const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  extractKwarg,
  machoDictToObject,
  buildCreationPayload,
} = require(path.join(__dirname, "./raffleHelpers"));
const {
  getRaffleRuntime,
} = require(path.join(__dirname, "./raffleRuntimeSingleton"));

class RaffleProxyService extends BaseService {
  constructor() {
    super("raffleProxy");
    this._runtime = getRaffleRuntime();
    this._runtime.initialize();
  }

  Handle_AmIBanned() {
    log.debug("[RaffleProxy] AmIBanned");
    return false;
  }

  Handle_SubscribeToTickets(args, session) {
    log.debug("[RaffleProxy] SubscribeToTickets");
    this._runtime.subscribeToTickets(session);
    return null;
  }

  Handle_UnSubscribeFromTickets(args, session) {
    log.debug("[RaffleProxy] UnSubscribeFromTickets");
    this._runtime.unsubscribeFromTickets(session);
    return null;
  }

  Handle_SubscribeToRaffle(args, session) {
    const raffleId = args && args[0];
    log.debug(`[RaffleProxy] SubscribeToRaffle(${raffleId})`);
    this._runtime.subscribeToRaffle(session, raffleId);
    return null;
  }

  Handle_UnsubscribeFromRaffle(args, session) {
    const raffleId = args && args[0];
    log.debug(`[RaffleProxy] UnsubscribeFromRaffle(${raffleId})`);
    this._runtime.unsubscribeFromRaffle(session, raffleId);
    return null;
  }

  Handle_Grab(args, session) {
    log.debug("[RaffleProxy] Grab");
    return this._runtime.grab({}, {}, null, session);
  }

  Handle_FilteredGrab(args, session, kwargs) {
    const filters = machoDictToObject(extractKwarg(kwargs, "filters"));
    const constraints = machoDictToObject(extractKwarg(kwargs, "constraints"));
    const size = extractKwarg(kwargs, "size");
    log.debug(
      `[RaffleProxy] FilteredGrab filters=${JSON.stringify(filters)} constraints=${JSON.stringify(constraints)}`,
    );
    return this._runtime.grab(filters, constraints, size, session);
  }

  Handle_GetRaffle(args, session) {
    const raffleId = args && args[0];
    log.debug(`[RaffleProxy] GetRaffle(${raffleId})`);
    return this._runtime.getRaffle(raffleId, session);
  }

  Handle_GetMyActiveTickets(args, session) {
    log.debug("[RaffleProxy] GetMyActiveTickets");
    return this._runtime.getActiveTickets(session);
  }

  Handle_GetMyRaffleHistory(args, session, kwargs) {
    const runningId = extractKwarg(kwargs, "running_id");
    log.debug(`[RaffleProxy] GetMyRaffleHistory running_id=${runningId}`);
    return this._runtime.getHistory(session, runningId);
  }

  Handle_GetCreatedParticipated(args, session) {
    log.debug("[RaffleProxy] GetCreatedParticipated");
    return this._runtime.getCharacterStatistics(session);
  }

  Handle_GetActiveHistoricPrices(args) {
    const typeId = args && args[0];
    log.debug(`[RaffleProxy] GetActiveHistoricPrices(${typeId})`);
    return this._runtime.getTypeStatistics(typeId);
  }

  Handle_CreateRaffle(args, session) {
    const creationData = args && args[0];
    log.debug(
      `[RaffleProxy] CreateRaffle ${JSON.stringify(buildCreationPayload(creationData))}`,
    );
    return this._runtime.createRaffle(session, creationData);
  }

  Handle_BuyTicket(args, session) {
    const raffleId = args && args[0];
    const ticketNumber = args && args[1];
    log.debug(`[RaffleProxy] BuyTicket raffle=${raffleId} ticket=${ticketNumber}`);
    return this._runtime.buyTicket(session, raffleId, ticketNumber);
  }

  Handle_BuyRandomTickets(args, session) {
    const raffleId = args && args[0];
    const ticketCount = args && args[1];
    log.debug(`[RaffleProxy] BuyRandomTickets raffle=${raffleId} count=${ticketCount}`);
    return this._runtime.buyRandomTickets(session, raffleId, ticketCount);
  }

  Handle_AwardItem(args, session) {
    const raffleId = args && args[0];
    log.debug(`[RaffleProxy] AwardItem(${raffleId})`);
    return this._runtime.awardItem(session, raffleId);
  }
}

module.exports = RaffleProxyService;
