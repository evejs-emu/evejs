const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const {
  buildBoundObjectResponse,
  buildFiletimeLong,
  extractDictEntries,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  throwWrappedUserError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  jumpSessionViaStargate,
} = require(path.join(__dirname, "../../space/transitions"));
const {
  flushPendingCommandSessionEffects,
} = require(path.join(__dirname, "../chat/commandSessionEffects"));
const {
  getCynoJammerOnlineSimTime,
} = require(path.join(__dirname, "../sovereignty/sovSuppressionState"));
const fleetRuntime = require(path.join(__dirname, "../fleets/fleetRuntime"));
const planetRuntimeStore = require(path.join(__dirname, "../planet/planetRuntimeStore"));
const bookmarkStore = require(path.join(__dirname, "../character/bookmarkStore"));
const sharedBookmarkStore = require(path.join(__dirname, "../character/sharedBookmarkStore"));
const bookmarkNotifications = require(path.join(__dirname, "../character/bookmarkNotifications"));
const bookmarkRuntime = require(path.join(__dirname, "../bookmark/bookmarkRuntimeState"));
const {
  resolveLocationBookmarkTarget,
} = require(path.join(__dirname, "../bookmark/bookmarkTargetResolver"));
const {
  TYPE_SOLAR_SYSTEM,
} = require(path.join(__dirname, "../bookmark/bookmarkConstants"));
const signatureRuntime = require(path.join(
  __dirname,
  "../exploration/signatures/signatureRuntime",
));
const USER_ERROR_LOCALIZATION_LABEL = 101;
const STARGATE_CLOSED_LABEL = "UI/GateIcons/GateClosed";
const STARGATE_TOO_FAR_LABEL = "UI/Menusvc/MenuHints/NotWithingMaxJumpDist";
const CRIMEWATCH_WARP_BLOCKED_MESSAGE = "Warp is disabled while the criminal timer is active.";
const SHARED_BOOKMARK_DELAY_MS = 2 * 60 * 1000;
const BOOKMARK_EXPIRY_MS = {
  1: 4 * 60 * 60 * 1000,
  2: 2 * 24 * 60 * 60 * 1000,
  3: 24 * 60 * 60 * 1000,
};

function getKwargValue(kwargs, key) {
  const entries = extractDictEntries(kwargs);
  const match = entries.find(([entryKey]) => String(entryKey) === String(key));
  return match ? match[1] : null;
}

function getBookmarkSubfolderID(kwargs) {
  return normalizeNumber(getKwargValue(kwargs, "subfolderID"), 0) || null;
}

function buildBookmarkReplyTuple(bookmark = {}) {
  return [
    normalizeNumber(bookmark.bookmarkID, 0),
    bookmark.itemID || null,
    normalizeNumber(bookmark.typeID, TYPE_SOLAR_SYSTEM),
    bookmark.x == null ? null : Number(bookmark.x),
    bookmark.y == null ? null : Number(bookmark.y),
    bookmark.z == null ? null : Number(bookmark.z),
    normalizeNumber(bookmark.locationID, 0),
    bookmark.expiry ? buildFiletimeLong(bookmark.expiry) : null,
  ];
}

function wrapBookmarkReplyTuple(tuple) {
  if (!Array.isArray(tuple)) {
    return tuple;
  }
  if (tuple[7] != null) {
    tuple[7] = buildFiletimeLong(tuple[7]);
  }
  return tuple;
}

function translateBookmarkExpiryMode(expiryMode) {
  const offsetMs = BOOKMARK_EXPIRY_MS[normalizeNumber(expiryMode, 0)] || null;
  return offsetMs === null ? null : Date.now() + offsetMs;
}

function filetimeToMs(filetimeStr) {
  if (filetimeStr == null) {
    return 0;
  }
  try {
    const EVE_EPOCH_OFFSET_MS = 11644473600000n;
    return Number(BigInt(filetimeStr) / 10000n - EVE_EPOCH_OFFSET_MS);
  } catch (_) {
    return 0;
  }
}

function isBookmarkDelayed(bookmark, charID) {
  if (!bookmark || !bookmark.creatorID) {
    return false;
  }
  if (Number(bookmark.creatorID) === Number(charID)) {
    return false;
  }

  const createdMs = filetimeToMs(bookmark.created);
  if (createdMs <= 0) {
    return false;
  }

  return Date.now() - createdMs < SHARED_BOOKMARK_DELAY_MS;
}

function resolveBookmarkAnyStore(session, bookmarkID) {
  const charID = session && session.characterID;
  const personalBookmark = bookmarkStore.getBookmarkByID(charID, bookmarkID);
  if (personalBookmark) {
    return personalBookmark;
  }

  const knownSharedFolders = bookmarkStore.getKnownSharedFolders(charID);
  for (const knownFolder of knownSharedFolders) {
    if (!knownFolder || !knownFolder.isActive) {
      continue;
    }
    const bookmarks = sharedBookmarkStore.getBookmarksInFolder(knownFolder.folderID);
    const match = bookmarks.find((bookmark) => Number(bookmark.bookmarkID) === Number(bookmarkID));
    if (!match) {
      continue;
    }
    if (isBookmarkDelayed(match, charID)) {
      log.info(
        `[Beyonce] Bookmark ${bookmarkID} is still in the shared delay window for char=${charID}`,
      );
      return null;
    }
    return match;
  }

  return null;
}

function resolveBookmarkAlignTarget(session, bookmarkID) {
  const bookmark = resolveBookmarkAnyStore(session, bookmarkID);
  return normalizeNumber(bookmark && bookmark.itemID, 0);
}

function addBookmarkToFolder(charID, folderID, bookmarkOpts) {
  let replyTuple = null;

  if (sharedBookmarkStore.isSharedFolderID(folderID)) {
    replyTuple = sharedBookmarkStore.addBookmarkToSharedFolder(folderID, bookmarkOpts);
    if (replyTuple) {
      const bookmarks = sharedBookmarkStore.getBookmarksInFolder(folderID);
      const newBookmark = bookmarks.find(
        (bookmark) => Number(bookmark.bookmarkID) === Number(replyTuple[0]),
      );
      if (newBookmark) {
        const update = bookmarkNotifications.buildBookmarksAddedUpdate(folderID, [newBookmark]);
        bookmarkNotifications.broadcastFolderUpdate(folderID, [update], charID);
      }
    }
  } else {
    replyTuple = bookmarkStore.addBookmark(charID, bookmarkOpts);
  }

  return wrapBookmarkReplyTuple(replyTuple);
}

function resolveBookmarkTargetForSession(session, bookmarkID, options = {}) {
  const bookmarkInfo = bookmarkRuntime.getBookmarkForCharacter(
    session && session.characterID,
    bookmarkID,
    options,
  );
  if (!bookmarkInfo) {
    return null;
  }
  const target = bookmarkRuntime.resolveBookmarkTarget(bookmarkID);
  return target ? { ...target, bookmarkInfo } : null;
}

function isDockedStructureObserverSession(session) {
  return Boolean(
    !session?._space &&
      Number(session && (session.structureID || session.structureid)) > 0 &&
      Number(session && (session.solarsystemid || session.solarsystemid2)) > 0,
  );
}

function bootstrapSessionBallpark(session, options = {}) {
  if (isDockedStructureObserverSession(session)) {
    return spaceRuntime.bootstrapDockedStructureView(session, options);
  }

  spaceRuntime.markBeyonceBound(session);
  return spaceRuntime.ensureInitialBallpark(session, options);
}

function prepareSessionBallpark(session) {
  if (
    isDockedStructureObserverSession(session)
  ) {
    return spaceRuntime.prepareDockedStructureView(session);
  }

  return bootstrapSessionBallpark(session, {
    allowDeferredJumpBootstrapVisuals: true,
  });
}

function getSessionSolarSystemID(session) {
  return normalizeNumber(
    session &&
      (
        (session._space && session._space.systemID) ||
        session.solarsystemid2 ||
        session.solarsystemid
      ),
    0,
  );
}

function buildScanSiteWarpPoint(site) {
  if (site && site.actualPosition && typeof site.actualPosition === "object") {
    return {
      x: normalizeNumber(site.actualPosition.x, 0),
      y: normalizeNumber(site.actualPosition.y, 0),
      z: normalizeNumber(site.actualPosition.z, 0),
    };
  }

  if (Array.isArray(site && site.position)) {
    return {
      x: normalizeNumber(site.position[0], 0),
      y: normalizeNumber(site.position[1], 0),
      z: normalizeNumber(site.position[2], 0),
    };
  }

  return null;
}

function ensureUniverseSiteContentsMaterialized(scene, siteOrEntity, options = {}) {
  if (!scene) {
    return null;
  }
  try {
    const dungeonUniverseSiteService = require(path.join(
      __dirname,
      "../dungeon/dungeonUniverseSiteService",
    ));
    return dungeonUniverseSiteService.ensureSiteContentsMaterialized(scene, siteOrEntity, options);
  } catch (error) {
    log.warn(
      `[Beyonce] Failed to materialize universe site contents in system=${normalizeNumber(scene && scene.systemID, 0)}: ${error.message}`,
    );
    return null;
  }
}

function maybeMaterializeMissionBookmarkTarget(session, bookmarkTarget) {
  const metadata =
    bookmarkTarget &&
    bookmarkTarget.metadata &&
    typeof bookmarkTarget.metadata === "object"
      ? bookmarkTarget.metadata
      : (
        bookmarkTarget &&
        bookmarkTarget.bookmarkInfo &&
        bookmarkTarget.bookmarkInfo.bookmark &&
        bookmarkTarget.bookmarkInfo.bookmark.metadata &&
        typeof bookmarkTarget.bookmarkInfo.bookmark.metadata === "object"
      )
        ? bookmarkTarget.bookmarkInfo.bookmark.metadata
        : {};
  const missionInstanceID = normalizeNumber(metadata.missionInstanceID, 0);
  if (missionInstanceID <= 0) {
    return null;
  }
  const scene = spaceRuntime.getSceneForSession(session);
  return ensureUniverseSiteContentsMaterialized(scene, {
    instanceID: missionInstanceID,
  }, {
    spawnEncounters: true,
    broadcast: true,
    session,
  });
}

function resolveScanWarpTarget(session, targetID) {
  const systemID = getSessionSolarSystemID(session);
  if (systemID <= 0) {
    return null;
  }

  const site = signatureRuntime.resolveSiteByTargetID(systemID, targetID, {
    loadScene: true,
  });
  if (!site) {
    return null;
  }
  const scene = spaceRuntime.getSceneForSession(session);
  ensureUniverseSiteContentsMaterialized(scene, site, {
    spawnEncounters: true,
    broadcast: true,
    session,
  });

  const entityID = normalizeNumber(
    site.itemID || site.endpointID || site.siteID,
    0,
  );
  if (entityID > 0) {
    const entity =
      scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(entityID)
        : null;
    if (entity) {
      return {
        kind: "entity",
        entityID,
        site,
      };
    }
  }

  const point = buildScanSiteWarpPoint(site);
  if (point) {
    return {
      kind: "point",
      point,
      site,
    };
  }

  return null;
}

class BeyonceService extends BaseService {
  constructor() {
    super("beyonce");
    this.reuseBoundObjectForSession = true;
  }

  _throwStargateJumpUserError(errorMsg = "") {
    switch (String(errorMsg || "").trim()) {
      case "NOT_IN_SPACE":
      case "SHIP_NOT_FOUND":
      case "WRONG_SOLAR_SYSTEM":
        throwWrappedUserError("DeniedShipChanged");
        break;
      case "STARGATE_NOT_FOUND":
      case "STARGATE_DESTINATION_MISMATCH":
        throwWrappedUserError("TargetingAttemptCancelled");
        break;
      case "TOO_FAR_FROM_STARGATE":
        throwWrappedUserError("CustomInfo", {
          info: [USER_ERROR_LOCALIZATION_LABEL, STARGATE_TOO_FAR_LABEL],
        });
        break;
      case "STARGATE_NOT_ACTIVE":
        throwWrappedUserError("CustomInfo", {
          info: [USER_ERROR_LOCALIZATION_LABEL, STARGATE_CLOSED_LABEL],
        });
        break;
      case "STARGATE_JUMP_IN_PROGRESS":
        throwWrappedUserError("CustomInfo", {
          info: "Stargate jump already in progress.",
        });
        break;
      default:
        throwWrappedUserError("CustomInfo", {
          info: "The stargate jump could not be completed.",
        });
        break;
    }
  }

  Handle_GetFormations(args, session) {
    // Docked structure exterior view is a view toggle, not a fresh space login.
    // The stock client may return to hangar without re-fetching hangar state,
    // so prepare a fresh exterior observer cache here and send the real
    // ballpark bootstrap only once Michelle completes MachoBindObject.
    const startedAtMs = Date.now();
    const prepared = prepareSessionBallpark(session);
    const elapsedMs = Date.now() - startedAtMs;
    if (
      typeof spaceRuntime.recordSessionJumpTimingTrace === "function"
    ) {
      spaceRuntime.recordSessionJumpTimingTrace(session, "beyonce-get-formations", {
        elapsedMs,
        prepared: prepared === true,
      });
    }
    if (elapsedMs >= 100) {
      log.info(`[Beyonce] GetFormations prepareSessionBallpark took ${elapsedMs}ms`);
    }

    return [
      [
        "Diamond",
        [
          [100.0, 0.0, 0.0],
          [0.0, 100.0, 0.0],
          [-100.0, 0.0, 0.0],
          [0.0, -100.0, 0.0],
        ],
      ],
      [
        "Arrow",
        [
          [100.0, 0.0, -50.0],
          [50.0, 0.0, 0.0],
          [-100.0, 0.0, -50.0],
          [-50.0, 0.0, 0.0],
        ],
      ],
    ];
  }

  Handle_UpdateStateRequest(args, session) {
    if (isDockedStructureObserverSession(session)) {
      const startedAtMs = Date.now();
      bootstrapSessionBallpark(session, {
        allowDeferredJumpBootstrapVisuals: true,
      });
      const elapsedMs = Date.now() - startedAtMs;
      if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
        spaceRuntime.recordSessionJumpTimingTrace(session, "beyonce-update-state-request", {
          elapsedMs,
          dockedStructureObserver: true,
        });
      }
      return null;
    }

    spaceRuntime.markBeyonceBound(session);
    const scene = spaceRuntime.getSceneForSession(session);
    const egoEntity = scene && scene.getShipEntityForSession(session);
    if (
      scene &&
      egoEntity &&
      session &&
      session._space &&
      session._space.initialStateSent
    ) {
      scene.sendStateRefresh(session, egoEntity);
      if (typeof scene.flushDirectDestinyNotificationBatchIfIdle === "function") {
        scene.flushDirectDestinyNotificationBatchIfIdle();
      }
      return null;
    }

    const startedAtMs = Date.now();
    bootstrapSessionBallpark(session, {
      allowDeferredJumpBootstrapVisuals: true,
    });
    const elapsedMs = Date.now() - startedAtMs;
    if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
      spaceRuntime.recordSessionJumpTimingTrace(session, "beyonce-update-state-request", {
        elapsedMs,
        dockedStructureObserver: false,
      });
    }
    if (elapsedMs >= 100) {
      log.info(`[Beyonce] UpdateStateRequest bootstrap took ${elapsedMs}ms`);
    }
    return null;
  }

  Handle_GetCynoJammerState(args, session) {
    return getCynoJammerOnlineSimTime(getSessionSolarSystemID(session));
  }

  Handle_CmdGotoDirection(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);

    log.info(
      `[Beyonce] CmdGotoDirection char=${session && session.characterID} dir=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoDirection(session, { x, y, z }, {
      commandSource: "CmdGotoDirection",
      ownerLocallyPredictsHeading: false,
    });
    return null;
  }

  Handle_CmdSteerDirection(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);

    log.info(
      `[Beyonce] CmdSteerDirection char=${session && session.characterID} dir=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoDirection(session, { x, y, z }, {
      commandSource: "CmdSteerDirection",
      ownerLocallyPredictsHeading: true,
    });
    return null;
  }

  Handle_CmdGotoPoint(args, session) {
    const x = normalizeNumber(args && args[0], 0);
    const y = normalizeNumber(args && args[1], 0);
    const z = normalizeNumber(args && args[2], 0);

    log.info(
      `[Beyonce] CmdGotoPoint char=${session && session.characterID} point=(${x}, ${y}, ${z})`,
    );
    spaceRuntime.gotoPoint(session, { x, y, z });
    return null;
  }

  Handle_CmdGotoBookmark(args, session) {
    const bookmarkID = normalizeNumber(args && args[0], 0);
    const bookmark = resolveBookmarkAnyStore(session, bookmarkID);
    log.info(
      `[Beyonce] CmdGotoBookmark char=${session && session.characterID} bookmark=${bookmarkID}`,
    );
    if (!bookmark) {
      throwWrappedUserError("BookmarkNotAvailable");
    }

    const targetID = normalizeNumber(bookmark.itemID, 0);
    if (targetID > 0) {
      const scene = spaceRuntime.getSceneForSession(session);
      const entity =
        scene && typeof scene.getEntityByID === "function"
          ? scene.getEntityByID(targetID)
          : null;
      if (entity) {
        spaceRuntime.followBall(session, targetID, 0);
        return null;
      }
    }

    const point = {
      x: normalizeNumber(bookmark.x, 0),
      y: normalizeNumber(bookmark.y, 0),
      z: normalizeNumber(bookmark.z, 0),
    };
    if (point.x !== 0 || point.y !== 0 || point.z !== 0) {
      spaceRuntime.gotoPoint(session, point, {
        commandSource: "CmdGotoBookmark",
      });
      return null;
    }

    throwWrappedUserError("BookmarkNotAvailable");
  }

  Handle_CmdAlignTo(args, session, kwargs) {
    const positionalTargetID = normalizeNumber(args && args[0], 0);
    const kwargTargetID = normalizeNumber(getKwargValue(kwargs, "dstID"), 0);
    const bookmarkID = normalizeNumber(getKwargValue(kwargs, "bookmarkID"), 0);
    const targetID =
      positionalTargetID ||
      kwargTargetID ||
      resolveBookmarkAlignTarget(session, bookmarkID);
    log.info(
      `[Beyonce] CmdAlignTo char=${session && session.characterID} target=${targetID} bookmark=${bookmarkID}`,
    );

    if (targetID > 0) {
      spaceRuntime.alignTo(session, targetID);
      return null;
    }

    if (bookmarkID > 0) {
      const bookmark = resolveBookmarkAnyStore(session, bookmarkID);
      if (bookmark) {
        const point = {
          x: normalizeNumber(bookmark.x, 0),
          y: normalizeNumber(bookmark.y, 0),
          z: normalizeNumber(bookmark.z, 0),
        };
        if (point.x !== 0 || point.y !== 0 || point.z !== 0) {
          spaceRuntime.gotoPoint(session, point, {
            commandSource: "CmdAlignToBookmark",
          });
          return null;
        }
      }
    }

    spaceRuntime.alignTo(session, targetID);
    return null;
  }

  Handle_CmdFollowBall(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    const range = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdFollowBall char=${session && session.characterID} target=${targetID} range=${range}`,
    );
    if (targetID > 0 && range <= 50) {
      const dockingDebug = spaceRuntime.getDockingDebugState(session, targetID);
      if (dockingDebug) {
        log.info(`[Beyonce] CmdFollowBall dockingState=${JSON.stringify(dockingDebug)}`);
      }
    }

    spaceRuntime.followBall(session, targetID, range);
    return null;
  }

  Handle_CmdOrbit(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    const range = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdOrbit char=${session && session.characterID} target=${targetID} range=${range}`,
    );
    spaceRuntime.orbit(session, targetID, range);
    return null;
  }

  Handle_CmdSetSpeedFraction(args, session) {
    const fraction = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdSetSpeedFraction char=${session && session.characterID} fraction=${fraction}`,
    );
    spaceRuntime.setSpeedFraction(session, fraction);
    return null;
  }

  Handle_CmdStop(args, session) {
    log.info(`[Beyonce] CmdStop char=${session && session.characterID}`);
    spaceRuntime.stop(session);
    return null;
  }

  Handle_CmdFleetTagTarget(args, session) {
    const itemID = normalizeNumber(args && args[0], 0);
    const tag = args && args.length > 1 ? args[1] : null;
    log.info(
      `[Beyonce] CmdFleetTagTarget char=${session && session.characterID} item=${itemID} tag=${tag === null || tag === undefined ? "<clear>" : String(tag)}`,
    );
    fleetRuntime.setFleetTargetTag(session, itemID, tag);
    return null;
  }

  Handle_CmdWarpToStuff(args, session, kwargs) {
    const warpType = String(args && args[0] ? args[0] : "");
    const rawTarget = args && args.length > 1 ? args[1] : null;
    const numericTarget = normalizeNumber(rawTarget, 0);
    const minimumRange = normalizeNumber(kwargs && kwargs.minRange, 0);

    log.info(
      `[Beyonce] CmdWarpToStuff char=${session && session.characterID} type=${warpType} target=${numericTarget || rawTarget} minRange=${minimumRange}`,
    );

    let result = null;
    if (warpType === "scan" && rawTarget !== null && rawTarget !== undefined) {
      const scanTarget = resolveScanWarpTarget(session, rawTarget);
      if (scanTarget && scanTarget.kind === "entity") {
        result = spaceRuntime.warpToEntity(session, scanTarget.entityID, {
          minimumRange,
        });
      } else if (scanTarget && scanTarget.kind === "point") {
        result = spaceRuntime.warpToPoint(session, scanTarget.point, {
          minimumRange,
          stopDistance: minimumRange,
        });
      } else if (numericTarget > 0) {
        result = spaceRuntime.warpToEntity(session, numericTarget, { minimumRange });
      } else {
        result = {
          success: false,
          errorMsg: "SCAN_TARGET_NOT_FOUND",
        };
      }
    } else if (warpType === "launch" && numericTarget > 0) {
      const launch = planetRuntimeStore.getLaunch(
        numericTarget,
        session && session.characterID,
      );
      if (launch) {
        const launchItemID = normalizeNumber(launch.itemID || launch.launchID, 0);
        if (launchItemID > 0) {
          result = spaceRuntime.warpToEntity(session, launchItemID, { minimumRange });
        }
        if (!result || !result.success) {
          result = spaceRuntime.warpToPoint(session, {
            x: normalizeNumber(launch.x, 0),
            y: normalizeNumber(launch.y, 0),
            z: normalizeNumber(launch.z, 0),
          }, {
            minimumRange,
            stopDistance: minimumRange,
          });
        }
      } else {
        result = spaceRuntime.warpToEntity(session, numericTarget, { minimumRange });
      }
    } else if (
      (warpType === "item" || warpType === "char" || !warpType) &&
      numericTarget > 0
    ) {
      const scene = spaceRuntime.getSceneForSession(session);
      const entity =
        scene && typeof scene.getEntityByID === "function"
          ? scene.getEntityByID(numericTarget)
          : null;
      if (
        entity &&
        (
          entity.signalTrackerUniverseSeededSite === true ||
          String(entity.kind || "").trim() === "missionSite"
        )
      ) {
        ensureUniverseSiteContentsMaterialized(scene, {
          siteID: numericTarget,
        }, {
          spawnEncounters: true,
          broadcast: true,
          session,
        });
      }
      result = spaceRuntime.warpToEntity(session, numericTarget, { minimumRange });
    } else if (warpType === "bookmark" && numericTarget > 0) {
      const bookmark = resolveBookmarkAnyStore(session, numericTarget);
      if (!bookmark) {
        throwWrappedUserError("BookmarkNotAvailable");
      }

      const bookmarkItemID = normalizeNumber(bookmark.itemID, 0);
      if (bookmarkItemID > 0) {
        result = spaceRuntime.warpToEntity(session, bookmarkItemID, { minimumRange });
        if ((!result || !result.success) &&
          (
            normalizeNumber(bookmark.x, 0) !== 0 ||
            normalizeNumber(bookmark.y, 0) !== 0 ||
            normalizeNumber(bookmark.z, 0) !== 0
          )
        ) {
          result = spaceRuntime.warpToPoint(session, {
            x: normalizeNumber(bookmark.x, 0),
            y: normalizeNumber(bookmark.y, 0),
            z: normalizeNumber(bookmark.z, 0),
          }, {
            minimumRange,
          });
        }
      } else {
        result = spaceRuntime.warpToPoint(session, {
          x: normalizeNumber(bookmark.x, 0),
          y: normalizeNumber(bookmark.y, 0),
          z: normalizeNumber(bookmark.z, 0),
        }, {
          minimumRange,
        });
      }
    } else if (
      rawTarget &&
      typeof rawTarget === "object" &&
      rawTarget.x !== undefined &&
      rawTarget.y !== undefined &&
      rawTarget.z !== undefined
    ) {
      result = spaceRuntime.warpToPoint(session, rawTarget, { minimumRange });
    } else {
      result = {
        success: false,
        errorMsg: "UNSUPPORTED_WARP_TARGET",
      };
    }

    if (!result || !result.success) {
      log.warn(
        `[Beyonce] CmdWarpToStuff failed for char=${session && session.characterID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      );
      if (result && result.errorMsg === "CRIMINAL_TIMER_ACTIVE") {
        throwWrappedUserError("CustomInfo", {
          info: CRIMEWATCH_WARP_BLOCKED_MESSAGE,
        });
      }
    }

    return null;
  }

  Handle_CmdWarpToStuffAutopilot(args, session) {
    const targetID = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdWarpToStuffAutopilot char=${session && session.characterID} target=${targetID}`,
    );
    const result = spaceRuntime.warpToEntity(session, targetID, { minimumRange: 10000 });
    if (!result || !result.success) {
      log.warn(
        `[Beyonce] CmdWarpToStuffAutopilot failed for char=${session && session.characterID}: ${(result && result.errorMsg) || "UNKNOWN_ERROR"}`,
      );
      if (result && result.errorMsg === "CRIMINAL_TIMER_ACTIVE") {
        throwWrappedUserError("CustomInfo", {
          info: CRIMEWATCH_WARP_BLOCKED_MESSAGE,
        });
      }
    }
    return null;
  }

  Handle_CmdDock(args, session) {
    const stationID = normalizeNumber(args && args[0], 0);
    log.info(
      `[Beyonce] CmdDock char=${session && session.characterID} station=${stationID}`,
    );
    const dockingDebug = spaceRuntime.getDockingDebugState(session, stationID);
    if (dockingDebug) {
      log.info(`[Beyonce] CmdDock state=${JSON.stringify(dockingDebug)}`);
    }

    if (!spaceRuntime.canDockAtStation(session, stationID)) {
      log.info(
        `[Beyonce] CmdDock converting to docking approach for char=${session && session.characterID} station=${stationID}`,
      );
      const followed = spaceRuntime.followBall(session, stationID, 2500, {
        dockingTargetID: stationID,
      });
      if (!followed) {
        log.info(
          `[Beyonce] CmdDock keeping existing docking approach for char=${session && session.characterID} station=${stationID}`,
        );
      }
      throwWrappedUserError("DockingApproach");
    }

    const result = spaceRuntime.acceptDocking(session, stationID);
    if (!result.success) {
      log.warn(
        `[Beyonce] CmdDock failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      return null;
    }

    return result.data.acceptedAtFileTime || null;
  }

  Handle_CmdStargateJump(args, session) {
    const fromStargateID = normalizeNumber(args && args[0], 0);
    const toStargateID = normalizeNumber(args && args[1], 0);
    log.info(
      `[Beyonce] CmdStargateJump char=${session && session.characterID} from=${fromStargateID} to=${toStargateID}`,
    );

    const result = jumpSessionViaStargate(session, fromStargateID, toStargateID);
    if (!result.success) {
      log.warn(
        `[Beyonce] CmdStargateJump failed for char=${session && session.characterID}: ${result.errorMsg}`,
      );
      this._throwStargateJumpUserError(result.errorMsg);
    }

    return result.data.boundResult || null;
  }

  Handle_BookmarkLocation(args, session, kwargs) {
    const charID = session && session.characterID;
    const itemID = normalizeNumber(args && args[0], 0);
    const folderID = normalizeNumber(args && args[1], 0);
    const name = normalizeText(args && args[2], "");
    const comment = normalizeText(args && args[3], "");
    const expiryMode = normalizeNumber(args && args[4], 0);
    const subfolderID = getBookmarkSubfolderID(kwargs);
    const scene = spaceRuntime.getSceneForSession(session);
    const target = resolveLocationBookmarkTarget(itemID, session, scene);

    if (!target) {
      throwWrappedUserError("BookmarkNotAvailable");
    }

    return addBookmarkToFolder(charID, folderID, {
      folderID,
      memo: name,
      note: comment,
      expiry: translateBookmarkExpiryMode(expiryMode),
      subfolderID,
      creatorID: charID,
      ...target,
    });
  }

  Handle_BookmarkScanResult(args, session, kwargs) {
    const charID = session && session.characterID;
    const locationID = normalizeNumber(args && args[0], 0);
    const name = normalizeText(args && args[1], "");
    const comment = normalizeText(args && args[2], "");
    const resultID = normalizeNumber(args && args[3], 0);
    const folderID = normalizeNumber(args && args[4], 0);
    const expiryMode = normalizeNumber(args && args[5], 0);
    const subfolderID = getBookmarkSubfolderID(kwargs);
    const target = bookmarkRuntime.resolveScanBookmarkTarget(locationID, resultID);
    if (!target) {
      throwWrappedUserError("BookmarkNotAvailable");
    }

    return addBookmarkToFolder(charID, folderID, {
      folderID,
      memo: name,
      note: comment,
      expiry: translateBookmarkExpiryMode(expiryMode),
      subfolderID,
      creatorID: charID,
      ...target,
    });
  }

  Handle_MachoResolveObject(args, session) {
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const startedAtMs = Date.now();
    const response = buildBoundObjectResponse(this, args, session, kwargs);
    const responseBuiltMs = Date.now() - startedAtMs;
    const dockedStructureObserverSession = isDockedStructureObserverSession(session);
    // Space login is race-sensitive: if the bind reply reaches the client
    // before the first AddBalls2/SetState bootstrap, the inflight HUD can open
    // against an empty ego-ball state and only recover later via Michelle's
    // missing-module redraw path.
    const bootstrapStartedAtMs = Date.now();
    const bootstrapResult = bootstrapSessionBallpark(session, {
      force: dockedStructureObserverSession,
      reset: Boolean(
        dockedStructureObserverSession &&
          session &&
          session._structureViewSpace &&
          session._structureViewSpace.pendingBallparkBind === true
      ),
    });
    const bootstrapElapsedMs = Date.now() - bootstrapStartedAtMs;
    if (typeof spaceRuntime.recordSessionJumpTimingTrace === "function") {
      spaceRuntime.recordSessionJumpTimingTrace(session, "beyonce-bind", {
        responseBuiltMs,
        bootstrapElapsedMs,
        dockedStructureObserver: dockedStructureObserverSession,
        bootstrapResult: bootstrapResult === true,
      });
    }
    if (responseBuiltMs >= 100 || bootstrapElapsedMs >= 100) {
      log.info(
        `[Beyonce] MachoBindObject responseBuiltMs=${responseBuiltMs} ` +
        `bootstrapMs=${bootstrapElapsedMs} dockedStructureObserver=${dockedStructureObserverSession ? 1 : 0}`,
      );
    }
    return response;
  }

  afterCallResponse(methodName, session) {
    if (methodName === "MachoBindObject") {
      flushPendingCommandSessionEffects(session);
      return;
    }

    if (methodName === "CmdStargateJump") {
      flushPendingCommandSessionEffects(session);
    }
  }
}

module.exports = BeyonceService;
