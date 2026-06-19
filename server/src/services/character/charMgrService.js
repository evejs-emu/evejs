/**
 * Character Manager Service (charMgr)
 *
 * Handles character info queries post-selection.
 * Different from charUnboundMgr — this is bound to a specific character.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterRecord,
  resolveHomeStationInfo,
} = require(path.join(__dirname, "./characterState"));
const {
  resolvePaperDollState,
} = require(path.join(__dirname, "./paperDollPayloads"));
const {
  normalizeCharacterGender,
} = require(path.join(__dirname, "./characterIdentity"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  buildList,
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildRow,
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  CharMgrGlobalAssets,
} = require(path.join(__dirname, "./charMgrGlobalAssets"));
const {
  deleteCharacterSetting,
  getCharacterSettings,
  setCharacterSetting,
} = require(path.join(__dirname, "./characterSettingsState"));
const {
  getCorporationMember,
} = require(path.join(__dirname, "../corporation/corporationRuntimeState"));
const {
  buildKillmailPayload,
  listKillmailsForCharacter,
} = require(path.join(__dirname, "../killmail/killmailState"));
const {
  listOwnerNotes,
  getOwnerNote,
  addOwnerNote,
  editOwnerNote,
  removeOwnerNote,
  getEntityNote,
  setEntityNote,
} = require(path.join(__dirname, "./characterNoteState"));

function resolveCharacterInfo(args, session) {
  const charId =
    args && args.length > 0 ? args[0] : session ? session.characterID : 0;

  return {
    charId,
    charData: getCharacterRecord(charId) || {},
  };
}

function sessionCharacterID(session) {
  return Number(
    session &&
    (session.characterID || session.charID || session.charid || 0),
  ) || 0;
}

function resolveHomeStationRecord(charData, session) {
  const homeStationInfo = resolveHomeStationInfo(charData, session);

  return {
    station: getStationRecord(session, homeStationInfo.homeStationID),
    homeStationInfo,
  };
}

function resolveCorporationChangeInfo(charId, charData, session) {
  const corporationID =
    Number(charData && charData.corporationID) ||
    Number(session && (session.corporationID || session.corpid)) ||
    0;
  const corporationMember =
    corporationID > 0 ? getCorporationMember(corporationID, charId) : null;
  const corporationDateTime =
    (corporationMember && corporationMember.startDate) ||
    (charData &&
      (charData.startDateTime ||
        (Array.isArray(charData.employmentHistory)
          ? charData.employmentHistory.find(
              (entry) =>
                Number(entry && entry.corporationID) === Number(corporationID),
            )?.startDate
          : null) ||
        charData.createDateTime)) ||
    null;

  return buildKeyVal([
    ["corporationID", corporationID || null],
    ["corporationDateTime", buildFiletimeLong(corporationDateTime)],
  ]);
}

function buildHomeStationPayload(station, homeStationInfo = {}) {
  return buildKeyVal([
    ["id", station.stationID],
    ["station_id", station.stationID],
    ["stationID", station.stationID],
    ["home_station_id", station.stationID],
    ["type_id", station.stationTypeID],
    ["typeID", station.stationTypeID],
    ["station_type_id", station.stationTypeID],
    ["name", station.stationName],
    ["station_name", station.stationName],
    ["stationName", station.stationName],
    ["solar_system_id", station.solarSystemID],
    ["solarSystemID", station.solarSystemID],
    ["constellation_id", station.constellationID],
    ["constellationID", station.constellationID],
    ["region_id", station.regionID],
    ["regionID", station.regionID],
    ["owner_id", station.ownerID],
    ["ownerID", station.ownerID],
    ["clone_station_id", homeStationInfo.cloneStationID || station.stationID],
    ["cloneStationID", homeStationInfo.cloneStationID || station.stationID],
    ["is_fallback", Boolean(homeStationInfo.isFallback)],
    ["isFallback", Boolean(homeStationInfo.isFallback)],
    ["stationTypeID", station.stationTypeID],
  ]);
}

function buildCloneEntries(entries = [], valueBuilder) {
  return buildDict(
    entries.map((entry, index) => [
      Number(entry.cloneID || entry.itemID || index + 1),
      valueBuilder(entry, index),
    ]),
  );
}

function buildPublicInfoEntries(charId, charData, session) {
  const factionID = charData.factionID ?? null;
  const empireID = charData.empireID ?? factionID;
  const corporationID =
    charData.corporationID || (session ? session.corporationID : 1000009);
  const allianceID = charData.allianceID || (session ? session.allianceID : null);
  const stationID =
    charData.stationID ??
    (session ? (session.stationID ?? session.stationid ?? null) : null);
  const solarSystemID =
    charData.solarSystemID || (session ? session.solarsystemid2 : 30000142);
  const createDateTime = buildFiletimeLong(charData.createDateTime);
  const startDateTime = buildFiletimeLong(
    charData.startDateTime || charData.createDateTime,
  );
  const securityStatus = Number(
    charData.securityStatus ?? charData.securityRating ?? 0,
  );

  return [
    ["characterID", charId],
    [
      "characterName",
      charData.characterName || (session ? session.characterName : "Unknown"),
    ],
    ["typeID", charData.typeID || 1373],
    ["raceID", charData.raceID || 1],
    ["bloodlineID", charData.bloodlineID || 1],
    ["ancestryID", charData.ancestryID || 1],
    ["corporationID", corporationID],
    ["allianceID", allianceID],
    ["factionID", factionID],
    ["empireID", empireID],
    ["schoolID", charData.schoolID ?? null],
    ["gender", normalizeCharacterGender(charData.gender, 1)],
    ["createDateTime", createDateTime],
    ["startDateTime", startDateTime],
    ["description", charData.description || ""],
    ["securityRating", securityStatus],
    ["securityStatus", securityStatus],
    ["bounty", Number(charData.bounty || 0)],
    ["title", charData.title || ""],
    ["shortName", charData.shortName || "none"],
    ["stationID", stationID],
    ["solarSystemID", solarSystemID],
    ["militiaFactionID", charData.militiaFactionID ?? null],
    ["medal1GraphicID", charData.medal1GraphicID ?? null],
  ];
}

function toPlainString(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "object") {
    if ("value" in value) {
      return toPlainString(value.value, fallback);
    }

    if ("str" in value) {
      return toPlainString(value.str, fallback);
    }
  }

  return fallback;
}

function buildOwnerNotePayload(noteID, label, noteText) {
  return buildList([
    buildKeyVal([
      ["noteID", Number(noteID) || 0],
      ["label", toPlainString(label, "")],
      ["note", toPlainString(noteText, "")],
    ]),
  ]);
}

class CharMgrService extends BaseService {
  constructor() {
    super("charMgr");
    this._globalAssets = new CharMgrGlobalAssets();
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    const result = this._globalAssets.Handle_MachoResolveObject(args, session, kwargs);
    if (result !== null) {
      return result;
    }

    log.warn("[CharMgr] Unsupported MachoResolveObject bind params");
    return null;
  }

  async Handle_MachoBindObject(args, session, kwargs) {
    const result = await this._globalAssets.Handle_MachoBindObject(
      args,
      session,
      kwargs,
      async (boundObjectID, methodName, callArgs, callKwargs) => {
        const previousBoundObjectID = session ? session.currentBoundObjectID : null;
        try {
          if (session) {
            session.currentBoundObjectID = boundObjectID;
          }
          return await this.callMethod(methodName, callArgs, session, callKwargs);
        } finally {
          if (session) {
            session.currentBoundObjectID = previousBoundObjectID || null;
          }
        }
      },
    );
    if (result !== null) {
      return result;
    }

    log.warn("[CharMgr] Unsupported MachoBindObject bind params");
    return null;
  }

  Handle_ListStations(args, session, kwargs) {
    return this._globalAssets.Handle_ListStations(args, session, kwargs);
  }

  Handle_ListStationItems(args, session, kwargs) {
    return this._globalAssets.Handle_ListStationItems(args, session, kwargs);
  }

  Handle_List(args, session, kwargs) {
    return this._globalAssets.Handle_List(args, session, kwargs);
  }

  Handle_ListIncludingContainers(args, session, kwargs) {
    return this._globalAssets.Handle_ListIncludingContainers(args, session, kwargs);
  }

  Handle_GetAssetWorth(args, session, kwargs) {
    return this._globalAssets.Handle_GetAssetWorth(args, session, kwargs);
  }

  Handle_GetPublicInfo(args, session) {
    const { charId, charData } = resolveCharacterInfo(args, session);
    log.debug(`[CharMgr] GetPublicInfo(${charId})`);
    return buildKeyVal(buildPublicInfoEntries(charId, charData, session));
  }

  Handle_GetPublicInfo3(args, session) {
    const { charId, charData } = resolveCharacterInfo(args, session);
    log.debug(`[CharMgr] GetPublicInfo3(${charId})`);
    return {
      type: "list",
      items: [buildKeyVal(buildPublicInfoEntries(charId, charData, session))],
    };
  }

  Handle_GetTopBounties() {
    log.debug("[CharMgr] GetTopBounties");
    return { type: "list", items: [] };
  }

  Handle_GetRecentShipKillsAndLosses(args, session) {
    const charId =
      (session && Number(session.currentBoundObjectID || 0)) ||
      (session && Number(session.characterID || session.charid || 0)) ||
      0;
    const limit = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const startKillID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    return {
      type: "list",
      items: listKillmailsForCharacter(charId, {
        limit,
        startKillID,
      }).map((record) => buildKillmailPayload(record)),
    };
  }

  Handle_GetPrivateInfo(args, session) {
    log.debug("[CharMgr] GetPrivateInfo");
    const { charId, charData } = resolveCharacterInfo(args, session);
    return buildRow(
      [
        "characterID",
        "gender",
        "createDateTime",
        "raceID",
        "bloodlineID",
        "ancestryID",
        "balance",
        "securityRating",
      ],
      [
        charId,
        normalizeCharacterGender(charData.gender, 1),
        buildFiletimeLong(charData.createDateTime),
        charData.raceID || 1,
        charData.bloodlineID || 1,
        charData.ancestryID || 1,
        Number(charData.balance ?? 0),
        Number(charData.securityStatus ?? charData.securityRating ?? 0),
      ],
    );
  }

  Handle_GetPrivateInfoOnCorpChange(args, session) {
    const { charId, charData } = resolveCharacterInfo(args, session);
    log.debug(`[CharMgr] GetPrivateInfoOnCorpChange(${charId})`);
    return resolveCorporationChangeInfo(charId, charData, session);
  }

  Handle_GetCharacterDescription(args, session) {
    const { charData } = resolveCharacterInfo(args, session);
    log.debug("[CharMgr] GetCharacterDescription");
    return charData.description || "";
  }

  Handle_GetCloneInfo(args, session) {
    log.debug("[CharMgr] GetCloneInfo");
    const { charData } = resolveCharacterInfo(args, session);
    const { station, homeStationInfo } = resolveHomeStationRecord(charData, session);

    return buildKeyVal([
      ["homeStationID", station.stationID],
      [
        "cloneStationID",
        Number(homeStationInfo.cloneStationID || station.stationID) || station.stationID,
      ],
      [
        "clones",
        buildCloneEntries(charData.jumpClones || [], (entry) =>
          buildKeyVal([
            ["cloneID", Number(entry.cloneID || 0)],
            ["name", entry.name || station.stationName],
            ["stationID", Number(entry.stationID || station.stationID)],
            ["solarSystemID", Number(entry.solarSystemID || station.solarSystemID)],
          ]),
        ),
      ],
      [
        "implants",
        buildCloneEntries(charData.implants || [], (entry) =>
          buildKeyVal([
            ["typeID", Number(entry.typeID || 0)],
            ["name", entry.name || ""],
            ["slot", Number(entry.slot || 0)],
          ]),
        ),
      ],
      ["timeLastJump", buildFiletimeLong(charData.timeLastCloneJump || 0n)],
    ]);
  }

  Handle_GetHomeStation(args, session) {
    log.debug("[CharMgr] GetHomeStation");
    const { charData } = resolveCharacterInfo(args, session);
    const { station, homeStationInfo } = resolveHomeStationRecord(charData, session);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_GetHomeStationRow(args, session) {
    log.debug("[CharMgr] GetHomeStationRow");

    // V23.02 mapView.py calls:
    //   homeStationRow = sm.GetService('charactersheet').GetHomeStationRow()
    // and then reads:
    //   homeStationRow.stationID
    //   homeStationRow.solarSystemID
    //   homeStationRow.stationTypeID
    //
    // Returning None crashes StarMap with:
    //   AttributeError: 'NoneType' object has no attribute 'stationID'
    //
    // The existing home-station KeyVal payload already exposes those fields,
    // so reuse it for the row-style call.
    return this.Handle_GetHomeStation(args, session);
  }

  Handle_getHomeStationRow(args, session) {
    return this.Handle_GetHomeStationRow(args, session);
  }

  Handle_get_home_station_row(args, session) {
    return this.Handle_GetHomeStationRow(args, session);
  }

  Handle_LogStartOfCharacterCreation() {
    log.debug("[CharMgr] LogStartOfCharacterCreation");
    return null;
  }

  // Paperdoll.State:
  // 0=NoRecustomization, 1=Resculpting, 2=NoExistingCustomization,
  // 3=FullRecustomizing, 4=ForceRecustomize
  Handle_GetPaperdollState(args, session) {
    const { charId, charData } = resolveCharacterInfo(args, session);
    const paperDollState = resolvePaperDollState(charData, 2);
    log.debug(`[CharMgr] GetPaperdollState(${charId}) -> ${paperDollState}`);
    return paperDollState;
  }

  Handle_GetCharacterCreationDate(args, session) {
    const { charId, charData } = resolveCharacterInfo(args, session);
    log.debug(`[CharMgr] GetCharacterCreationDate(${charId})`);
    return buildFiletimeLong(charData.createDateTime);
  }

  Handle_GetCharacterSettings(args, session) {
    log.debug("[CharMgr] GetCharacterSettings called");
    const characterID = sessionCharacterID(session);
    return buildDict(
      Object.entries(getCharacterSettings(characterID)).sort(([left], [right]) => (
        String(left).localeCompare(String(right))
      )),
    );
  }

  Handle_GetSettingsInfo() {
    log.debug("[CharMgr] GetSettingsInfo called");
    const py2codeHex =
      "630000000000000000010000004300000073040000006900005328010000004e280000000028000000002800000000280000000073080000003c737472696e673e740100000066010000007300000000";
    return [Buffer.from(py2codeHex, "hex"), 0];
  }

  Handle_GetContactList() {
    log.debug("[CharMgr] GetContactList called");
    return buildKeyVal([
      [
        "addresses",
        buildRowset(
          ["contactID", "inWatchlist", "relationshipID", "labelMask"],
          [],
          "eve.common.script.sys.rowset.Rowset",
        ),
      ],
      [
        "blocked",
        buildRowset(
          ["contactID", "inWatchlist", "relationshipID", "labelMask"],
          [],
          "eve.common.script.sys.rowset.Rowset",
        ),
      ],
    ]);
  }

  Handle_GetOwnerNoteLabels(args, session) {
    const characterID = sessionCharacterID(session);
    log.debug(`[CharMgr] GetOwnerNoteLabels(${characterID})`);

    return buildRowset(
      ["noteID", "label"],
      listOwnerNotes(characterID).map((entry) => [
        Number(entry.noteID) || 0,
        entry.label || "",
      ]),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetOwnerNote(args, session) {
    const characterID = sessionCharacterID(session);
    const noteID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[CharMgr] GetOwnerNote(${characterID}, ${noteID})`);

    const note = getOwnerNote(characterID, noteID);
    if (!note) {
      return buildOwnerNotePayload(noteID, "", "");
    }

    return buildOwnerNotePayload(note.noteID, note.label, note.note);
  }

  Handle_AddOwnerNote(args, session) {
    const characterID = sessionCharacterID(session);
    const label = args && args.length > 0 ? args[0] : "";
    const noteText = args && args.length > 1 ? args[1] : "";
    log.debug(`[CharMgr] AddOwnerNote(${characterID}, ${toPlainString(label, "")})`);
    return addOwnerNote(characterID, label, noteText);
  }

  Handle_EditOwnerNote(args, session) {
    const characterID = sessionCharacterID(session);
    const noteID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const label = args && args.length > 1 ? args[1] : undefined;
    const noteText = args && args.length > 2 ? args[2] : undefined;
    log.debug(`[CharMgr] EditOwnerNote(${characterID}, ${noteID})`);
    editOwnerNote(characterID, noteID, label, noteText);
    return null;
  }

  Handle_RemoveOwnerNote(args, session) {
    const characterID = sessionCharacterID(session);
    const noteID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[CharMgr] RemoveOwnerNote(${characterID}, ${noteID})`);
    removeOwnerNote(characterID, noteID);
    return null;
  }

  Handle_GetNote(args, session) {
    const characterID = sessionCharacterID(session);
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[CharMgr] GetNote(${characterID}, ${itemID})`);
    return getEntityNote(characterID, itemID);
  }

  Handle_SetNote(args, session) {
    const characterID = sessionCharacterID(session);
    const itemID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const noteText = args && args.length > 1 ? args[1] : "";
    log.debug(`[CharMgr] SetNote(${characterID}, ${itemID})`);
    setEntityNote(characterID, itemID, noteText);
    return null;
  }

  Handle_SaveCharacterSetting(args, session) {
    const settingKey = args && args.length > 0 ? args[0] : null;
    const settingValue = args && args.length > 1 ? args[1] : null;
    setCharacterSetting(sessionCharacterID(session), settingKey, settingValue);
    return null;
  }

  Handle_DeleteCharacterSetting(args, session) {
    const settingKey = args && args.length > 0 ? args[0] : null;
    deleteCharacterSetting(sessionCharacterID(session), settingKey);
    return null;
  }
}

module.exports = CharMgrService;
