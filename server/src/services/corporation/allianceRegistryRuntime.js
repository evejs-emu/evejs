const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));
const {
  buildBoundObjectResponse,
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildPackedRow,
  buildRow,
  buildRowset,
  currentFileTime,
  extractDictEntries,
  extractList,
  normalizeNumber,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getAllianceCorporationIDs,
  getAllianceOwnerRecord,
  getAllianceRecord,
  getCharacterIDsInCorporation,
  getCorporationRecord,
  getOwnerLookupRecord,
} = require(path.join(__dirname, "./corporationState"));
const {
  createAllianceWithRuntime,
  ensureRuntimeInitialized,
  getAllianceRuntime,
  normalizeFiletimeString,
  normalizeInteger,
  normalizePositiveInteger,
  normalizeText,
  setCorporationAlliance,
  updateAllianceRecord,
  updateCorporationRuntime,
  updateAllianceRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));
const {
  createWarRecord,
} = require(path.join(__dirname, "./warRuntimeState"));
const {
  getCorporationWalletBalance,
} = require(path.join(__dirname, "./corpWalletState"));
const {
  buildAllianceApplicationsIndexRowset,
  buildAllianceMembersRowset,
  buildAllianceMembersIndexRowset,
  getAllianceMembersOlderThan,
  getDaysInAlliance,
  recordAllianceMemberJoin,
  removeAllianceCorporationState,
  setAllianceExecutorSupportChoice,
} = require(path.join(__dirname, "./allianceViewState"));
const {
  BILL_TYPE_WAR,
  createBill,
  listBillsForCreditor,
  listBillsForDebtor,
  payBillFromCorporation,
} = require(path.join(__dirname, "../account/billRuntimeState"));
const {
  getWarPermitStatusForOwner,
} = require(path.join(__dirname, "./warPermitState"));
const {
  addLabelMask,
  allocateNextLabelID,
  removeLabelMask,
} = require(path.join(__dirname, "./contactLabelState"));
const {
  cancelAllianceCapitalTransition: cancelSovereigntyCapitalTransition,
  getAllianceCapitalInfo: getSovereigntyAllianceCapitalInfo,
  getAlliancePrimeInfo: getSovereigntyAlliancePrimeInfo,
  getAllianceSovereigntyRows,
  setAllianceCapitalSystem: setSovereigntyAllianceCapitalSystem,
  setAlliancePrimeHour: setSovereigntyAlliancePrimeHour,
} = require(path.join(__dirname, "../sovereignty/sovState"));
const {
  buildAllianceCapitalInfoPayload,
  buildAlliancePrimeInfoPayload,
  buildAllianceSovereigntyRowsPayload,
} = require(path.join(__dirname, "../sovereignty/sovPayloads"));
const {
  buildAllianceApplicationSnapshot,
  buildAllianceMemberSnapshot,
  buildAllianceRelationshipSnapshot,
  buildCorporationSnapshot,
  notifyAllianceApplicationChanged,
  notifyAllianceChanged,
  notifyAllianceMemberChanged,
  notifyAllianceRelationshipChanged,
  notifyCorporationChanged,
} = require(path.join(__dirname, "./corporationNotifications"));

const ALLIANCE_ROW_HEADER = [
  "allianceID",
  "allianceName",
  "shortName",
  "executorCorpID",
  "creatorCorpID",
  "creatorCharID",
  "warFactionID",
  "description",
  "url",
  "startDate",
  "memberCount",
  "dictatorial",
  "allowWar",
  "currentCapital",
  "currentPrimeHour",
  "newPrimeHour",
  "newPrimeHourValidAfter",
  "deleted",
];
const OWNER_HEADER = [
  "ownerID",
  "ownerName",
  "typeID",
  "gender",
  "ownerNameID",
];
const BULLETIN_DBROW_COLUMNS = [
  ["bulletinID", 0x03],
  ["ownerID", 0x03],
  ["createDateTime", 0x40],
  ["editDateTime", 0x40],
  ["editCharacterID", 0x03],
  ["title", 0x82],
  ["body", 0x82],
  ["sortOrder", 0x03],
];
const CONCORD_CORPORATION_ID = 1000125;
const WAR_BILL_AMOUNT = 100000000;

function resolveAllianceIDFromArgs(args, session) {
  const firstArg = args && args.length > 0 ? args[0] : null;
  const firstList = extractList(firstArg);
  if (firstList.length > 0) {
    return normalizePositiveInteger(firstList[0], null);
  }
  const explicitAllianceID = normalizePositiveInteger(firstArg, null);
  if (explicitAllianceID) {
    return explicitAllianceID;
  }
  return normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    null,
  );
}

function resolveAllianceIDFromSession(session) {
  return normalizePositiveInteger(
    session && (session.allianceID || session.allianceid),
    null,
  );
}

function buildAllianceSummary(allianceRecord) {
  const resolvedAllianceRecord =
    allianceRecord && typeof allianceRecord === "object"
      ? allianceRecord
      : getAllianceRecord(normalizePositiveInteger(allianceRecord, null));
  if (!resolvedAllianceRecord) {
    return null;
  }
  const sovPrimeInfo = getSovereigntyAlliancePrimeInfo(resolvedAllianceRecord.allianceID);
  const sovCapitalInfo = getSovereigntyAllianceCapitalInfo(
    resolvedAllianceRecord.allianceID,
  );
  const executorCorporationID = normalizePositiveInteger(
    resolvedAllianceRecord.executorCorporationID,
    null,
  );
  const executorCorporation = executorCorporationID
    ? getCorporationRecord(executorCorporationID)
    : null;
  const hasExplicitAllowWar =
    Object.prototype.hasOwnProperty.call(resolvedAllianceRecord, "allowWar") &&
    resolvedAllianceRecord.allowWar !== undefined &&
    resolvedAllianceRecord.allowWar !== null;
  return {
    allianceID: resolvedAllianceRecord.allianceID,
    allianceName:
      resolvedAllianceRecord.allianceName ||
      `Alliance ${resolvedAllianceRecord.allianceID}`,
    shortName: resolvedAllianceRecord.shortName || "ALLY",
    executorCorpID: executorCorporationID,
    creatorCorpID: normalizePositiveInteger(
      resolvedAllianceRecord.creatorCorpID || resolvedAllianceRecord.executorCorporationID,
      null,
    ),
    creatorCharID: normalizePositiveInteger(
      resolvedAllianceRecord.creatorCharID || resolvedAllianceRecord.creatorID,
      null,
    ),
    warFactionID: normalizePositiveInteger(
      resolvedAllianceRecord.warFactionID,
      normalizePositiveInteger(executorCorporation && executorCorporation.factionID, null),
    ),
    description: resolvedAllianceRecord.description || "",
    url:
      typeof resolvedAllianceRecord.url === "string" &&
      resolvedAllianceRecord.url.trim() === ""
        ? null
        : resolvedAllianceRecord.url || null,
    startDate: buildFiletimeLong(resolvedAllianceRecord.createdAt || 0n),
    memberCount: getAllianceCorporationIDs(resolvedAllianceRecord.allianceID).reduce(
      (count, corporationID) => count + getCharacterIDsInCorporation(corporationID).length,
      0,
    ),
    dictatorial: resolvedAllianceRecord.dictatorial ? 1 : 0,
    allowWar: hasExplicitAllowWar
      ? resolvedAllianceRecord.allowWar
        ? 1
        : 0
      : getWarPermitStatusForOwner(resolvedAllianceRecord.allianceID),
    currentCapital: sovCapitalInfo.currentCapitalSystem || null,
    currentPrimeHour: sovPrimeInfo.currentPrimeHour || 0,
    newPrimeHour: sovPrimeInfo.newPrimeHour || 0,
    newPrimeHourValidAfter: buildFiletimeLong(sovPrimeInfo.newPrimeHourValidAfter || "0"),
    deleted: resolvedAllianceRecord.deleted ? 1 : 0,
  };
}

function buildAllianceRowPayload(allianceRecord) {
  const summary = buildAllianceSummary(allianceRecord);
  return buildRow(ALLIANCE_ROW_HEADER, [
    summary.allianceID,
    summary.allianceName,
    summary.shortName,
    summary.executorCorpID,
    summary.creatorCorpID,
    summary.creatorCharID,
    summary.warFactionID,
    summary.description,
    summary.url,
    summary.startDate,
    summary.memberCount,
    summary.dictatorial,
    summary.allowWar,
    summary.currentCapital,
    summary.currentPrimeHour,
    summary.newPrimeHour,
    summary.newPrimeHourValidAfter,
    summary.deleted,
  ]);
}

function buildAllianceKeyValPayload(allianceRecord) {
  const summary = buildAllianceSummary(allianceRecord);
  const sovCapitalInfo = getSovereigntyAllianceCapitalInfo(allianceRecord.allianceID);
  return buildKeyVal(
    ALLIANCE_ROW_HEADER.map((fieldName) => [fieldName, summary[fieldName]]).concat([
      ["__header__", ALLIANCE_ROW_HEADER],
      ["currentCapitalSystem", summary.currentCapital],
      [
        "newCapitalSystem",
        sovCapitalInfo.newCapitalSystem || null,
      ],
      [
        "newCapitalSystemValidAfter",
        buildFiletimeLong(sovCapitalInfo.newCapitalSystemValidAfter || "0"),
      ],
    ]),
  );
}

function buildBulletinRow(bulletin) {
  return buildPackedRow(BULLETIN_DBROW_COLUMNS, {
    bulletinID: Number(bulletin.bulletinID || 0),
    ownerID: Number(bulletin.ownerID || 0),
    createDateTime: bulletin.createDateTime || "0",
    editDateTime: bulletin.editDateTime || "0",
    editCharacterID: Number(bulletin.editCharacterID || 0),
    title: bulletin.title || "",
    body: bulletin.body || "",
    sortOrder: Number(bulletin.sortOrder || 0),
  });
}

function getOwnerRecord(ownerID) {
  const character = getCharacterRecord(ownerID);
  if (character) {
    return {
      ownerID: Number(ownerID),
      ownerName: character.characterName || `Character ${ownerID}`,
      typeID: Number(character.typeID || 1373),
      gender: Number(character.gender || 0),
    };
  }
  return getAllianceOwnerRecord(ownerID) || getOwnerLookupRecord(ownerID);
}

function buildBillPayload(bill) {
  return buildKeyVal([
    ["billID", Number(bill && bill.billID ? bill.billID : 0)],
    ["billTypeID", Number(bill && bill.billTypeID ? bill.billTypeID : 0)],
    ["amount", Number(bill && bill.amount ? bill.amount : 0)],
    ["interest", Number(bill && bill.interest ? bill.interest : 0)],
    ["debtorID", Number(bill && bill.debtorID ? bill.debtorID : 0)],
    ["creditorID", Number(bill && bill.creditorID ? bill.creditorID : 0)],
    [
      "dueDateTime",
      buildFiletimeLong(bill && bill.dueDateTime ? bill.dueDateTime : "0"),
    ],
    ["paid", bill && bill.paid ? 1 : 0],
    [
      "paidDateTime",
      bill && bill.paidDateTime ? buildFiletimeLong(bill.paidDateTime) : null,
    ],
    ["paidByOwnerID", Number(bill && bill.paidByOwnerID ? bill.paidByOwnerID : 0)],
    [
      "externalID",
      bill && bill.externalID !== undefined && bill.externalID !== null
        ? Number(bill.externalID)
        : -1,
    ],
    [
      "externalID2",
      bill && bill.externalID2 !== undefined && bill.externalID2 !== null
        ? Number(bill.externalID2)
        : -1,
    ],
  ]);
}

function extractKwargValue(kwargs, key) {
  for (const [entryKey, entryValue] of extractDictEntries(kwargs)) {
    if (entryKey === key) {
      return entryValue;
    }
  }
  return undefined;
}

class AllianceRegistryRuntimeService extends BaseService {
  constructor() {
    super("allianceRegistry");
  }

  Handle_IsAllianceLocal(args, session) {
    return getAllianceRecord(resolveAllianceIDFromArgs(args, session)) ? 1 : 0;
  }

  Handle_MachoResolveObject(args, session) {
    return getAllianceRecord(resolveAllianceIDFromArgs(args, session))
      ? resolveBoundNodeId()
      : null;
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    return getAllianceRecord(allianceID)
      ? buildBoundObjectResponse(this, args, session, kwargs)
      : null;
  }

  Handle_GetAlliance(args, session) {
    const alliance = getAllianceRecord(resolveAllianceIDFromArgs(args, session));
    return alliance ? buildAllianceKeyValPayload(alliance) : null;
  }

  Handle_GetAlliancePublicInfo(args, session) {
    const alliance = getAllianceRecord(resolveAllianceIDFromArgs(args, session));
    return alliance ? buildAllianceKeyValPayload(alliance) : null;
  }

  Handle_GetRankedAlliances(args) {
    const maxLen = Math.max(0, normalizeNumber(args && args[0], 100));
    const runtimeTable = ensureRuntimeInitialized();
    const items = Object.keys(runtimeTable.alliances || {})
      .map((allianceID) => getAllianceRecord(allianceID))
      .filter(Boolean)
      .slice(0, maxLen || undefined)
      .map((alliance) => buildAllianceRowPayload(alliance));
    return buildList(items);
  }

  Handle_GetAllianceMembers(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    return buildAllianceMembersRowset(allianceID);
  }

  Handle_GetMembers(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    return buildAllianceMembersIndexRowset(allianceID);
  }

  Handle_GetEmploymentRecord(args, session) {
    const alliance = getAllianceRecord(resolveAllianceIDFromArgs(args, session));
    return buildRowset(
      ["allianceID", "startDate", "deleted"],
      alliance
        ? [buildList([alliance.allianceID, buildFiletimeLong(alliance.createdAt), 0])]
        : [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_UpdateAlliance(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const previousAlliance = buildAllianceSummary(allianceID);
    updateAllianceRecord(allianceID, {
      description: normalizeText(args && args[0], ""),
      url: normalizeText(args && args[1], ""),
    });
    notifyAllianceChanged(allianceID, previousAlliance);
    return null;
  }

  Handle_GetApplications(args, session) {
    return buildAllianceApplicationsIndexRowset(resolveAllianceIDFromSession(session));
  }

  Handle_UpdateApplication(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const corporationID = normalizePositiveInteger(args && args[0], null);
    const applicationText = normalizeText(args && args[1], "");
    const state = normalizeInteger(args && args[2], 0);
    const previousApplication = buildAllianceApplicationSnapshot(
      allianceID,
      corporationID,
    );
    const previousAllianceMember = buildAllianceMemberSnapshot(
      allianceID,
      corporationID,
    );
    const previousAlliance = buildAllianceSummary(allianceID);
    const previousCorporation = buildCorporationSnapshot(corporationID);
    let applicationFound = false;
    updateAllianceRuntime(allianceID, (runtime) => {
      if (!runtime.applications[String(corporationID)]) {
        return runtime;
      }
      applicationFound = true;
      runtime.applications[String(corporationID)].applicationText = applicationText;
      runtime.applications[String(corporationID)].state = state;
      return runtime;
    });
    updateCorporationRuntime(corporationID, (runtime) => {
      if (!runtime.allianceApplications[String(allianceID)]) {
        return runtime;
      }
      runtime.allianceApplications[String(allianceID)].applicationText = applicationText;
      runtime.allianceApplications[String(allianceID)].state = state;
      return runtime;
    });
    if (state === 2) {
      setCorporationAlliance(corporationID, allianceID);
      recordAllianceMemberJoin(allianceID, corporationID);
    }
    if (state >= 2) {
      updateAllianceRuntime(allianceID, (runtime) => {
        delete runtime.applications[String(corporationID)];
        return runtime;
      });
    }
    if (applicationFound || previousApplication) {
      notifyAllianceApplicationChanged(allianceID, corporationID, previousApplication);
    }
    if (applicationFound && state === 2) {
      notifyAllianceMemberChanged(allianceID, corporationID, previousAllianceMember);
      notifyAllianceChanged(allianceID, previousAlliance);
      notifyCorporationChanged(corporationID, previousCorporation);
    }
    return null;
  }

  Handle_GMForceAcceptApplication(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const corporationID = normalizePositiveInteger(args && args[0], null);
    const runtime = getAllianceRuntime(allianceID) || {};
    const application =
      runtime.applications && runtime.applications[String(corporationID)]
        ? runtime.applications[String(corporationID)]
        : null;
    return this.Handle_UpdateApplication(
      [
        corporationID,
        application && application.applicationText ? application.applicationText : "",
        2,
      ],
      session,
    );
  }

  Handle_DeclareExecutorSupport(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const chosenExecutorCorporationID = normalizePositiveInteger(args && args[0], null);
    const supporterCorporationID = normalizePositiveInteger(
      session && (session.corporationID || session.corpid),
      null,
    );
    const previousMember = buildAllianceMemberSnapshot(
      allianceID,
      supporterCorporationID,
    );
    setAllianceExecutorSupportChoice(
      allianceID,
      supporterCorporationID,
      chosenExecutorCorporationID,
    );
    notifyAllianceMemberChanged(allianceID, supporterCorporationID, previousMember);
    return null;
  }

  Handle_DeleteMember(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const corporationID = normalizePositiveInteger(args && args[0], null);
    const previousMember = buildAllianceMemberSnapshot(allianceID, corporationID);
    const previousAlliance = buildAllianceSummary(allianceID);
    const previousCorporation = buildCorporationSnapshot(corporationID);
    setCorporationAlliance(corporationID, null);
    removeAllianceCorporationState(allianceID, corporationID);
    notifyAllianceMemberChanged(allianceID, corporationID, previousMember);
    notifyAllianceChanged(allianceID, previousAlliance);
    notifyCorporationChanged(corporationID, previousCorporation);
    return null;
  }

  Handle_GetAllianceContacts(args, session) {
    const runtime = getAllianceRuntime(resolveAllianceIDFromSession(session)) || {};
    return buildDict(
      Object.entries(runtime.contacts || {}).map(([contactID, contact]) => [
        Number(contactID),
        buildKeyVal([
          ["contactID", Number(contactID)],
          ["relationshipID", Number(contact.relationshipID || 0)],
          ["labelMask", Number(contact.labelMask || 0)],
        ]),
      ]),
    );
  }

  Handle_GetContactList(args, session) {
    return this.Handle_GetAllianceContacts(args, session);
  }

  Handle_AddAllianceContact(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const contactID = normalizePositiveInteger(args && args[0], null);
    const relationshipID = normalizeInteger(args && args[1], 0);
    updateAllianceRuntime(allianceID, (runtime) => {
      runtime.contacts[String(contactID)] = {
        relationshipID,
        labelMask: 0,
      };
      return runtime;
    });
    return null;
  }

  Handle_EditAllianceContact(args, session) {
    return this.Handle_AddAllianceContact(args, session);
  }

  Handle_RemoveAllianceContacts(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const contactIDs = extractList(args && args[0]);
    updateAllianceRuntime(allianceID, (runtime) => {
      for (const contactID of contactIDs) {
        delete runtime.contacts[String(contactID)];
      }
      return runtime;
    });
    return null;
  }

  Handle_EditContactsRelationshipID(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const contactIDs = extractList(args && args[0]);
    const relationshipID = normalizeInteger(args && args[1], 0);
    updateAllianceRuntime(allianceID, (runtime) => {
      for (const contactID of contactIDs) {
        runtime.contacts[String(contactID)] = {
          ...(runtime.contacts[String(contactID)] || {}),
          relationshipID,
        };
      }
      return runtime;
    });
    return null;
  }

  Handle_GetLabels(args, session) {
    const runtime = getAllianceRuntime(resolveAllianceIDFromSession(session)) || {};
    return buildDict(
      Object.entries(runtime.labels || {}).map(([labelID, label]) => [
        Number(labelID),
        buildKeyVal([
          ["labelID", Number(labelID)],
          ["name", label.name || ""],
          ["color", Number(label.color || 0)],
        ]),
      ]),
    );
  }

  Handle_CreateLabel(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const name = normalizeText(args && args[0], "");
    const color = normalizeInteger(args && args[1], 0);
    let labelID = null;
    updateAllianceRuntime(allianceID, (runtime, allianceRecord, table) => {
      const allocation = allocateNextLabelID(
        runtime.labels || {},
        table._meta.nextLabelID,
      );
      labelID = allocation.labelID;
      table._meta.nextLabelID = allocation.nextLabelID;
      runtime.labels[String(labelID)] = { name, color };
      return runtime;
    });
    return labelID;
  }

  Handle_DeleteLabel(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const labelID = normalizePositiveInteger(args && args[0], null);
    updateAllianceRuntime(allianceID, (runtime) => {
      delete runtime.labels[String(labelID)];
      for (const contact of Object.values(runtime.contacts || {})) {
        contact.labelMask = removeLabelMask(contact.labelMask, labelID);
      }
      return runtime;
    });
    return null;
  }

  Handle_EditLabel(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const labelID = normalizePositiveInteger(args && args[0], null);
    updateAllianceRuntime(allianceID, (runtime) => {
      runtime.labels[String(labelID)] = {
        ...(runtime.labels[String(labelID)] || {}),
        name: args && args[1] !== undefined ? normalizeText(args[1], "") : (runtime.labels[String(labelID)] || {}).name || "",
        color: args && args[2] !== undefined ? normalizeInteger(args[2], 0) : Number((runtime.labels[String(labelID)] || {}).color || 0),
      };
      return runtime;
    });
    return null;
  }

  Handle_AssignLabels(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const contactIDs = extractList(args && args[0]);
    const labelMask = normalizeInteger(args && args[1], 0);
    updateAllianceRuntime(allianceID, (runtime) => {
      for (const contactID of contactIDs) {
        runtime.contacts[String(contactID)] = {
          ...(runtime.contacts[String(contactID)] || {}),
          relationshipID: Number((runtime.contacts[String(contactID)] || {}).relationshipID || 0),
          labelMask: addLabelMask(
            (runtime.contacts[String(contactID)] || {}).labelMask,
            labelMask,
          ),
        };
      }
      return runtime;
    });
    return null;
  }

  Handle_RemoveLabels(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const contactIDs = extractList(args && args[0]);
    const labelMask = normalizeInteger(args && args[1], 0);
    updateAllianceRuntime(allianceID, (runtime) => {
      for (const contactID of contactIDs) {
        if (runtime.contacts[String(contactID)]) {
          runtime.contacts[String(contactID)].labelMask = removeLabelMask(
            runtime.contacts[String(contactID)].labelMask,
            labelMask,
          );
        }
      }
      return runtime;
    });
    return null;
  }

  Handle_GetBulletins(args, session) {
    const runtime = getAllianceRuntime(resolveAllianceIDFromSession(session)) || {};
    return buildList(
      (runtime.bulletins || [])
        .slice()
        .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
        .map((bulletin) => buildBulletinRow(bulletin)),
    );
  }

  Handle_GetBulletinEntries(args, session) {
    return this.Handle_GetBulletins(args, session);
  }

  Handle_GetBulletin(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const bulletinID = normalizePositiveInteger(args && args[0], null);
    const runtime = getAllianceRuntime(allianceID) || {};
    const bulletin = (runtime.bulletins || []).find(
      (entry) => Number(entry.bulletinID) === Number(bulletinID),
    );
    if (!bulletin) {
      return null;
    }
    return buildBulletinRow(bulletin);
  }

  Handle_AddBulletin(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const title = normalizeText(args && args[0], "");
    const body = normalizeText(args && args[1], "");
    let bulletinID = normalizePositiveInteger(args && args[2], null);
    updateAllianceRuntime(allianceID, (runtime, allianceRecord, table) => {
      if (!bulletinID) {
        bulletinID = table._meta.nextBulletinID++;
      }
      const index = (runtime.bulletins || []).findIndex(
        (entry) => Number(entry.bulletinID) === Number(bulletinID),
      );
      const record = {
        bulletinID,
        ownerID: allianceID,
        createDateTime:
          index >= 0 ? runtime.bulletins[index].createDateTime : String(currentFileTime()),
        editDateTime: args && args[3] ? String(args[3]) : String(currentFileTime()),
        editCharacterID: session && (session.characterID || session.charid),
        title,
        body,
        sortOrder: index >= 0 ? runtime.bulletins[index].sortOrder || 0 : runtime.bulletins.length,
      };
      if (index >= 0) {
        runtime.bulletins[index] = record;
      } else {
        runtime.bulletins.push(record);
      }
      return runtime;
    });
    return bulletinID;
  }

  Handle_UpdateBulletin(args, session) {
    return this.Handle_AddBulletin(
      [
        args && args[1],
        args && args[2],
        args && args[0],
        args && args.length > 3 ? args[3] : null,
      ],
      session,
    );
  }

  Handle_DeleteBulletin(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const bulletinID = normalizePositiveInteger(args && args[0], null);
    updateAllianceRuntime(allianceID, (runtime) => {
      runtime.bulletins = (runtime.bulletins || []).filter(
        (bulletin) => Number(bulletin.bulletinID) !== Number(bulletinID),
      );
      return runtime;
    });
    return null;
  }

  Handle_UpdateBulletinOrder(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const newOrder = extractList(args && args[0]);
    updateAllianceRuntime(allianceID, (runtime) => {
      const orderMap = new Map(newOrder.map((bulletinID, index) => [Number(bulletinID), index]));
      for (const bulletin of runtime.bulletins || []) {
        if (orderMap.has(Number(bulletin.bulletinID))) {
          bulletin.sortOrder = orderMap.get(Number(bulletin.bulletinID));
        }
      }
      runtime.bulletins.sort(
        (left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0),
      );
      return runtime;
    });
    return null;
  }

  Handle_GetRelationships(args, session) {
    const runtime = getAllianceRuntime(resolveAllianceIDFromSession(session)) || {};
    return buildDict(
      Object.entries(runtime.relationships || {}).map(([ownerID, relationship]) => [
        Number(ownerID),
        relationship,
      ]),
    );
  }

  Handle_SetRelationship(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const relationship = normalizeInteger(args && args[0], 0);
    const toID = normalizePositiveInteger(args && args[1], null);
    const previousRelationship = buildAllianceRelationshipSnapshot(allianceID, toID);
    updateAllianceRuntime(allianceID, (runtime) => {
      runtime.relationships[String(toID)] = relationship;
      return runtime;
    });
    notifyAllianceRelationshipChanged(allianceID, toID, previousRelationship);
    return null;
  }

  Handle_DeleteRelationship(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const toID = normalizePositiveInteger(args && args[0], null);
    const previousRelationship = buildAllianceRelationshipSnapshot(allianceID, toID);
    updateAllianceRuntime(allianceID, (runtime) => {
      delete runtime.relationships[String(toID)];
      return runtime;
    });
    notifyAllianceRelationshipChanged(allianceID, toID, previousRelationship);
    return null;
  }

  Handle_GetPrimeTimeInfo(args, session) {
    return buildAlliancePrimeInfoPayload(
      getSovereigntyAlliancePrimeInfo(resolveAllianceIDFromSession(session)),
    );
  }

  Handle_SetPrimeHour(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const hour = normalizeInteger(args && args[0], 0);
    const previousAlliance = buildAllianceSummary(allianceID);
    setSovereigntyAlliancePrimeHour(allianceID, hour);
    notifyAllianceChanged(allianceID, previousAlliance);
    return null;
  }

  Handle_GetCapitalSystemInfo(args, session) {
    return buildAllianceCapitalInfoPayload(
      getSovereigntyAllianceCapitalInfo(resolveAllianceIDFromSession(session)),
    );
  }

  Handle_GetAllianceSovereigntyStructuresInfo(args, session) {
    return buildAllianceSovereigntyRowsPayload(
      getAllianceSovereigntyRows(resolveAllianceIDFromSession(session)),
    );
  }

  Handle_SetCapitalSystem(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const solarSystemID = normalizePositiveInteger(args && args[0], null);
    const previousAlliance = buildAllianceSummary(allianceID);
    setSovereigntyAllianceCapitalSystem(allianceID, solarSystemID);
    notifyAllianceChanged(allianceID, previousAlliance);
    return null;
  }

  Handle_CancelCapitalSystemTransition(args, session) {
    const allianceID = resolveAllianceIDFromSession(session);
    const previousAlliance = buildAllianceSummary(allianceID);
    cancelSovereigntyCapitalTransition(allianceID);
    notifyAllianceChanged(allianceID, previousAlliance);
    return null;
  }

  Handle_GetBills(args, session) {
    return buildList(
      listBillsForDebtor(resolveAllianceIDFromSession(session)).map((bill) =>
        buildBillPayload(bill),
      ),
    );
  }

  Handle_GetBillsReceivable(args, session) {
    return buildList(
      listBillsForCreditor(resolveAllianceIDFromSession(session)).map((bill) =>
        buildBillPayload(bill),
      ),
    );
  }

  Handle_GetBillBalance(args, session) {
    const corporationID = normalizePositiveInteger(
      session && (session.corporationID || session.corpid),
      null,
    );
    const accountKey = normalizePositiveInteger(
      session && (session.corpAccountKey || session.corpaccountkey),
      1000,
    );
    return corporationID
      ? getCorporationWalletBalance(corporationID, accountKey)
      : 0;
  }

  Handle_PayBill(args, session, kwargs) {
    const billID = normalizePositiveInteger(args && args[0], null);
    const accountKey = normalizePositiveInteger(
      extractKwargValue(kwargs, "fromAccountKey") ??
        (args && args[1]) ??
        1000,
      1000,
    );
    payBillFromCorporation(
      billID,
      normalizePositiveInteger(session && (session.corporationID || session.corpid), null),
      accountKey,
    );
    return null;
  }

  Handle_DeclareWarAgainst(args, session) {
    const allianceID = resolveAllianceIDFromArgs([], session);
    const againstID = normalizePositiveInteger(args && args[0], null);
    const warHQ = normalizePositiveInteger(args && args[1], null);
    const bill = createBill({
      billTypeID: BILL_TYPE_WAR,
      amount: WAR_BILL_AMOUNT,
      debtorID: allianceID,
      creditorID: CONCORD_CORPORATION_ID,
      externalID: againstID || -1,
      externalID2: -1,
      dueDateTime: String(currentFileTime()),
    });
    return createWarRecord({
      declaredByID: allianceID,
      againstID,
      warHQ,
      mutual: false,
      billID: bill ? bill.billID : null,
    });
  }

  Handle_GetDaysInAlliance(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const corporationID = normalizePositiveInteger(args && args[1], null);
    return getDaysInAlliance(allianceID, corporationID);
  }

  Handle_GetAllianceMembersOlderThan(args, session) {
    const allianceID = resolveAllianceIDFromArgs(args, session);
    const minimumDays = normalizeInteger(args && args[1], 0);
    return buildList(getAllianceMembersOlderThan(allianceID, minimumDays));
  }

  Handle_GetEveOwners(args) {
    const ownerIDs = extractList(args && args[0])
      .map((ownerID) => getOwnerRecord(ownerID))
      .filter(Boolean)
      .map((record) =>
        buildRow(OWNER_HEADER, [
          record.ownerID,
          record.ownerName,
          record.typeID,
          record.gender,
          null,
        ]),
      );
    return buildList(ownerIDs);
  }
}

module.exports = AllianceRegistryRuntimeService;
