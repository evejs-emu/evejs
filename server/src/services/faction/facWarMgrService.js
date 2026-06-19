const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function resolveCharacterID(args, session) {
  return Number(
    (Array.isArray(args) && args.length > 0 && args[0]) ||
      (session &&
        (session.characterID || session.charID || session.charid || session.userid)),
  ) || 0;
}

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0
    ? numericValue
    : fallback;
}

function normalizeRank(value, fallback = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.min(9, Math.trunc(numericValue)));
}

function resolveWarFactionID(charData = {}, session = null) {
  return normalizePositiveInteger(
    charData.warFactionID ??
      charData.warfactionid ??
      (session && (session.warFactionID || session.warfactionid)),
    null,
  );
}

function resolveCurrentRank(charData = {}, fallback = null) {
  const directCandidates = [
    charData.facWarCurrentRank,
    charData.currentRank,
    charData.factionRank,
    charData.factionWarRank,
    charData.militiaRank,
    charData.warFactionRank,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeRank(candidate, null);
    if (normalized !== null) {
      return normalized;
    }
  }

  if (charData.facWar && typeof charData.facWar === "object") {
    const nestedRank = normalizeRank(charData.facWar.currentRank, null);
    if (nestedRank !== null) {
      return nestedRank;
    }
  }

  if (charData.rankInfo && typeof charData.rankInfo === "object") {
    const nestedRank = normalizeRank(charData.rankInfo.currentRank, null);
    if (nestedRank !== null) {
      return nestedRank;
    }
  }

  return fallback;
}

function buildRankInfoPayload(characterID, factionID, currentRank) {
  return buildKeyVal([
    ["characterID", characterID || null],
    ["factionID", factionID],
    ["warFactionID", factionID],
    ["currentRank", currentRank],
  ]);
}

function normalizeRankOverviewEntry(entry, fallbackFactionID) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const factionID = normalizePositiveInteger(
    entry.factionID ?? entry.warFactionID,
    fallbackFactionID,
  );
  const currentRank = normalizeRank(entry.currentRank, null);
  if (!factionID || currentRank === null) {
    return null;
  }

  return { factionID, currentRank };
}

function buildRankOverviewPayload(characterID, charData, session) {
  const factionID = resolveWarFactionID(charData, session);
  if (!factionID) {
    return buildList([]);
  }

  const sourceCandidates = [
    charData.facWarRankOverview,
    charData.rankOverview,
    charData.characterRankOverview,
    charData.factionRankOverview,
  ];
  const overviewSource = sourceCandidates.find(Array.isArray);
  const normalizedEntries = [];

  if (overviewSource) {
    for (const entry of overviewSource) {
      const normalized = normalizeRankOverviewEntry(entry, factionID);
      if (normalized) {
        normalizedEntries.push(normalized);
      }
    }
  } else {
    const currentRank = resolveCurrentRank(charData, 0);
    if (currentRank > 0) {
      normalizedEntries.push({ factionID, currentRank });
    }
  }

  return buildList(
    normalizedEntries.map((entry) =>
      buildRankInfoPayload(characterID, entry.factionID, entry.currentRank)
    ),
  );
}

function buildSingleRankInfo(characterID, charData, session) {
  const factionID = resolveWarFactionID(charData, session);
  if (!factionID) {
    return null;
  }

  return buildRankInfoPayload(
    characterID,
    factionID,
    resolveCurrentRank(charData, 0),
  );
}

class FacWarMgrService extends BaseService {
  constructor() {
    super("facWarMgr");
  }

  Handle_GetMyCharacterRankOverview(args, session) {
    const characterID = resolveCharacterID(args, session);
    const charData = characterID ? getCharacterRecord(characterID) || {} : {};
    const result = buildRankOverviewPayload(characterID, charData, session);

    log.debug(
      `[FacWarMgr] GetMyCharacterRankOverview(charID=${characterID}) -> ${result.items.length}`,
    );

    return result;
  }

  Handle_GetCharacterRankOverview(args, session) {
    const characterID = resolveCharacterID(args, session);
    const charData = characterID ? getCharacterRecord(characterID) || {} : {};
    const result = buildRankOverviewPayload(characterID, charData, session);

    log.debug(
      `[FacWarMgr] GetCharacterRankOverview(charID=${characterID}) -> ${result.items.length}`,
    );

    return result;
  }

  Handle_GetMyCharacterRankInfo(args, session) {
    const characterID = resolveCharacterID(args, session);
    const charData = characterID ? getCharacterRecord(characterID) || {} : {};
    const result = buildSingleRankInfo(characterID, charData, session);

    log.debug(
      `[FacWarMgr] GetMyCharacterRankInfo(charID=${characterID}) -> ${result ? "rank" : "none"}`,
    );

    return result;
  }

  Handle_GetCharacterRankInfo(args, session) {
    const characterID = resolveCharacterID(args, session);
    const charData = characterID ? getCharacterRecord(characterID) || {} : {};
    const result = buildSingleRankInfo(characterID, charData, session);

    log.debug(
      `[FacWarMgr] GetCharacterRankInfo(charID=${characterID}) -> ${result ? "rank" : "none"}`,
    );

    return result;
  }
}

module.exports = FacWarMgrService;
