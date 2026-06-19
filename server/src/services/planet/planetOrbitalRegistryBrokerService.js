const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildBoundObjectResponse,
  buildKeyVal,
  normalizeNumber,
  resolveBoundNodeId,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const planetOrbitalState = require("./planetOrbitalState");

const DEFAULT_CUSTOMS_OFFICE_TAX_RATE =
  planetOrbitalState.DEFAULT_TAX_RATES.corporation;

function extractOrbitalID(args) {
  const unwrapped = unwrapMarshalValue(Array.isArray(args) ? args[0] : args);
  return Math.trunc(normalizeNumber(unwrapped, 0));
}

function buildTaxRateKeyVal(taxRates = {}) {
  const normalizedRates = planetOrbitalState._testing.normalizeTaxRates(taxRates);
  return buildKeyVal(Object.entries(normalizedRates));
}

class PlanetOrbitalRegistryBrokerService extends BaseService {
  constructor() {
    super("planetOrbitalRegistryBroker");
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    void args;
    void session;
    void kwargs;
    log.debug("[PlanetOrbitalRegistryBroker] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[PlanetOrbitalRegistryBroker] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetTaxRate(args) {
    const customsOfficeID = extractOrbitalID(args);
    log.debug(
      `[PlanetOrbitalRegistryBroker] GetTaxRate customsOfficeID=${customsOfficeID || "unknown"}`,
    );
    return planetOrbitalState.getTaxRate(customsOfficeID);
  }

  Handle_GetSettingsInfo(args) {
    const orbitalID = extractOrbitalID(args);
    log.debug(
      `[PlanetOrbitalRegistryBroker] GetSettingsInfo orbitalID=${orbitalID || "unknown"}`,
    );
    const settings = planetOrbitalState.buildOrbitalSettingsInfo(orbitalID);
    return [
      settings.reinforceHour,
      buildTaxRateKeyVal(settings.taxRates),
      settings.standingLevel,
      settings.allowAlliance,
      settings.allowStandings,
      settings.aclGroupID,
    ];
  }

  Handle_UpdateSettings(args) {
    const unwrappedArgs = unwrapMarshalValue(Array.isArray(args) ? args : []);
    const orbitalID = Math.trunc(normalizeNumber(unwrappedArgs[0], 0));
    const taxRates = unwrappedArgs[2] && typeof unwrappedArgs[2] === "object"
      ? unwrappedArgs[2]
      : {};
    log.info(
      `[PlanetOrbitalRegistryBroker] UpdateSettings orbitalID=${orbitalID || "unknown"}`,
    );
    const result = planetOrbitalState.updateOrbitalSettings(orbitalID, {
      reinforceHour: unwrappedArgs[1],
      taxRates,
      standingLevel: unwrappedArgs[3],
      allowAlliance: unwrappedArgs[4],
      allowStandings: unwrappedArgs[5],
      aclGroupID: unwrappedArgs[6],
    });
    if (!result.success) {
      log.warn(
        `[PlanetOrbitalRegistryBroker] UpdateSettings failed orbitalID=${orbitalID}: ${result.errorMsg || "UNKNOWN_ERROR"}`,
      );
    }
    return null;
  }

  Handle_RevertOrbitalsToInterBus() {
    log.debug("[PlanetOrbitalRegistryBroker] RevertOrbitalsToInterBus noop");
    return null;
  }
}

PlanetOrbitalRegistryBrokerService._testing = {
  DEFAULT_CUSTOMS_OFFICE_TAX_RATE,
  buildTaxRateKeyVal,
  extractOrbitalID,
};

module.exports = PlanetOrbitalRegistryBrokerService;
