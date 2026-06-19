const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildBlueprintInstancePayload,
} = require(path.join(__dirname, "./industryPayloads"));
const {
  getBlueprintByItemID,
  listBlueprintInstancesByOwner,
} = require(path.join(__dirname, "./industryRuntimeState"));
const log = require(path.join(__dirname, "../../utils/logger"));

class BlueprintManagerService extends BaseService {
  constructor() {
    super("blueprintManager");
  }

  Handle_GetLimits() {
    log.debug("[BlueprintManager] GetLimits");
    return buildDict([
      ["maxBlueprintResults", 500],
    ]);
  }

  Handle_GetBlueprintData(args, session) {
    const blueprintID = args && args.length > 0 ? args[0] : null;
    log.debug(`[BlueprintManager] GetBlueprintData(${String(blueprintID)})`);
    return buildBlueprintInstancePayload(getBlueprintByItemID(blueprintID, session) || {});
  }

  Handle_GetBlueprintDataByOwner(args, session) {
    const ownerID = args && args.length > 0 ? args[0] : null;
    const facilityID = args && args.length > 1 ? args[1] : null;
    log.debug(
      `[BlueprintManager] GetBlueprintDataByOwner(ownerID=${String(ownerID)}, facilityID=${String(facilityID)})`,
    );
    const result = listBlueprintInstancesByOwner(ownerID, facilityID, session);
    return [
      buildList(result.blueprints.map((blueprint) => buildBlueprintInstancePayload(blueprint))),
      buildDict(
        Object.entries(result.counts || {}).map(([key, count]) => [
          key === "null" ? null : Number(key) || 0,
          Number(count) || 0,
        ]),
      ),
    ];
  }
}

module.exports = BlueprintManagerService;
