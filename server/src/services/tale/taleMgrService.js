const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return numericValue;
}

class TaleMgrService extends BaseService {
  constructor() {
    super("taleMgr");
  }

  Handle_GetGlobalWorldEventTales() {
    return [];
  }

  GetGlobalWorldEventTales() {
    return [];
  }

  Handle_get_active_tales_by_template(args) {
    const templateID = normalizePositiveInteger(args && args[0], 0);
    if (!templateID) {
      return [];
    }
    return [];
  }

  get_active_tales_by_template(args) {
    const templateID = Array.isArray(args) ? args[0] : args;
    return this.Handle_get_active_tales_by_template([templateID]);
  }
}

module.exports = TaleMgrService;
