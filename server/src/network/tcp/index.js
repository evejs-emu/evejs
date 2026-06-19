// EveJS Elysian TCP Server
// Handles client connections and drives the handshake state machine.
// After handshake, routes packets via the PacketDispatcher.

const path = require("path");
const net = require("net");
const pc = require("picocolors");

const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const EVEHandshake = require(path.join(__dirname, "./handshake"));
const { marshalDecode } = require(path.join(__dirname, "./utils/marshal"));
const ClientSession = require(path.join(__dirname, "../clientSession"));
const PacketDispatcher = require(path.join(__dirname, "../packetDispatcher"));
const sessionRegistry = require(path.join(
  __dirname,
  "../../services/chat/sessionRegistry",
));
const {
  disconnectCharacterSession,
} = require(path.join(__dirname, "../../services/_shared/sessionDisconnect"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const { logStartupDataSummary } = require(path.join(
  __dirname,
  "../../utils/startupDataSummary",
));
const tidiAutoscaler = require(path.join(
  __dirname,
  "../../utils/tidiAutoscaler",
));
const { MACHONETMSG_TYPE } = require(
  path.join(__dirname, "../../common/packetTypes"),
);
const { encodeAddress } = require(
  path.join(__dirname, "../../common/machoAddress"),
);
const { normalizeCountryCode } = require(path.join(
  __dirname,
  "../../services/machoNet/globalConfig",
));
const {
  composeSessionRoleMask,
} = require(path.join(
  __dirname,
  "../../services/account/accountRoleProfiles",
));
const dungeonUniverseRuntime = require(path.join(
  __dirname,
  "../../services/dungeon/dungeonUniverseRuntime",
));
const dungeonRuntime = require(path.join(
  __dirname,
  "../../services/dungeon/dungeonRuntime",
));
const dungeonUniverseSiteService = require(path.join(
  __dirname,
  "../../services/dungeon/dungeonUniverseSiteService",
));
const wormholeRuntime = require(path.join(
  __dirname,
  "../../services/exploration/wormholes/wormholeRuntime",
));

/**
 * start the tcp server.
 * @param {ServiceManager} serviceManager - the service manager with registered services
 */
module.exports = function (serviceManager) {
  const dispatcher = new PacketDispatcher(serviceManager);
  const startupPreloadPlan = spaceRuntime.getStartupSolarSystemPreloadPlan();

  log.startupSection(
    "NEW EDEN SYSTEM LOADING",
    [
      {
        label: "Mode",
        value: `${startupPreloadPlan.mode}  ${startupPreloadPlan.modeName}`,
      },
      {
        label: "Rule",
        value: startupPreloadPlan.selectionRule,
      },
      {
        label: "Targets",
        value: startupPreloadPlan.targetSummary,
      },
      {
        label: "Systems",
        value: `${startupPreloadPlan.systemIDs.length} queued for startup preload`,
      },
    ],
    {
      accentColor: pc.cyan,
      titleRenderer: (value) => pc.bgCyan(pc.black(value)),
      valueColor: pc.white,
      subtitle: "after DB cache, before scene bootstrap",
    },
  );

  const universePrepareStartedAtMs = Date.now();
  log.info(
    `[Startup] Dungeon universe prepare: evaluating persistent site state for ` +
      `${startupPreloadPlan.systemIDs.length} startup system(s)`,
  );
  const universeStartup = dungeonUniverseRuntime.prepareStartupUniversePersistentSites({
    startupSystemIDs: startupPreloadPlan.systemIDs,
  });
  const universePrepareElapsedMs = Date.now() - universePrepareStartedAtMs;
  log.info(
    `[Startup] Dungeon universe prepare complete in ${universePrepareElapsedMs}ms ` +
      `(fullUpToDate=${universeStartup && universeStartup.status && universeStartup.status.fullUpToDate === true} ` +
      `background=${universeStartup && universeStartup.background && universeStartup.background.reason})`,
  );

  const universeResumeStartedAtMs = Date.now();
  const seededCountsBeforeResume = dungeonUniverseRuntime.summarizeActiveUniverseSeededCounts();
  log.info("[Startup] Dungeon universe resume tick: reconciling expired/rotating persistent sites");
  const immediateUniverseTick = dungeonUniverseRuntime.advanceUniversePersistentSites({
    nowMs: Date.now(),
    lifecycleReason: "startup-resume",
  });
  const universeResumeElapsedMs = Date.now() - universeResumeStartedAtMs;
  const seededCountsAfterResume = dungeonUniverseRuntime.summarizeActiveUniverseSeededCounts();
  const expectedSeededTotalAfterResume =
    Number(seededCountsBeforeResume && seededCountsBeforeResume.totalCount || 0) -
    (Number(immediateUniverseTick && immediateUniverseTick.expiredCount) || 0) +
    (Number(immediateUniverseTick && immediateUniverseTick.rotatedCount) || 0);
  log.info(
    `[Startup] Dungeon universe resume tick complete in ${universeResumeElapsedMs}ms ` +
      `(expired=${Number(immediateUniverseTick && immediateUniverseTick.expiredCount) || 0} ` +
      `rotated=${Number(immediateUniverseTick && immediateUniverseTick.rotatedCount) || 0} ` +
      `removed=${Number(immediateUniverseTick && immediateUniverseTick.removedCount) || 0} ` +
      `seeded=${Number(seededCountsBeforeResume && seededCountsBeforeResume.totalCount) || 0}` +
      `->${Number(seededCountsAfterResume && seededCountsAfterResume.totalCount) || 0})`,
  );
  if ((Number(seededCountsAfterResume && seededCountsAfterResume.totalCount) || 0) !== expectedSeededTotalAfterResume) {
    log.warn(
      `[Startup] Dungeon universe resume tick count mismatch ` +
        `(expected=${expectedSeededTotalAfterResume} actual=${Number(seededCountsAfterResume && seededCountsAfterResume.totalCount) || 0} ` +
        `persistent=${Number(seededCountsAfterResume && seededCountsAfterResume.persistentCount) || 0} ` +
        `generatedMining=${Number(seededCountsAfterResume && seededCountsAfterResume.generatedMiningCount) || 0})`,
    );
  }

  log.info("[Startup] Starting dungeon universe runtime sync");
  dungeonUniverseSiteService.startRuntimeSync();
  log.info("[Startup] Starting dungeon universe ticker");
  dungeonUniverseRuntime.startTicker();
  log.info("[Startup] Starting dungeon runtime ticker");
  dungeonRuntime.startTicker();
  if (config.wormholesEnabled === true) {
    const wormholeWarmStartedAtMs = Date.now();
    log.info("[Startup] Warming wormhole runtime state before space scene preload");
    const wormholeWarm = wormholeRuntime.warmRuntimeCache(Date.now());
    log.info(
      `[Startup] Wormhole runtime warm complete in ${Date.now() - wormholeWarmStartedAtMs}ms ` +
        `(active=${Number(wormholeWarm && wormholeWarm.activePairCount) || 0} ` +
        `total=${Number(wormholeWarm && wormholeWarm.totalPairCount) || 0})`,
    );
  }
  log.info("[Startup] Starting space scene preload");
  spaceRuntime.preloadStartupSolarSystems({ broadcast: false });

  function logDebug(t) {
    if (config.logLevel > 1) log.debug(t);
  }

  function logInfo(t) {
    if (config.logLevel > 0) log.info(t);
  }

  const server = net
    .createServer((socket) => {
      logInfo(
        `New connection from ${socket.remoteAddress}:${socket.remotePort}`,
      );

      let tcpBuffer = Buffer.alloc(0);

      // Create a handshake state machine for this connection
      const handshake = new EVEHandshake(socket);
      let handshakeComplete = false;
      let clientSession = null;

      // Start the handshake (sends VersionExchangeServer)
      handshake.start();

      // Listen for data
      socket.on("data", (chunk) => {
        tcpBuffer = Buffer.concat([tcpBuffer, chunk]);

        // Frame-level parsing: packets are [4-byte LE length] [payload]
        while (tcpBuffer.length >= 4) {
          const payloadLength = tcpBuffer.readUInt32LE(0);

          // Sanity check
          if (payloadLength <= 0 || payloadLength > 10_000_000) {
            log.err(`[TCP] Invalid payload length: ${payloadLength}`);
            tcpBuffer = Buffer.alloc(0);
            break;
          }

          const totalLength = 4 + payloadLength;
          if (tcpBuffer.length < totalLength) break; // Need more data

          // Extract the payload (everything after the 4-byte length)
          const payload = tcpBuffer.slice(4, totalLength);
          tcpBuffer = tcpBuffer.slice(totalLength);

          if (!handshakeComplete) {
            // Pass to handshake state machine
            try {
              const result = handshake.handlePacket(payload);
              if (result.done) {
                handshakeComplete = true;
                logDebug(
                  `Handshake complete for ${socket.remoteAddress} — entering packet dispatch mode`,
                );

                // Create client session from handshake data
                clientSession = new ClientSession(
                  {
                    userId: handshake.userId,
                    userName: handshake.userName,
                    clientId: handshake.clientId,
                    accountRole: handshake.accountRole,
                    chatRole: handshake.role,
                    role: composeSessionRoleMask(
                      handshake.accountRole,
                      handshake.role,
                    ),
                    languageId: handshake.languageId,
                    countryCode: handshake.countryCode,
                    sessionId: handshake.sessionId,
                  },
                  socket,
                  {
                    encrypted: handshake.encrypted,
                    sessionKey: handshake.sessionKey,
                    sessionIV: handshake.sessionIV,
                    encryptFn: handshake.encrypted
                      ? (data) => handshake._encrypt(data)
                      : null,
                    decryptFn: handshake.encrypted
                      ? (data) => handshake._decrypt(data)
                      : null,
                  },
                );

                logInfo(
                  `session created for ${clientSession.userName} (ID: ${clientSession.userid})`,
                );
                sessionRegistry.register(clientSession);

                // Send SessionInitialStateNotification to unblock client
                // The client waits for this before making further service calls
                _sendSessionInitNotification(clientSession, config);
              }
            } catch (err) {
              log.err(`handshake error: ${err.message}`);
              logDebug(`stack: ${err.stack}`);
            }
          } else {
            // ── Post-handshake packet dispatch ──────────────────────────
            try {
              // Decrypt if needed
              let data = payload;
              if (clientSession) {
                data = clientSession.decryptPacket(payload);
              }

              // Check for zlib compression
              if (data[0] === 0x78) {
                const zlib = require("zlib");
                data = zlib.inflateSync(data);
              }

              // Unmarshal the packet
              const decoded = marshalDecode(data);

              if (log.isPacketPayloadDebugEnabled()) {
                if (decoded && decoded.type === "object" && decoded.args) {
                  logDebug(
                    `[TCP] incoming PyPacket: ${decoded.name} has tuple length: ${decoded.args.length}`,
                  );
                }

                logDebug(
                  `[TCP] decoded packet: ${JSON.stringify(decoded, (k, v) => {
                    if (typeof v === "bigint") return v.toString();
                    if (v && v.type === "Buffer" && v.data) {
                      try {
                        return `<Buffer:${Buffer.from(v.data).toString("utf8")}>`;
                      } catch (e) {}
                    }
                    return v;
                  }).substring(0, 500)}`,
                );
              }

              // Dispatch asynchronously so services can await external RPC calls
              Promise.resolve(dispatcher.dispatch(decoded, clientSession)).catch((err) => {
                log.err(`[TCP] async packet dispatch error: ${err.message}`);
                logDebug(`[TCP] async dispatch stack: ${err.stack}`);
              });
            } catch (err) {
              log.err(`[TCP] packet processing error: ${err.message}`);
              logDebug(`[TCP] stack: ${err.stack}`);
              logDebug(
                `[TCP] raw: ${payload.toString("hex").substring(0, 80)}...`,
              );
            }
          }
        }
      });

      socket.on("close", () => {
        if (clientSession) {
          disconnectCharacterSession(clientSession, {
            broadcast: true,
            clearSession: true,
          });
          sessionRegistry.unregister(clientSession);
        }
        logInfo(
          `connection closed: ${socket.remoteAddress}:${socket.remotePort}`,
        );
      });

      socket.on("error", (err) => {
        if (clientSession) {
          disconnectCharacterSession(clientSession, {
            broadcast: true,
            clearSession: true,
          });
          sessionRegistry.unregister(clientSession);
        }
        log.err(`[TCP] socket error: ${err.message}`);
      });
    })
    .listen(config.serverPort, "0.0.0.0", () => {
      log.success(`EveJS Elysian is running!`);
      log.success(`(port: ${config.serverPort})`);
      try {
        logStartupDataSummary();
      } catch (error) {
        log.warn(
          `[Startup] Failed to print data summary: ${error.message}`,
        );
      }
      const universeStatus = universeStartup && universeStartup.status
        ? universeStartup.status
        : null;
      const universeBackground = universeStartup && universeStartup.background
        ? universeStartup.background
        : null;
      if (universeStatus && universeStatus.fullUpToDate === true) {
        log.info("[DungeonUniverse] cached universe site state is current; skipped full startup rebuild");
        if (immediateUniverseTick && immediateUniverseTick.rotatedCount > 0) {
          log.info(
            `[DungeonUniverse] resumed ${immediateUniverseTick.rotatedCount} expired persistent site slots on startup`,
          );
        }
      } else if (universeBackground && universeBackground.needsFullReconcile === true) {
        log.warn(
          "[DungeonUniverse] persistent universe site state is stale; startup will not auto-reconcile it. " +
          "Run tools\\universe-site-seed\\BuildUniverseSiteSeed.bat to inspect or reseed the universe.",
        );
      }
      tidiAutoscaler.init();
    });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      const pc = require("picocolors");
      console.error("");
      console.error(pc.red("  ╔══════════════════════════════════════════════════════════════╗"));
      console.error(pc.red("  ║") + pc.bold(pc.yellowBright("   ⚠  EVE.JS SERVER ALREADY RUNNING  ⚠                      ")) + pc.red("║"));
      console.error(pc.red("  ╠══════════════════════════════════════════════════════════════╣"));
      console.error(pc.red("  ║") + pc.white(`   Port ${err.port || config.serverPort} is already in use.`) + " ".repeat(Math.max(0, 37 - String(err.port || config.serverPort).length)) + pc.red("║"));
      console.error(pc.red("  ║") + pc.white("   Kill the other instance first, then try again.          ") + pc.red("║"));
      console.error(pc.red("  ╚══════════════════════════════════════════════════════════════╝"));
      console.error("");
      process.exit(1);
    } else {
      log.err(`[TCP] server error: ${err.message}`);
    }
  });
};

/**
 * Send a SessionInitialStateNotification to the client.
 * The client blocks until it receives this after the handshake.
 */
function _sendSessionInitNotification(session, config) {
  const sessionID =
    typeof session.sid === "bigint"
      ? session.sid
      : BigInt(session.sid || session.sessionID || (Date.now() * 15));
  session.sid = sessionID;
  session.sessionID = sessionID;

  const initialState = {
    type: "dict",
    entries: [
      ["userid", session.userid || 0],
      ["userType", 30],
      [
        "role",
        {
          type: "long",
          value: composeSessionRoleMask(
            session.accountRole || session.role || 0,
            session.chatRole || 0,
          ),
        },
      ],
      ["address", session.address || config.gameServerHost || "127.0.0.1"],
      ["languageID", session.languageID || "EN"],
      [
        "countryCode",
        normalizeCountryCode(session.countryCode, config.defaultCountryCode),
      ],
    ],
  };

  const payload = [
    { type: "long", value: sessionID },
    5, // sessionType = GAME
    initialState,
  ];

  const responseTuple = [
    MACHONETMSG_TYPE.SESSIONINITIALSTATENOTIFICATION, // type = 18
    encodeAddress({
      type: "node",
      nodeID: config.proxyNodeId,
      callID: 0,
      service: null,
    }),
    encodeAddress({
      type: "client",
      clientID: session.clientID || session.clientId || 0,
      callID: 0,
      service: null,
    }),
    session.userid || null,
    payload, // payload tuple
    { type: "dict", entries: [] }, // named payload
    null, // contextKey
    null, // traceID/bssid (8th element)
    null, // spanID/bssctx (9th element)
    null, // 10th
    null, // 11th
    null, // 12th
    null, // 13th
    null, // 14th
  ];

  const packet = {
    type: "object",
    name: "carbon.common.script.net.machoNetPacket.SessionInitialStateNotification",
    args: responseTuple,
  };

  log.pktOut("SessionInit", `initial state for user ${session.userid}`);
  session.sendPacket(packet);
}
