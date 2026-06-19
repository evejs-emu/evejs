/**
 * HANDSHAKE CONTROLLER
 * (made with AI, revised by Icey)
 * 
 * only supports PLACEBO packets
 *
 * implements the 6 step login handshake modeled after EVEmu EVEClientSession.
 * (most of it is the same! surprising for 10 years of updates towards the game)
 *
 * flow:
 *   step 1: SERVER sends VersionExchangeServer         (on connect)
 *   step 2: CLIENT sends VersionExchangeClient         → SERVER validates, advances
 *   step 3: CLIENT sends VK command (None, "VK", key)  → SERVER validates, advances
 *   step 4: CLIENT sends CryptoRequestPacket           → SERVER sends "OK CC"
 *   step 5: CLIENT sends CryptoChallengePacket (login) → SERVER sends PyInt(2) + CryptoServerHandshake
 *   step 6: CLIENT sends CryptoHandshakeResult         → SERVER sends CryptoHandshakeAck + SessionInit
 * 
 */

const path = require("path");
const crypto = require("crypto");
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const {
  marshalEncode, // unused
  marshalDecode,
  wrapPacket,    // unused
  encodePacket,
  dictGet,
  strVal,
  bufVal,
} = require(path.join(__dirname, "./utils/marshal"));

// database
const database = require("../../newDatabase")
const {
  MAX_ACCOUNT_ROLE,
  DEFAULT_CHAT_ROLE,
  buildPersistedAccountRoleRecord,
  roleToString,
} = require(path.join(
  __dirname,
  "../../services/account/accountRoleProfiles",
));
const {
  buildGlobalConfigDict,
  buildClientBootMetadataEntries,
  buildServerStatusDict,
  getRuntimeConfig,
  normalizeCountryCode,
} = require(path.join(__dirname, "../../services/machoNet/globalConfig"));
const {
  reserveAccountID,
} = require(path.join(__dirname, "../../services/_shared/identityAllocator"));

// The "marshaledNone" from EVE_Consts.h — a pickled Python None object
// 0x74 = cPickle header, then 4-byte length LE, then "None" as ASCII
const MARSHALED_NONE = Buffer.from([
  0x74, 0x04, 0x00, 0x00, 0x00, 0x4e, 0x6f, 0x6e, 0x65,
]);

//testing: marshaled Python expression for client signedFunc during handshake.
//testing: GPS.py __Execute() captures stdout into outputBuffer → sent back in CryptoHandshakeResult.
//testing: we log the result server-side in _handleFuncResult to see what blue.os APIs exist.
//testing: prev: MARSHALED_NONE → eval("None") → no-op
//testing: to revert: change MARSHALED_TIDI_PROBE back to MARSHALED_NONE on line ~505
function buildMarshaledString(str) {
  const buf = Buffer.alloc(1 + 4 + str.length);
  buf[0] = 0x74; // 't' interned string type (Python 2.7 marshal)
  buf.writeInt32LE(str.length, 1);
  buf.write(str, 5, "ascii");
  return buf;
}
const TIDI_DEFAULT_OVERLOAD_ADJUSTMENT = 0.8254;
const TIDI_DEFAULT_UNDERLOAD_ADJUSTMENT = 1.059254;
const TIDI_DISABLE_UNDERLOAD_SNAP_ADJUSTMENT = 1000.0;
const TIDI_ENABLE_OVERLOAD_SNAP_ADJUSTMENT = 0.1;

function buildPortraitSignedFuncSource() {
  return [
    "try:",
    " import eve.client.script.ui.services.evePhotosvc as _evejs_photosvc",
    "except:",
    " _evejs_photosvc = None",
    " import traceback",
    " traceback.print_exc()",
    "if _evejs_photosvc is not None and not getattr(_evejs_photosvc, '_evejsPortraitPatchInstalled', False):",
    " _evejs_photosvc._evejs_original_add_portrait = _evejs_photosvc.EvePhoto.AddPortrait",
    " def _evejs_add_portrait(self, portraitPath, charID, _evejs_original_add_portrait=_evejs_photosvc._evejs_original_add_portrait):",
    "  result = _evejs_original_add_portrait(self, portraitPath, charID)",
    "  try:",
    "   photoFile = open(portraitPath, 'rb')",
    "   try:",
    "    photoData = photoFile.read()",
    "   finally:",
    "    photoFile.close()",
    "   sm.RemoteSvc('photoUploadSvc').Upload(charID, photoData)",
    "   print 'PORTRAIT_UPLOAD:OK:%s:%s' % (charID, len(photoData))",
    "  except:",
    "   import traceback",
    "   traceback.print_exc()",
    "  return result",
    " _evejs_photosvc.EvePhoto.AddPortrait = _evejs_add_portrait",
    " _evejs_photosvc._evejsPortraitPatchInstalled = True",
    " print 'PORTRAIT_UPLOAD_HANDLER:OK'",
  ];
}

function buildSkillExtractorAccessTokenSignedFuncSource() {
  return [
    "try:",
    " _evejs_connection = sm.GetService('connection')",
    " if getattr(_evejs_connection, 'accessToken', None) is None:",
    "  _evejs_connection.accessToken = 'evejs-local-skill-extractor'",
    " print 'SKILL_EXTRACTOR_ACCESS_TOKEN:OK'",
    "except:",
    " import traceback",
    " traceback.print_exc()",
  ];
}

function buildTidiSignedFuncSource() {
  const source = [
    "import blue",
    "blue.os.EnableSimDilation(0)",
    "class _TiDiHandler(object):",
    " __guid__ = 'svc.tidiHandler'",
    " __notifyevents__ = ['OnSetTimeDilation']",
    " def OnSetTimeDilation(self, maxD, minD, thresh):",
    "  import blue",
    "  blue.os.maxSimDilation = float(maxD)",
    "  blue.os.minSimDilation = float(minD)",
    "  blue.os.dilationOverloadThreshold = int(thresh)",
    "  if int(thresh) == 100000000:",
    `   blue.os.dilationOverloadAdjustment = ${TIDI_DEFAULT_OVERLOAD_ADJUSTMENT}`,
    `   blue.os.dilationUnderloadAdjustment = ${TIDI_DISABLE_UNDERLOAD_SNAP_ADJUSTMENT}`,
    "  else:",
    `   blue.os.dilationOverloadAdjustment = ${TIDI_ENABLE_OVERLOAD_SNAP_ADJUSTMENT}`,
    `   blue.os.dilationUnderloadAdjustment = ${TIDI_DEFAULT_UNDERLOAD_ADJUSTMENT}`,
    "_h = _TiDiHandler()",
    "sm.RegisterForNotifyEvent(_h, 'OnSetTimeDilation')",
    "__builtins__['__tidiHandler'] = _h",
    "print 'TIDI_HANDLER:OK'",
  ].concat(buildPortraitSignedFuncSource());

  if (config.devHandshakeSeedSkillExtractorAccessToken) {
    source.push.apply(source, buildSkillExtractorAccessTokenSignedFuncSource());
  }

  return source.join("\\n");
}
//testing: Starts blue.dll's TiDi tick loop via EnableSimDilation(0) and registers
//testing: a notification handler (OnSetTimeDilation) so the server can control dilation
//testing: at runtime via /tidi or the solar system TiDi system.
//testing: No TiDi is forced at login — the handler waits for a server notification.
//testing: prev: phase 5 forced maxSimDilation/minSimDilation/dilationOverloadThreshold at login
//testing: after: only EnableSimDilation + handler install; runtime notification sets params
//testing: to revert: change buildTidiSignedFunc(...) back to MARSHALED_NONE on line ~533
function buildTidiSignedFunc(clientId) {
  const pyCode = buildTidiSignedFuncSource(clientId);
  const expr = 'eval(compile("' + pyCode + '", "<tidi>", "exec"))';
  return buildMarshaledString(expr);
}

const DEV_ACCOUNT_ROLE = roleToString(MAX_ACCOUNT_ROLE);
const DEV_CHAT_ROLE = roleToString(DEFAULT_CHAT_ROLE);
function createSessionID(seed = 0) {
  const numericSeed = Number(seed) || 0;
  return BigInt(Date.now()) * 15n + BigInt(numericSeed % 15);
}

function buildMarshalDict(entries) {
  if (entries && typeof entries === "object" && entries.type === "dict") {
    return entries;
  }
  return {
    type: "dict",
    entries: Object.entries(entries || {}),
  };
}

function encodePy2Protocol2String(value) {
  const text = String(value ?? "");
  const bytes = Buffer.from(text, "utf8");
  const header = Buffer.alloc(5);
  header[0] = 0x58; // BINUNICODE
  header.writeUInt32LE(bytes.length, 1);
  return Buffer.concat([header, bytes]);
}

function encodePy2Protocol2Value(value) {
  if (value === null || value === undefined) {
    return Buffer.from("N", "ascii");
  }
  if (typeof value === "boolean") {
    return Buffer.from([value ? 0x88 : 0x89]); // NEWTRUE / NEWFALSE
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= 0 && value <= 0xff) {
      return Buffer.from([0x4b, value]); // BININT1
    }
    if (value >= 0 && value <= 0xffff) {
      const encoded = Buffer.alloc(3);
      encoded[0] = 0x4d; // BININT2
      encoded.writeUInt16LE(value, 1);
      return encoded;
    }
    const encoded = Buffer.alloc(5);
    encoded[0] = 0x4a; // BININT
    encoded.writeInt32LE(value, 1);
    return encoded;
  }
  if (typeof value === "string") {
    return encodePy2Protocol2String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((entry) => encodePy2Protocol2Value(entry));
    if (items.length === 0) {
      return Buffer.from(")", "ascii"); // EMPTY_TUPLE
    }
    if (items.length === 1) {
      return Buffer.concat([items[0], Buffer.from([0x85])]); // TUPLE1
    }
    if (items.length === 2) {
      return Buffer.concat([items[0], items[1], Buffer.from([0x86])]); // TUPLE2
    }
    if (items.length === 3) {
      return Buffer.concat([items[0], items[1], items[2], Buffer.from([0x87])]); // TUPLE3
    }
    return Buffer.concat([
      Buffer.from("(", "ascii"), // MARK
      ...items,
      Buffer.from("t", "ascii"), // TUPLE
    ]);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    const chunks = [Buffer.from("}", "ascii")]; // EMPTY_DICT
    for (const [key, entryValue] of entries) {
      chunks.push(encodePy2Protocol2String(key));
      chunks.push(encodePy2Protocol2Value(entryValue));
      chunks.push(Buffer.from("s", "ascii")); // SETITEM
    }
    return Buffer.concat(chunks);
  }
  return encodePy2Protocol2String(String(value));
}

function buildGPSTransportClosedCPickle(
  reasonCode,
  reasonArgs = {},
  reason = reasonCode,
) {
  const argsTuple = Buffer.concat([
    encodePy2Protocol2Value(reason || "Disconnected"),
    encodePy2Protocol2Value(reasonCode || null),
    encodePy2Protocol2Value(reasonArgs || {}),
    Buffer.from([0x87]), // TUPLE3
  ]);
  return Buffer.concat([
    Buffer.from([0x80, 0x02]), // protocol 2
    Buffer.from("cexceptions\nGPSTransportClosed\n", "ascii"),
    argsTuple,
    Buffer.from("R.", "ascii"), // REDUCE + STOP
  ]);
}

// ---- handshake states
const State = {
  SEND_VERSION: "SEND_VERSION",
  WAIT_VERSION: "WAIT_VERSION",
  WAIT_COMMAND: "WAIT_COMMAND",
  WAIT_CRYPTO: "WAIT_CRYPTO",
  WAIT_AUTH: "WAIT_AUTH",
  WAIT_FUNC_RESULT: "WAIT_FUNC_RESULT",
  DONE: "DONE",
};

class EVEHandshake {
  constructor(socket) {
    this.socket = socket;
    this.state = State.SEND_VERSION;
    this.userId = 0;
    this.userName = "";
    this.clientId = 0;
    this.accountRole = 0;
    this.role = 0;
    this.address = socket.remoteAddress || "unknown";
    this.languageId = "EN";
    this.countryCode = normalizeCountryCode(config.defaultCountryCode);
    this.sessionId = null;

    // encryption variables
    // WARNING: this was made in attempt for CryptoAPI support... failed horribly :)
    // only kept because removing them would mean rewriting ~100 lines
    this.sessionKey = null; // raw AES session key (Buffer)
    this.sessionIV = null; // raw AES session IV (Buffer)
    this.encrypted = false; // is connection encrypted?
  }




  /**
   *   mmmm mmmmmmm mmmmmm mmmmm       mmmmm 
   *  #"   "   #    #      #   "#        #   
   *  "#mmm    #    #mmmmm #mmm#"        #   
   *      "#   #    #      #             #   
   *  "mmm#"   #    #mmmmm #           mmmmm
   * 
   * initiate the handshake: send VersionExchangeServer
   */
  start() {
    log.debug(`[HANDSHAKE] Starting handshake with ${this.address}`);

    const runtimeConfig = getRuntimeConfig();
    const bootMetadata = new Map(buildClientBootMetadataEntries(runtimeConfig));
    const serverStatusEntries = new Map(
      buildServerStatusDict(runtimeConfig).entries,
    );

    const versionTuple = [
      runtimeConfig.eveBirthday,
      runtimeConfig.machoVersion,
      serverStatusEntries.get("cluster_usercount") || 0,
      bootMetadata.get("boot_version"), // float
      bootMetadata.get("boot_build"),
      runtimeConfig.projectVersion,
      null, // update_info
    ];

    const packet = encodePacket(versionTuple);
    this.socket.write(packet);
    log.debug(`[HANDSHAKE] Sent VersionExchangeServer`);

    this.state = State.WAIT_VERSION;
  }

  /**
   * handle an incoming payload buffer (after stripping the 4byte length prefix)
   * returns { done: false } during handshake, { done: true } when complete
   */
  handlePacket(payload) {
    let decodable = payload;

    // line 69
    // do we even need this?
    if (this.encrypted && this.sessionKey && this.sessionIV) {
      try {
        decodable = this._decrypt(payload);

        // commented for flood prevention
        // log.debug(
        //   `[HANDSHAKE] Decrypted ${payload.length} bytes → ${decodable.length} bytes`,
        // );
      } catch (err) {
        log.err(`[HANDSHAKE] Decryption failed: ${err.message}`);
        // commented for flood prevention
        // log.debug(
        //   `[HANDSHAKE] Raw payload (first 64 bytes): ${payload.toString("hex").substring(0, 128)}`,
        // );
        // log.debug(
        //   `[HANDSHAKE] Session key (${this.sessionKey.length} bytes): ${this.sessionKey.toString("hex")}`,
        // );
        // log.debug(
        //   `[HANDSHAKE] Session IV  (${this.sessionIV.length} bytes): ${this.sessionIV.toString("hex")}`,
        // );
        return { done: false };
      }
    }

    let decoded;
    try {
      decoded = marshalDecode(decodable);
    } catch (err) {
      log.err(
        `[HANDSHAKE] Failed to decode packet in state ${this.state}: ${err.message}`,
      );
      // commented for flood prevention
      // log.debug(
      //   `[HANDSHAKE] Raw payload: ${decodable.toString("hex").substring(0, 100)}...`,
      // );
      return { done: false };
    }

    log.debug(
      `[HANDSHAKE] handshake state: ${this.state}`,
    );
    // commented for flood prevention
    // log.debug(
    //   `[HANDSHAKE] State: ${this.state} | Decoded: ${this._summarize(decoded)}`,
    // );

    // state mapper: what state are we currently in, and whats next?
    switch (this.state) {
      case State.WAIT_VERSION:
        return this._handleVersion(decoded);
      case State.WAIT_COMMAND:
        return this._handleCommand(decoded);
      case State.WAIT_CRYPTO:
        return this._handleCrypto(decoded, payload);
      case State.WAIT_AUTH:
        return this._handleAuthentication(decoded);
      case State.WAIT_FUNC_RESULT:
        return this._handleFuncResult(decoded);
      default:
        log.err(`[HANDSHAKE] unexpected state: ${this.state}`);
        return { done: false };
    }
  }




  /**                                           
   *   mmmm mmmmmmm mmmmmm mmmmm       mmmmm  mmmmm 
   *  #"   "   #    #      #   "#        #      #   
   *  "#mmm    #    #mmmmm #mmm#"        #      #   
   *      "#   #    #      #             #      #   
   *  "mmm#"   #    #mmmmm #           mm#mm  mm#mm 
   *
   * client responds with VersionExchangeClient
   */
  _handleVersion(decoded) {
    // check if decoded is a valid VersionExchangeClient
    if (!Array.isArray(decoded) || decoded.length < 6) {
      log.err(
        `[HANDSHAKE] Invalid VersionExchangeClient: expected tuple of 6+`,
      );
      return { done: false };
    }

    // grab values from decoded
    const [birthday, machoVer, , versionNum, buildVer, projectVer] = decoded;

    log.debug(
      `[HANDSHAKE] Client version: birthday=${birthday} macho=${machoVer} ver=${versionNum} build=${buildVer} proj=${strVal(projectVer)}`,
    );

    if (birthday !== config.eveBirthday)
      log.warn(
        `[HANDSHAKE] Client birthday mismatch! Expected ${config.eveBirthday}, got ${birthday}`,
      );
    if (machoVer !== config.machoVersion)
      log.warn(
        `[HANDSHAKE] Client macho_version mismatch! Expected ${config.machoVersion}, got ${machoVer}`,
      );

    // update state
    this.state = State.WAIT_COMMAND;
    log.debug(`[HANDSHAKE] Version accepted, waiting for command (VK/QC)`);

    return { done: false };
  }




  /**                                                
   *   mmmm mmmmmmm mmmmmm mmmmm       mmmmm  mmmmm  mmmmm 
   *  #"   "   #    #      #   "#        #      #      #   
   *  "#mmm    #    #mmmmm #mmm#"        #      #      #   
   *      "#   #    #      #             #      #      #   
   *  "mmm#"   #    #mmmmm #           mm#mm  mm#mm  mm#mm 
   *
   * client sends command tuple             
   */
  _handleCommand(decoded) {
    if (!Array.isArray(decoded)) {
      log.err(`[HANDSHAKE] Invalid command: expected tuple`);
      return { done: false };
    }

    if (decoded.length === 2) {
      // QC (Queue Check)
      const cmdType = strVal(decoded[1]);
      log.debug(`[HANDSHAKE] Got Queue Check command (${cmdType})`);
      const queuePos = encodePacket(0);
      this.socket.write(queuePos);
      this.start();
      return { done: false };
    }

    if (decoded.length === 3) {
      // VK command: (None, "VK", vipKey)
      const cmdType = strVal(decoded[1]);
      const vipKeyBuf = bufVal(decoded[2]);

      // commented for flood prevention
      // log.debug(
      //   `[HANDSHAKE] Got ${cmdType} command, vipKey=${vipKeyBuf ? vipKeyBuf.length + " bytes" : "null"}`,
      // );
      // if (vipKeyBuf) {
      //   log.debug(`[HANDSHAKE] VIP key hex: ${vipKeyBuf.toString("hex")}`);
      // }

      // update state
      this.state = State.WAIT_CRYPTO;
      log.debug(`[HANDSHAKE] VK accepted, waiting for crypto request`);
      return { done: false };
    }

    log.err(`[HANDSHAKE] Unknown command tuple length: ${decoded.length}`);
    return { done: false };
  }




  /**                                               
   *   mmmm mmmmmmm mmmmmm mmmmm       mmmmm  m    m
   *  #"   "   #    #      #   "#        #    "m  m"
   *  "#mmm    #    #mmmmm #mmm#"        #     #  # 
   *      "#   #    #      #             #     "mm" 
   *  "mmm#"   #    #mmmmm #           mm#mm    ##  
   * 
   * client sends CryptoRequestPacket
   */
  _handleCrypto(decoded, rawPayload) {
    if (!Array.isArray(decoded) || decoded.length < 2) {
      log.err(`[HANDSHAKE] Invalid CryptoRequestPacket: expected tuple of 2`);
      return { done: false };
    }

    const keyVersion = strVal(decoded[0]);
    const keyParams = decoded[1]; // dict

    log.debug(`[HANDSHAKE] Crypto request: keyVersion="${keyVersion}"`);

    // do we even need this?
    if (keyParams && keyParams.type === "dict") {
      const sessionKeyVal = dictGet(keyParams, "crypting_sessionkey");
      const sessionIVVal = dictGet(keyParams, "crypting_sessioniv");

      if (sessionKeyVal) {
        this.sessionKey = bufVal(sessionKeyVal);
        log.debug(
          `[HANDSHAKE] Session key: ${this.sessionKey ? this.sessionKey.length + " bytes" : "null"}`,
        );
        if (this.sessionKey) {
          log.debug(
            `[HANDSHAKE] Session key hex: ${this.sessionKey.toString("hex").substring(0, 64)}...`,
          );
        }
      }

      if (sessionIVVal) {
        this.sessionIV = bufVal(sessionIVVal);
        log.debug(
          `[HANDSHAKE] Session IV: ${this.sessionIV ? this.sessionIV.length + " bytes" : "null"}`,
        );
        if (this.sessionIV) {
          log.debug(
            `[HANDSHAKE] Session IV hex: ${this.sessionIV.toString("hex").substring(0, 64)}...`,
          );
        }
      }

      // If we got key and IV, encryption is active for subsequent packets
      if (this.sessionKey && this.sessionIV) {
        this.encrypted = true;
        log.debug(
          `[HANDSHAKE] Encryption mode: ACTIVE (key=${this.sessionKey.length}B, iv=${this.sessionIV.length}B)`,
        );

        // The raw key/IV might be longer than needed for AES.
        // AES-256-CBC needs exactly 32-byte key and 16-byte IV.
        // Try using the first 32 bytes of the key and first 16 bytes of the IV.
        if (this.sessionKey.length > 32) {
          log.debug(
            `[HANDSHAKE] Trimming session key from ${this.sessionKey.length} to 32 bytes`,
          );
          this.sessionKey = this.sessionKey.slice(0, 32);
        }
        if (this.sessionIV.length > 16) {
          log.debug(
            `[HANDSHAKE] Trimming session IV from ${this.sessionIV.length} to 16 bytes`,
          );
          this.sessionIV = this.sessionIV.slice(0, 16);
        }

        log.debug(
          `[HANDSHAKE] Final key (${this.sessionKey.length}B): ${this.sessionKey.toString("hex")}`,
        );
        log.debug(
          `[HANDSHAKE] Final IV  (${this.sessionIV.length}B): ${this.sessionIV.toString("hex")}`,
        );
      }
    }

    // Send "OK CC"
    const okPacket = encodePacket("OK CC");
    this.socket.write(okPacket);
    log.debug(`[HANDSHAKE] Sent "OK CC" — waiting for login credentials`);

    // update state
    this.state = State.WAIT_AUTH;
    return { done: false };
  }




  /**                                  
   *   mmmm mmmmmmm mmmmmm mmmmm       m    m
   *  #"   "   #    #      #   "#      "m  m"
   *  "#mmm    #    #mmmmm #mmm#"       #  # 
   *      "#   #    #      #            "mm" 
   *  "mmm#"   #    #mmmmm #             ##
   * 
   * client sends CryptoChallengePacket (Login)
   * server responds with PyInt(2) + CryptoServerHandshake back to back
   */
  _handleAuthentication(decoded) {
    if (!Array.isArray(decoded) || decoded.length < 2) {
      log.err(`[HANDSHAKE] Invalid CryptoChallengePacket: expected tuple of 2`);
      return { done: false };
    }

    // grab values from decoded
    const loginData = decoded[1];
    const userName = strVal(dictGet(loginData, "user_name") || "");
    const passwordHash = Buffer.from(dictGet(loginData, "user_password_hash"), "hex").toString("hex")
    // const userPassword = strVal(dictGet(loginData, "user_password") || ""); // user_password does not exist as the client only sends user_password_hash
    const userLanguageId = strVal(
      dictGet(loginData, "user_languageid") || "EN",
    ); // returns a json object TODO: decode json and get language id

    /**
     * the client sends a hashed password, so instead of checking the password
     * we will check the hash against the database's hash. the server never gets
     * to know the password. when we create an account (dev mode) we will put the 
     * hash in the databse and use it to match when user attempts to log in.
     */


    // get the raw password hash as hex (it's binary data, not a UTF-8 string)
    // let userPasswordHashHex = "";
    // if (Buffer.isBuffer(rawHash)) {
    //   userPasswordHashHex = rawHash.toString("hex");
    // } else if (rawHash && typeof rawHash === "string") {
    //   userPasswordHashHex = Buffer.from(rawHash, "binary").toString("hex");
    // }

    log.debug(
      `[HANDSHAKE] Login attempt: user="${userName}" lang="${userLanguageId}"`,
    );

    // send password version (PyInt 2 = "i want hashed passwords")
    // this is required for some reason
    const pwVersionPacket = encodePacket(2);
    this._sendPacket(pwVersionPacket);
    log.debug(`[HANDSHAKE] Sent password version (2)`);

    // validate credentials

    // OLD DB STUFF
    // const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    // const accounts = db.accounts || {};

    const accountResult = database.read("accounts", "/")
    const accounts = accountResult.success && accountResult.data
      ? accountResult.data
      : {}
    let accountWasAutoCreated = false;
    let rawAccount = accounts[userName] || null;

    if (!rawAccount) {
      if (config.devAutoCreateAccounts) {
        const createdAccount = buildPersistedAccountRoleRecord({
          passwordhash: passwordHash,
          id: reserveAccountID(),
          role: DEV_ACCOUNT_ROLE,
          chatRole: DEV_CHAT_ROLE,
          banned: false,
        });
        log.warn(
          `[HANDSHAKE] Account "${userName}" not found - auto creating because devAutoCreateAccounts is enabled`,
        );
        database.write("accounts", `/${userName}`, createdAccount);
        database.flushTablesSync(["accounts"]);
        rawAccount = createdAccount;
        accountWasAutoCreated = true;
      } else {
        log.warn(`[HANDSHAKE] Account "${userName}" not found`);
      }
    }

    if (!rawAccount) {
      log.warn(`[HANDSHAKE] Login attempt failed for "${userName}": account not found`);
      this._sendTransportClose("LoginAuthFailed");
      return { done: false };
    }

    const account = buildPersistedAccountRoleRecord(rawAccount);
    if (JSON.stringify(rawAccount) !== JSON.stringify(account)) {
      database.write("accounts", `/${userName}`, account);
      if (accountWasAutoCreated) {
        database.flushTablesSync(["accounts"]);
      }
    }
    let loginFailureReasonCode = null;
    if (config.devSkipPasswordValidation) {
      log.debug(
        `[HANDSHAKE] Password accepted for "${userName}" because devSkipPasswordValidation is enabled`,
      );
    } else {
      if (account.passwordhash !== passwordHash) {
        log.warn(
          `[HANDSHAKE] Password mismatch for "${userName}"`,
        );
        loginFailureReasonCode = "LoginAuthFailed";
      }
    }

    // do we really need this?
    if (account.banned) {
      log.err(`[HANDSHAKE] Account "${userName}" is banned!`);
      loginFailureReasonCode = "ACCOUNTBANNED";
    }

    if (loginFailureReasonCode) {
      log.warn(
        `[HANDSHAKE] Login attempt failed for "${userName}" with reason ${loginFailureReasonCode}`,
      );
      this._sendTransportClose(loginFailureReasonCode);
      return { done: false };
    }

    this.userId = account.id;
    this.userName = userName;
    this.clientId = 1000000 * account.id + config.proxyNodeId;
    this.accountRole = account.role;
    this.role = account.chatRole || account.role;
    this.languageId = userLanguageId;
    this.countryCode = normalizeCountryCode(
      account.countryCode,
      config.defaultCountryCode,
    );

    // send CryptoServerHandshake
    const runtimeConfig = getRuntimeConfig();
    const serverStatusEntries = new Map(
      buildServerStatusDict(runtimeConfig).entries,
    );
    const serverHandshake = [
      "", // serverChallenge
      //testing: prev: [MARSHALED_NONE, false] — client eval("None") — no-op
      //testing: after: calls EnableSimDilation(0) + RegisterClientIDForSimTimeUpdates(clientId)
      //testing: to revert: change buildTidiSignedFunc(...) to MARSHALED_NONE
      [buildTidiSignedFunc(this.clientId), false], // func tuple: [marshaled_code, verification]
      { type: "dict", entries: [] }, // context
      {
        type: "dict",
        entries: [
          ["challenge_responsehash", "55087"],
          ["macho_version", runtimeConfig.machoVersion],
          ...buildClientBootMetadataEntries(runtimeConfig),
          [
            "cluster_usercount",
            serverStatusEntries.get("cluster_usercount") || 0,
          ],
          ["proxy_nodeid", config.proxyNodeId],
          [
            "user_logonqueueposition",
            serverStatusEntries.get("user_logonqueueposition") || 1,
          ],
          ["config_vals", buildGlobalConfigDict(runtimeConfig)],
        ],
      },
    ];

    const handshakePacket = encodePacket(serverHandshake);
    // commented for flood prevention
    // log.debug(
    //   `[HANDSHAKE] CryptoServerHandshake hex (${handshakePacket.length} bytes): ${handshakePacket.toString("hex")}`,
    // );
    this._sendPacket(handshakePacket);
    log.debug(`[HANDSHAKE] Sent CryptoServerHandshake for user "${userName}"`);

    // update state
    this.state = State.WAIT_FUNC_RESULT;
    return { done: false };
  }




  /**                                        
   *   mmmm mmmmmmm mmmmmm mmmmm       m    m mmmmm 
   *  #"   "   #    #      #   "#      "m  m"   #   
   *  "#mmm    #    #mmmmm #mmm#"       #  #    #   
   *      "#   #    #      #            "mm"    #   
   *  "mmm#"   #    #mmmmm #             ##   mm#mm 
   * 
   * client sends CryptoHandshakeResult                               
   */
  _handleFuncResult(decoded) {
    log.debug(`[HANDSHAKE] Received CryptoHandshakeResult`);

    if (Array.isArray(decoded)) {
      log.debug(`[HANDSHAKE] Result tuple length: ${decoded.length}`);
      //testing: log signedFunc stdout (outputBuffer) and eval result (funcResult)
      //testing: decoded = [challengeHash, outputBuffer, funcResult]
      //testing: outputBuffer contains anything the eval expression printed to stdout
      //testing: writes to server/tidi_probe.log so we can inspect after login
      if (decoded.length >= 2) {
        const output = decoded[1] ? (Buffer.isBuffer(decoded[1]) ? decoded[1].toString("utf8") : String(decoded[1])) : "(empty)";
        const result = decoded.length >= 3 && decoded[2] != null ? JSON.stringify(decoded[2]) : "(none)";
        const logLine = `[${new Date().toISOString()}] signedFunc output: ${output}\nsignedFunc result: ${result}\nraw decoded length: ${decoded.length}\ndecoded types: ${decoded.map(d => d === null ? 'null' : typeof d === 'object' && Buffer.isBuffer(d) ? 'Buffer(' + d.length + ')' : typeof d).join(', ')}\n`;
        if (log.isVerboseDebugEnabled()) {
          log.info(`[HANDSHAKE] signedFunc output: ${output}`);
          try {
            rotatingLog.append(path.join(__dirname, "../../..", "logs", "tidi_probe.log"), logLine);
            log.info(`[HANDSHAKE] Probe results written to server/logs/tidi_probe.log`);
          } catch (e) {
            log.warn(`[HANDSHAKE] Could not write probe log: ${e.message}`);
          }
        }
      }
    }

    // send CryptoHandshakeAck
    if (this.sessionId === null) {
      this.sessionId = createSessionID(this.clientId);
    }

    const ack = {
      type: "dict",
      entries: [
        ["live_updates", { type: "list", items: [] }],
        [
          "session_init",
          {
            type: "dict",
            entries: [
              ["languageID", this.languageId],
              ["countryCode", this.countryCode],
              ["userid", this.userId],
              ["maxSessionTime", null],
              ["userType", 30],
              ["role", { type: "long", value: BigInt(this.role) }],
              ["address", this.address],
              ["inDetention", null],
            ],
          },
        ],
        ["sessionID", { type: "long", value: this.sessionId }],
        ["client_hash", null],
        ["user_clientid", { type: "long", value: BigInt(this.clientId) }],
      ],
    };

    const ackPacket = encodePacket(ack);
    this._sendPacket(ackPacket);
    log.debug(`[HANDSHAKE] Sent CryptoHandshakeAck`);

    this.state = State.DONE;
    log.success(
      `[HANDSHAKE] Handshake complete for "${this.userName}" (id=${this.userId})`,
    );

    return { done: true };
  }

  // ─── Encryption/Decryption ───────────────────────────────────────────────

  _decrypt(data) {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      this.sessionKey,
      this.sessionIV,
    );
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    // Update IV for CBC chaining (last ciphertext block becomes next IV)
    this.sessionIV = data.slice(-16);
    return decrypted;
  }

  _encrypt(data) {
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      this.sessionKey,
      this.sessionIV,
    );
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    // Update IV for CBC chaining
    this.sessionIV = encrypted.slice(-16);
    return encrypted;
  }

  /**
   * Send a framed packet, encrypting the payload if encryption is active.
   * The input `packet` should already be framed (4-byte length + payload).
   */
  _sendPacket(packet) {
    if (this.encrypted && this.sessionKey && this.sessionIV) {
      // The payload to encrypt is everything after the 4-byte length header
      const payload = packet.slice(4);
      const encrypted = this._encrypt(payload);
      // Re-frame with the new encrypted length
      const header = Buffer.alloc(4);
      header.writeUInt32LE(encrypted.length, 0);
      this.socket.write(Buffer.concat([header, encrypted]));
    } else {
      this.socket.write(packet);
    }
  }

  _sendTransportClose(reasonCode, reasonArgs = {}, reason = reasonCode) {
    const closePacket = encodePacket({
      type: "cpicked",
      data: buildGPSTransportClosedCPickle(
        reasonCode,
        reasonArgs,
        reason,
      ),
    });
    this._sendPacket(closePacket);
    this.socket.end();
  }

  /**
   * Summarize a decoded value for debug logging (truncate long data).
   */
  _summarize(val) {
    const str = JSON.stringify(val, (key, value) => {
      // Truncate Buffers in JSON output
      if (value && value.type === "Buffer" && Array.isArray(value.data)) {
        return `<Buffer ${value.data.length}B>`;
      }
      return value;
    });
    if (str && str.length > 300) return str.substring(0, 300) + "...";
    return str;
  }
}

EVEHandshake._testing = {
  buildTidiSignedFunc,
  buildTidiSignedFuncSource,
  buildPortraitSignedFuncSource,
  buildSkillExtractorAccessTokenSignedFuncSource,
  buildGPSTransportClosedCPickle,
  reserveAccountID,
};

module.exports = EVEHandshake;
