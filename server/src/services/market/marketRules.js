const path = require("path");

const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const standingRuntime = require(path.join(
  __dirname,
  "../character/standingRuntime",
));
const { getCharacterSkillMap } = require(path.join(
  __dirname,
  "../skills/skillState",
));
const { getStationRecord } = require(path.join(
  __dirname,
  "../_shared/stationStaticData",
));
const {
  RANGE_STATION,
  RANGE_SOLAR_SYSTEM,
  RANGE_REGION,
  getOrderJumpDistance,
  getStationSolarSystemID,
} = require(path.join(__dirname, "./marketTopology"));

const TYPE_TRADE = 3443;
const TYPE_RETAIL = 3444;
const TYPE_BROKER_RELATIONS = 3446;
const TYPE_VISIBILITY = 3447;
const TYPE_DAYTRADING = 16595;
const TYPE_WHOLESALE = 16596;
const TYPE_MARGIN_TRADING = 16597;
const TYPE_MARKETING = 16598;
const TYPE_PROCUREMENT = 16594;
const TYPE_ACCOUNTING = 16622;
const TYPE_TYCOON = 18580;

const MARKET_BROKER_COMMISSION_PERCENT = 3.0;
const MARKET_SCC_COMMISSION_PERCENT = 0.5;
const MARKET_TRANSACTION_TAX_DEFAULT_PERCENT = 8.0;
const MARKET_MINIMUM_BROKER_FEE = 100;
const MARKET_MINIMUM_SCC_SURCHARGE = 25;
const MARKET_MAX_ORDER_PRICE = 9223372036854.0;
const BROKER_RELATIONS_SKILL_MODIFIER = 0.3;
const ACCOUNTING_SKILL_MODIFIER = 0.11;
const MARKET_FACTION_STANDING_MULTIPLIER = 0.0003;
const MARKET_NPC_CORP_STANDING_MULTIPLIER = 0.0002;
const PIRATE_ALIGNMENT_ZARZAKH_MODIFIER = 0.5;
const ZARZAKH_SOLAR_SYSTEM_ID = 30100000;
const ALLOWED_DURATIONS = new Set([0, 1, 3, 7, 14, 30, 90]);
const ALLOWED_BUY_RANGES = new Set([
  RANGE_STATION,
  RANGE_SOLAR_SYSTEM,
  1,
  2,
  3,
  4,
  5,
  10,
  20,
  30,
  40,
  RANGE_REGION,
]);
const JUMPS_PER_SKILL_LEVEL = {
  0: RANGE_STATION,
  1: RANGE_SOLAR_SYSTEM,
  2: 5,
  3: 10,
  4: 20,
  5: RANGE_REGION,
};

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizePositiveInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return Math.trunc(numericValue);
  }
  return fallback;
}

function roundIsk(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(numericValue * 100) / 100;
}

function clampSkillLevel(value) {
  return Math.max(0, Math.min(5, normalizeInteger(value, 0)));
}

function getCharacterMarketSkillLevels(characterID) {
  const skillMap = getCharacterSkillMap(normalizePositiveInteger(characterID, 0));
  const getLevel = (typeID) => {
    const record = skillMap.get(typeID);
    return clampSkillLevel(record && record.effectiveSkillLevel);
  };

  return {
    trade: getLevel(TYPE_TRADE),
    retail: getLevel(TYPE_RETAIL),
    broker: getLevel(TYPE_BROKER_RELATIONS),
    visibility: getLevel(TYPE_VISIBILITY),
    daytrading: getLevel(TYPE_DAYTRADING),
    wholesale: getLevel(TYPE_WHOLESALE),
    margin: getLevel(TYPE_MARGIN_TRADING),
    marketing: getLevel(TYPE_MARKETING),
    procurement: getLevel(TYPE_PROCUREMENT),
    accounting: getLevel(TYPE_ACCOUNTING),
    tycoon: getLevel(TYPE_TYCOON),
  };
}

function getLocationDiscount(warFactionID, solarSystemID) {
  const numericSolarSystemID = normalizePositiveInteger(solarSystemID, 0);
  if (numericSolarSystemID !== ZARZAKH_SOLAR_SYSTEM_ID) {
    return 0;
  }

  const pirateFactionIDs = new Set([500018, 500019]);
  return pirateFactionIDs.has(normalizePositiveInteger(warFactionID, 0))
    ? PIRATE_ALIGNMENT_ZARZAKH_MODIFIER
    : 0;
}

function getMarketContext({ characterID, stationID, session } = {}) {
  const numericCharacterID = normalizePositiveInteger(characterID, 0);
  const numericStationID = normalizePositiveInteger(stationID, 0);
  const station = getStationRecord(session, numericStationID);
  const characterRecord = getCharacterRecord(numericCharacterID) || {};
  const isStation = getStationSolarSystemID(numericStationID) > 0;
  const skills = getCharacterMarketSkillLevels(numericCharacterID);
  const stationOwnerID = normalizePositiveInteger(station && station.ownerID, 0);
  const stationFactionID = normalizePositiveInteger(station && station.factionID, 0);
  const factionStanding = isStation
    ? standingRuntime.getCharacterRawStanding(numericCharacterID, stationFactionID)
    : 0;
  const corpStanding = isStation
    ? standingRuntime.getCharacterRawStanding(numericCharacterID, stationOwnerID)
    : 0;
  const modificationFeeDiscount = 0.5 + 0.06 * skills.margin;

  let brokerCommissionRate = MARKET_BROKER_COMMISSION_PERCENT / 100.0;
  if (isStation) {
    brokerCommissionRate -=
      (skills.broker * BROKER_RELATIONS_SKILL_MODIFIER) / 100.0;
    brokerCommissionRate -=
      factionStanding * MARKET_FACTION_STANDING_MULTIPLIER +
      corpStanding * MARKET_NPC_CORP_STANDING_MULTIPLIER;
  }

  let transactionTaxRate = MARKET_TRANSACTION_TAX_DEFAULT_PERCENT / 100.0;
  transactionTaxRate *= 1 - skills.accounting * ACCOUNTING_SKILL_MODIFIER;
  const warFactionID =
    normalizePositiveInteger(
      session && (session.warfactionid || session.warFactionID),
      0,
    ) ||
    normalizePositiveInteger(characterRecord.warFactionID, 0) ||
    normalizePositiveInteger(characterRecord.factionID, 0);
  transactionTaxRate *=
    1 -
    getLocationDiscount(
      warFactionID,
      station && station.solarSystemID,
    );

  return {
    characterID: numericCharacterID,
    stationID: numericStationID,
    station,
    isStation,
    skills,
    factionStanding,
    corpStanding,
    brokerCommissionRate,
    sccSurchargeRate: isStation ? 0 : MARKET_SCC_COMMISSION_PERCENT / 100.0,
    modificationFeeDiscount,
    limits: {
      cnt:
        5 +
        skills.trade * 4 +
        skills.retail * 8 +
        skills.wholesale * 16 +
        skills.tycoon * 32,
      acc: transactionTaxRate,
      ask: JUMPS_PER_SKILL_LEVEL[skills.marketing] ?? RANGE_STATION,
      bid: JUMPS_PER_SKILL_LEVEL[skills.procurement] ?? RANGE_STATION,
      vis: JUMPS_PER_SKILL_LEVEL[skills.visibility] ?? RANGE_STATION,
      mod: JUMPS_PER_SKILL_LEVEL[skills.daytrading] ?? RANGE_STATION,
    },
  };
}

function computeBrokerFeeInfo(context, oldAmount, newAmount) {
  const normalizedNewAmount = roundIsk(newAmount);
  if (!(normalizedNewAmount >= 0)) {
    return {
      amount: 0,
      rawPercentage: Number(context && context.brokerCommissionRate) || 0,
      usingMinimumValue: false,
    };
  }

  const brokerCommissionRate = Number(context && context.brokerCommissionRate) || 0;
  let feeAmount = 0;
  let modificationFee = 0;
  if (oldAmount === null || oldAmount === undefined) {
    feeAmount = normalizedNewAmount * brokerCommissionRate;
  } else {
    modificationFee =
      normalizedNewAmount *
      brokerCommissionRate *
      (1 - (Number(context && context.modificationFeeDiscount) || 0));
    if (normalizedNewAmount > roundIsk(oldAmount)) {
      feeAmount =
        (normalizedNewAmount - roundIsk(oldAmount)) * brokerCommissionRate;
    }
  }

  const totalAmount = roundIsk(feeAmount + modificationFee);
  const usingMinimumValue = totalAmount <= MARKET_MINIMUM_BROKER_FEE;
  return {
    amount: usingMinimumValue ? MARKET_MINIMUM_BROKER_FEE : totalAmount,
    rawPercentage: brokerCommissionRate,
    usingMinimumValue,
  };
}

function computeSccSurchargeInfo(context, oldAmount, newAmount) {
  const normalizedNewAmount = roundIsk(newAmount);
  const surchargeRate = Number(context && context.sccSurchargeRate) || 0;
  if (!(normalizedNewAmount >= 0) || !(surchargeRate > 0)) {
    return {
      amount: 0,
      rawPercentage: surchargeRate,
      usingMinimumValue: false,
    };
  }

  let surchargeAmount = 0;
  let modificationFee = 0;
  if (oldAmount === null || oldAmount === undefined) {
    surchargeAmount = normalizedNewAmount * surchargeRate;
  } else {
    modificationFee =
      normalizedNewAmount *
      surchargeRate *
      (1 - (Number(context && context.modificationFeeDiscount) || 0));
    if (normalizedNewAmount > roundIsk(oldAmount)) {
      surchargeAmount =
        (normalizedNewAmount - roundIsk(oldAmount)) * surchargeRate;
    }
  }

  const totalAmount = roundIsk(surchargeAmount + modificationFee);
  const usingMinimumValue = totalAmount <= MARKET_MINIMUM_SCC_SURCHARGE;
  return {
    amount: usingMinimumValue ? MARKET_MINIMUM_SCC_SURCHARGE : totalAmount,
    rawPercentage: surchargeRate,
    usingMinimumValue,
  };
}

function computeSalesTaxAmount(context, grossAmount) {
  const normalizedGrossAmount = roundIsk(grossAmount);
  if (!(normalizedGrossAmount > 0)) {
    return 0;
  }

  return roundIsk(normalizedGrossAmount * (Number(context && context.limits && context.limits.acc) || 0));
}

function getStationDistanceFromSession(session, stationID) {
  const currentStationID = normalizePositiveInteger(
    session && (session.stationid || session.stationID || session.locationid),
    0,
  );
  const currentSolarSystemID = normalizePositiveInteger(
    session &&
      (session.solarsystemid2 || session.solarsystemid || session.solarSystemID),
    0,
  );
  return getOrderJumpDistance({
    currentStationID,
    currentSolarSystemID,
    orderStationID: stationID,
    orderSolarSystemID: getStationSolarSystemID(stationID),
  });
}

function isAllowedDuration(durationDays) {
  return ALLOWED_DURATIONS.has(normalizeInteger(durationDays, -1));
}

function isAllowedBuyRange(rangeValue) {
  return ALLOWED_BUY_RANGES.has(normalizeInteger(rangeValue, Number.NaN));
}

module.exports = {
  RANGE_STATION,
  RANGE_SOLAR_SYSTEM,
  RANGE_REGION,
  MARKET_MINIMUM_BROKER_FEE,
  MARKET_MINIMUM_SCC_SURCHARGE,
  MARKET_MAX_ORDER_PRICE,
  MARKET_TRANSACTION_TAX_DEFAULT_PERCENT,
  getCharacterMarketSkillLevels,
  getMarketContext,
  computeBrokerFeeInfo,
  computeSccSurchargeInfo,
  computeSalesTaxAmount,
  getStationDistanceFromSession,
  isAllowedDuration,
  isAllowedBuyRange,
  normalizeInteger,
  normalizePositiveInteger,
  roundIsk,
};
