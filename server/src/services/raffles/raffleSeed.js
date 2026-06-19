const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  listCharacterItems,
} = require(path.join(__dirname, "../inventory/itemStore"));
const itemTypeRegistry = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const {
  getUnpublishedShipTypes,
} = require(path.join(__dirname, "../chat/shipTypeRegistry"));
const {
  FILETIME_TICKS_PER_MS,
  SEED_DURATION_MS,
  SEED_OWNER_ID,
  SEED_FALLBACK_STATION_ID,
  SEED_FALLBACK_SYSTEM_ID,
  SEED_PREFERRED_TYPE_IDS,
  SEED_FALLBACK_ITEM_TYPE_IDS,
  TICKET_COUNT_POOL,
  TOKEN_TYPE_ID,
  RAFFLE_STATUS,
} = require(path.join(__dirname, "./raffleConstants"));
const {
  normalizeInteger,
  pickRandomEntries,
  shuffleArray,
  isValidTotalPrice,
} = require(path.join(__dirname, "./raffleHelpers"));
const {
  resolveCharacterStationId,
  resolveStationSolarSystemId,
  ITEM_FLAGS,
  seedShipsForCharacter,
  seedItemsForCharacter,
} = require(path.join(__dirname, "./raffleInventory"));

function buildDefaultSettlementState() {
  return {
    sellerPayoutApplied: false,
    refundedOwners: {},
    itemRestored: false,
    itemDelivered: false,
  };
}

function getSeedOwnerId() {
  return Math.max(1, normalizeInteger(config.hyperNetSeedOwnerId, SEED_OWNER_ID));
}

function isSeedRestockEnabled() {
  return config.hyperNetSeedRestockEnabled !== false;
}

function buildRaffleSettlementState(overrides = {}) {
  return {
    ...buildDefaultSettlementState(),
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };
}

function buildSeedRaffleState(runtimeState, item, context = {}) {
  const ids = runtimeState.allocateIds();
  const creationTime = currentFileTime();
  const expirationTime =
    creationTime + BigInt(SEED_DURATION_MS) * FILETIME_TICKS_PER_MS;
  const typeMetadata = itemTypeRegistry.resolveItemByTypeID(item.typeID) || {};
  const seedKind = context.seedKind === "item" ? "item" : "ship";
  const ownerId = normalizeInteger(context.ownerId, getSeedOwnerId());

  return {
    runningId: ids.runningId,
    raffleId: ids.raffleId,
    ownerId,
    locationId: normalizeInteger(item.locationID, context.locationId),
    solarSystemId: normalizeInteger(
      context.solarSystemId,
      SEED_FALLBACK_SYSTEM_ID,
    ),
    itemId: normalizeInteger(item.itemID, 0),
    typeId: normalizeInteger(item.typeID, 0),
    groupId: normalizeInteger(item.groupID, 0),
    categoryId: normalizeInteger(item.categoryID, 0),
    metaGroupId: normalizeInteger(
      typeMetadata.metaGroupID || typeMetadata.metaGroupId,
      0,
    ),
    ticketCount: context.ticketCount,
    ticketPrice: context.ticketPrice,
    restrictionId: null,
    creationTime,
    expirationTime,
    soldTickets: [],
    winningTicket: null,
    raffleStatus: RAFFLE_STATUS.RUNNING,
    endDate: null,
    pendingIsk: 0,
    metaData: {
      is_copy: false,
      seed_kind: seedKind,
    },
    inventory: {
      escrowItemId: normalizeInteger(item.itemID, 0),
      originalLocationId: normalizeInteger(item.locationID, context.locationId),
      originalFlagId: normalizeInteger(item.flagID, ITEM_FLAGS.HANGAR),
    },
    settlement: buildRaffleSettlementState({
      itemRestored: true,
    }),
    source: "seed",
    seedKind,
  };
}

function getSeedLocationContext(ownerId = getSeedOwnerId()) {
  const locationId =
    resolveCharacterStationId(ownerId) || SEED_FALLBACK_STATION_ID;
  const solarSystemId =
    resolveStationSolarSystemId(locationId, SEED_FALLBACK_SYSTEM_ID) ||
    SEED_FALLBACK_SYSTEM_ID;

  return {
    locationId,
    solarSystemId,
  };
}

function getHangarItems(locationId, ownerId = getSeedOwnerId()) {
  return listCharacterItems(ownerId, {
    locationID: locationId,
    flagID: ITEM_FLAGS.HANGAR,
  })
    .filter((item) => item && normalizeInteger(item.itemID, 0) > 0)
    .sort((left, right) => left.itemID - right.itemID);
}

function isSeedReserved(runtimeState, item) {
  return runtimeState.isItemReserved(normalizeInteger(item && item.itemID, 0));
}

function getAvailableSeedShips(runtimeState, locationId, ownerId = getSeedOwnerId()) {
  return getHangarItems(locationId, ownerId)
    .filter((item) => (
      normalizeInteger(item.categoryID, 0) === 6 &&
      !isSeedReserved(runtimeState, item)
    ));
}

function getAvailableSeedItems(runtimeState, locationId, ownerId = getSeedOwnerId()) {
  return getHangarItems(locationId, ownerId)
    .filter((item) => (
      normalizeInteger(item.categoryID, 0) !== 6 &&
      normalizeInteger(item.typeID, 0) !== TOKEN_TYPE_ID &&
      !isSeedReserved(runtimeState, item)
    ));
}

function buildFallbackShipPool() {
  const unpublishedShips = getUnpublishedShipTypes();
  const preferredShips = SEED_PREFERRED_TYPE_IDS
    .map((typeId) => unpublishedShips.find((shipType) => shipType.typeID === typeId))
    .filter(Boolean);
  const otherShips = unpublishedShips.filter((shipType) => (
    !preferredShips.some((preferredShip) => preferredShip.typeID === shipType.typeID)
  ));
  return [...preferredShips, ...otherShips];
}

function buildFallbackItemPool() {
  return SEED_FALLBACK_ITEM_TYPE_IDS
    .map((typeId) => itemTypeRegistry.resolveItemByTypeID(typeId))
    .filter(Boolean)
    .map((itemType) => ({
      ...itemType,
      quantity: 1,
      singleton: 0,
  }));
}

function ensureSeedShips(runtimeState, locationId, count, ownerId = getSeedOwnerId()) {
  let availableShips = getAvailableSeedShips(runtimeState, locationId, ownerId);
  if (availableShips.length >= count) {
    return availableShips;
  }

  const shortage = Math.max(0, normalizeInteger(count, 0) - availableShips.length);
  if (shortage > 0 && isSeedRestockEnabled()) {
    const shipTypesToSeed = buildFallbackShipPool().slice(0, shortage);
    if (shipTypesToSeed.length > 0) {
      seedShipsForCharacter(ownerId, locationId, shipTypesToSeed);
    }
  }

  availableShips = getAvailableSeedShips(runtimeState, locationId, ownerId);
  return availableShips;
}

function ensureSeedItems(runtimeState, locationId, count, ownerId = getSeedOwnerId()) {
  let availableItems = getAvailableSeedItems(runtimeState, locationId, ownerId);
  if (availableItems.length >= count) {
    return availableItems;
  }

  const shortage = Math.max(0, normalizeInteger(count, 0) - availableItems.length);
  if (shortage > 0 && isSeedRestockEnabled()) {
    const itemTypesToSeed = buildFallbackItemPool().slice(0, shortage);
    if (itemTypesToSeed.length > 0) {
      seedItemsForCharacter(ownerId, locationId, itemTypesToSeed);
    }
  }

  availableItems = getAvailableSeedItems(runtimeState, locationId, ownerId);
  return availableItems;
}

function prioritizeShips(ships = []) {
  const preferredShips = [];
  const otherShips = [];

  for (const ship of Array.isArray(ships) ? ships : []) {
    if (SEED_PREFERRED_TYPE_IDS.includes(normalizeInteger(ship && ship.typeID, 0))) {
      preferredShips.push(ship);
    } else {
      otherShips.push(ship);
    }
  }

  return [...shuffleArray(preferredShips), ...shuffleArray(otherShips)];
}

function prioritizeItems(items = []) {
  const withBasePrice = [];
  const withoutBasePrice = [];

  for (const item of Array.isArray(items) ? items : []) {
    const typeMetadata = itemTypeRegistry.resolveItemByTypeID(item && item.typeID) || {};
    if (Number(typeMetadata.basePrice || 0) > 0) {
      withBasePrice.push(item);
    } else {
      withoutBasePrice.push(item);
    }
  }

  return [...shuffleArray(withBasePrice), ...shuffleArray(withoutBasePrice)];
}

function chooseSeedTicketCount(seedKind) {
  const pool = seedKind === "ship"
    ? TICKET_COUNT_POOL.filter((count) => [8, 16].includes(count))
    : TICKET_COUNT_POOL.filter((count) => [8, 16].includes(count));
  const usablePool = pool.length > 0 ? pool : TICKET_COUNT_POOL;
  return usablePool[Math.floor(Math.random() * usablePool.length)] || 8;
}

function roundSeedTicketPrice(value) {
  const normalizedValue = Math.max(1, Math.round(Number(value) || 0));
  if (normalizedValue < 100_000) {
    return Math.ceil(normalizedValue / 100) * 100;
  }
  if (normalizedValue < 1_000_000) {
    return Math.ceil(normalizedValue / 1_000) * 1_000;
  }
  if (normalizedValue < 100_000_000) {
    return Math.ceil(normalizedValue / 10_000) * 10_000;
  }
  if (normalizedValue < 1_000_000_000) {
    return Math.ceil(normalizedValue / 100_000) * 100_000;
  }
  return Math.ceil(normalizedValue / 1_000_000) * 1_000_000;
}

function estimateSeedItemValue(item) {
  const typeMetadata = itemTypeRegistry.resolveItemByTypeID(item && item.typeID) || {};
  const rawStackSize = normalizeInteger(item && (item.stacksize || item.quantity), 0);
  const stackSize = Math.max(
    1,
    rawStackSize > 0 ? rawStackSize : 1,
  );
  const basePrice = Number(typeMetadata.basePrice || 0);
  if (basePrice > 0) {
    return Math.max(1_000, Math.round(basePrice * stackSize));
  }

  if (normalizeInteger(item && item.categoryID, 0) === 6) {
    return 50_000_000;
  }

  return Math.max(1_000_000, 250_000 * stackSize);
}

function resolveSeedTicketing(item, seedKind) {
  const ticketCount = chooseSeedTicketCount(seedKind);
  const estimatedValue = estimateSeedItemValue(item);
  let ticketPrice = roundSeedTicketPrice(estimatedValue / ticketCount);
  let totalPrice = ticketPrice * ticketCount;

  if (!isValidTotalPrice(totalPrice)) {
    if (totalPrice <= 0) {
      ticketPrice = 1_000;
    } else if (totalPrice < 1_000) {
      ticketPrice = Math.ceil(1_000 / ticketCount);
    } else {
      ticketPrice = Math.floor(10_000_000_000_000 / ticketCount);
    }
    ticketPrice = roundSeedTicketPrice(ticketPrice);
    totalPrice = ticketPrice * ticketCount;
  }

  return {
    ticketCount,
    ticketPrice,
    estimatedValue,
  };
}

function buildSeedRaffles(runtimeState, options = {}) {
  const shipCount = Math.max(0, normalizeInteger(options.shipCount, 0));
  const itemCount = Math.max(0, normalizeInteger(options.itemCount, 0));
  if (shipCount === 0 && itemCount === 0) {
    return [];
  }

  const ownerId = getSeedOwnerId();
  const { locationId, solarSystemId } = getSeedLocationContext(ownerId);
  const selectedShips = pickRandomEntries(
    prioritizeShips(ensureSeedShips(runtimeState, locationId, shipCount, ownerId)),
    shipCount,
  );
  const selectedItems = pickRandomEntries(
    prioritizeItems(ensureSeedItems(runtimeState, locationId, itemCount, ownerId)),
    itemCount,
  );

  const buildSeedEntry = (item, seedKind) => {
    const ticketing = resolveSeedTicketing(item, seedKind);
    return buildSeedRaffleState(runtimeState, item, {
      ownerId,
      locationId,
      solarSystemId,
      ticketCount: ticketing.ticketCount,
      ticketPrice: ticketing.ticketPrice,
      seedKind,
    });
  };

  return [
    ...selectedShips.map((item) => buildSeedEntry(item, "ship")),
    ...selectedItems.map((item) => buildSeedEntry(item, "item")),
  ];
}

module.exports = {
  buildDefaultSettlementState,
  buildRaffleSettlementState,
  buildSeedRaffleState,
  buildSeedRaffles,
  getSeedLocationContext,
  getSeedOwnerId,
  isSeedRestockEnabled,
  getAvailableSeedShips,
  getAvailableSeedItems,
  ensureSeedShips,
  ensureSeedItems,
  resolveSeedTicketing,
};
