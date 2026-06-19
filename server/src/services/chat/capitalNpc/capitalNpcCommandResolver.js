const path = require("path");

const spaceRuntime = require(path.join(__dirname, "../../../space/runtime"));
const {
  resolveCapitalNpcCommandQuery,
  getCapitalNpcProfileRow,
  getCapitalNpcSpawnPoolRow,
  getCapitalNpcAuthorityEntry,
} = require(path.join(__dirname, "../../../space/npc/capitals/capitalNpcCatalog"));

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function resolveSessionSystemID(session) {
  return toPositiveInt(
    session &&
    session._space &&
    session._space.systemID,
    toPositiveInt(session && session.solarsystemid2, toPositiveInt(session && session.solarsystemid, 0)),
  );
}

function resolveSessionShipID(session) {
  return toPositiveInt(
    session &&
    session._space &&
    session._space.shipID,
    toPositiveInt(session && session.shipItem && session.shipItem.itemID, 0),
  );
}

function resolveSessionShipEntity(session) {
  const scene = spaceRuntime.getSceneForSession(session);
  const shipID = resolveSessionShipID(session);
  return scene && shipID > 0 ? scene.getEntityByID(shipID) || null : null;
}

function buildSelectionLabel(selection) {
  if (!selection) {
    return "Capital NPCs";
  }
  if (selection.row && selection.row.name) {
    return selection.row.name;
  }
  return selection.id || "Capital NPCs";
}

function resolveCapitalSelection(query = "") {
  const resolution = resolveCapitalNpcCommandQuery(query);
  if (!resolution.success) {
    return resolution;
  }

  const normalized = resolution.data || {
    kind: "pool",
    id: "capital_npc_all",
  };
  if (normalized.kind === "profile") {
    const row = getCapitalNpcProfileRow(normalized.id);
    const authorityEntry = getCapitalNpcAuthorityEntry(normalized.id);
    return {
      success: Boolean(row && authorityEntry),
      errorMsg: row && authorityEntry ? null : "PROFILE_NOT_FOUND",
      suggestions: [],
      data: {
        kind: "profile",
        id: normalized.id,
        row,
        authorityEntry,
        profileIDs: row ? [row.profileID] : [],
        label: buildSelectionLabel({ kind: "profile", id: normalized.id, row }),
      },
    };
  }

  const row = getCapitalNpcSpawnPoolRow(normalized.id);
  const profileIDs = Array.isArray(row && row.entries)
    ? row.entries
      .map((entry) => String(entry && entry.profileID || "").trim())
      .filter(Boolean)
    : [];
  return {
    success: Boolean(row),
    errorMsg: row ? null : "PROFILE_NOT_FOUND",
    suggestions: [],
    data: {
      kind: "pool",
      id: normalized.id,
      row,
      authorityEntry: null,
      profileIDs,
      label: buildSelectionLabel({ kind: "pool", id: normalized.id, row }),
    },
  };
}

function getSystemCapitalSummaries(npcService, session, query = "") {
  const systemID = resolveSessionSystemID(session);
  const selection = resolveCapitalSelection(query);
  if (!selection.success) {
    return {
      success: false,
      errorMsg: selection.errorMsg,
      suggestions: selection.suggestions || [],
    };
  }

  const allowedProfileIDs = new Set(selection.data.profileIDs);
  const summaries = npcService.getNpcOperatorSummary().filter((summary) => (
    summary &&
    summary.capitalNpc === true &&
    Number(summary.systemID) === systemID &&
    (allowedProfileIDs.size <= 0 || allowedProfileIDs.has(String(summary.profileID || "").trim()))
  ));

  return {
    success: true,
    data: {
      systemID,
      scene: spaceRuntime.ensureScene(systemID),
      selection: selection.data,
      summaries,
    },
  };
}

function resolveTargetEntity(session, rawTargetToken) {
  const normalized = String(rawTargetToken || "").trim().toLowerCase();
  const scene = spaceRuntime.getSceneForSession(session);
  if (!scene) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }
  if (!normalized || normalized === "me" || normalized === "self" || normalized === "ship") {
    const shipEntity = resolveSessionShipEntity(session);
    return shipEntity
      ? { success: true, data: shipEntity }
      : { success: false, errorMsg: "SHIP_NOT_FOUND" };
  }

  const entityID = toPositiveInt(normalized, 0);
  if (entityID <= 0) {
    return {
      success: false,
      errorMsg: "TARGET_NOT_FOUND",
    };
  }
  const entity = scene.getEntityByID(entityID) || null;
  return entity
    ? { success: true, data: entity }
    : { success: false, errorMsg: "TARGET_NOT_FOUND" };
}

module.exports = {
  resolveCapitalSelection,
  resolveSessionSystemID,
  resolveSessionShipEntity,
  getSystemCapitalSummaries,
  resolveTargetEntity,
};
