const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const {
  buildList,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  throwWrappedRaffleCreateError,
  throwWrappedRaffleError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  findItemById,
  listCharacterItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const itemTypeRegistry = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const log = require(path.join(__dirname, "../../utils/logger"));
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));
const {
  FILETIME_TICKS_PER_MS,
  SEED_DURATION_MS,
  HISTORY_PAGE_SIZE,
  DEFAULT_GRAB_SIZE,
  DEFAULT_STARTUP_SEED_COUNT,
  MAX_QA_SEED_COUNT,
  RAFFLE_STATUS,
  TOKEN_TYPE_ID,
} = require(path.join(__dirname, "./raffleConstants"));
const {
  normalizeInteger,
  getSessionCharacterID,
  dedupeTicketNumbers,
  shuffleArray,
  calculateTotalPrice,
  tokensRequired,
  matchesGrabFilters,
  isExpired,
  pickWinningTicket,
  buildCreationPayload,
  getSessionStationID,
  isFinishedStatus,
} = require(path.join(__dirname, "./raffleHelpers"));
const {
  buildTicketValue,
  buildRaffleValue,
  buildCharacterStatisticsValue,
  buildTypeStatisticsValue,
} = require(path.join(__dirname, "./raffleMarshal"));
const {
  notifyTicketsUpdated,
  notifyRaffleUpdated,
  notifyRaffleFinished,
  notifyRaffleCreated,
} = require(path.join(__dirname, "./raffleNotifications"));
const {
  ensureCharacterTokenStack,
  consumeTokenStack,
  moveItemToRaffleEscrow,
  restoreEscrowedItem,
  deliverRaffleItemToCharacterStation,
  notifyInventoryChangesToCharacter,
  getCharacterSessions,
  getLargestTokenStack,
  ITEM_FLAGS,
} = require(path.join(__dirname, "./raffleInventory"));
const RaffleState = require(path.join(__dirname, "./raffleState"));
const {
  buildRaffleSettlementState,
} = require(path.join(__dirname, "./raffleSeed"));
const RaffleSeedManager = require(path.join(__dirname, "./raffleSeedManager"));
const {
  ensureSettlementState,
  repairPersistedRaffleState,
  restoreExpiredItem,
  refundExpiredTickets,
  creditSellerIfNeeded,
} = require(path.join(__dirname, "./raffleSettlement"));
const {
  validateCreateInput,
} = require(path.join(__dirname, "./raffleValidation"));

const RAFFLE_CREATE_DEBUG_PATH = path.join(
  __dirname,
  "../../../logs/raffle-create-debug.log",
);

function summarizeCreateItem(item) {
  if (!item) {
    return null;
  }

  return {
    itemID: item.itemID,
    typeID: item.typeID,
    ownerID: item.ownerID,
    locationID: item.locationID,
    flagID: item.flagID,
    singleton: item.singleton,
    stacksize: item.stacksize,
  };
}

function appendCreateDebug(entry) {
  try {
    rotatingLog.append(RAFFLE_CREATE_DEBUG_PATH, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    log.warn(`[RaffleRuntime] Failed to write create debug log: ${error.message}`);
  }
}

function resolveCreateItem(ownerId, creationData, sessionStationId) {
  const directItem = findItemById(creationData.item_id);
  const locationId = normalizeInteger(
    creationData.location_id,
    sessionStationId,
  );
  const directItemMatches = (
    directItem &&
    normalizeInteger(directItem.ownerID, 0) === ownerId &&
    normalizeInteger(directItem.typeID, 0) === normalizeInteger(creationData.type_id, 0) &&
    normalizeInteger(directItem.flagID, 0) === ITEM_FLAGS.HANGAR &&
    (
      locationId <= 0 ||
      normalizeInteger(directItem.locationID, 0) === locationId
    )
  );
  if (directItemMatches) {
    return {
      item: directItem,
      resolution: "direct",
    };
  }

  const candidates = listCharacterItems(ownerId, {
    locationID: locationId > 0 ? locationId : null,
    flagID: ITEM_FLAGS.HANGAR,
    typeID: creationData.type_id,
  });
  if (candidates.length === 1) {
    return {
      item: candidates[0],
      resolution: "owner-location-type-fallback",
    };
  }

  return {
    item: null,
    resolution: "missing",
    candidateCount: candidates.length,
    directItem: summarizeCreateItem(directItem),
  };
}

function resolveCreateToken(ownerId, creationData, sessionStationId) {
  const directToken = findItemById(creationData.token_id);
  const locationId = normalizeInteger(
    creationData.token_location_id,
    sessionStationId,
  );
  const directTokenMatches = (
    directToken &&
    normalizeInteger(directToken.ownerID, 0) === ownerId &&
    normalizeInteger(directToken.typeID, 0) === TOKEN_TYPE_ID &&
    normalizeInteger(directToken.flagID, 0) === ITEM_FLAGS.HANGAR &&
    (
      locationId <= 0 ||
      normalizeInteger(directToken.locationID, 0) === locationId
    )
  );
  if (directTokenMatches) {
    return {
      token: directToken,
      resolution: "direct",
    };
  }

  const fallbackToken = getLargestTokenStack(
    ownerId,
    locationId > 0 ? locationId : null,
  );
  if (fallbackToken) {
    return {
      token: fallbackToken,
      resolution: "largest-stack-fallback",
    };
  }

  return {
    token: null,
    resolution: "missing",
    directToken: summarizeCreateItem(directToken),
  };
}

class RaffleRuntime {
  constructor() {
    this._state = new RaffleState();
    this._seedManager = new RaffleSeedManager(this._state);
    this._expirationTimers = new Map();
    this._initialized = false;
  }

  initialize() {
    if (this._initialized) {
      return;
    }

    this._state.initialize();
    this._repairPersistedRaffles();
    this._schedulePersistedExpirations();
    this._sweepExpiredRaffles();

    const createdSeedRaffles = this._seedManager.reconcile();
    for (const raffleState of createdSeedRaffles) {
      this._scheduleExpiration(raffleState);
    }

    this._initialized = true;
  }

  reset(options = {}) {
    for (const timer of this._expirationTimers.values()) {
      clearTimeout(timer);
    }
    this._expirationTimers.clear();
    this._state.reset(options);
    this._initialized = false;
  }

  subscribeToTickets(session) {
    this.initialize();
    this._ensureCharacterReady(session);
    this._state.subscriptions.subscribeToTickets(session);
  }

  unsubscribeFromTickets(session) {
    this.initialize();
    this._state.subscriptions.unsubscribeFromTickets(session);
  }

  subscribeToRaffle(session, raffleId) {
    this.initialize();
    const raffleState = this._requireRaffle(raffleId);
    this._state.subscriptions.subscribeToRaffle(session, raffleState.raffleId);
  }

  unsubscribeFromRaffle(session, raffleId) {
    this.initialize();
    this._state.subscriptions.unsubscribeFromRaffle(session, raffleId);
  }

  grab(filters = {}, constraints = {}, size = null, session = null) {
    this.initialize();
    this._ensureCharacterReady(session);
    this._sweepExpiredRaffles();

    const maxSize =
      size === null || size === undefined
        ? DEFAULT_GRAB_SIZE
        : Math.max(0, normalizeInteger(size, DEFAULT_GRAB_SIZE));
    if (maxSize === 0) {
      return buildList([]);
    }

    const viewerCharacterId = getSessionCharacterID(session);
    const raffles = this._state.getRaffles()
      .filter((raffleState) => raffleState.raffleStatus === RAFFLE_STATUS.RUNNING)
      .filter((raffleState) => (
        matchesGrabFilters(
          raffleState,
          filters,
          constraints,
          viewerCharacterId,
        )
      ))
      .slice(0, maxSize)
      .map(buildRaffleValue);

    return buildList(raffles);
  }

  getRaffle(raffleId, session = null) {
    this.initialize();
    this._ensureCharacterReady(session);
    this._sweepExpiredRaffles();
    return buildRaffleValue(this._requireRaffle(raffleId));
  }

  getActiveTickets(session) {
    this.initialize();
    this._sweepExpiredRaffles();
    const ownerId = getSessionCharacterID(session);
    const tickets = this._state.getRaffles()
      .filter((raffleState) => raffleState.raffleStatus === RAFFLE_STATUS.RUNNING)
      .flatMap((raffleState) => this._getOwnedTickets(ownerId, raffleState))
      .map(buildTicketValue);
    return buildList(tickets);
  }

  getHistory(session, runningId = null) {
    this.initialize();
    this._sweepExpiredRaffles();
    const ownerId = getSessionCharacterID(session);
    const normalizedRunningId = normalizeInteger(runningId, 0);
    const page = this._state.getRaffles()
      .filter((raffleState) => (
        raffleState.ownerId === ownerId ||
        this._getOwnedTickets(ownerId, raffleState).length > 0
      ))
      .filter((raffleState) => (
        normalizedRunningId <= 0 || raffleState.runningId < normalizedRunningId
      ))
      .slice(0, HISTORY_PAGE_SIZE)
      .map(buildRaffleValue);

    return [buildList(page), HISTORY_PAGE_SIZE];
  }

  getCharacterStatistics(session) {
    this.initialize();
    this._sweepExpiredRaffles();
    const ownerId = getSessionCharacterID(session);
    let rafflesParticipated = 0;
    let rafflesWon = 0;
    let finishedDelivered = 0;
    let finishedUndelivered = 0;
    let finishedExpired = 0;
    let createdRunning = 0;

    for (const raffleState of this._state.getRaffles()) {
      const hasTickets = this._getOwnedTickets(ownerId, raffleState).length > 0;
      const isWinner =
        normalizeInteger(raffleState.winningTicket && raffleState.winningTicket.ownerId, 0) ===
        ownerId;
      const isOwner = raffleState.ownerId === ownerId;

      if (hasTickets) {
        rafflesParticipated += 1;
      }
      if (isWinner) {
        rafflesWon += 1;
      }
      if (isOwner && raffleState.raffleStatus === RAFFLE_STATUS.FINISHED_DELIVERED) {
        finishedDelivered += 1;
      }
      if (isOwner && raffleState.raffleStatus === RAFFLE_STATUS.FINISHED_UNDELIVERED) {
        finishedUndelivered += 1;
      }
      if (isOwner && raffleState.raffleStatus === RAFFLE_STATUS.FINISHED_EXPIRED) {
        finishedExpired += 1;
      }
      if (isOwner && raffleState.raffleStatus === RAFFLE_STATUS.RUNNING) {
        createdRunning += 1;
      }
    }

    return buildCharacterStatisticsValue({
      raffles_participated: rafflesParticipated,
      raffles_won: rafflesWon,
      finished_delivered: finishedDelivered,
      finished_undelivered: finishedUndelivered,
      finished_expired: finishedExpired,
      created_running: createdRunning,
    });
  }

  getTypeStatistics(typeId) {
    this.initialize();
    this._sweepExpiredRaffles();
    const normalizedTypeId = normalizeInteger(typeId, 0);
    const matchingRaffles = this._state.getRaffles().filter(
      (raffleState) => raffleState.typeId === normalizedTypeId,
    );
    const activePrices = matchingRaffles
      .filter((raffleState) => raffleState.raffleStatus === RAFFLE_STATUS.RUNNING)
      .map((raffleState) => calculateTotalPrice(raffleState.ticketPrice, raffleState.ticketCount));
    const historicPrices = matchingRaffles
      .filter((raffleState) => raffleState.raffleStatus !== RAFFLE_STATUS.RUNNING)
      .map((raffleState) => calculateTotalPrice(raffleState.ticketPrice, raffleState.ticketCount));
    const average = (values) => (
      values.length > 0
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : 0
    );

    return buildTypeStatisticsValue({
      historic_count: historicPrices.length,
      historic_min: historicPrices.length ? Math.min(...historicPrices) : 0,
      historic_max: historicPrices.length ? Math.max(...historicPrices) : 0,
      historic_average: average(historicPrices),
      active_count: activePrices.length,
      active_min: activePrices.length ? Math.min(...activePrices) : 0,
      active_max: activePrices.length ? Math.max(...activePrices) : 0,
      active_average: average(activePrices),
    });
  }

  createRaffle(session, rawCreationData) {
    this.initialize();
    this._ensureCharacterReady(session);
    this._sweepExpiredRaffles();

    const creationData = buildCreationPayload(rawCreationData);
    const ownerId = getSessionCharacterID(session);
    const sessionStationId = getSessionStationID(session);
    const resolvedItem = resolveCreateItem(ownerId, creationData, sessionStationId);
    const resolvedToken = resolveCreateToken(ownerId, creationData, sessionStationId);
    const item = resolvedItem.item;
    const token = resolvedToken.token;
    const totalPrice = calculateTotalPrice(
      creationData.ticket_price,
      creationData.ticket_count,
    );
    let validated = null;
    try {
      validated = validateCreateInput({
        session,
        sessionStationId,
        creationData,
        totalPrice,
        item,
        token,
        raffleState: this._state,
      });
    } catch (error) {
      appendCreateDebug({
        at: new Date().toISOString(),
        phase: "validate",
        error: error && error.message ? error.message : String(error),
        session: {
          characterID: session && session.characterID,
          charid: session && session.charid,
          stationID: session && session.stationID,
          stationid: session && session.stationid,
        },
        ownerId,
        sessionStationId,
        creationData,
        resolvedItem,
        resolvedToken,
        item: summarizeCreateItem(item),
        token: summarizeCreateItem(token),
      });
      throw error;
    }

    const requiredTokens = tokensRequired(totalPrice);
    if (normalizeInteger(token.stacksize, 0) < requiredTokens) {
      appendCreateDebug({
        at: new Date().toISOString(),
        phase: "token-count",
        error: "TokenAmountError",
        ownerId,
        sessionStationId,
        creationData,
        resolvedItem,
        resolvedToken,
        item: summarizeCreateItem(item),
        token: summarizeCreateItem(token),
        requiredTokens,
      });
      throwWrappedRaffleCreateError("TokenAmountError");
    }

    const escrowResult = moveItemToRaffleEscrow(item.itemID);
    if (!escrowResult.success) {
      appendCreateDebug({
        at: new Date().toISOString(),
        phase: "escrow",
        error: "ItemEscrowError",
        ownerId,
        sessionStationId,
        creationData,
        resolvedItem,
        resolvedToken,
        item: summarizeCreateItem(item),
        token: summarizeCreateItem(token),
      });
      throwWrappedRaffleCreateError("ItemEscrowError");
    }

    const tokenResult = consumeTokenStack(token.itemID, requiredTokens);
    if (!tokenResult.success) {
      appendCreateDebug({
        at: new Date().toISOString(),
        phase: "consume-tokens",
        error:
          tokenResult.errorMsg === "INSUFFICIENT_TOKENS"
            ? "TokenAmountError"
            : "TokenPaymentError",
        ownerId,
        sessionStationId,
        creationData,
        resolvedItem,
        resolvedToken,
        item: summarizeCreateItem(item),
        token: summarizeCreateItem(token),
        requiredTokens,
        tokenResult,
      });
      restoreEscrowedItem(item.itemID, item.locationID, item.flagID);
      throwWrappedRaffleCreateError(
        tokenResult.errorMsg === "INSUFFICIENT_TOKENS"
          ? "TokenAmountError"
          : "TokenPaymentError",
      );
    }

    const ids = this._state.allocateIds();
    const creationTime = currentFileTime();
    const expirationTime =
      creationTime + BigInt(SEED_DURATION_MS) * FILETIME_TICKS_PER_MS;
    const typeMetadata = itemTypeRegistry.resolveItemByTypeID(item.typeID) || {};
    const raffleState = {
      runningId: ids.runningId,
      raffleId: ids.raffleId,
      ownerId,
      locationId: item.locationID,
      solarSystemId: validated.solarSystemId,
      itemId: item.itemID,
      typeId: item.typeID,
      groupId: normalizeInteger(item.groupID, 0),
      categoryId: normalizeInteger(item.categoryID, 0),
      metaGroupId: normalizeInteger(
        typeMetadata.metaGroupID || typeMetadata.metaGroupId,
        0,
      ),
      ticketCount: creationData.ticket_count,
      ticketPrice: creationData.ticket_price,
      restrictionId: creationData.restriction_id,
      creationTime,
      expirationTime,
      soldTickets: [],
      winningTicket: null,
      raffleStatus: RAFFLE_STATUS.RUNNING,
      endDate: null,
      pendingIsk: 0,
      metaData: {
        is_copy: normalizeInteger(item.categoryID, 0) === 9 && item.quantity === -2,
      },
      inventory: {
        escrowItemId: item.itemID,
        originalLocationId: item.locationID,
        originalFlagId: item.flagID,
        tokenItemId: token.itemID,
        tokenCount: requiredTokens,
      },
      settlement: buildRaffleSettlementState(),
      source: "player",
    };

    this._state.addRaffle(raffleState);
    this._scheduleExpiration(raffleState);
    notifyInventoryChangesToCharacter(
      ownerId,
      [escrowResult.data.change, tokenResult.data.change],
      { includeSession: session },
    );

    const creatorSessions = getCharacterSessions(ownerId, {
      includeSession: session,
    });
    setTimeout(() => {
      notifyRaffleCreated(
        creatorSessions,
        raffleState.raffleId,
        buildRaffleValue(raffleState),
      );
    }, 0);

    return raffleState.raffleId;
  }

  buyTicket(session, raffleId, ticketNumber) {
    this.initialize();
    this._sweepExpiredRaffles();
    const raffleState = this._requireRunningRaffle(raffleId);
    const normalizedTicketNumber = normalizeInteger(ticketNumber, -1);
    if (
      normalizedTicketNumber < 0 ||
      normalizedTicketNumber >= raffleState.ticketCount
    ) {
      throwWrappedRaffleError("raffles.TicketUnavailableError");
    }

    return this._buyTickets(session, raffleState, [normalizedTicketNumber]);
  }

  buyRandomTickets(session, raffleId, ticketCount) {
    this.initialize();
    this._sweepExpiredRaffles();
    const raffleState = this._requireRunningRaffle(raffleId);
    const requestedCount = Math.max(0, normalizeInteger(ticketCount, 0));
    if (requestedCount === 0) {
      return buildRaffleValue(raffleState);
    }

    const availableTicketNumbers = shuffleArray(
      this._getAvailableTicketNumbers(raffleState),
    );
    if (availableTicketNumbers.length === 0) {
      throwWrappedRaffleError("raffles.TicketUnavailableError");
    }
    if (requestedCount > availableTicketNumbers.length) {
      throwWrappedRaffleError("raffles.TicketUnavailableError");
    }

    return this._buyTickets(
      session,
      raffleState,
      availableTicketNumbers.slice(0, requestedCount),
    );
  }

  awardItem(session, raffleId) {
    this.initialize();
    this._sweepExpiredRaffles();
    const raffleState = this._requireRaffle(raffleId);
    const ownerId = getSessionCharacterID(session);
    const winnerId = normalizeInteger(
      raffleState.winningTicket && raffleState.winningTicket.ownerId,
      0,
    );

    if (
      raffleState.raffleStatus !== RAFFLE_STATUS.FINISHED_UNDELIVERED ||
      ownerId <= 0 ||
      winnerId !== ownerId
    ) {
      throwWrappedRaffleError("raffles.FailureToDeliverItemError");
    }

    const deliveryResult = deliverRaffleItemToCharacterStation(
      raffleState.itemId,
      winnerId,
      raffleState.locationId,
      ITEM_FLAGS.HANGAR,
    );
    if (!deliveryResult.success) {
      throwWrappedRaffleError("raffles.FailureToDeliverItemError");
    }

    raffleState.raffleStatus = RAFFLE_STATUS.FINISHED_DELIVERED;
    if (!raffleState.endDate) {
      raffleState.endDate = currentFileTime();
    }
    ensureSettlementState(raffleState).itemDelivered = true;
    this._state.saveRaffle(raffleState);

    const deliveredChange = deliveryResult.data && deliveryResult.data.change;
    const previousOwnerId = normalizeInteger(
      deliveredChange && deliveredChange.previousData && deliveredChange.previousData.ownerID,
      0,
    );
    if (deliveredChange) {
      notifyInventoryChangesToCharacter(winnerId, [deliveredChange], {
        includeSession: session,
      });
      if (previousOwnerId > 0 && previousOwnerId !== winnerId) {
        notifyInventoryChangesToCharacter(previousOwnerId, [deliveredChange]);
      }
    }

    const raffleData = buildRaffleValue(raffleState);
    const recipientSessions = this._state.subscriptions.getInterestedSessions(
      raffleState,
      { includeSession: session },
    );
    notifyRaffleUpdated(recipientSessions, raffleState.raffleId, raffleData);
    return null;
  }

  qaSeedRaffles(count = DEFAULT_STARTUP_SEED_COUNT) {
    this.initialize();
    const normalizedCount = Math.max(
      0,
      Math.min(MAX_QA_SEED_COUNT, normalizeInteger(count, 0)),
    );
    const raffleStates = this._seedManager.seedRequested(normalizedCount);
    for (const raffleState of raffleStates) {
      this._scheduleExpiration(raffleState);
    }
    return raffleStates.length;
  }

  _ensureCharacterReady(session) {
    if (!session || getSessionStationID(session) <= 0) {
      return;
    }
    if (config.hyperNetDevAutoGrantCores !== true) {
      return;
    }
    ensureCharacterTokenStack(session);
  }

  _repairPersistedRaffles() {
    for (const raffleState of this._state.getRaffles()) {
      if (repairPersistedRaffleState(raffleState)) {
        this._state.saveRaffle(raffleState);
      }
    }
  }

  _schedulePersistedExpirations() {
    for (const raffleState of this._state.getRaffles()) {
      this._scheduleExpiration(raffleState);
    }
  }

  _scheduleExpiration(raffleState) {
    if (
      !raffleState ||
      normalizeInteger(raffleState.raffleStatus, 0) !== RAFFLE_STATUS.RUNNING ||
      typeof raffleState.expirationTime !== "bigint"
    ) {
      return;
    }

    this._clearExpiration(raffleState.raffleId);
    const remainingMs = Math.max(
      0,
      Number((raffleState.expirationTime - currentFileTime()) / FILETIME_TICKS_PER_MS),
    );
    const timer = setTimeout(() => {
      this._expireRaffle(raffleState.raffleId);
    }, remainingMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this._expirationTimers.set(raffleState.raffleId, timer);
  }

  _clearExpiration(raffleId) {
    const normalizedRaffleId = normalizeInteger(raffleId, 0);
    const timer = this._expirationTimers.get(normalizedRaffleId);
    if (timer) {
      clearTimeout(timer);
      this._expirationTimers.delete(normalizedRaffleId);
    }
  }

  _sweepExpiredRaffles() {
    const now = currentFileTime();
    for (const raffleState of this._state.getRaffles()) {
      if (isExpired(raffleState, now)) {
        this._expireRaffle(raffleState.raffleId);
      }
    }
  }

  _expireRaffle(raffleId) {
    const raffleState = this._state.getRaffle(raffleId);
    if (!raffleState) {
      return false;
    }

    ensureSettlementState(raffleState);
    const alreadyFinished = isFinishedStatus(raffleState.raffleStatus);
    if (!alreadyFinished) {
      raffleState.winningTicket = null;
      raffleState.raffleStatus = RAFFLE_STATUS.FINISHED_EXPIRED;
      raffleState.endDate = currentFileTime();
      this._clearExpiration(raffleState.raffleId);
      this._state.saveRaffle(raffleState);
    }

    const refundedDirty = refundExpiredTickets(raffleState);
    const restoreResult = restoreExpiredItem(raffleState);
    if (refundedDirty || restoreResult.dirty) {
      this._state.saveRaffle(raffleState);
    }

    if (restoreResult.inventoryChanges.length > 0) {
      notifyInventoryChangesToCharacter(raffleState.ownerId, restoreResult.inventoryChanges);
    }

    if (!alreadyFinished) {
      const raffleData = buildRaffleValue(raffleState);
      const recipientSessions = this._state.subscriptions.getInterestedSessions(
        raffleState,
      );
      notifyRaffleUpdated(recipientSessions, raffleState.raffleId, raffleData);
      notifyRaffleFinished(recipientSessions, raffleState.raffleId, null);
      return true;
    }

    return refundedDirty || restoreResult.dirty;
  }

  _buyTickets(session, raffleState, requestedTicketNumbers = []) {
    const ownerId = getSessionCharacterID(session);
    if (ownerId <= 0) {
      throwWrappedRaffleError("raffles.TicketUnavailableError");
    }

    const requestedNumbers = dedupeTicketNumbers(requestedTicketNumbers).filter(
      (ticketNumber) => ticketNumber < raffleState.ticketCount,
    );
    if (requestedNumbers.length === 0) {
      return buildRaffleValue(raffleState);
    }

    const availableTicketNumbers = this._getAvailableTicketNumbers(raffleState);
    const availableNumbers = new Set(availableTicketNumbers);
    for (const ticketNumber of requestedNumbers) {
      if (!availableNumbers.has(ticketNumber)) {
        throwWrappedRaffleError("raffles.TicketUnavailableError");
      }
    }

    this._debitTicketPurchase(ownerId, raffleState, requestedNumbers.length);
    for (const ticketNumber of requestedNumbers) {
      raffleState.soldTickets.push({
        runningId: raffleState.runningId,
        raffleId: raffleState.raffleId,
        ownerId,
        number: ticketNumber,
      });
    }
    raffleState.soldTickets.sort((left, right) => left.number - right.number);
    raffleState.pendingIsk += raffleState.ticketPrice * requestedNumbers.length;

    const justFinished = raffleState.soldTickets.length >= raffleState.ticketCount;
    if (justFinished) {
      this._finishRaffle(raffleState);
    } else {
      this._state.saveRaffle(raffleState);
    }

    const raffleData = buildRaffleValue(raffleState);
    const recipientSessions = this._state.subscriptions.getInterestedSessions(
      raffleState,
      { includeSession: session },
    );
    notifyTicketsUpdated(
      recipientSessions,
      raffleState.raffleId,
      raffleState.soldTickets.length,
    );
    notifyRaffleUpdated(recipientSessions, raffleState.raffleId, raffleData);
    if (justFinished) {
      notifyRaffleFinished(
        recipientSessions,
        raffleState.raffleId,
        raffleState.winningTicket
          ? buildTicketValue(raffleState.winningTicket)
          : null,
      );
    }

    return raffleData;
  }

  _finishRaffle(raffleState) {
    if (isFinishedStatus(raffleState.raffleStatus)) {
      return;
    }

    raffleState.winningTicket = pickWinningTicket(raffleState.soldTickets);
    raffleState.raffleStatus = raffleState.winningTicket
      ? RAFFLE_STATUS.FINISHED_UNDELIVERED
      : RAFFLE_STATUS.FINISHED_EXPIRED;
    raffleState.endDate = currentFileTime();
    this._clearExpiration(raffleState.raffleId);
    this._state.saveRaffle(raffleState);

    if (raffleState.winningTicket) {
      if (creditSellerIfNeeded(raffleState)) {
        this._state.saveRaffle(raffleState);
      }
    }
  }

  _debitTicketPurchase(ownerId, raffleState, ticketCount) {
    const amount =
      raffleState.ticketPrice * Math.max(0, normalizeInteger(ticketCount, 0));
    if (amount <= 0) {
      return;
    }

    const walletResult = adjustCharacterBalance(ownerId, -amount, {
      description: `HyperNet ticket purchase ${raffleState.raffleId}`,
      ownerID1: ownerId,
      ownerID2: raffleState.ownerId,
      referenceID: raffleState.raffleId,
    });
    if (!walletResult.success) {
      throwWrappedRaffleError(
        walletResult.errorMsg === "INSUFFICIENT_FUNDS"
          ? "raffles.NotEnoughISKError"
          : "raffles.PurchaseError",
      );
    }
  }

  _getOwnedTickets(ownerId, raffleState) {
    return raffleState.soldTickets.filter((ticket) => (
      normalizeInteger(ticket && ticket.ownerId, 0) === normalizeInteger(ownerId, 0)
    ));
  }

  _getAvailableTicketNumbers(raffleState) {
    const availableTicketNumbers = [];
    for (let ticketNumber = 0; ticketNumber < raffleState.ticketCount; ticketNumber += 1) {
      const alreadySold = raffleState.soldTickets.some((ticket) => (
        normalizeInteger(ticket && ticket.number, -1) === ticketNumber
      ));
      if (!alreadySold) {
        availableTicketNumbers.push(ticketNumber);
      }
    }
    return availableTicketNumbers;
  }

  _requireRaffle(raffleId) {
    const raffleState = this._state.getRaffle(raffleId);
    if (!raffleState) {
      throwWrappedRaffleError("raffles.RaffleNotFoundError");
    }
    return raffleState;
  }

  _requireRunningRaffle(raffleId) {
    const raffleState = this._requireRaffle(raffleId);
    if (isFinishedStatus(raffleState.raffleStatus)) {
      throwWrappedRaffleError("raffles.TicketUnavailableError");
    }
    return raffleState;
  }
}

module.exports = RaffleRuntime;
