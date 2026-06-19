const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { buildList, buildKeyVal } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  ensureRuntimeInitialized,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  getWarPermitStatusForOwner,
} = require(path.join(__dirname, "./warPermitState"));

class LookupService extends BaseService {
  constructor() {
    super("lookupSvc");
  }

  Handle_LookupWarableCorporationsOrAlliances(args) {
    const search = (args && args.length > 0 ? String(args[0] || "") : "").toLowerCase();
    const exact = Boolean(args && args.length > 1 ? args[1] : false);
    const runtime = ensureRuntimeInitialized();
    const rows = [];
    for (const corporationID of Object.keys(runtime.corporations || {})) {
      const corporation = getCorporationRecord(corporationID);
      const corporationName = corporation && String(corporation.corporationName || "").toLowerCase();
      const matches = exact ? corporationName === search : corporationName.includes(search);
      if (!corporation || !matches) {
        continue;
      }
      rows.push(
        buildKeyVal([
          ["ownerID", corporation.corporationID],
          ["ownerName", corporation.corporationName],
          ["typeID", 2],
          ["warPermit", getWarPermitStatusForOwner(corporation.corporationID)],
        ]),
      );
    }
    for (const allianceID of Object.keys(runtime.alliances || {})) {
      const alliance = getAllianceRecord(allianceID);
      const allianceName = alliance && String(alliance.allianceName || "").toLowerCase();
      const matches = exact ? allianceName === search : allianceName.includes(search);
      if (!alliance || !matches) {
        continue;
      }
      rows.push(
        buildKeyVal([
          ["ownerID", alliance.allianceID],
          ["ownerName", alliance.allianceName],
          ["typeID", 16159],
          ["warPermit", getWarPermitStatusForOwner(alliance.allianceID)],
        ]),
      );
    }
    return buildList(rows);
  }
}

module.exports = LookupService;
