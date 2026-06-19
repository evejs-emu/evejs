const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const ClientSession = require(path.join(
  repoRoot,
  "server/src/network/clientSession",
));
const {
  marshalEncode,
} = require(path.join(
  repoRoot,
  "server/src/network/tcp/utils/marshal",
));

const database = require(path.join(repoRoot, "server/src/newDatabase"));

const CorpRegistryRuntimeService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpRegistryRuntime",
));
const CorpMgrService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpmgrService",
));
const CorpRecruitmentProxyService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpRecProxyService",
));
const OfficeManagerService = require(path.join(
  repoRoot,
  "server/src/services/corporation/officeManagerService",
));
const ItemLockingService = require(path.join(
  repoRoot,
  "server/src/services/corporation/itemLockingService",
));
const AccountService = require(path.join(
  repoRoot,
  "server/src/services/account/accountService",
));
const AllianceRegistryRuntimeService = require(path.join(
  repoRoot,
  "server/src/services/corporation/allianceRegistryRuntime",
));
const WarRegistryService = require(path.join(
  repoRoot,
  "server/src/services/corporation/warRegistryService",
));
const LPService = require(path.join(
  repoRoot,
  "server/src/services/corporation/lpService",
));
const WarsInfoMgrService = require(path.join(
  repoRoot,
  "server/src/services/corporation/warsInfoMgrService",
));
const MutualWarInviteManagerService = require(path.join(
  repoRoot,
  "server/src/services/corporation/mutualWarInviteMgrService",
));
const PeaceTreatyManagerService = require(path.join(
  repoRoot,
  "server/src/services/corporation/peaceTreatyMgrService",
));
const LookupService = require(path.join(
  repoRoot,
  "server/src/services/corporation/lookupSvcService",
));
const SearchService = require(path.join(
  repoRoot,
  "server/src/services/_other/searchService",
));
const VoteManagerService = require(path.join(
  repoRoot,
  "server/src/services/corporation/voteManagerService",
));
const {
  StationSvcAlias,
} = require(path.join(
  repoRoot,
  "server/src/services/station/stationService",
));
const {
  currentFileTime,
} = require(path.join(
  repoRoot,
  "server/src/services/_shared/serviceHelpers",
));
const {
  cloneValue,
  ensureRuntimeInitialized,
  getCorporationOffices,
  getCorporationRuntime,
  setCorporationAlliance,
  updateAllianceRecord,
  updateCorporationRecord,
  updateCorporationRuntime,
  updateRuntimeState,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
));
const {
  getAllianceRecord,
  getCorporationRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationState",
));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getCorporationWalletBalance,
  setCorporationWalletDivisionBalance,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpWalletState",
));
const {
  buildInventoryItem,
  grantItemToCharacterStationHangar,
  removeInventoryItem,
  updateInventoryItem,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));
const {
  createWarRecord,
  getWarRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/warRuntimeState",
));
const {
  PyWString,
} = require(path.join(repoRoot, "server/src/common/pyTypes"));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  updateVoteCase,
  voteCEO,
  voteKickMember,
  voteWar,
  voteShares,
  voteItemLockdown,
  voteItemUnlock,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/voteRuntimeState",
));
const {
  resetSovereigntyStateForTests,
  upsertSystemState,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovState",
));

const CORPORATION_ID = 98000000;
const ALLIANCE_ID = 99000000;
const CEO_CHARACTER_ID = 140000003;
const APPLICANT_CHARACTER_ID = 140000002;
const NPC_CORPORATION_ID = 1000044;
const VOTE_TABLE = "corporationVotes";

function dictEntriesToMap(dictPayload) {
  assert.equal(dictPayload && dictPayload.type, "dict");
  return new Map(dictPayload.entries);
}

function keyValEntriesToMap(payload) {
  assert.equal(payload && payload.name, "util.KeyVal");
  return dictEntriesToMap(payload.args);
}

function rowEntriesToMap(rowPayload) {
  if (rowPayload && rowPayload.type === "packedrow") {
    const columns = Array.isArray(rowPayload.columns) ? rowPayload.columns : [];
    const values = Array.isArray(rowPayload.values)
      ? rowPayload.values
      : columns.map(([columnName]) =>
          rowPayload.fields && Object.prototype.hasOwnProperty.call(rowPayload.fields, columnName)
            ? rowPayload.fields[columnName]
            : null,
        );
    return new Map(columns.map(([columnName], index) => [columnName, values[index]]));
  }
  assert.equal(rowPayload && rowPayload.name, "util.Row");
  const rowState = dictEntriesToMap(rowPayload.args);
  const header = rowState.get("header").items;
  const line = rowState.get("line").items;
  return new Map(header.map((columnName, index) => [columnName, line[index]]));
}

function rowsetToObjects(rowsetPayload) {
  assert.equal(
    rowsetPayload && rowsetPayload.name,
    rowsetPayload && rowsetPayload.name === "util.Rowset"
      ? "util.Rowset"
      : "eve.common.script.sys.rowset.Rowset",
  );
  const rowsetState = dictEntriesToMap(rowsetPayload.args);
  const headerPayload = rowsetState.get("header");
  const header =
    headerPayload && headerPayload.type === "objectex1"
      ? headerPayload.header[1][0].map(([columnName]) => columnName)
      : headerPayload.items;
  const lines = rowsetState.get("lines").items;
  return lines.map((line) =>
    new Map(
      header.map((columnName, index) => [
        columnName,
        Array.isArray(line) ? line[index] : line.items[index],
      ]),
    ),
  );
}

function indexRowsetToObjects(rowsetPayload) {
  assert.equal(
    rowsetPayload && rowsetPayload.name,
    "eve.common.script.sys.rowset.IndexRowset",
  );
  const rowsetState = dictEntriesToMap(rowsetPayload.args);
  const header = rowsetState.get("header").items;
  const items = dictEntriesToMap(rowsetState.get("items"));
  return new Map(
    [...items.entries()].map(([key, line]) => [
      Number(key),
      new Map(header.map((columnName, index) => [columnName, line.items[index]])),
    ]),
  );
}

function listPayloadToMaps(listPayload) {
  assert.equal(listPayload && listPayload.type, "list");
  return listPayload.items.map((item) =>
    item && (item.name === "util.Row" || item.type === "packedrow")
      ? rowEntriesToMap(item)
      : keyValEntriesToMap(item),
  );
}

function pagedResultSetToMaps(payload) {
  let collection;
  let totalCount;
  let page;
  let perPage;

  if (payload && payload.type === "objectex1") {
    assert.equal(
      payload.header && payload.header[0] && payload.header[0].value,
      "eve.common.script.util.pagedCollection.PagedResultSet",
    );
    const args = Array.isArray(payload.header[1]) ? payload.header[1] : [];
    [collection, totalCount, page, perPage] = args;
  } else {
    assert.equal(
      payload && payload.name,
      "eve.common.script.util.pagedCollection.PagedResultSet",
    );
    const state = dictEntriesToMap(payload.args);
    collection = state.get("collection");
    totalCount = state.get("totalCount");
    page = state.get("page");
    perPage = state.get("perPage");
  }

  assert.equal(collection && collection.type, "list");
  return {
    totalCount: Number(totalCount),
    page: Number(page),
    perPage: Number(perPage),
    rows: collection.items.map((item) => rowEntriesToMap(item)),
  };
}

function longValue(value) {
  if (value && typeof value === "object" && value.type === "long") {
    return BigInt(String(value.value || 0));
  }
  return BigInt(String(value || 0));
}

function buildCorpSession(overrides = {}) {
  const stationID = getCorporationRecord(CORPORATION_ID).stationID || 60003760;
  return {
    corporationID: CORPORATION_ID,
    corpid: CORPORATION_ID,
    allianceID: ALLIANCE_ID,
    allianceid: ALLIANCE_ID,
    characterID: CEO_CHARACTER_ID,
    charid: CEO_CHARACTER_ID,
    corpAccountKey: 1000,
    corpaccountkey: 1000,
    stationID,
    stationid: stationID,
    ...overrides,
  };
}

function buildNpcCorpSession(overrides = {}) {
  return {
    corporationID: NPC_CORPORATION_ID,
    corpid: NPC_CORPORATION_ID,
    allianceID: null,
    allianceid: null,
    characterID: APPLICANT_CHARACTER_ID,
    charid: APPLICANT_CHARACTER_ID,
    corpAccountKey: 1000,
    corpaccountkey: 1000,
    ...overrides,
  };
}

function buildCharacterSession(characterID, overrides = {}) {
  const character = getCharacterRecord(characterID) || {};
  const corporationID = Number(character.corporationID || 0) || 0;
  const corporation = getCorporationRecord(corporationID) || {};
  const stationID =
    Number(
      character.stationID ||
        character.homeStationID ||
        character.cloneStationID ||
        corporation.stationID,
    ) || 60003760;
  const allianceID =
    Number(character.allianceID || corporation.allianceID || 0) || null;
  return {
    corporationID,
    corpid: corporationID,
    allianceID,
    allianceid: allianceID,
    characterID,
    charid: characterID,
    corpAccountKey: 1000,
    corpaccountkey: 1000,
    stationID,
    stationid: stationID,
    ...overrides,
  };
}

test(
  "corporation identity and settings payloads stay aligned after updates",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const corpMgr = new CorpMgrService();
    const session = buildCorpSession();
    const originalRuntime = cloneValue(getCorporationRuntime(CORPORATION_ID) || {});
    const originalCorporation = cloneValue(getCorporationRecord(CORPORATION_ID) || {});
    const divisionNames = Array.from({ length: 14 }, (_, index) => `Parity Division ${index + 1}`);

    t.after(() => {
      updateCorporationRuntime(CORPORATION_ID, () => cloneValue(originalRuntime));
      updateCorporationRecord(CORPORATION_ID, originalCorporation);
    });

    corpRegistry.Handle_UpdateCorporationAbilities([false], session);
    corpRegistry.Handle_UpdateCorporation(
      ["Parity Description", "https://corp.example/parity", 0.12, true, 0.34],
      session,
    );
    corpRegistry.Handle_UpdateLogo([111, 222, 333, 444, 555, 666, 777], session);
    corpRegistry.Handle_UpdateDivisionNames(divisionNames, session);

    const corpRow = rowEntriesToMap(corpRegistry.Handle_GetCorporation([], session));
    assert.equal(corpRow.get("description"), "Parity Description");
    assert.equal(corpRow.get("url"), "https://corp.example/parity");
    assert.equal(Number(corpRow.get("taxRate")), 0.12);
    assert.equal(Number(corpRow.get("loyaltyPointTaxRate")), 0.34);
    assert.equal(Number(corpRow.get("applicationsEnabled")), 1);
    assert.equal(Number(corpRow.get("isRecruiting")), 1);
    assert.equal(Number(corpRow.get("shape1")), 111);
    assert.equal(Number(corpRow.get("color3")), 666);
    assert.equal(corpRow.get("division1"), "Parity Division 1");
    assert.equal(corpRow.get("walletDivision7"), "Parity Division 14");

    const publicInfo = keyValEntriesToMap(
      corpMgr.Handle_GetPublicInfo([CORPORATION_ID], session),
    );
    assert.equal(publicInfo.get("description"), "Parity Description");
    assert.equal(Number(publicInfo.get("applicationsEnabled")), 1);
    assert.equal(Number(publicInfo.get("isRecruiting")), 1);

    corpRegistry.Handle_UpdateCorporationAbilities([false], session);
    const disabledPublicInfo = keyValEntriesToMap(
      corpMgr.Handle_GetPublicInfo([CORPORATION_ID], session),
    );
    assert.equal(Number(disabledPublicInfo.get("applicationsEnabled")), 0);
    assert.equal(Number(disabledPublicInfo.get("isRecruiting")), 0);
  },
);

test(
  "member management surfaces update member roles, account keys, and titles",
  { concurrency: false },
  (t) => {
    const service = new CorpRegistryRuntimeService();
    const directorSession = buildCorpSession();
    const targetCharacterID = CEO_CHARACTER_ID;
    const memberSession = buildCorpSession();
    const originalRuntime = cloneValue(getCorporationRuntime(CORPORATION_ID) || {});
    const originalCharacter = cloneValue(getCharacterRecord(targetCharacterID) || {});

    t.after(() => {
      updateCorporationRuntime(CORPORATION_ID, () => cloneValue(originalRuntime));
      updateCharacterRecord(targetCharacterID, () => cloneValue(originalCharacter));
    });

    service.Handle_UpdateMember(
      [
        targetCharacterID,
        "Parity Officer",
        3,
        4,
        1n,
        2n,
        4n,
        8n,
        16n,
        32n,
        64n,
        128n,
        directorSession.stationID,
        256,
        512n,
      ],
      directorSession,
    );
    service.Handle_SetAccountKey([1004], memberSession);
    service.Handle_UpdateTitle(
      [2048, "Parity Title", 1n, 2n, 4n, 8n, 16n, 32n, 64n, 128n],
      directorSession,
    );
    service.Handle_UpdateTitles(
      [[4096, "Parity Bulk Title", 3n, 6n, 9n, 12n, 15n, 18n, 21n, 24n]],
      directorSession,
    );

    const member = rowEntriesToMap(
      service.Handle_GetMember([targetCharacterID], directorSession),
    );
    assert.equal(member.get("title"), "Parity Officer");
    assert.equal(Number(member.get("divisionID")), 3);
    assert.equal(Number(member.get("squadronID")), 4);
    assert.equal(longValue(member.get("roles")) > 0n, true);
    assert.equal(longValue(member.get("grantableRoles")) >= 0n, true);
    assert.equal(Number(member.get("accountKey")), 1004);

    const membersPage = pagedResultSetToMaps(
      service.Handle_GetMembersPaged([1], directorSession),
    );
    assert.equal(membersPage.totalCount > 0, true);
    assert.equal(membersPage.page, 0);
    assert.equal(membersPage.perPage, 50);
    assert.equal(
      membersPage.rows.some(
        (entry) => Number(entry.get("characterID")) === targetCharacterID,
      ),
      true,
    );

    const grantableRoles = service.Handle_GetMyGrantableRoles([], memberSession);
    assert.equal(grantableRoles.length, 4);
    assert.equal(longValue(grantableRoles[0]) > 0n, true);

    const titleMap = dictEntriesToMap(service.Handle_GetTitles([], directorSession));
    assert.equal(rowEntriesToMap(titleMap.get(2048)).get("titleName"), "Parity Title");
    assert.equal(
      [...titleMap.values()].some(
        (row) => rowEntriesToMap(row).get("titleName") === "Parity Bulk Title",
      ),
      true,
    );

    const memberTracking = rowsetToObjects(
      service.Handle_GetMemberTrackingInfo([], directorSession),
    );
    assert.equal(memberTracking.length > 0, true);

    service.Handle_DeleteTitle([2048], directorSession);
    const updatedTitleMap = dictEntriesToMap(service.Handle_GetTitles([], directorSession));
    assert.equal(rowEntriesToMap(updatedTitleMap.get(2048)).get("titleName"), "");
  },
);

test(
  "recruitment applications, invitations, welcome mail, and ads round-trip through corp runtime",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const recruitmentProxy = new CorpRecruitmentProxyService();
    const corpSession = buildCorpSession();
    const applicantSession = buildNpcCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const applicantSnapshot = cloneValue(getCharacterRecord(APPLICANT_CHARACTER_ID) || {});

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      updateCharacterRecord(APPLICANT_CHARACTER_ID, () => cloneValue(applicantSnapshot));
    });

    corpRegistry.Handle_SetCorpWelcomeMail(["Welcome to Parity Corp"], corpSession);
    const welcomeMail = keyValEntriesToMap(
      corpRegistry.Handle_GetCorpWelcomeMail([], corpSession),
    );
    assert.equal(welcomeMail.get("welcomeMail"), "Welcome to Parity Corp");
    assert.equal(Number(welcomeMail.get("characterID")), CEO_CHARACTER_ID);
    assert.equal(longValue(welcomeMail.get("changeDate")) > 0n, true);

    const applicationID = corpRegistry.Handle_InsertApplication(
      [CORPORATION_ID, "Please accept me"],
      applicantSession,
    );
    assert.equal(Number(applicationID) > 0, true);

    const myApplications = dictEntriesToMap(
      corpRegistry.Handle_GetMyApplications([], applicantSession),
    );
    assert.equal(myApplications.has(CORPORATION_ID), true);

    const corpApplications = dictEntriesToMap(
      corpRegistry.Handle_GetApplications([], corpSession),
    );
    assert.equal(corpApplications.has(APPLICANT_CHARACTER_ID), true);

    corpRegistry.Handle_UpdateApplicationOffer(
      [applicationID, APPLICANT_CHARACTER_ID, CORPORATION_ID, "Approved", 6, "Join us"],
      corpSession,
    );
    const invitationID = corpRegistry.Handle_InsertInvitation(
      [APPLICANT_CHARACTER_ID],
      corpSession,
    );
    assert.equal(Number(invitationID) > 0, true);

    const invitations = listPayloadToMaps(
      corpRegistry.Handle_GetMyOpenInvitations([], applicantSession),
    );
    assert.equal(
      invitations.some(
        (entry) => Number(entry.get("corporationID")) === CORPORATION_ID,
      ),
      true,
    );

    corpRegistry.Handle_UpdateApplicationOffer(
      [applicationID, APPLICANT_CHARACTER_ID, CORPORATION_ID, "Approved", 2, ""],
      applicantSession,
    );
    assert.equal(
      Number((getCharacterRecord(APPLICANT_CHARACTER_ID) || {}).corporationID),
      CORPORATION_ID,
    );

    const oldApplications = listPayloadToMaps(
      corpRegistry.Handle_GetMyOldApplications([], applicantSession),
    );
    assert.equal(
      oldApplications.some(
        (entry) => Number(entry.get("applicationID")) === Number(applicationID),
      ),
      true,
    );

    const advertID = recruitmentProxy.Handle_CreateRecruitmentAd(
      [7, 1, 2, "Parity advert", [CEO_CHARACTER_ID], "Parity Title", 8, 500000, 4],
      corpSession,
    );
    assert.equal(Number(advertID) > 0, true);

    let ads = listPayloadToMaps(
      recruitmentProxy.Handle_GetRecruitmentAdsForCorporation([], corpSession),
    );
    assert.equal(
      ads.some((entry) => Number(entry.get("adID")) === Number(advertID)),
      true,
    );

    recruitmentProxy.Handle_UpdateRecruitmentAd(
      [advertID, 3, 4, "Parity advert updated", [CEO_CHARACTER_ID, APPLICANT_CHARACTER_ID], "Parity Title 2", null, 16, 1000000, 8],
      corpSession,
    );
    const recruiters = recruitmentProxy.Handle_GetRecruiters([advertID], corpSession);
    assert.deepEqual(recruiters.items, [CEO_CHARACTER_ID, APPLICANT_CHARACTER_ID]);

    const searchResults = listPayloadToMaps(
      recruitmentProxy.Handle_SearchCorpAds([3, 4, false, false, 1500000, 0, 0, 1, 1, 16, 8]),
    );
    assert.equal(searchResults.length > 0, true);

    recruitmentProxy.Handle_DeleteRecruitmentAd([advertID], corpSession);
    ads = listPayloadToMaps(
      recruitmentProxy.Handle_GetRecruitmentAdsForCorporation([], corpSession),
    );
    assert.equal(
      ads.some((entry) => Number(entry.get("adID")) === Number(advertID)),
      false,
    );
  },
);

test(
  "live corporation application notifications stay client-compatible for create and close flows",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const applicantSnapshot = cloneValue(getCharacterRecord(APPLICANT_CHARACTER_ID) || {});
    const corpSession = {
      ...buildCorpSession(),
      socket: { destroyed: false },
      _notifications: [],
      _sessionChanges: [],
      sendNotification(name, idType, payload) {
        this._notifications.push({ name, idType, payload });
      },
      sendSessionChange(change) {
        this._sessionChanges.push(change);
      },
    };
    const applicantSession = {
      ...buildNpcCorpSession(),
      socket: { destroyed: false },
      _notifications: [],
      _sessionChanges: [],
      sendNotification(name, idType, payload) {
        this._notifications.push({ name, idType, payload });
      },
      sendSessionChange(change) {
        this._sessionChanges.push(change);
      },
    };

    sessionRegistry.register(corpSession);
    sessionRegistry.register(applicantSession);

    t.after(() => {
      sessionRegistry.unregister(corpSession);
      sessionRegistry.unregister(applicantSession);
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      updateCharacterRecord(APPLICANT_CHARACTER_ID, () => cloneValue(applicantSnapshot));
    });

    updateCorporationRuntime(CORPORATION_ID, (runtime) => ({
      ...runtime,
      applications: {},
      applicationHistory: [],
      invitations: {},
    }));
    updateCharacterRecord(APPLICANT_CHARACTER_ID, (record) => ({
      ...record,
      corporationID: NPC_CORPORATION_ID,
      allianceID: null,
    }));

    const applicationID = corpRegistry.Handle_InsertApplication(
      [CORPORATION_ID, "Please accept me"],
      applicantSession,
    );
    const firstInvitationID = corpRegistry.Handle_InsertInvitation(
      [APPLICANT_CHARACTER_ID],
      corpSession,
    );
    const secondInvitationID = corpRegistry.Handle_InsertInvitation(
      [APPLICANT_CHARACTER_ID],
      corpSession,
    );
    const runtimeAfterInvites = ensureRuntimeInitialized().corporations[String(CORPORATION_ID)];
    const firstInvitationApplicationID = Number(
      runtimeAfterInvites.invitations[String(firstInvitationID)].applicationID,
    );
    const secondInvitationApplicationID = Number(
      runtimeAfterInvites.invitations[String(secondInvitationID)].applicationID,
    );

    const activeApplicationsPayload = corpRegistry.Handle_GetMyApplications(
      [],
      applicantSession,
    );
    assert.doesNotThrow(
      () => marshalEncode(activeApplicationsPayload),
      "Expected GetMyApplications payloads to marshal instead of collapsing to None",
    );
    const activeApplications = dictEntriesToMap(activeApplicationsPayload);
    assert.equal(activeApplications.has(CORPORATION_ID), true);
    assert.equal(
      activeApplications.get(CORPORATION_ID).items.every(
        (item) => item && item.type === "packedrow",
      ),
      true,
    );

    corpRegistry.Handle_UpdateApplicationOffer(
      [applicationID, APPLICANT_CHARACTER_ID, CORPORATION_ID, "Please accept me", 7, ""],
      applicantSession,
    );
    corpRegistry.Handle_UpdateApplicationOffer(
      [firstInvitationApplicationID, APPLICANT_CHARACTER_ID, CORPORATION_ID, "", 2, ""],
      applicantSession,
    );

    const notifications = applicantSession._notifications
      .filter((entry) => entry.name === "OnCorporationApplicationChanged");
    assert.equal(notifications.length >= 5, true);
    assert.equal(
      notifications.every((entry) => entry.payload[3] && entry.payload[3].type === "packedrow"),
      true,
    );

    const statusesByApplicationID = new Map();
    for (const notification of notifications) {
      const applicationRow = rowEntriesToMap(notification.payload[3]);
      const seenStatuses = statusesByApplicationID.get(Number(notification.payload[2])) || [];
      seenStatuses.push(Number(applicationRow.get("status")));
      statusesByApplicationID.set(Number(notification.payload[2]), seenStatuses);
    }
    assert.deepEqual(statusesByApplicationID.get(Number(applicationID)), [0, 7]);
    assert.deepEqual(statusesByApplicationID.get(firstInvitationApplicationID), [8, 2]);
    assert.deepEqual(statusesByApplicationID.get(secondInvitationApplicationID), [8, 3]);

    const oldApplications = listPayloadToMaps(
      corpRegistry.Handle_GetMyOldApplications([], applicantSession),
    );
    assert.equal(
      oldApplications.every((entry) => Number(entry.get("status")) !== 8),
      true,
    );
    assert.equal(
      oldApplications.some(
        (entry) =>
          Number(entry.get("applicationID")) === secondInvitationApplicationID &&
          Number(entry.get("status")) === 3,
      ),
      true,
    );
  },
);

test(
  "office, asset, deliveries, impound, and locked-item readers stay DB-backed and client-shaped",
  { concurrency: false },
  (t) => {
    const officeManager = new OfficeManagerService();
    const corpMgr = new CorpMgrService();
    const lockingService = new ItemLockingService();
    const session = buildCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const stationID = session.stationID;
    let testItemID = null;

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      if (testItemID !== null) {
        removeInventoryItem(testItemID);
      }
    });

    officeManager.Handle_RentOffice([stationID], session);
    let offices = rowsetToObjects(officeManager.Handle_GetMyCorporationsOffices([], session));
    const officeRow = offices.find(
      (entry) => Number(entry.get("stationID")) === Number(stationID),
    );
    assert.ok(officeRow);
    assert.equal(Number(officeRow.get("stationTypeID")) > 0, true);
    assert.equal(
      officeManager.Handle_GetCorporationsWithOffices([stationID], session).includes(
        CORPORATION_ID,
      ),
      true,
    );
    assert.equal(Number(officeManager.Handle_GetPriceQuote([stationID], session)) >= 0, true);

    const office = getCorporationOffices(CORPORATION_ID).find(
      (entry) => Number(entry.stationID) === Number(stationID),
    );
    assert.ok(office);

    const grantResult = grantItemToCharacterStationHangar(
      CEO_CHARACTER_ID,
      stationID,
      34,
      25,
    );
    testItemID =
      grantResult && grantResult.success && grantResult.data.items.length > 0
        ? grantResult.data.items[0].itemID
        : null;
    assert.equal(Number(testItemID) > 0, true);

    updateInventoryItem(testItemID, (item) =>
      buildInventoryItem({
        ...item,
        ownerID: CORPORATION_ID,
        locationID: office.officeFolderID,
        flagID: 4,
      }),
    );

    let assetLocations = listPayloadToMaps(
      corpMgr.Handle_GetAssetInventory([CORPORATION_ID, "offices"]),
    );
    assert.equal(
      assetLocations.some(
        (entry) => Number(entry.get("locationID")) === Number(stationID),
      ),
      true,
    );

    let assetItems = rowsetToObjects(
      corpMgr.Handle_GetAssetInventoryForLocation([CORPORATION_ID, stationID, "offices"]),
    );
    assert.equal(
      assetItems.some((entry) => Number(entry.get("itemID")) === Number(testItemID)),
      true,
    );

    updateInventoryItem(testItemID, (item) =>
      buildInventoryItem({
        ...item,
        ownerID: CORPORATION_ID,
        locationID: stationID,
        flagID: 62,
      }),
    );

    assetLocations = listPayloadToMaps(
      corpMgr.Handle_GetAssetInventory([CORPORATION_ID, "deliveries"]),
    );
    assert.equal(
      assetLocations.some(
        (entry) => Number(entry.get("locationID")) === Number(stationID),
      ),
      true,
    );

    const searchLocations = listPayloadToMaps(
      corpMgr.Handle_SearchAssets(["deliveries", 0, 0, 34, 1], session),
    );
    assert.equal(
      searchLocations.some(
        (entry) => Number(entry.get("locationID")) === Number(stationID),
      ),
      true,
    );

    updateCorporationRuntime(CORPORATION_ID, (runtime) => {
      runtime.lockedItemsByLocation[String(stationID)] = {
        [String(testItemID)]: {
          itemID: testItemID,
          typeID: 34,
          ownerID: CORPORATION_ID,
          locationID: stationID,
        },
      };
      const officeID = String(office.officeID);
      runtime.offices[officeID].impounded = true;
      runtime.offices[officeID].rentalCost = 12345;
      return runtime;
    });

    const lockedItems = dictEntriesToMap(
      lockingService.Handle_GetItemsByLocation([stationID], session),
    );
    assert.equal(lockedItems.has(testItemID), true);
    assert.equal(
      lockingService.Handle_GetLockedItemLocations([], session).type,
      "objectex1",
    );
    assert.equal(
      lockingService.Handle_GetLockedItemLocations([], session).header[0].value,
      "__builtin__.set",
    );

    assert.equal(officeManager.Handle_HasCorpImpoundedItems([stationID], session), 1);
    assert.equal(
      Number(officeManager.Handle_GetImpoundReleasePrice([stationID], session)),
      12345,
    );
    officeManager.Handle_GetItemsFromImpound([stationID], session);
    assert.equal(officeManager.Handle_HasCorpImpoundedItems([stationID], session), 0);

    updateCorporationRuntime(CORPORATION_ID, (runtime) => {
      runtime.offices[String(office.officeID)].impounded = true;
      return runtime;
    });
    officeManager.Handle_TrashImpoundedOffice([stationID], session);
    offices = rowsetToObjects(officeManager.Handle_GetMyCorporationsOffices([], session));
    assert.equal(
      offices.some((entry) => Number(entry.get("stationID")) === Number(stationID)),
      false,
    );
  },
);

test(
  "corp wallet, accounting, shares, and dividends use the runtime cache instead of static payloads",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const accountService = new AccountService();
    const session = buildCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
    });

    setCorporationWalletDivisionBalance(CORPORATION_ID, 1000, 1000000, {
      description: "Parity wallet seed",
    });
    setCorporationWalletDivisionBalance(NPC_CORPORATION_ID, 1000, 0, {
      description: "Parity wallet reset",
    });
    updateCorporationRuntime(CORPORATION_ID, (runtime) => {
      runtime.shares[String(CORPORATION_ID)] = 20;
      runtime.shares[String(CEO_CHARACTER_ID)] = 8;
      runtime.shares[String(NPC_CORPORATION_ID)] = 10;
      return runtime;
    });

    assert.equal(Number(accountService.Handle_GetCashBalance([1, 1000], session)), 1000000);

    const divisions = listPayloadToMaps(accountService.Handle_GetWalletDivisionsInfo([], session));
    assert.equal(divisions.length >= 7, true);
    assert.equal(
      divisions.some((entry) => Number(entry.get("key")) === 1000),
      true,
    );

    let shareholders = rowsetToObjects(
      corpRegistry.Handle_GetShareholders([CORPORATION_ID], session),
    );
    assert.equal(
      shareholders.some(
        (entry) =>
          Number(entry.get("shareholderID")) === NPC_CORPORATION_ID &&
          Number(entry.get("shares")) === 10,
      ),
      true,
    );

    corpRegistry.Handle_MoveCompanyShares([CORPORATION_ID, NPC_CORPORATION_ID, 5], session);
    shareholders = rowsetToObjects(
      corpRegistry.Handle_GetShareholders([CORPORATION_ID], session),
    );
    assert.equal(
      shareholders.some(
        (entry) =>
          Number(entry.get("shareholderID")) === CORPORATION_ID &&
          Number(entry.get("shares")) === 15,
      ),
      true,
    );

    corpRegistry.Handle_MovePrivateShares([CORPORATION_ID, NPC_CORPORATION_ID, 3], session);
    shareholders = rowsetToObjects(
      corpRegistry.Handle_GetShareholders([CORPORATION_ID], session),
    );
    assert.equal(
      shareholders.some(
        (entry) =>
          Number(entry.get("shareholderID")) === CEO_CHARACTER_ID &&
          Number(entry.get("shares")) === 5,
      ),
      true,
    );

    corpRegistry.Handle_PayoutDividend([1, 250000], session);
    assert.equal(getCorporationWalletBalance(CORPORATION_ID, 1000) < 1000000, true);
    assert.equal(getCorporationWalletBalance(NPC_CORPORATION_ID, 1000) > 0, true);

    const journal = rowsetToObjects(
      accountService.Handle_GetJournalForAccounts([1000], session),
    );
    assert.equal(journal.length > 0, true);
    assert.equal(
      journal.some((entry) =>
        String(entry.get("description") || "").includes("Corporation dividend"),
      ),
      true,
    );

    const transactions = listPayloadToMaps(
      accountService.Handle_GetTransactions([1000], session),
    );
    assert.equal(transactions.length > 0, true);
  },
);

test(
  "alliance admin surfaces cover applications, relationships, executor support, prime time, and capital state",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const allianceRegistry = new AllianceRegistryRuntimeService();
    const allianceSession = buildCorpSession();
    const applicantSession = buildNpcCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const allianceSnapshot = cloneValue(getAllianceRecord(ALLIANCE_ID) || {});

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      updateAllianceRecord(ALLIANCE_ID, allianceSnapshot);
    });

    corpRegistry.Handle_ApplyToJoinAlliance([ALLIANCE_ID, "Please let us in"], applicantSession);
    let applications = indexRowsetToObjects(
      allianceRegistry.Handle_GetApplications([], allianceSession),
    );
    assert.equal(applications.has(NPC_CORPORATION_ID), true);
    assert.equal(
      applications.get(NPC_CORPORATION_ID).get("applicationText"),
      "Please let us in",
    );

    allianceRegistry.Handle_UpdateApplication(
      [NPC_CORPORATION_ID, "Denied", 4],
      allianceSession,
    );
    applications = indexRowsetToObjects(
      allianceRegistry.Handle_GetApplications([], allianceSession),
    );
    assert.equal(applications.has(NPC_CORPORATION_ID), false);

    allianceRegistry.Handle_SetRelationship([10, NPC_CORPORATION_ID], allianceSession);
    let relationships = dictEntriesToMap(
      allianceRegistry.Handle_GetRelationships([], allianceSession),
    );
    assert.equal(relationships.get(NPC_CORPORATION_ID), 10);
    allianceRegistry.Handle_DeleteRelationship([NPC_CORPORATION_ID], allianceSession);
    relationships = dictEntriesToMap(
      allianceRegistry.Handle_GetRelationships([], allianceSession),
    );
    assert.equal(relationships.has(NPC_CORPORATION_ID), false);

    allianceRegistry.Handle_DeclareExecutorSupport([CORPORATION_ID], allianceSession);
    const memberRows = rowsetToObjects(
      allianceRegistry.Handle_GetAllianceMembers([ALLIANCE_ID], allianceSession),
    );
    assert.equal(
      memberRows.some(
        (entry) =>
          Number(entry.get("corporationID")) === CORPORATION_ID &&
          Number(entry.get("chosenExecutorID")) === CORPORATION_ID,
      ),
      true,
    );

    allianceRegistry.Handle_SetPrimeHour([21], allianceSession);
    let primeInfo = keyValEntriesToMap(
      allianceRegistry.Handle_GetPrimeTimeInfo([], allianceSession),
    );
    assert.equal(Number(primeInfo.get("currentPrimeHour")), 0);
    assert.equal(Number(primeInfo.get("newPrimeHour")), 21);

    allianceRegistry.Handle_SetCapitalSystem([30000142], allianceSession);
    let capitalInfo = keyValEntriesToMap(
      allianceRegistry.Handle_GetCapitalSystemInfo([], allianceSession),
    );
    assert.equal(capitalInfo.get("currentCapitalSystem"), null);
    assert.equal(Number(capitalInfo.get("newCapitalSystem")), 30000142);
    allianceRegistry.Handle_CancelCapitalSystemTransition([], allianceSession);
    capitalInfo = keyValEntriesToMap(
      allianceRegistry.Handle_GetCapitalSystemInfo([], allianceSession),
    );
    assert.equal(capitalInfo.get("newCapitalSystem"), null);

    allianceRegistry.Handle_UpdateAlliance(
      ["Parity Alliance Description", "https://alliance.example/parity"],
      allianceSession,
    );
    const publicAlliance = keyValEntriesToMap(
      allianceRegistry.Handle_GetAlliancePublicInfo([ALLIANCE_ID], allianceSession),
    );
    assert.equal(publicAlliance.get("description"), "Parity Alliance Description");
    assert.equal(publicAlliance.get("url"), "https://alliance.example/parity");

    assert.equal(allianceRegistry.Handle_GetBills([], allianceSession).type, "list");
    assert.equal(
      allianceRegistry.Handle_GetBillsReceivable([], allianceSession).type,
      "list",
    );
  },
);

test("corp LP wallet bootstrap calls return iterable empty lists instead of None", () => {
  const lpService = new LPService();

  const characterPayload = lpService.Handle_GetAllMyCharacterWalletLPBalances();
  assert.equal(characterPayload && characterPayload.type, "list");
  assert.deepEqual(characterPayload.items, []);

  const corporationPayload = lpService.Handle_GetAllMyCorporationWalletLPBalances();
  assert.equal(corporationPayload && corporationPayload.type, "list");
  assert.deepEqual(corporationPayload.items, []);
});

test("alliance home and war search helpers return real sovereignty-backed iterables and grouped search dicts", (t) => {
  const allianceRegistry = new AllianceRegistryRuntimeService();
  const stationSvc = new StationSvcAlias();
  const searchSvc = new SearchService();
  const session = buildCorpSession();
  const sovereigntySnapshot = cloneValue(database.read("sovereignty", "/").data || {});

  t.after(() => {
    database.write("sovereignty", "/", cloneValue(sovereigntySnapshot));
    resetSovereigntyStateForTests();
  });

  resetSovereigntyStateForTests();
  upsertSystemState(
    30000142,
    {
      allianceID: ALLIANCE_ID,
      corporationID: CORPORATION_ID,
      claimStructureID: 440000101,
      infrastructureHubID: 440000102,
      claimTime: currentFileTime().toString(),
      structures: [
        {
          itemID: 440000101,
          typeID: 32226,
          ownerID: CORPORATION_ID,
          corporationID: CORPORATION_ID,
          allianceID: ALLIANCE_ID,
        },
        {
          itemID: 440000102,
          typeID: 32458,
          ownerID: CORPORATION_ID,
          corporationID: CORPORATION_ID,
          allianceID: ALLIANCE_ID,
          campaignEventType: 7,
          campaignStartTime: currentFileTime().toString(),
          campaignScoresByTeam: {
            1: 55,
          },
        },
      ],
    },
    { suppressNotifications: true },
  );

  const sovereigntyPayload = allianceRegistry.Handle_GetAllianceSovereigntyStructuresInfo(
    [],
    session,
  );
  assert.equal(Array.isArray(sovereigntyPayload), true);
  assert.equal(sovereigntyPayload.length, 3);
  assert.equal(sovereigntyPayload[0].type, "list");
  assert.equal(sovereigntyPayload[0].items.length, 1);
  assert.equal(sovereigntyPayload[1].items.length, 1);
  assert.equal(sovereigntyPayload[2].items.length, 1);
  const tcuRow = keyValEntriesToMap(sovereigntyPayload[0].items[0]);
  const iHubRow = keyValEntriesToMap(sovereigntyPayload[1].items[0]);
  const scoreRow = keyValEntriesToMap(sovereigntyPayload[2].items[0]);
  assert.equal(Number(tcuRow.get("structureID")), 440000102);
  assert.equal(Number(iHubRow.get("structureID")), 440000102);
  assert.equal(Number(scoreRow.get("sourceItemID")), 440000102);
  assert.equal(Number(scoreRow.get("teamID")), 1);
  assert.equal(Number(scoreRow.get("score")), 55);

  const allianceSystems = stationSvc.Handle_GetSystemsForAlliance([ALLIANCE_ID], session);
  assert.equal(allianceSystems && allianceSystems.type, "list");
  assert.equal(allianceSystems.items.length, 1);
  const firstSystem = keyValEntriesToMap(allianceSystems.items[0]);
  assert.equal(Number(firstSystem.get("solarSystemID")), 30000142);
  assert.equal(Number(firstSystem.get("allianceID")), ALLIANCE_ID);

  const corpSearch = dictEntriesToMap(
    searchSvc.Handle_Query(["ELYSIAN", [3]], null, { exact: 0 }),
  );
  assert.deepEqual(corpSearch.get(3).items, [CORPORATION_ID]);

  const allianceSearch = dictEntriesToMap(
    searchSvc.Handle_Query(["ELYSIAN", [4]], null, { exact: 0 }),
  );
  assert.deepEqual(allianceSearch.get(4).items, [ALLIANCE_ID]);
});

test(
  "live corp creation unwraps marshal string args instead of persisting [object Object]",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const applicantSession = buildNpcCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const corporationTableSnapshot = cloneValue(database.read("corporations", "/").data || {});
    const applicantSnapshot = cloneValue(getCharacterRecord(APPLICANT_CHARACTER_ID) || {});

    t.after(() => {
      database.write("corporations", "/", cloneValue(corporationTableSnapshot));
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      updateCharacterRecord(APPLICANT_CHARACTER_ID, () => cloneValue(applicantSnapshot));
    });

    const corporationID = corpRegistry.Handle_AddCorporation(
      [
        new PyWString("Marshal Parity Corp"),
        new PyWString("MPC"),
        new PyWString("Created from PyWString args"),
        new PyWString("https://marshal-parity.example/corp"),
        0.07,
        111,
        222,
        333,
        444,
        555,
        666,
        777,
        true,
        false,
        0.03,
      ],
      applicantSession,
    );
    assert.equal(Number(corporationID) > 0, true);

    const createdCorporation = getCorporationRecord(corporationID);
    assert.equal(createdCorporation.corporationName, "Marshal Parity Corp");
    assert.equal(createdCorporation.tickerName, "MPC");
    assert.equal(createdCorporation.description, "Created from PyWString args");
    assert.equal(
      createdCorporation.url,
      "https://marshal-parity.example/corp",
    );

    const createdCorpSession = buildCharacterSession(APPLICANT_CHARACTER_ID);
    const createdCorpRow = rowEntriesToMap(
      corpRegistry.Handle_GetCorporation([], createdCorpSession),
    );
    assert.equal(createdCorpRow.get("corporationName"), "Marshal Parity Corp");
    assert.equal(createdCorpRow.get("tickerName"), "MPC");
  },
);

test(
  "live corp creation sends the wallet session keys the client needs immediately",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const corporationTableSnapshot = cloneValue(database.read("corporations", "/").data || {});
    const applicantSnapshot = cloneValue(getCharacterRecord(APPLICANT_CHARACTER_ID) || {});
    const applicantSession = {
      ...buildNpcCorpSession(),
      socket: { destroyed: false },
      _sessionChanges: [],
      _notifications: [],
      sendNotification(name, idType, payload) {
        this._notifications.push({ name, idType, payload });
      },
      sendSessionChange(change) {
        this._sessionChanges.push(change);
      },
    };

    sessionRegistry.register(applicantSession);

    t.after(() => {
      sessionRegistry.unregister(applicantSession);
      database.write("corporations", "/", cloneValue(corporationTableSnapshot));
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      updateCharacterRecord(APPLICANT_CHARACTER_ID, () => cloneValue(applicantSnapshot));
    });

    const corporationID = corpRegistry.Handle_AddCorporation(
      [
        "Wallet Session Parity Corp",
        "WSPC",
        "Covers wallet session refresh after live corp creation",
        "https://wallet-session.example/parity",
        0.05,
        111,
        222,
        333,
        444,
        555,
        666,
        777,
        true,
        false,
        0.02,
      ],
      applicantSession,
    );
    assert.equal(Number(corporationID) > 0, true);
    assert.equal(Number(applicantSession.corporationID), Number(corporationID));
    assert.equal(Number(applicantSession.corpAccountKey), 1000);
    assert.equal(applicantSession._sessionChanges.length > 0, true);

    const corpRefresh = applicantSession._sessionChanges.find((change) => (
      change && Object.prototype.hasOwnProperty.call(change, "corpid")
    ));
    assert.ok(corpRefresh);
    assert.deepEqual(corpRefresh.corpid, [NPC_CORPORATION_ID, Number(corporationID)]);
    assert.deepEqual(corpRefresh.corpAccountKey, [1000, 1000]);
    assert.notEqual(longValue(corpRefresh.corprole[1]), 0n);
  },
);

test(
  "live create-alliance flow persists the CCP-facing alliance payloads",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const allianceRegistry = new AllianceRegistryRuntimeService();
    const applicantSession = buildNpcCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const corporationTableSnapshot = cloneValue(database.read("corporations", "/").data || {});
    const allianceTableSnapshot = cloneValue(database.read("alliances", "/").data || {});
    const applicantSnapshot = cloneValue(getCharacterRecord(APPLICANT_CHARACTER_ID) || {});

    t.after(() => {
      database.write("corporations", "/", cloneValue(corporationTableSnapshot));
      database.write("alliances", "/", cloneValue(allianceTableSnapshot));
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      updateCharacterRecord(APPLICANT_CHARACTER_ID, () => cloneValue(applicantSnapshot));
    });

    const tempCorporationID = corpRegistry.Handle_AddCorporation(
      [
        "Parity Temp Corporation",
        "PTC",
        "Temporary alliance creation corp",
        "https://temp-corp.example/parity",
        0.05,
        111,
        222,
        333,
        444,
        555,
        666,
        777,
        true,
        false,
        0.02,
      ],
      applicantSession,
    );
    assert.equal(Number(tempCorporationID) > 0, true);

    const tempSession = buildCharacterSession(APPLICANT_CHARACTER_ID);
    assert.equal(Number(tempSession.corporationID), Number(tempCorporationID));

    const allianceID = corpRegistry.Handle_CreateAlliance(
      [
        "Parity Temporary Alliance",
        "PTA",
        "Alliance created through corpRegistry runtime",
        "https://temp-alliance.example/parity",
      ],
      tempSession,
    );
    assert.equal(Number(allianceID) > 0, true);

    const allianceRow = keyValEntriesToMap(
      allianceRegistry.Handle_GetAlliance([allianceID], tempSession),
    );
    assert.equal(Number(allianceRow.get("allianceID")), Number(allianceID));
    assert.equal(allianceRow.get("allianceName"), "Parity Temporary Alliance");
    assert.equal(allianceRow.get("shortName"), "PTA");
    assert.equal(
      Number(allianceRow.get("executorCorpID")),
      Number(tempCorporationID),
    );
    assert.equal(Array.isArray(allianceRow.get("__header__")), true);

    const publicInfo = keyValEntriesToMap(
      allianceRegistry.Handle_GetAlliancePublicInfo([allianceID], tempSession),
    );
    assert.equal(
      publicInfo.get("description"),
      "Alliance created through corpRegistry runtime",
    );
    assert.equal(
      publicInfo.get("url"),
      "https://temp-alliance.example/parity",
    );
    assert.equal(
      Number(getCorporationRecord(tempCorporationID).allianceID),
      Number(allianceID),
    );
  },
);

test("client session change packets keep corpAccountKey for live wallet refreshes", () => {
  const socket = {
    destroyed: false,
    remoteAddress: "127.0.0.1",
    write() {},
  };
  const session = new ClientSession(
    {
      userId: 1,
      clientId: 60001,
      role: 1,
      sessionId: 1n,
    },
    socket,
  );
  let packet = null;
  session.sendPacket = (value) => {
    packet = value;
  };

  session.sendSessionChange({
    corpid: [98000000, 98000002],
    corpAccountKey: [1000, 1000],
  });

  assert.ok(packet);
  const payload = packet.args[4];
  const sessionChanges = payload[1][1];
  const changeMap = new Map(sessionChanges.entries);
  assert.deepEqual(changeMap.get("corpid"), [98000000, 98000002]);
  assert.deepEqual(changeMap.get("corpAccountKey"), [1000, 1000]);
});

test(
  "account GiveCash deposits character ISK into the selected corporation wallet division",
  { concurrency: false },
  (t) => {
    const accountService = new AccountService();
    const session = buildCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const characterSnapshot = cloneValue(getCharacterRecord(CEO_CHARACTER_ID) || {});
    const targetDivision = 1003;

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      updateCharacterRecord(CEO_CHARACTER_ID, () => cloneValue(characterSnapshot));
    });

    setCorporationWalletDivisionBalance(CORPORATION_ID, targetDivision, 0, {
      description: "Deposit parity reset",
    });
    updateCharacterRecord(CEO_CHARACTER_ID, (record) => ({
      ...record,
      balance: 250000,
      walletJournal: [],
    }));

    accountService.Handle_GiveCash(
      [CORPORATION_ID, 100000, "Parity corp deposit"],
      session,
      {
        type: "dict",
        entries: [["toAccountKey", targetDivision]],
      },
    );

    assert.equal(Number(getCharacterRecord(CEO_CHARACTER_ID).balance), 150000);
    assert.equal(
      Number(getCorporationWalletBalance(CORPORATION_ID, targetDivision)),
      100000,
    );
    const journal = rowsetToObjects(
      accountService.Handle_GetJournalForAccounts([targetDivision], session),
    );
    assert.equal(
      journal.some((entry) =>
        String(entry.get("description") || "").includes("Parity corp deposit"),
      ),
      true,
    );
  },
);

test(
  "alliance member-removal and live declare-war entry points update DB-backed rows",
  { concurrency: false },
  (t) => {
    const allianceRegistry = new AllianceRegistryRuntimeService();
    const corpRegistry = new CorpRegistryRuntimeService();
    const warRegistry = new WarRegistryService();
    const allianceSession = buildCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());

    t.after(() => {
      setCorporationAlliance(CORPORATION_ID, ALLIANCE_ID);
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
    });

    allianceRegistry.Handle_DeleteMember([CORPORATION_ID], allianceSession);
    assert.equal(getCorporationRecord(CORPORATION_ID).allianceID, null);
    const allianceMembersAfterRemoval = rowsetToObjects(
      allianceRegistry.Handle_GetAllianceMembers([ALLIANCE_ID], allianceSession),
    );
    assert.equal(
      allianceMembersAfterRemoval.some(
        (entry) => Number(entry.get("corporationID")) === CORPORATION_ID,
      ),
      false,
    );

    setCorporationAlliance(CORPORATION_ID, ALLIANCE_ID);
    const restoredMembers = rowsetToObjects(
      allianceRegistry.Handle_GetAllianceMembers([ALLIANCE_ID], allianceSession),
    );
    assert.equal(
      restoredMembers.some(
        (entry) => Number(entry.get("corporationID")) === CORPORATION_ID,
      ),
      true,
    );

    const createdWar = corpRegistry.Handle_DeclareWarAgainst(
      [NPC_CORPORATION_ID, allianceSession.stationID],
      allianceSession,
    );
    assert.equal(Number(createdWar && createdWar.warID) > 0, true);
    assert.equal(Number(createdWar.declaredByID), CORPORATION_ID);
    assert.equal(Number(createdWar.againstID), NPC_CORPORATION_ID);

    const wars = dictEntriesToMap(
      warRegistry.Handle_GetWars([CORPORATION_ID], allianceSession),
    );
    assert.equal(wars.has(Number(createdWar.warID)), true);
  },
);

test(
  "war services cover info readers, invites, negotiations, peace treaties, and lookup search",
  { concurrency: false },
  (t) => {
    const warRegistry = new WarRegistryService();
    const warsInfoMgr = new WarsInfoMgrService();
    const mutualWarInviteMgr = new MutualWarInviteManagerService();
    const peaceTreatyMgr = new PeaceTreatyManagerService();
    const lookupSvc = new LookupService();
    const attackerSession = buildCorpSession();
    const defenderSession = buildNpcCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const warHQ = attackerSession.stationID;

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
    });

    setCorporationWalletDivisionBalance(CORPORATION_ID, 1000, 500000, {
      description: "War parity seed",
    });

    const war = createWarRecord({
      declaredByID: ALLIANCE_ID,
      againstID: NPC_CORPORATION_ID,
      warHQ,
      openForAllies: true,
    });
    assert.ok(war);

    const warsByOwner = dictEntriesToMap(warRegistry.Handle_GetWars([], attackerSession));
    assert.equal(warsByOwner.has(Number(war.warID)), true);

    const publicWar = keyValEntriesToMap(
      warsInfoMgr.Handle_GetPublicWarInfo([war.warID]),
    );
    assert.equal(Number(publicWar.get("warID")), Number(war.warID));
    assert.equal(Number(publicWar.get("warHQID")), Number(warHQ));

    const top50 = listPayloadToMaps(warsInfoMgr.Handle_GetTop50([2147483647]));
    assert.equal(
      top50.some((entry) => Number(entry.get("warID")) === Number(war.warID)),
      true,
    );

    const warsForStructure = listPayloadToMaps(
      warsInfoMgr.Handle_GetWarsForStructure([warHQ]),
    );
    assert.equal(
      warsForStructure.some((entry) => Number(entry.get("warID")) === Number(war.warID)),
      true,
    );

    const warsRequiringHelp = listPayloadToMaps(
      warsInfoMgr.Handle_GetWarsRequiringAssistance([], defenderSession),
    );
    assert.equal(
      warsRequiringHelp.some((entry) => Number(entry.get("warID")) === Number(war.warID)),
      true,
    );

    mutualWarInviteMgr.Handle_SendInviteByPlayer([NPC_CORPORATION_ID], attackerSession);
    const pendingInvites = listPayloadToMaps(
      mutualWarInviteMgr.Handle_GetPendingInvitesForSession([], attackerSession),
    );
    assert.equal(
      pendingInvites.some(
        (entry) => Number(entry.get("toOwnerID")) === NPC_CORPORATION_ID,
      ),
      true,
    );

    mutualWarInviteMgr.Handle_RespondToInviteByPlayer([CORPORATION_ID, true], defenderSession);
    const warsAfterMutualInvite = dictEntriesToMap(
      warRegistry.Handle_GetWars([], defenderSession),
    );
    assert.equal(warsAfterMutualInvite.size >= 2, true);

    warRegistry.Handle_CreateSurrenderNegotiation([war.warID, 5000, "Stand down"], attackerSession);
    const negotiations = listPayloadToMaps(
      warRegistry.Handle_GetNegotiations([], attackerSession),
    );
    assert.equal(negotiations.length > 0, true);
    const negotiationID = Number(negotiations[0].get("warNegotiationID"));
    const negotiation = keyValEntriesToMap(
      warRegistry.Handle_GetWarNegotiation([negotiationID]),
    );
    assert.equal(Number(negotiation.get("warID")), Number(war.warID));

    warRegistry.Handle_AcceptSurrender([negotiationID]);
    const treaties = peaceTreatyMgr.Handle_GetPeaceTreatiesForSession([], attackerSession);
    assert.equal(Array.isArray(treaties), true);
    assert.equal(treaties.length, 2);
    assert.equal(treaties[0].type, "list");
    assert.equal(treaties[0].items.length > 0, true);

    const corpLookup = listPayloadToMaps(
      lookupSvc.Handle_LookupWarableCorporationsOrAlliances(["elysian", false]),
    );
    assert.equal(
      corpLookup.some((entry) => Number(entry.get("ownerID")) === CORPORATION_ID),
      true,
    );
    const allianceLookup = listPayloadToMaps(
      lookupSvc.Handle_LookupWarableCorporationsOrAlliances(["e l y s i a n", true]),
    );
    assert.equal(
      allianceLookup.some((entry) => Number(entry.get("ownerID")) === ALLIANCE_ID),
      true,
    );
  },
);

test(
  "third-party ally offers can be accepted through the live war-registry flow",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const warRegistry = new WarRegistryService();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const corporationTableSnapshot = cloneValue(database.read("corporations", "/").data || {});
    const applicantSnapshot = cloneValue(getCharacterRecord(APPLICANT_CHARACTER_ID) || {});
    const defenderSession = buildNpcCorpSession();

    t.after(() => {
      database.write("corporations", "/", cloneValue(corporationTableSnapshot));
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      updateCharacterRecord(APPLICANT_CHARACTER_ID, () => cloneValue(applicantSnapshot));
    });

    const allyCorporationID = corpRegistry.Handle_AddCorporation(
      [
        "Parity Ally Corporation",
        "PALY",
        "Temporary ally offer corp",
        "https://ally.example/parity",
        0.01,
        111,
        222,
        333,
        444,
        555,
        666,
        777,
        true,
        false,
        0.0,
      ],
      buildNpcCorpSession(),
    );
    assert.equal(Number(allyCorporationID) > 0, true);

    const allySession = buildCharacterSession(APPLICANT_CHARACTER_ID);
    const war = createWarRecord({
      declaredByID: CORPORATION_ID,
      againstID: NPC_CORPORATION_ID,
      openForAllies: true,
    });
    assert.ok(war);

    setCorporationWalletDivisionBalance(NPC_CORPORATION_ID, 1000, 100000, {
      description: "Parity ally acceptance seed",
    });

    warRegistry.Handle_CreateWarAllyOffer(
      [war.warID, 2500, NPC_CORPORATION_ID, "Hire Parity Ally"],
      allySession,
    );
    const defenderNegotiations = listPayloadToMaps(
      warRegistry.Handle_GetNegotiations([], defenderSession),
    );
    const negotiationEntry = defenderNegotiations.find(
      (entry) =>
        Number(entry.get("warID")) === Number(war.warID) &&
        Number(entry.get("ownerID1")) === Number(allyCorporationID),
    );
    assert.ok(negotiationEntry);

    const negotiationID = Number(negotiationEntry.get("warNegotiationID"));
    warRegistry.Handle_AcceptAllyNegotiation([negotiationID], defenderSession);

    const acceptedWar = getWarRecord(war.warID);
    assert.ok(acceptedWar.allies[String(allyCorporationID)]);

    const acceptedNegotiation = keyValEntriesToMap(
      warRegistry.Handle_GetWarNegotiation([negotiationID]),
    );
    assert.equal(Number(acceptedNegotiation.get("negotiationState")), 1);
    assert.equal(acceptedNegotiation.get("timeAccepted") !== null, true);
  },
);

test(
  "voting surfaces expose CCP-shaped cases, options, votes, and sanction dictionaries",
  { concurrency: false },
  (t) => {
    const voteTableSnapshot = cloneValue(database.read(VOTE_TABLE, "/").data || {});
    const service = new VoteManagerService();
    const session = buildCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      database.write(VOTE_TABLE, "/", cloneValue(voteTableSnapshot));
    });

    updateCorporationRuntime(CORPORATION_ID, (runtime) => {
      runtime.shares[String(CORPORATION_ID)] = 0;
      runtime.shares[String(CEO_CHARACTER_ID)] = 5;
      return runtime;
    });

    assert.equal(service.Handle_CanViewVotes([CORPORATION_ID], session), 1);
    assert.equal(service.Handle_CanVote([CORPORATION_ID], session), 1);

    const voteCaseID = service.Handle_InsertVoteCase(
      ["Parity Vote", "Parity Description", 4, ["Yes", "No"], 1],
      session,
    );
    assert.equal(Number(voteCaseID) > 0, true);

    const voteCasesByStatus = dictEntriesToMap(
      service.Handle_GetVoteCasesByCorporation([CORPORATION_ID, 0], session),
    );
    const openVoteCaseRowsetState = dictEntriesToMap(voteCasesByStatus.get(2).args);
    assert.equal(openVoteCaseRowsetState.get("RowClass").value, "blue.DBRow");
    assert.equal(openVoteCaseRowsetState.get("header").type, "objectex1");
    const openVoteCases = rowsetToObjects(voteCasesByStatus.get(2));
    assert.equal(
      openVoteCases.some(
        (entry) => Number(entry.get("voteCaseID")) === Number(voteCaseID),
      ),
      true,
    );

    const voteCase = keyValEntriesToMap(
      service.Handle_GetVoteCase([CORPORATION_ID, voteCaseID], session),
    );
    assert.equal(Number(voteCase.get("voteCaseID")), Number(voteCaseID));
    assert.equal(voteCase.get("voteCaseText"), "Parity Vote");

    const options = listPayloadToMaps(
      service.Handle_GetVoteCaseOptions([CORPORATION_ID, voteCaseID], session),
    );
    assert.equal(options.length, 2);
    assert.equal(options[0].get("optionText"), "Yes");
    assert.equal(options[1].get("optionText"), "No");

    service.Handle_InsertVote([CORPORATION_ID, voteCaseID, 0], session);
    const votes = listPayloadToMaps(service.Handle_GetVotes([voteCaseID], session));
    assert.equal(votes.length, 1);
    assert.equal(Number(votes[0].get("voteCaseID")), Number(voteCaseID));
    assert.equal(Number(votes[0].get("optionID")), 0);
    assert.equal(Number(votes[0].get("voteWeight")), 5);

    const sanctionedActions = dictEntriesToMap(
      service.Handle_GetCorpSanctionedActions([], session),
    );
    assert.equal(sanctionedActions instanceof Map, true);
  },
);

test(
  "sanctioned-action activation covers shares, war votes, kick-member, and lockdown or unlock flows",
  { concurrency: false },
  (t) => {
    const voteTableSnapshot = cloneValue(database.read(VOTE_TABLE, "/").data || {});
    const service = new VoteManagerService();
    const corpRegistry = new CorpRegistryRuntimeService();
    const officeManager = new OfficeManagerService();
    const lockingService = new ItemLockingService();
    const session = buildCorpSession();
    const applicantSession = buildNpcCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const applicantSnapshot = cloneValue(getCharacterRecord(APPLICANT_CHARACTER_ID) || {});
    let testItemID = null;

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      database.write(VOTE_TABLE, "/", cloneValue(voteTableSnapshot));
      updateCharacterRecord(APPLICANT_CHARACTER_ID, () => cloneValue(applicantSnapshot));
      if (testItemID !== null) {
        removeInventoryItem(testItemID);
      }
    });

    updateCorporationRuntime(CORPORATION_ID, (runtime) => {
      runtime.shares[String(CORPORATION_ID)] = 0;
      runtime.shares[String(CEO_CHARACTER_ID)] = 10;
      runtime.shares[String(APPLICANT_CHARACTER_ID)] = 1;
      return runtime;
    });

    const applicationID = corpRegistry.Handle_InsertApplication(
      [CORPORATION_ID, "Join for vote activation parity"],
      applicantSession,
    );
    corpRegistry.Handle_UpdateApplicationOffer(
      [
        applicationID,
        APPLICANT_CHARACTER_ID,
        CORPORATION_ID,
        "Approved",
        2,
        "",
      ],
      session,
    );

    const shareVoteID = service.Handle_InsertVoteCase(
      [
        "Create Shares",
        "Share activation parity",
        voteShares,
        ["Create seven shares", "Do not create shares", 7, null, null],
        1,
      ],
      session,
    );
    service.Handle_InsertVote([CORPORATION_ID, shareVoteID, 0], session);
    updateVoteCase(CORPORATION_ID, shareVoteID, (voteCase) => ({
      ...voteCase,
      endDateTime: "1",
    }));
    service.Handle_ActivateSanctionedAction([shareVoteID], session);
    assert.equal(
      Number(getCorporationRecord(CORPORATION_ID).shares) >= 1007,
      true,
    );

    const warVoteID = service.Handle_InsertVoteCase(
      [
        "Declare War",
        "War vote activation parity",
        voteWar,
        ["Declare war", "Do not declare war", NPC_CORPORATION_ID, null, null],
        1,
      ],
      session,
    );
    service.Handle_InsertVote([CORPORATION_ID, warVoteID, 0], session);
    updateVoteCase(CORPORATION_ID, warVoteID, (voteCase) => ({
      ...voteCase,
      endDateTime: "1",
    }));
    service.Handle_ActivateSanctionedAction([warVoteID], session);
    const sanctionedWars = rowsetToObjects(
      new WarsInfoMgrService().Handle_GetWarsByOwnerID([CORPORATION_ID]),
    );
    assert.equal(
      sanctionedWars.some(
        (entry) =>
          Number(entry.get("declaredByID")) === CORPORATION_ID &&
          Number(entry.get("againstID")) === NPC_CORPORATION_ID,
      ),
      true,
    );

    officeManager.Handle_RentOffice([session.stationID], session);
    const office = getCorporationOffices(CORPORATION_ID).find(
      (entry) => Number(entry.stationID) === Number(session.stationID),
    );
    assert.ok(office);

    const grantResult = grantItemToCharacterStationHangar(
      CEO_CHARACTER_ID,
      session.stationID,
      34,
      1,
    );
    testItemID =
      grantResult && grantResult.success && grantResult.data.items.length > 0
        ? grantResult.data.items[0].itemID
        : null;
    assert.equal(Number(testItemID) > 0, true);

    updateInventoryItem(testItemID, (item) =>
      buildInventoryItem({
        ...item,
        ownerID: CORPORATION_ID,
        locationID: office.officeFolderID,
        flagID: 4,
      }),
    );

    const lockVoteID = service.Handle_InsertVoteCase(
      [
        "Lock Blueprint",
        "Lockdown parity",
        voteItemLockdown,
        ["Lock blueprint", "Do not lock", testItemID, 34, session.stationID],
        1,
      ],
      session,
    );
    service.Handle_InsertVote([CORPORATION_ID, lockVoteID, 0], session);
    updateVoteCase(CORPORATION_ID, lockVoteID, (voteCase) => ({
      ...voteCase,
      endDateTime: "1",
    }));
    const sanctionedBeforeUnlock = dictEntriesToMap(
      lockingService.Handle_GetItemsByLocation([session.stationID], session),
    );
    assert.equal(sanctionedBeforeUnlock.has(testItemID), true);
    service.Handle_GetCorpSanctionedActions([], session);

    const unlockVoteID = service.Handle_InsertVoteCase(
      [
        "Unlock Blueprint",
        "Unlock parity",
        voteItemUnlock,
        ["Unlock blueprint", "Do not unlock", testItemID, 34, session.stationID],
        1,
      ],
      session,
    );
    service.Handle_InsertVote([CORPORATION_ID, unlockVoteID, 0], session);
    updateVoteCase(CORPORATION_ID, unlockVoteID, (voteCase) => ({
      ...voteCase,
      endDateTime: "1",
    }));
    service.Handle_ActivateSanctionedAction([unlockVoteID], session);
    const sanctionedAfterUnlock = dictEntriesToMap(
      lockingService.Handle_GetItemsByLocation([session.stationID], session),
    );
    assert.equal(sanctionedAfterUnlock.has(testItemID), false);

    const kickVoteID = service.Handle_InsertVoteCase(
      [
        "Kick Member",
        "Kick-member activation parity",
        voteKickMember,
        [
          "Kick applicant",
          "Do not kick applicant",
          APPLICANT_CHARACTER_ID,
          null,
          null,
        ],
        1,
      ],
      session,
    );
    service.Handle_InsertVote([CORPORATION_ID, kickVoteID, 0], session);
    updateVoteCase(CORPORATION_ID, kickVoteID, (voteCase) => ({
      ...voteCase,
      endDateTime: "1",
    }));
    service.Handle_ActivateSanctionedAction([kickVoteID], session);
    assert.equal(
      Number((getCharacterRecord(APPLICANT_CHARACTER_ID) || {}).corporationID),
      NPC_CORPORATION_ID,
    );
  },
);

test(
  "closed CEO vote cases automatically promote the winning candidate through sanctioned-action reads",
  { concurrency: false },
  (t) => {
    const voteTableSnapshot = cloneValue(database.read(VOTE_TABLE, "/").data || {});
    const service = new VoteManagerService();
    const corpRegistry = new CorpRegistryRuntimeService();
    const session = buildCorpSession();
    const applicantSession = buildNpcCorpSession();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const corporationSnapshot = cloneValue(getCorporationRecord(CORPORATION_ID) || {});
    const applicantSnapshot = cloneValue(getCharacterRecord(APPLICANT_CHARACTER_ID) || {});

    t.after(() => {
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      database.write(VOTE_TABLE, "/", cloneValue(voteTableSnapshot));
      updateCorporationRecord(CORPORATION_ID, corporationSnapshot);
      updateCharacterRecord(APPLICANT_CHARACTER_ID, () => cloneValue(applicantSnapshot));
    });

    updateCorporationRuntime(CORPORATION_ID, (runtime) => {
      runtime.shares[String(CEO_CHARACTER_ID)] = 10;
      runtime.shares[String(APPLICANT_CHARACTER_ID)] = 5;
      return runtime;
    });

    const applicationID = corpRegistry.Handle_InsertApplication(
      [CORPORATION_ID, "Join for CEO vote parity"],
      applicantSession,
    );
    corpRegistry.Handle_UpdateApplicationOffer(
      [
        applicationID,
        APPLICANT_CHARACTER_ID,
        CORPORATION_ID,
        "Approved",
        2,
        "",
      ],
      session,
    );

    const candidateSession = buildCharacterSession(APPLICANT_CHARACTER_ID);
    const ceoVoteID = service.Handle_InsertVoteCase(
      [
        "CEO Vote",
        "CEO succession parity",
        voteCEO,
        ["Promote applicant", "Keep existing CEO", APPLICANT_CHARACTER_ID, null, null],
        1,
      ],
      candidateSession,
    );
    service.Handle_InsertVote([CORPORATION_ID, ceoVoteID, 0], session);
    updateVoteCase(CORPORATION_ID, ceoVoteID, (voteCase) => ({
      ...voteCase,
      endDateTime: "1",
    }));

    const sanctionedActions = dictEntriesToMap(
      service.Handle_GetCorpSanctionedActions([], session),
    );
    assert.equal(sanctionedActions.has(Number(ceoVoteID)), true);
    assert.equal(
      Number(getCorporationRecord(CORPORATION_ID).ceoID),
      APPLICANT_CHARACTER_ID,
    );
  },
);
