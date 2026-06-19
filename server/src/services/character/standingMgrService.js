const BaseService = require("../baseService");
const log = require("../../utils/logger");
const {
  buildFiletimeLong,
  buildKeyVal,
} = require("../_shared/serviceHelpers");
const standingRuntime = require("./standingRuntime");

// Standings use real Rowsets so the client can call both .Index() and .Filter().
// Only valid owner IDs may be present here: cfg.eveowners.Get(None) crashes the
// standings UI while building corp/faction groups.
function buildRelationshipStandingsRowset(rows = []) {
  const rowDescriptor = {
    type: "list",
    items: ["fromID", "toID", "standing"],
  };

  const rowMap = new Map();
  for (const entry of rows) {
    const normalizedEntry = normalizeStandingEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    rowMap.set(`${normalizedEntry.fromID}::${normalizedEntry.toID}`, {
      type: "list",
      items: [
        normalizedEntry.fromID,
        normalizedEntry.toID,
        normalizedEntry.standing,
      ],
    });
  }

  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", rowDescriptor],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: [...rowMap.values()] }],
      ],
    },
  };
}

function buildFromStandingRowset(rows = [], targetID) {
  const normalizedTargetID = normalizeStandingID(targetID);
  const rowDescriptor = {
    type: "list",
    items: ["fromID", "standing"],
  };

  const rowMap = new Map();
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const simplifiedFromID = normalizeStandingID(entry.fromID);
    const simplifiedStanding = Number(entry.standing);
    if (
      simplifiedFromID &&
      entry.toID == null &&
      Number.isFinite(simplifiedStanding)
    ) {
      rowMap.set(String(simplifiedFromID), {
        type: "list",
        items: [
          simplifiedFromID,
          simplifiedStanding,
        ],
      });
      continue;
    }

    const normalizedEntry = normalizeStandingEntry(entry);
    if (!normalizedEntry || normalizedEntry.toID !== normalizedTargetID) {
      continue;
    }

    rowMap.set(String(normalizedEntry.fromID), {
      type: "list",
      items: [
        normalizedEntry.fromID,
        normalizedEntry.standing,
      ],
    });
  }

  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", rowDescriptor],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: [...rowMap.values()] }],
      ],
    },
  };
}

function normalizeStandingID(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeStandingEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const fromID = normalizeStandingID(entry.fromID);
  const toID = normalizeStandingID(entry.toID);
  if (!fromID || !toID || fromID === toID) {
    return null;
  }

  const standing = Number(entry.standing);
  return {
    fromID,
    toID,
    standing: Number.isFinite(standing) ? standing : 0.0,
  };
}

function buildKeyValList(items = []) {
  return {
    type: "list",
    items,
  };
}

function buildStandingTransactionList(transactions = []) {
  return buildKeyValList(
    transactions.map((transaction) =>
      buildKeyVal([
        ["eventTypeID", Number(transaction && transaction.eventTypeID) || 0],
        ["eventDateTime", buildFiletimeLong(transaction && transaction.eventDateTime)],
        ["modification", Number(transaction && transaction.modification) || 0],
        ["fromID", Number(transaction && transaction.fromID) || 0],
        ["toID", Number(transaction && transaction.toID) || 0],
        ["msg", String((transaction && transaction.msg) || "")],
        ["int_1", transaction && transaction.int_1 != null ? Number(transaction.int_1) || 0 : null],
        ["int_2", transaction && transaction.int_2 != null ? Number(transaction.int_2) || 0 : null],
        ["int_3", transaction && transaction.int_3 != null ? Number(transaction.int_3) || 0 : null],
      ]),
    ),
  );
}

function buildStandingCompositionList(rows = []) {
  return buildKeyValList(
    rows.map((row) =>
      buildKeyVal([
        ["ownerID", Number(row && row.ownerID) || 0],
        ["standing", Number(row && row.standing) || 0],
      ]),
    ),
  );
}

class StandingMgrService extends BaseService {
  constructor(name = "standingMgr") {
    super(name);
  }

  Handle_GetNPCNPCStandings(args, session) {
    log.debug("[StandingMgr] GetNPCNPCStandings called");
    return buildRelationshipStandingsRowset(standingRuntime.listNpcStandings());
  }

  Handle_GetCharStandings(args, session) {
    log.debug("[StandingMgr] GetCharStandings called");
    return buildFromStandingRowset(
      standingRuntime.listCharacterStandings(session && (session.characterID || session.charid)),
      session && (session.characterID || session.charid),
    );
  }

  Handle_GetCorpStandings(args, session) {
    log.debug("[StandingMgr] GetCorpStandings called");
    return buildFromStandingRowset(
      standingRuntime.listCorporationStandings(session && (session.corporationID || session.corpid)),
      session && (session.corporationID || session.corpid),
    );
  }

  Handle_GetStandingTransactions(args) {
    const fromID = args && args.length > 0 ? args[0] : 0;
    const toID = args && args.length > 1 ? args[1] : 0;
    log.debug(`[StandingMgr] GetStandingTransactions(${fromID}, ${toID})`);
    return buildStandingTransactionList(
      standingRuntime.getStandingTransactions(fromID, toID),
    );
  }

  Handle_GetStandingCompositions(args) {
    const fromID = args && args.length > 0 ? args[0] : 0;
    const toID = args && args.length > 1 ? args[1] : 0;
    log.debug(`[StandingMgr] GetStandingCompositions(${fromID}, ${toID})`);
    return buildStandingCompositionList(
      standingRuntime.getStandingCompositions(fromID, toID),
    );
  }
}

class Standing2Service extends StandingMgrService {
  constructor() {
    super("standing2");
  }
}

module.exports = {
  StandingMgrService,
  Standing2Service,
};
