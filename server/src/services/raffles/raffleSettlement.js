const path = require("path");

const {
  adjustCharacterBalance,
  getCharacterWalletJournal,
} = require(path.join(__dirname, "../account/walletState"));
const {
  findItemById,
} = require(path.join(__dirname, "../inventory/itemStore"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  normalizeInteger,
  calculateTotalPrice,
  calculateSellerPayout,
  groupTicketsByOwner,
} = require(path.join(__dirname, "./raffleHelpers"));
const {
  restoreEscrowedItem,
} = require(path.join(__dirname, "./raffleInventory"));
const {
  RAFFLE_STATUS,
} = require(path.join(__dirname, "./raffleConstants"));
const {
  buildRaffleSettlementState,
} = require(path.join(__dirname, "./raffleSeed"));

function getPayoutDescription(raffleId) {
  return `HyperNet raffle payout ${raffleId}`;
}

function getRefundDescription(raffleId) {
  return `HyperNet raffle refund ${raffleId}`;
}

function hasWalletJournalEntry(characterId, raffleId, description) {
  return getCharacterWalletJournal(characterId).some((entry) => (
    normalizeInteger(entry && entry.referenceID, 0) === normalizeInteger(raffleId, 0) &&
    String(entry && entry.description || "") === String(description || "")
  ));
}

function ensureSettlementState(raffleState) {
  raffleState.settlement = buildRaffleSettlementState(raffleState.settlement);
  return raffleState.settlement;
}

function repairPersistedRaffleState(raffleState) {
  let dirty = false;
  const settlement = ensureSettlementState(raffleState);

  if (
    raffleState.winningTicket &&
    !settlement.sellerPayoutApplied &&
    hasWalletJournalEntry(
      raffleState.ownerId,
      raffleState.raffleId,
      getPayoutDescription(raffleState.raffleId),
    )
  ) {
    settlement.sellerPayoutApplied = true;
    raffleState.pendingIsk = 0;
    dirty = true;
  }

  if (
    normalizeInteger(raffleState.raffleStatus, 0) === RAFFLE_STATUS.FINISHED_DELIVERED &&
    !settlement.itemDelivered
  ) {
    settlement.itemDelivered = true;
    dirty = true;
  }

  if (normalizeInteger(raffleState.raffleStatus, 0) === RAFFLE_STATUS.FINISHED_EXPIRED) {
    dirty = repairRefundJournalState(raffleState) || dirty;
    dirty = repairRestoredItemState(raffleState) || dirty;
  }

  return dirty;
}

function repairRefundJournalState(raffleState) {
  const settlement = ensureSettlementState(raffleState);
  let dirty = false;

  for (const [ownerId, tickets] of groupTicketsByOwner(raffleState.soldTickets)) {
    const refundAmount = raffleState.ticketPrice * tickets.length;
    const existingAmount = Number(settlement.refundedOwners[String(ownerId)] || 0);
    if (existingAmount >= refundAmount) {
      continue;
    }

    if (
      hasWalletJournalEntry(
        ownerId,
        raffleState.raffleId,
        getRefundDescription(raffleState.raffleId),
      )
    ) {
      settlement.refundedOwners[String(ownerId)] = refundAmount;
      dirty = true;
    }
  }

  if (dirty) {
    raffleState.pendingIsk = 0;
  }
  return dirty;
}

function repairRestoredItemState(raffleState) {
  const settlement = ensureSettlementState(raffleState);
  if (
    settlement.itemRestored ||
    raffleState.source !== "player" ||
    !raffleState.inventory ||
    normalizeInteger(raffleState.inventory.escrowItemId, 0) <= 0
  ) {
    return false;
  }

  const escrowItem = findItemById(raffleState.inventory.escrowItemId);
  if (
    escrowItem &&
    normalizeInteger(escrowItem.locationID, 0) ===
      normalizeInteger(raffleState.inventory.originalLocationId, 0) &&
    normalizeInteger(escrowItem.flagID, 0) ===
      normalizeInteger(raffleState.inventory.originalFlagId, 0)
  ) {
    settlement.itemRestored = true;
    return true;
  }

  return false;
}

function restoreExpiredItem(raffleState) {
  const settlement = ensureSettlementState(raffleState);
  if (
    raffleState.source !== "player" ||
    !raffleState.inventory ||
    normalizeInteger(raffleState.inventory.escrowItemId, 0) <= 0
  ) {
    return {
      dirty: false,
      inventoryChanges: [],
    };
  }

  if (settlement.itemRestored) {
    return {
      dirty: false,
      inventoryChanges: [],
    };
  }

  const escrowItem = findItemById(raffleState.inventory.escrowItemId);
  if (
    escrowItem &&
    normalizeInteger(escrowItem.locationID, 0) ===
      normalizeInteger(raffleState.inventory.originalLocationId, 0) &&
    normalizeInteger(escrowItem.flagID, 0) ===
      normalizeInteger(raffleState.inventory.originalFlagId, 0)
  ) {
    settlement.itemRestored = true;
    return {
      dirty: true,
      inventoryChanges: [],
    };
  }

  const restoreResult = restoreEscrowedItem(
    raffleState.inventory.escrowItemId,
    raffleState.inventory.originalLocationId,
    raffleState.inventory.originalFlagId,
  );
  if (!restoreResult.success) {
    log.warn(
      `[RaffleRuntime] Failed to restore escrowed item raffle=${raffleState.raffleId} item=${raffleState.inventory.escrowItemId}`,
    );
    return {
      dirty: false,
      inventoryChanges: [],
    };
  }

  settlement.itemRestored = true;
  return {
    dirty: true,
    inventoryChanges: [restoreResult.data.change],
  };
}

function refundExpiredTickets(raffleState) {
  const settlement = ensureSettlementState(raffleState);
  let dirty = false;

  for (const [ownerId, tickets] of groupTicketsByOwner(raffleState.soldTickets)) {
    const refundAmount = raffleState.ticketPrice * tickets.length;
    const refundedAmount = Number(settlement.refundedOwners[String(ownerId)] || 0);
    if (refundedAmount >= refundAmount) {
      continue;
    }

    const walletResult = adjustCharacterBalance(ownerId, refundAmount, {
      description: getRefundDescription(raffleState.raffleId),
      ownerID1: ownerId,
      referenceID: raffleState.raffleId,
    });
    if (!walletResult.success) {
      log.warn(
        `[RaffleRuntime] Failed to refund owner=${ownerId} raffle=${raffleState.raffleId} amount=${refundAmount}`,
      );
      continue;
    }

    settlement.refundedOwners[String(ownerId)] = refundAmount;
    dirty = true;
  }

  if (dirty) {
    raffleState.pendingIsk = 0;
  }
  return dirty;
}

function creditSellerIfNeeded(raffleState) {
  const settlement = ensureSettlementState(raffleState);
  if (
    !raffleState.winningTicket ||
    settlement.sellerPayoutApplied
  ) {
    return false;
  }

  const sellerPayout = calculateSellerPayout(
    calculateTotalPrice(raffleState.ticketPrice, raffleState.ticketCount),
  );
  const normalizedAmount = Number(sellerPayout) || 0;
  if (normalizedAmount <= 0 || normalizeInteger(raffleState.ownerId, 0) <= 0) {
    settlement.sellerPayoutApplied = true;
    raffleState.pendingIsk = 0;
    return true;
  }

  const walletResult = adjustCharacterBalance(raffleState.ownerId, normalizedAmount, {
    description: getPayoutDescription(raffleState.raffleId),
    ownerID1: raffleState.ownerId,
    referenceID: raffleState.raffleId,
  });
  if (!walletResult.success) {
    log.warn(
      `[RaffleRuntime] Failed to credit seller=${raffleState.ownerId} raffle=${raffleState.raffleId} amount=${normalizedAmount}`,
    );
    return false;
  }

  settlement.sellerPayoutApplied = true;
  raffleState.pendingIsk = 0;
  return true;
}

module.exports = {
  getPayoutDescription,
  getRefundDescription,
  hasWalletJournalEntry,
  ensureSettlementState,
  repairPersistedRaffleState,
  restoreExpiredItem,
  refundExpiredTickets,
  creditSellerIfNeeded,
};
