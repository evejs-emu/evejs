/**
 * Object Caching Service
 *
 * Handles cached data queries for pass-by-value CCP cache objects.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCachableObjectResponse,
  __testHooks,
} = require(path.join(__dirname, "./objectCacheRuntime"));

class ObjCacheService extends BaseService {
  constructor() {
    super("objectCaching");
  }

  Handle_GetCachableObject(args) {
    const shared = args && args.length > 0 ? args[0] : 1;
    const objectId = args && args.length > 1 ? args[1] : null;
    const objectVersion = args && args.length > 2 ? args[2] : null;
    const nodeId = args && args.length > 3 ? args[3] : null;

    log.debug(
      `[ObjCache] GetCachableObject ${__testHooks.describeObjectId(objectId)}`,
    );

    return getCachableObjectResponse(shared, objectId, objectVersion, nodeId);
  }

  Handle_UpdateCache() {
    log.debug("[ObjCache] UpdateCache");
    return null;
  }
}

module.exports = ObjCacheService;
