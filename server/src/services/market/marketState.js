const path = require("path");

const { buildFiletimeLong } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { getStationRecord } = require(path.join(
  __dirname,
  "../_shared/stationStaticData",
));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));

const SHIPS = readStaticRows(TABLE.SHIP_TYPES)
  .filter(
    (entry) => Number(entry.categoryID) === 6 && entry.published !== false,
  )
  .map((entry) => ({
    typeID: Number(entry.typeID),
    groupID: Number(entry.groupID),
    categoryID: Number(entry.categoryID),
    marketGroupID: Number(entry.marketGroupID || 0),
    groupName: String(entry.groupName || "Ships"),
    name: String(entry.name || "Ship"),
    basePrice: Number(entry.basePrice || 1000000),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const MARKET_GROUP_ROOT_ID = 500000;

function roundIsk(value) {
  return Math.round(Number(value) * 100) / 100;
}

function getMarketGroupsRows() {
  const rows = [
    [
      null,
      MARKET_GROUP_ROOT_ID,
      "Ships",
      "Ships available in the EveJS Elysian sandbox market.",
      null,
      false,
      null,
      MARKET_GROUP_ROOT_ID,
      null,
      null,
    ],
  ];

  const seen = new Set();
  for (const ship of SHIPS) {
    if (!ship.marketGroupID || seen.has(ship.marketGroupID)) {
      continue;
    }

    seen.add(ship.marketGroupID);
    rows.push([
      MARKET_GROUP_ROOT_ID,
      ship.marketGroupID,
      ship.groupName,
      `${ship.groupName} hulls`,
      null,
      true,
      null,
      ship.marketGroupID,
      null,
      null,
    ]);
  }

  return rows;
}

function getStationAsks(session = null) {
  const station = getStationRecord(session);
  return SHIPS.map((ship) => [
    ship.typeID,
    roundIsk(ship.basePrice * 1.12),
    5,
    station.stationID,
  ]);
}

function getSystemAsks(session = null) {
  const station = getStationRecord(session);
  return SHIPS.map((ship) => [
    ship.typeID,
    roundIsk(ship.basePrice * 1.1),
    7,
    station.stationID,
  ]);
}

function getRegionBest(session = null) {
  const station = getStationRecord(session);
  return SHIPS.map((ship) => [
    ship.typeID,
    roundIsk(ship.basePrice * 1.08),
    9,
    station.stationID,
  ]);
}

function resolveShip(typeID) {
  const numericTypeID = Number(typeID);
  return SHIPS.find((ship) => ship.typeID === numericTypeID) || null;
}

function getOrders(typeID, session = null) {
  const station = getStationRecord(session);
  const ship = resolveShip(typeID);
  if (!ship) {
    return {
      sell: [],
      buy: [],
    };
  }

  const basePrice = ship.basePrice || 1000000;
  const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
  const sell = [
    [
      roundIsk(basePrice * 1.08),
      3,
      ship.typeID,
      32767,
      ship.typeID * 1000 + 1,
      3,
      1,
      0,
      { type: "long", value: now - 864000000000n },
      90,
      station.stationID,
      station.regionID,
      station.solarSystemID,
      0,
    ],
    [
      roundIsk(basePrice * 1.12),
      2,
      ship.typeID,
      32767,
      ship.typeID * 1000 + 2,
      2,
      1,
      0,
      { type: "long", value: now - 432000000000n },
      90,
      station.stationID,
      station.regionID,
      station.solarSystemID,
      0,
    ],
  ];

  const buy = [
    [
      roundIsk(basePrice * 0.92),
      4,
      ship.typeID,
      32767,
      ship.typeID * 1000 + 11,
      4,
      1,
      1,
      { type: "long", value: now - 648000000000n },
      90,
      station.stationID,
      station.regionID,
      station.solarSystemID,
      0,
    ],
  ];

  return { sell, buy };
}

function getPriceHistory(typeID) {
  const ship = resolveShip(typeID);
  if (!ship) {
    return [];
  }

  const basePrice = ship.basePrice || 1000000;
  const day = 864000000000n;
  const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

  return Array.from({ length: 7 }, (_, index) => {
    const factor = 1 + (index - 3) * 0.01;
    const avgPrice = roundIsk(basePrice * factor);
    return [
      buildFiletimeLong(now - BigInt(6 - index) * day),
      roundIsk(avgPrice * 0.98),
      roundIsk(avgPrice * 1.02),
      avgPrice,
      10 + index,
      1 + Math.floor(index / 2),
    ];
  });
}

module.exports = {
  getMarketGroupsRows,
  getStationAsks,
  getSystemAsks,
  getRegionBest,
  getOrders,
  getPriceHistory,
};
