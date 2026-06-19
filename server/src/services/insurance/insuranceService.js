const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildBoundObjectResponse,
  buildDict,
  buildList,
  extractList,
  marshalObjectToObject,
  normalizeNumber,
} = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const insuranceRuntime = require(path.join(__dirname, "./insuranceRuntime"));

class InsuranceService extends BaseService {
  constructor() {
    super("insuranceSvc");
    this.reuseBoundObjectForSession = true;
  }

  Handle_GetContracts(args, session) {
    const isCorp = normalizeNumber(args && args[0], 0) > 0;
    const contracts = insuranceRuntime.listContracts(session, isCorp);
    log.debug(`[InsuranceSvc] GetContracts corp=${isCorp ? 1 : 0} -> ${contracts.length}`);
    return buildList(
      contracts
        .map((contract) => insuranceRuntime.buildClientContract(contract))
        .filter(Boolean),
    );
  }

  Handle_GetItemsToInsure(args, session) {
    log.debug("[InsuranceSvc] GetItemsToInsure");
    return buildList(
      insuranceRuntime
        .listItemsToInsure(session)
        .map((ship) => insuranceRuntime.buildClientItemKeyVal(ship)),
    );
  }

  Handle_GetInsurancePrice(args, session) {
    const typeID = normalizeNumber(args && args[0], 0);
    const price = insuranceRuntime.getFullInsurancePrice(typeID);
    log.debug(`[InsuranceSvc] GetInsurancePrice type=${typeID} -> ${price}`);
    return price;
  }

  Handle_GetInsurancePrices(args, session) {
    const typeIDs = extractList(args && args[0])
      .map((entry) => normalizeNumber(entry, 0))
      .filter((entry) => entry > 0);
    const prices = insuranceRuntime.getInsurancePrices(typeIDs);
    log.debug(`[InsuranceSvc] GetInsurancePrices count=${typeIDs.length}`);
    return buildDict(Object.entries(prices).map(([typeID, price]) => [Number(typeID), price]));
  }

  Handle_GetContractForShip(args, session) {
    const itemID = normalizeNumber(args && args[0], 0);
    const contract = insuranceRuntime.getContractForShip(session, itemID);
    log.debug(`[InsuranceSvc] GetContractForShip ship=${itemID} found=${contract ? 1 : 0}`);
    return contract ? insuranceRuntime.buildClientContract(contract) : null;
  }

  Handle_InsureShip(args, session, kwargs) {
    const kw = marshalObjectToObject(kwargs);
    const itemID = normalizeNumber(args && args[0], 0);
    const quotedPremium = normalizeNumber(args && args[1], 0);
    const isCorpItem = normalizeNumber(args && args[2], 0) > 0;
    log.debug(
      `[InsuranceSvc] InsureShip ship=${itemID} premium=${quotedPremium} corp=${isCorpItem ? 1 : 0} voidOld=${kw.voidOld ? 1 : 0}`,
    );
    return insuranceRuntime.insureShip(session, {
      itemID,
      quotedPremium,
      isCorpItem,
      voidOld: kw.voidOld === true || normalizeNumber(kw.voidOld, 0) > 0,
    });
  }

  Handle_UnInsureShip(args, session) {
    const itemID = normalizeNumber(args && args[0], 0);
    log.debug(`[InsuranceSvc] UnInsureShip ship=${itemID}`);
    return insuranceRuntime.unInsureShip(session, itemID);
  }

  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[InsuranceSvc] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  callMethod(method, args, session, kwargs) {
    const response = super.callMethod(method, args, session, kwargs);
    if (response !== null) {
      return response;
    }

    log.warn(`[InsuranceSvc] Unhandled method fallback: ${method}`);
    return null;
  }
}

module.exports = InsuranceService;
