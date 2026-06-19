/**
 * Config Service
 *
 * Handles client config/settings calls including owner/location/ticker lookups.
 *
 * V23.02 client calls cfg.eveowners.Prime(), cfg.evelocations.Prime(),
 * cfg.corptickernames.Prime() during character selection, which make remote
 * calls to GetMultiOwnersEx, GetMultiLocationsEx, GetMultiCorpTickerNamesEx.
 *
 * EVEmu returns "TupleSet" format: ([columnNames], [[row1], [row2], ...])
 * For empty results: empty tuple ().
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));

const log = require(path.join(__dirname, "../../utils/logger"));
const database = require("../../newDatabase")
const { toClientSafeDisplayName } = require(path.join(
  __dirname,
  "../_shared/clientNameUtils",
));
const { getCharacterShips } = require(path.join(
  __dirname,
  "../character/characterState",
));
const { normalizeCharacterGender } = require(path.join(
  __dirname,
  "../character/characterIdentity",
));
const { findShipItemById } = require(path.join(
  __dirname,
  "../inventory/itemStore",
));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const { buildKeyVal, buildList } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { getStationRecord } = require(path.join(
  __dirname,
  "../_shared/stationStaticData",
));
const { getStaticOwnerRecord } = require(path.join(
  __dirname,
  "../_shared/stationStaticData",
));
const {
  getAllianceShortNameRecord,
  getCorporationRecord,
  getCorporationStationSolarSystems,
  getOwnerLookupRecord,
} = require(path.join(__dirname, "../corporation/corporationState"));
const structureState = require(path.join(
  __dirname,
  "../structure/structureState",
));

/**
 * Extract a plain JS array from a value that might be:
 *   - A plain array: [1, 2, 3]
 *   - A marshal list object: {type: 'list', items: [1, 2, 3]}
 */
function extractList(val) {
  if (Array.isArray(val)) return val;
  if (
    val &&
    typeof val === "object" &&
    val.type === "list" &&
    Array.isArray(val.items)
  ) {
    return val.items;
  }
  return [];
}

function buildAveragePriceEntry(price, adjustedPrice = null) {
  const normalizedAverage = Number(price) || 0;
  const normalizedAdjusted =
    adjustedPrice == null ? normalizedAverage : Number(adjustedPrice) || 0;

  return buildKeyVal([
    ["averagePrice", normalizedAverage],
    ["adjustedPrice", normalizedAdjusted],
  ]);
}

let staticLocationRowsById = null;
let averageMarketPricesPayload = null;

function normalizeSolarSystemID(value, fallback = null) {
  const numericValue = Number(value);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    return numericValue;
  }
  return fallback;
}

function resolveSessionSolarSystemID(session, fallback = null) {
  return normalizeSolarSystemID(
    session &&
      (session.solarSystemID ??
        session.solarsystemid ??
        session.solarSystemID2 ??
        session.solarsystemid2),
    fallback,
  );
}

function buildLocationRow(
  locationID,
  locationName,
  solarSystemID = null,
  position = null,
  fallbackName = null,
) {
  return [
    locationID,
    toClientSafeDisplayName(
      locationName,
      fallbackName || `Location ${locationID}`,
    ),
    normalizeSolarSystemID(solarSystemID, null),
    Number(position && position.x) || 0.0,
    Number(position && position.y) || 0.0,
    Number(position && position.z) || 0.0,
    null,
  ];
}

function getStaticLocationRowsById() {
  if (staticLocationRowsById) {
    return staticLocationRowsById;
  }

  const rowsById = new Map();
  const addLocation = (
    locationID,
    locationName,
    solarSystemID = null,
    position = null,
  ) => {
    const numericId = Number(locationID) || 0;
    if (numericId <= 0 || !locationName) {
      return;
    }
    rowsById.set(
      numericId,
      buildLocationRow(numericId, locationName, solarSystemID, position),
    );
  };

  for (const system of readStaticRows(TABLE.SOLAR_SYSTEMS)) {
    addLocation(
      system.solarSystemID,
      system.solarSystemName,
      system.solarSystemID,
      system.position,
    );
  }
  for (const station of readStaticRows(TABLE.STATIONS)) {
    addLocation(
      station.stationID,
      station.stationName,
      station.solarSystemID,
      station.position,
    );
  }
  for (const celestial of readStaticRows(TABLE.CELESTIALS)) {
    addLocation(
      celestial.itemID,
      celestial.itemName,
      celestial.solarSystemID,
      celestial.position,
    );
  }
  for (const asteroidBelt of readStaticRows(TABLE.ASTEROID_BELTS)) {
    addLocation(
      asteroidBelt.itemID,
      asteroidBelt.itemName,
      asteroidBelt.solarSystemID,
      asteroidBelt.position,
    );
  }
  for (const stargate of readStaticRows(TABLE.STARGATES)) {
    addLocation(
      stargate.itemID,
      stargate.itemName,
      stargate.solarSystemID,
      stargate.position,
    );
  }

  staticLocationRowsById = rowsById;
  return rowsById;
}

function getAverageMarketPricesPayload() {
  if (averageMarketPricesPayload) {
    return averageMarketPricesPayload;
  }

  const entries = readStaticRows(TABLE.ITEM_TYPES)
    .filter(
      (itemType) =>
        itemType &&
        Number(itemType.typeID) > 0 &&
        Number(itemType.basePrice) > 0 &&
        itemType.published !== false,
    )
    .map((itemType) => [
      Number(itemType.typeID),
      buildAveragePriceEntry(itemType.basePrice),
    ]);

  averageMarketPricesPayload = {
    type: "dict",
    entries,
  };
  return averageMarketPricesPayload;
}

function buildShipItemOwnerRow(itemID) {
  const shipItem = findShipItemById(itemID);
  if (!shipItem) {
    return null;
  }

  return [
    Number(shipItem.itemID) || Number(itemID) || 0,
    toClientSafeDisplayName(
      shipItem.shipName || shipItem.itemName || `Ship ${itemID}`,
      `Ship ${itemID}`,
    ),
    Number(shipItem.shipTypeID || shipItem.typeID) || 606,
    0,
    null,
  ];
}

class ConfigService extends BaseService {
  constructor() {
    super("config");
  }

  /**
   * GetMultiOwnersEx — fetch owner info for a list of entity IDs.
   *
   * EVEmu returns TupleSet: ([ownerID, ownerName, typeID, gender, ownerNameID], [rows])
   * The client's _Prime method expects a tuple, NOT a list.
   */
  Handle_GetMultiOwnersEx(args, session) {
    const rawArg = args && args.length > 0 ? args[0] : [];
    const requestedIds = extractList(rawArg);
    log.debug(
      `[ConfigService] GetMultiOwnersEx: ${JSON.stringify(requestedIds)}`,
    );

    const characterResult = database.read("characters", "/")
    const characters = characterResult.success ? characterResult.data : {}

    const rows = [];

    for (const id of requestedIds) {
      const numericId = Number(id);
      if (!Number.isFinite(numericId)) {
        continue;
      }
      const normalizedId = Math.trunc(numericId);

      // Check if this is a character ID we know about
      const charData = normalizedId > 0 ? characters[String(normalizedId)] : null;
      if (charData) {
        rows.push([
          normalizedId, // ownerID
          charData.characterName || "Unknown", // ownerName
          charData.typeID || 1373, // typeID
          normalizeCharacterGender(charData.gender, 1), // gender
          null, // ownerNameID
        ]);
        continue;
      }

      const shipItemOwnerRow = normalizedId > 0
        ? buildShipItemOwnerRow(normalizedId)
        : null;
      if (shipItemOwnerRow) {
        rows.push(shipItemOwnerRow);
        continue;
      }

      const staticOwner = normalizedId > 0
        ? getStaticOwnerRecord(normalizedId, session)
        : null;
      const dynamicOwner = normalizedId > 0
        ? getOwnerLookupRecord(normalizedId)
        : null;
      const ownerRecord = dynamicOwner || staticOwner;
      if (ownerRecord) {
        rows.push([
          ownerRecord.ownerID,
          ownerRecord.ownerName,
          ownerRecord.typeID,
          ownerRecord.gender,
          null,
        ]);
        continue;
      }

      // NPC corps (1000000-1999999 range)
      if (normalizedId >= 1000000 && normalizedId < 2000000) {
        rows.push([
          normalizedId,
          `Corporation ${normalizedId}`,
          2, // typeID = 2 (Corporation)
          0, // gender
          null, // ownerNameID
        ]);
        continue;
      }

      // Unknown entity — return a generic row so the client's cfg._Prime
      // can unpack it and inspect the typeID (e.g. to rule out IsCharacter).
      // Without this, the client gets an empty result and crashes with
      // "ValueError: need more than 0 values to unpack".
      rows.push([
        normalizedId,
        `Item ${normalizedId}`,
        0, // typeID = 0 (not a character/corp/alliance)
        0, // gender
        null, // ownerNameID
      ]);
    }

    if (rows.length === 0) {
      return [];
    }

    // Return TupleSet: ([columnNames], [rows])
    return [["ownerID", "ownerName", "typeID", "gender", "ownerNameID"], rows];
  }

/**
 * GetMultiLocationsEx — fetch location info for a list of location IDs.
 *
 * cfg.evelocations uses:
 * [locationID, locationName, solarSystemID, x, y, z, locationNameID]
 */
  Handle_GetMultiLocationsEx(args, session) {
    const rawArg = args && args.length > 0 ? args[0] : [];
    const requestedIds = extractList(rawArg);
    log.debug(
      `[ConfigService] GetMultiLocationsEx: ${JSON.stringify(requestedIds)}`,
    );

    const characterResult = database.read("characters", "/")
    const characters = characterResult.success ? characterResult.data : {}
    const station = getStationRecord(session);
    const sessionSolarSystemID = resolveSessionSolarSystemID(
      session,
      normalizeSolarSystemID(station && station.solarSystemID, null),
    );
    const locationRowsById = new Map();
    const staticRowsById = getStaticLocationRowsById();

    if (station) {
      locationRowsById.set(
        station.stationID,
        buildLocationRow(
          station.stationID,
          station.stationName,
          station.solarSystemID,
          station.position,
        ),
      );
      locationRowsById.set(
        station.orbitID,
        buildLocationRow(
          station.orbitID,
          station.orbitName || station.stationName,
          station.solarSystemID,
        ),
      );
      locationRowsById.set(
        station.solarSystemID,
        buildLocationRow(
          station.solarSystemID,
          station.solarSystemName || `System ${station.solarSystemID}`,
          station.solarSystemID,
        ),
      );
      locationRowsById.set(
        station.constellationID,
        buildLocationRow(
          station.constellationID,
          station.constellationName || `Constellation ${station.constellationID}`,
          null,
        ),
      );
      locationRowsById.set(
        station.regionID,
        buildLocationRow(
          station.regionID,
          station.regionName || `Region ${station.regionID}`,
          null,
        ),
      );
    }

    const shipNameById = new Map();
    const charNameById = new Map();
    for (const [charId, c] of Object.entries(characters)) {
      const cid = parseInt(charId, 10);
      if (Number.isInteger(cid)) {
        charNameById.set(cid, c.characterName || `Character ${cid}`);
      }
      for (const ship of getCharacterShips(cid)) {
        if (ship && Number.isInteger(ship.shipID)) {
          shipNameById.set(ship.shipID, ship.shipName || "Ship");
        }
      }
    }

    const rows = [];

    for (const id of requestedIds) {
      const numericId = Number(id) || 0;
      if (numericId <= 0) {
        continue;
      }

      if (locationRowsById.has(numericId)) {
        rows.push(locationRowsById.get(numericId));
        continue;
      } else {
        const structure = structureState.getStructureByID(numericId, {
          refresh: false,
        });
        if (structure) {
          rows.push(
            buildLocationRow(
              structure.structureID,
              structure.itemName || structure.name || `Structure ${structure.structureID}`,
              structure.solarSystemID,
              structure.position,
              `Structure ${structure.structureID}`,
            ),
          );
          continue;
        }
      }

      if (staticRowsById.has(numericId)) {
        rows.push(staticRowsById.get(numericId));
      } else if (shipNameById.has(numericId)) {
        rows.push(
          buildLocationRow(
            numericId,
            shipNameById.get(numericId),
            sessionSolarSystemID,
            null,
            `Ship ${numericId}`,
          ),
        );
      } else if (charNameById.has(numericId)) {
        rows.push(
          buildLocationRow(
            numericId,
            charNameById.get(numericId),
            sessionSolarSystemID,
            null,
            `Character ${numericId}`,
          ),
        );
      } else if (numericId >= 60000000 && numericId < 64000000) {
        rows.push(
          buildLocationRow(
            numericId,
            `Station ${numericId}`,
            sessionSolarSystemID,
            null,
            `Station ${numericId}`,
          ),
        );
      } else if (numericId >= 30000000 && numericId < 40000000) {
        rows.push(
          buildLocationRow(
            numericId,
            `System ${numericId}`,
            numericId,
            null,
            `System ${numericId}`,
          ),
        );
      } else {
        rows.push(
          buildLocationRow(
            numericId,
            `Location ${numericId}`,
            sessionSolarSystemID,
            null,
            `Location ${numericId}`,
          ),
        );
      }
    }

    if (rows.length === 0) {
      return [];
    }

    return [
      ["locationID", "locationName", "solarSystemID", "x", "y", "z", "locationNameID"],
      rows,
    ];
  }
  Handle_GetMultiAllianceShortNamesEx(args, session) {
    const rawArg = args && args.length > 0 ? args[0] : [];
    const allianceIDs = extractList(rawArg);
    log.debug(
      `[ConfigService] GetMultiAllianceShortNamesEx: ${JSON.stringify(allianceIDs)}`,
    );

    const rows = allianceIDs
      .map((allianceID) => getAllianceShortNameRecord(allianceID))
      .filter(Boolean)
      .map((record) => [record.allianceID, record.shortName]);

    if (rows.length === 0) {
      return [];
    }

    return [["allianceID", "shortName"], rows];
  }

  /**
   * GetMultiCorpTickerNamesEx — fetch corporation ticker names.
   *
   * Called by cfg.corptickernames.Prime()
   */
  Handle_GetMultiCorpTickerNamesEx(args, session) {
    const rawArg = args && args.length > 0 ? args[0] : [];
    const requestedIds = extractList(rawArg);
    log.debug(
      `[ConfigService] GetMultiCorpTickerNamesEx: ${JSON.stringify(requestedIds)}`,
    );

    const rows = [];

    for (const id of requestedIds) {
      const numericId = Number(id) || 0;
      if (numericId <= 0) {
        continue;
      }

      const staticOwner = getStaticOwnerRecord(numericId, session);
      const dynamicOwner = getOwnerLookupRecord(numericId);
      const corporationRecord = getCorporationRecord(numericId);
      const ownerRecord = dynamicOwner || staticOwner;
      rows.push([
        numericId,
        ownerRecord && ownerRecord.tickerName ? ownerRecord.tickerName : "CORP",
        corporationRecord ? corporationRecord.shape1 ?? null : null,
        corporationRecord ? corporationRecord.shape2 ?? null : null,
        corporationRecord ? corporationRecord.shape3 ?? null : null,
        corporationRecord ? corporationRecord.color1 ?? null : null,
        corporationRecord ? corporationRecord.color2 ?? null : null,
        corporationRecord ? corporationRecord.color3 ?? null : null,
      ]);
    }

    if (rows.length === 0) {
      return [];
    }

    return [
      [
        "corporationID",
        "tickerName",
        "shape1",
        "shape2",
        "shape3",
        "color1",
        "color2",
        "color3",
      ],
      rows,
    ];
  }

  Handle_GetMapObjects(args, session) {
    log.debug("[ConfigService] GetMapObjects");
    return { type: "list", items: [] };
  }

  Handle_GetStationSolarSystemsByOwner(args, session) {
    const ownerID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    log.debug(`[ConfigService] GetStationSolarSystemsByOwner(${ownerID})`);
    return buildList(
      getCorporationStationSolarSystems(ownerID).map((solarSystemRecord) =>
        buildKeyVal([
          ["ownerID", Number(solarSystemRecord && solarSystemRecord.ownerID) || ownerID],
          ["solarSystemID", Number(solarSystemRecord && solarSystemRecord.solarSystemID) || 0],
          ["stationCount", Number(solarSystemRecord && solarSystemRecord.stationCount) || 0],
        ]),
      ),
    );
  }

  Handle_GetMultiGraphicsEx(args, session) {
    log.debug("[ConfigService] GetMultiGraphicsEx");
    return [];
  }

  Handle_GetBlackListedPlanets(args, session) {
    log.debug("[ConfigService] GetBlackListedPlanets");
    return { type: "list", items: [] };
  }

  Handle_GetOldStationData(args, session) {
    log.debug("[ConfigService] GetOldStationData");
    return { type: "list", items: [] };
  }

  Handle_GetAverageMarketPrices(args, session) {
    log.debug("[ConfigService] GetAverageMarketPrices");
    return getAverageMarketPricesPayload();
  }
}

module.exports = ConfigService;
