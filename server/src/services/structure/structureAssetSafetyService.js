const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const assetSafetyState = require(path.join(
  __dirname,
  "./structureAssetSafetyState",
));
const structureState = require(path.join(
  __dirname,
  "./structureState",
));

function buildEmptyList() {
  return {
    type: "list",
    items: [],
  };
}

function normalizeWrapIds(args) {
  const wrapIDs = Array.isArray(args) && args.length > 0 ? args[0] : [];
  return Array.isArray(wrapIDs) ? wrapIDs : [wrapIDs];
}

function buildStationInfoPayload(info) {
  if (!info || typeof info !== "object") {
    return null;
  }

  return buildKeyVal([
    ["itemID", Number(info.itemID) || 0],
    ["typeID", Number(info.typeID) || 0],
    ["solarSystemID", Number(info.solarSystemID) || 0],
    ["itemName", String(info.itemName || `Station ${Number(info.itemID) || 0}`)],
  ]);
}

function buildWrapPayload(wrap) {
  return buildKeyVal([
    ["solarSystemID", Number(wrap.solarSystemID) || 0],
    ["assetWrapID", Number(wrap.assetWrapID) || 0],
    ["wrapName", String(wrap.wrapName || `Asset Safety Wrap ${wrap.assetWrapID}`)],
    ["ejectTime", buildFiletimeLong(structureState.toFileTimeLongFromMs(wrap.ejectTimeMs))],
    ["daysUntilCanDeliverConst", Number(wrap.daysUntilCanDeliverConst) || assetSafetyState.DAYS_UNTIL_CAN_DELIVER],
    ["daysUntilAutoMoveConst", Number(wrap.daysUntilAutoMoveConst) || assetSafetyState.DAYS_UNTIL_AUTO_MOVE],
    ["nearestNPCStationInfo", buildStationInfoPayload(wrap.nearestNPCStationInfo)],
  ]);
}

class StructureAssetSafetyService extends BaseService {
  constructor() {
    super("structureAssetSafety");
  }

  Handle_GetItemsInSafetyForCharacter(args, session) {
    const wraps = assetSafetyState.listWrapsForOwner(
      "char",
      session && (session.characterID || session.charid || session.userid),
    );
    log.debug(`[StructureAssetSafety] GetItemsInSafetyForCharacter count=${wraps.length}`);
    return buildList(wraps.map((wrap) => buildWrapPayload(wrap)));
  }

  Handle_GetItemsInSafetyForCorp(args, session) {
    const wraps = assetSafetyState.listWrapsForOwner(
      "corp",
      session && (session.corporationID || session.corpid),
    );
    log.debug(`[StructureAssetSafety] GetItemsInSafetyForCorp count=${wraps.length}`);
    return buildList(wraps.map((wrap) => buildWrapPayload(wrap)));
  }

  Handle_GetWrapNames(args) {
    const wrapIDs = normalizeWrapIds(args);
    log.debug(`[StructureAssetSafety] GetWrapNames count=${wrapIDs.length}`);
    return buildDict(
      wrapIDs.map((wrapID) => [
        Number(wrapID) || wrapID,
        assetSafetyState.getWrapNames([wrapID])[Number(wrapID) || wrapID] || null,
      ]),
    );
  }

  Handle_GetStructuresICanDeliverTo(args, session) {
    const solarSystemID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const targets = assetSafetyState.getDeliveryTargetsForSession(session, solarSystemID);
    const activeWraps = [
      ...assetSafetyState.listWrapsForOwner(
        "char",
        session && (session.characterID || session.charid || session.userid),
        { refresh: false },
      ),
      ...assetSafetyState.listWrapsForOwner(
        "corp",
        session && (session.corporationID || session.corpid),
        { refresh: false },
      ),
    ].filter((wrap) => Number(wrap.solarSystemID) === Number(solarSystemID));
    log.debug(
      `[StructureAssetSafety] GetStructuresICanDeliverTo solarSystem=${String(solarSystemID)}`,
    );
    return [
      activeWraps.length > 0
        ? buildList(
          targets.structures.map((structure) => buildKeyVal([
            ["itemID", Number(structure.itemID) || 0],
            ["typeID", Number(structure.typeID) || 0],
            ["solarSystemID", Number(structure.solarSystemID) || 0],
            ["itemName", String(structure.itemName || `Structure ${Number(structure.itemID) || 0}`)],
          ])),
        )
        : buildEmptyList(),
      activeWraps.length > 0
        ? buildStationInfoPayload(targets.nearestNPCStationInfo)
        : null,
    ];
  }

  Handle_MovePersonalAssetsToSafety(args, session) {
    const solarSystemID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const structureID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    log.debug(
      `[StructureAssetSafety] MovePersonalAssetsToSafety solarSystem=${String(solarSystemID)} structure=${String(structureID)}`,
    );
    assetSafetyState.movePersonalAssetsToSafety(session, solarSystemID, structureID);
    return null;
  }

  Handle_MoveCorpAssetsToSafety(args, session) {
    const solarSystemID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const structureID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    log.debug(
      `[StructureAssetSafety] MoveCorpAssetsToSafety solarSystem=${String(solarSystemID)} structure=${String(structureID)}`,
    );
    assetSafetyState.moveCorporationAssetsToSafety(session, solarSystemID, structureID);
    return null;
  }

  Handle_MoveSafetyWrapToStructure(args, _session, kwargs) {
    const assetWrapID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const solarSystemID = Array.isArray(args) && args.length > 1 ? args[1] : null;
    const destinationID =
      kwargs &&
      kwargs.type === "dict" &&
      Array.isArray(kwargs.entries)
        ? (
            kwargs.entries.find(([key]) => key === "destinationID") || [null, null]
          )[1]
        : null;
    log.debug(
      `[StructureAssetSafety] MoveSafetyWrapToStructure wrap=${String(assetWrapID)} solarSystem=${String(solarSystemID)} destination=${String(destinationID)}`,
    );
    assetSafetyState.deliverWrapToDestination(assetWrapID, destinationID, {
      session: _session,
    });
    return null;
  }

  Handle_MoveEjectTimeGM(args) {
    const assetWrapID = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const days = Array.isArray(args) && args.length > 1 ? args[1] : null;
    log.debug(
      `[StructureAssetSafety] MoveEjectTimeGM wrap=${String(assetWrapID)} days=${String(days)}`,
    );
    assetSafetyState.shiftWrapEjectTimeGM(assetWrapID, days);
    return null;
  }
}

module.exports = StructureAssetSafetyService;
