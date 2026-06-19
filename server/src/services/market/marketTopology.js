const path = require("path");

const worldData = require(path.join(__dirname, "../../space/worldData"));

const RANGE_STATION = -1;
const RANGE_SOLAR_SYSTEM = 0;
const RANGE_CONSTELLATION = 4;
const RANGE_REGION = 32767;

let adjacency = null;
const jumpCache = new Map();

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return Math.trunc(numericValue);
  }
  return fallback;
}

function ensureAdjacency() {
  if (adjacency) {
    return adjacency;
  }

  adjacency = new Map();
  for (const solarSystem of worldData.getSolarSystems()) {
    adjacency.set(normalizePositiveInteger(solarSystem && solarSystem.solarSystemID), new Set());
  }

  for (const solarSystem of worldData.getSolarSystems()) {
    const sourceSystemID = normalizePositiveInteger(
      solarSystem && solarSystem.solarSystemID,
    );
    if (!sourceSystemID) {
      continue;
    }

    for (const stargate of worldData.getStargatesForSystem(sourceSystemID)) {
      const destinationSystemID = normalizePositiveInteger(
        stargate && stargate.destinationSolarSystemID,
      );
      if (!destinationSystemID) {
        continue;
      }

      if (!adjacency.has(sourceSystemID)) {
        adjacency.set(sourceSystemID, new Set());
      }
      if (!adjacency.has(destinationSystemID)) {
        adjacency.set(destinationSystemID, new Set());
      }

      adjacency.get(sourceSystemID).add(destinationSystemID);
      adjacency.get(destinationSystemID).add(sourceSystemID);
    }
  }

  return adjacency;
}

function getStation(stationID) {
  return worldData.getStationByID(normalizePositiveInteger(stationID, 0));
}

function getSolarSystem(solarSystemID) {
  return worldData.getSolarSystemByID(normalizePositiveInteger(solarSystemID, 0));
}

function getStationSolarSystemID(stationID) {
  return normalizePositiveInteger(
    getStation(stationID) && getStation(stationID).solarSystemID,
    0,
  );
}

function getStationConstellationID(stationID) {
  return normalizePositiveInteger(
    getStation(stationID) && getStation(stationID).constellationID,
    0,
  );
}

function getStationRegionID(stationID) {
  return normalizePositiveInteger(
    getStation(stationID) && getStation(stationID).regionID,
    0,
  );
}

function getSolarSystemConstellationID(solarSystemID) {
  return normalizePositiveInteger(
    getSolarSystem(solarSystemID) && getSolarSystem(solarSystemID).constellationID,
    0,
  );
}

function getSolarSystemRegionID(solarSystemID) {
  return normalizePositiveInteger(
    getSolarSystem(solarSystemID) && getSolarSystem(solarSystemID).regionID,
    0,
  );
}

function getJumpCount(fromSolarSystemID, toSolarSystemID) {
  const sourceSystemID = normalizePositiveInteger(fromSolarSystemID, 0);
  const destinationSystemID = normalizePositiveInteger(toSolarSystemID, 0);

  if (!sourceSystemID || !destinationSystemID) {
    return RANGE_REGION;
  }
  if (sourceSystemID === destinationSystemID) {
    return 0;
  }

  const cacheKey = `${sourceSystemID}:${destinationSystemID}`;
  if (jumpCache.has(cacheKey)) {
    return jumpCache.get(cacheKey);
  }

  const graph = ensureAdjacency();
  const visited = new Set([sourceSystemID]);
  const queue = [{ systemID: sourceSystemID, jumps: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const neighbors = graph.get(current.systemID) || new Set();
    for (const neighborSystemID of neighbors) {
      if (visited.has(neighborSystemID)) {
        continue;
      }

      const nextJumps = current.jumps + 1;
      if (neighborSystemID === destinationSystemID) {
        jumpCache.set(cacheKey, nextJumps);
        jumpCache.set(`${destinationSystemID}:${sourceSystemID}`, nextJumps);
        return nextJumps;
      }

      visited.add(neighborSystemID);
      queue.push({
        systemID: neighborSystemID,
        jumps: nextJumps,
      });
    }
  }

  jumpCache.set(cacheKey, RANGE_REGION);
  jumpCache.set(`${destinationSystemID}:${sourceSystemID}`, RANGE_REGION);
  return RANGE_REGION;
}

function getOrderJumpDistance({
  currentStationID = 0,
  currentSolarSystemID = 0,
  orderStationID = 0,
  orderSolarSystemID = 0,
} = {}) {
  const numericCurrentStationID = normalizePositiveInteger(currentStationID, 0);
  const numericOrderStationID = normalizePositiveInteger(orderStationID, 0);
  if (
    numericCurrentStationID > 0 &&
    numericOrderStationID > 0 &&
    numericCurrentStationID === numericOrderStationID
  ) {
    return -1;
  }

  return getJumpCount(currentSolarSystemID, orderSolarSystemID);
}

function isBidOrderInRange(orderRow, sellerStationID, sellerSolarSystemID) {
  const orderRange = Number(orderRow && (orderRow.range_value ?? orderRow.range ?? 0));
  const bidStationID = normalizePositiveInteger(
    orderRow && (orderRow.station_id ?? orderRow.stationID),
    0,
  );
  const bidSolarSystemID = normalizePositiveInteger(
    orderRow && (orderRow.solar_system_id ?? orderRow.solarSystemID),
    0,
  );

  if (orderRange === RANGE_REGION) {
    const bidRegionID = normalizePositiveInteger(
      orderRow && (orderRow.region_id ?? orderRow.regionID),
      getSolarSystemRegionID(bidSolarSystemID),
    );
    return bidRegionID > 0 && bidRegionID === getStationRegionID(sellerStationID);
  }

  if (orderRange === RANGE_STATION) {
    return bidStationID > 0 && bidStationID === normalizePositiveInteger(sellerStationID, 0);
  }

  if (orderRange === RANGE_SOLAR_SYSTEM) {
    return (
      bidSolarSystemID > 0 &&
      bidSolarSystemID === normalizePositiveInteger(sellerSolarSystemID, 0)
    );
  }

  if (orderRange === RANGE_CONSTELLATION) {
    return (
      bidSolarSystemID > 0 &&
      getSolarSystemConstellationID(bidSolarSystemID) ===
        getStationConstellationID(sellerStationID)
    );
  }

  if (orderRange > 0) {
    return getJumpCount(bidSolarSystemID, sellerSolarSystemID) <= orderRange;
  }

  return false;
}

function isSellOrderInRange(orderRow, buyerStationID, buyerSolarSystemID, buyRange) {
  const orderRange = Number(buyRange);
  const askStationID = normalizePositiveInteger(
    orderRow && (orderRow.station_id ?? orderRow.stationID),
    0,
  );
  const askSolarSystemID = normalizePositiveInteger(
    orderRow && (orderRow.solar_system_id ?? orderRow.solarSystemID),
    getStationSolarSystemID(askStationID),
  );
  const normalizedBuyerStationID = normalizePositiveInteger(buyerStationID, 0);
  const normalizedBuyerSolarSystemID = normalizePositiveInteger(
    buyerSolarSystemID,
    getStationSolarSystemID(normalizedBuyerStationID),
  );

  if (orderRange === RANGE_REGION) {
    const askRegionID = normalizePositiveInteger(
      orderRow && (orderRow.region_id ?? orderRow.regionID),
      getStationRegionID(askStationID),
    );
    const buyerRegionID = getStationRegionID(normalizedBuyerStationID);
    if (askRegionID > 0 && buyerRegionID > 0) {
      return askRegionID === buyerRegionID;
    }
    return true;
  }

  if (orderRange === RANGE_STATION) {
    return askStationID > 0 && askStationID === normalizedBuyerStationID;
  }

  if (orderRange === RANGE_SOLAR_SYSTEM) {
    return (
      askSolarSystemID > 0 &&
      askSolarSystemID === normalizedBuyerSolarSystemID
    );
  }

  if (orderRange === RANGE_CONSTELLATION) {
    return (
      askSolarSystemID > 0 &&
      getSolarSystemConstellationID(askSolarSystemID) ===
        getSolarSystemConstellationID(normalizedBuyerSolarSystemID)
    );
  }

  if (orderRange > 0) {
    return getJumpCount(normalizedBuyerSolarSystemID, askSolarSystemID) <= orderRange;
  }

  return false;
}

module.exports = {
  RANGE_STATION,
  RANGE_SOLAR_SYSTEM,
  RANGE_CONSTELLATION,
  RANGE_REGION,
  getStationSolarSystemID,
  getStationConstellationID,
  getStationRegionID,
  getSolarSystemConstellationID,
  getSolarSystemRegionID,
  getJumpCount,
  getOrderJumpDistance,
  isBidOrderInRange,
  isSellOrderInRange,
};
