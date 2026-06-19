const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));
const {
  throwWrappedRaffleCreateError,
} = require(path.join(__dirname, "../../common/machoErrors"));
const {
  TOKEN_TYPE_ID,
} = require(path.join(__dirname, "./raffleConstants"));
const {
  normalizeInteger,
  getSessionCharacterID,
  isSupportedTicketCount,
  isValidTotalPrice,
} = require(path.join(__dirname, "./raffleHelpers"));
const {
  ITEM_FLAGS,
  resolveStationSolarSystemId,
} = require(path.join(__dirname, "./raffleInventory"));

const TRIGLAVIAN_FACTION_ID = 500026;

function isStationLocation(locationId) {
  return Boolean(worldData.getStationByID(normalizeInteger(locationId, 0)));
}

function isTriglavianSystem(solarSystemId) {
  const solarSystem = worldData.getSolarSystemByID(
    normalizeInteger(solarSystemId, 0),
  );
  return normalizeInteger(solarSystem && solarSystem.factionID, 0) ===
    TRIGLAVIAN_FACTION_ID;
}

function validateCreateInput({
  session,
  sessionStationId,
  creationData,
  totalPrice,
  item,
  token,
  raffleState,
}) {
  const ownerId = getSessionCharacterID(session);

  if (ownerId <= 0) {
    throwWrappedRaffleCreateError("ItemOwnerError");
  }
  if (!item) {
    throwWrappedRaffleCreateError("ItemEscrowError");
  }
  if (!token) {
    throwWrappedRaffleCreateError("TokenPaymentError");
  }
  if (normalizeInteger(item.typeID, 0) !== normalizeInteger(creationData.type_id, 0)) {
    throwWrappedRaffleCreateError("TypeMismatchError");
  }
  if (normalizeInteger(token.typeID, 0) !== TOKEN_TYPE_ID) {
    throwWrappedRaffleCreateError("TokenTypeError");
  }
  if (!isSupportedTicketCount(creationData.ticket_count)) {
    throwWrappedRaffleCreateError("TicketCountError");
  }
  if (!isValidTotalPrice(totalPrice)) {
    throwWrappedRaffleCreateError("TicketPriceError");
  }
  if (normalizeInteger(item.ownerID, 0) !== ownerId) {
    throwWrappedRaffleCreateError("ItemOwnerError");
  }
  if (normalizeInteger(token.ownerID, 0) !== ownerId) {
    throwWrappedRaffleCreateError("TokenOwnerError");
  }
  if (normalizeInteger(item.typeID, 0) === TOKEN_TYPE_ID) {
    throwWrappedRaffleCreateError("ItemTypeError");
  }
  if (normalizeInteger(item.flagID, 0) !== ITEM_FLAGS.HANGAR) {
    throwWrappedRaffleCreateError("ItemInventoryError");
  }
  if (normalizeInteger(token.flagID, 0) !== ITEM_FLAGS.HANGAR) {
    throwWrappedRaffleCreateError("TokenInventoryError");
  }
  if (normalizeInteger(item.locationID, 0) !== normalizeInteger(creationData.location_id, 0)) {
    throwWrappedRaffleCreateError("ItemLocationError");
  }
  if (
    normalizeInteger(token.locationID, 0) !==
    normalizeInteger(creationData.token_location_id, 0)
  ) {
    throwWrappedRaffleCreateError("TokenLocationError");
  }
  if (!isStationLocation(item.locationID)) {
    throwWrappedRaffleCreateError("ItemLocationError");
  }
  if (!isStationLocation(token.locationID)) {
    throwWrappedRaffleCreateError("TokenLocationError");
  }
  if (sessionStationId > 0 && normalizeInteger(item.locationID, 0) !== sessionStationId) {
    throwWrappedRaffleCreateError("ItemLocationError");
  }
  if (sessionStationId > 0 && normalizeInteger(token.locationID, 0) !== sessionStationId) {
    throwWrappedRaffleCreateError("TokenLocationError");
  }
  if (raffleState && raffleState.isItemReserved(item.itemID)) {
    throwWrappedRaffleCreateError("ItemEscrowError");
  }

  const solarSystemId = resolveStationSolarSystemId(
    item.locationID,
    creationData.solar_system_id,
  );
  if (
    normalizeInteger(creationData.solar_system_id, 0) > 0 &&
    solarSystemId > 0 &&
    solarSystemId !== normalizeInteger(creationData.solar_system_id, 0)
  ) {
    throwWrappedRaffleCreateError("ItemLocationError");
  }
  if (solarSystemId > 0 && isTriglavianSystem(solarSystemId)) {
    throwWrappedRaffleCreateError("ItemTriglavianSystemError");
  }

  return {
    ownerId,
    solarSystemId,
  };
}

module.exports = {
  validateCreateInput,
  isStationLocation,
  isTriglavianSystem,
};
