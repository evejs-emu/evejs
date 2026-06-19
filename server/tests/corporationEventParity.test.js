const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const {
  register,
  unregister,
} = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const CorpRegistryRuntimeService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpRegistryRuntime",
));
const AllianceRegistryRuntimeService = require(path.join(
  repoRoot,
  "server/src/services/corporation/allianceRegistryRuntime",
));
const CorpRecruitmentProxyService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpRecProxyService",
));
const OfficeManagerService = require(path.join(
  repoRoot,
  "server/src/services/corporation/officeManagerService",
));
const VoteManagerService = require(path.join(
  repoRoot,
  "server/src/services/corporation/voteManagerService",
));
const {
  cloneValue,
  ensureRuntimeInitialized,
  getCorporationOffices,
  updateRuntimeState,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
));
const {
  getCorporationRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationState",
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
  voteItemLockdown,
  VOTES_TABLE,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/voteRuntimeState",
));

const CORPORATION_ID = 98000000;
const ALLIANCE_ID = 99000000;
const CEO_CHARACTER_ID = 140000003;
const APPLICANT_CHARACTER_ID = 140000002;
const NPC_CORPORATION_ID = 1000044;

function dictEntriesToMap(dictPayload) {
  assert.equal(dictPayload && dictPayload.type, "dict");
  return new Map(dictPayload.entries);
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
    structureID: null,
    structureid: null,
    socket: { destroyed: false },
    userid: 1,
    clientID: 1,
    sendSessionChange() {},
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
    socket: { destroyed: false },
    userid: 2,
    clientID: 2,
    sendSessionChange() {},
    ...overrides,
  };
}

function createSpySession(overrides = {}) {
  const notifications = [];
  const session = buildCorpSession({
    sendNotification(notifyType, idType, payloadTuple) {
      notifications.push({
        notifyType,
        idType,
        payloadTuple,
      });
    },
    ...overrides,
  });
  session.notifications = notifications;
  return session;
}

function findNotification(session, notifyType) {
  return session.notifications.find((entry) => entry.notifyType === notifyType) || null;
}

test(
  "corp, alliance, war, office, and locked-item write paths emit live parity notifications",
  { concurrency: false },
  (t) => {
    const corpRegistry = new CorpRegistryRuntimeService();
    const allianceRegistry = new AllianceRegistryRuntimeService();
    const recruitmentProxy = new CorpRecruitmentProxyService();
    const officeManager = new OfficeManagerService();
    const voteManager = new VoteManagerService();
    const runtimeSnapshot = cloneValue(ensureRuntimeInitialized());
    const voteTableSnapshot = cloneValue(database.read(VOTES_TABLE, "/").data || {});
    const spySession = createSpySession();
    const officeStationID = spySession.stationID;
    const uniqueSuffix = Date.now();
    const updatedDescription = `Event Parity Description ${uniqueSuffix}`;
    const updatedUrl = `https://corp.example/events/${uniqueSuffix}`;
    const updatedMemberTitle = `Notifier ${uniqueSuffix}`;
    const previousAllianceRelationship =
      runtimeSnapshot.alliances &&
      runtimeSnapshot.alliances[String(ALLIANCE_ID)] &&
      runtimeSnapshot.alliances[String(ALLIANCE_ID)].relationships
        ? Number(
            runtimeSnapshot.alliances[String(ALLIANCE_ID)].relationships[
              String(NPC_CORPORATION_ID)
            ] || 0,
          )
        : 0;
    const updatedAllianceRelationship =
      previousAllianceRelationship === 5 ? 6 : 5;
    let createdItemID = null;

    register(spySession);

    t.after(() => {
      unregister(spySession);
      if (createdItemID !== null) {
        removeInventoryItem(createdItemID);
      }
      updateRuntimeState(() => cloneValue(runtimeSnapshot));
      database.write(VOTES_TABLE, "/", cloneValue(voteTableSnapshot));
    });

    corpRegistry.Handle_UpdateCorporation(
      [updatedDescription, updatedUrl, 0.05, true, 0.1],
      buildCorpSession(),
    );
    let note = findNotification(spySession, "OnCorporationChanged");
    assert.ok(note);
    assert.equal(Number(note.payloadTuple[0]), CORPORATION_ID);
    assert.equal(note.payloadTuple[1].type, "dict");
    assert.equal(
      new Map(note.payloadTuple[1].entries).get("description")[1],
      updatedDescription,
    );
    spySession.notifications.length = 0;

    corpRegistry.Handle_InsertApplication(
      [CORPORATION_ID, "Notification parity application"],
      buildNpcCorpSession(),
    );
    note = findNotification(spySession, "OnCorporationApplicationChanged");
    assert.ok(note);
    assert.equal(Number(note.payloadTuple[0]), CORPORATION_ID);
    assert.equal(note.payloadTuple[3] && note.payloadTuple[3].name, "util.Row");
    spySession.notifications.length = 0;

    corpRegistry.Handle_SetCorpWelcomeMail(
      ["Notification parity welcome"],
      buildCorpSession(),
    );
    note = findNotification(spySession, "OnCorporationWelcomeMailChanged");
    assert.ok(note);
    assert.equal(Number(note.payloadTuple[0]), CEO_CHARACTER_ID);
    spySession.notifications.length = 0;

    recruitmentProxy.Handle_CreateRecruitmentAd(
      [7, 1, 2, "Parity advert", [CEO_CHARACTER_ID], "Parity", 8, 1000, 4],
      buildCorpSession(),
    );
    note = findNotification(spySession, "OnCorporationRecruitmentAdChanged");
    assert.ok(note);
    spySession.notifications.length = 0;

    const existingOffice = getCorporationOffices(CORPORATION_ID).find(
      (entry) => Number(entry.stationID) === Number(officeStationID),
    );
    if (existingOffice) {
      officeManager.Handle_UnrentOffice([officeStationID], buildCorpSession());
      spySession.notifications.length = 0;
    }
    officeManager.Handle_RentOffice([officeStationID], buildCorpSession());
    note = findNotification(spySession, "OnOfficeRentalChanged");
    assert.ok(note);
    assert.equal(Number(note.payloadTuple[0]), CORPORATION_ID);
    assert.equal(Number(note.payloadTuple[1]) > 0, true);
    spySession.notifications.length = 0;

    corpRegistry.Handle_UpdateMember(
      [CEO_CHARACTER_ID, updatedMemberTitle, 1, 1, 1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, null, 0, 0n],
      buildCorpSession(),
    );
    note = findNotification(spySession, "OnCorporationMemberChanged");
    assert.ok(note);
    assert.equal(Number(note.payloadTuple[0]), CORPORATION_ID);
    assert.equal(Number(note.payloadTuple[1]), CEO_CHARACTER_ID);
    spySession.notifications.length = 0;

    allianceRegistry.Handle_SetRelationship(
      [updatedAllianceRelationship, NPC_CORPORATION_ID],
      buildCorpSession(),
    );
    note = findNotification(spySession, "OnAllianceRelationshipChanged");
    assert.ok(note);
    assert.equal(Number(note.payloadTuple[0]), ALLIANCE_ID);
    assert.equal(Number(note.payloadTuple[1]), NPC_CORPORATION_ID);
    spySession.notifications.length = 0;

    corpRegistry.Handle_DeclareWarAgainst(
      [NPC_CORPORATION_ID, officeStationID],
      buildCorpSession(),
    );
    note = findNotification(spySession, "OnWarChanged");
    assert.ok(note);
    assert.equal(note.payloadTuple[0] && note.payloadTuple[0].name, "util.KeyVal");
    assert.equal(Array.isArray(note.payloadTuple[1]), true);
    assert.equal(note.payloadTuple[2] && note.payloadTuple[2].type, "dict");
    spySession.notifications.length = 0;

    const office = getCorporationOffices(CORPORATION_ID).find(
      (entry) => Number(entry.stationID) === Number(officeStationID),
    );
    assert.ok(office);

    const grantResult = grantItemToCharacterStationHangar(
      CEO_CHARACTER_ID,
      officeStationID,
      34,
      1,
    );
    createdItemID =
      grantResult && grantResult.success && grantResult.data.items.length > 0
        ? grantResult.data.items[0].itemID
        : null;
    assert.equal(Number(createdItemID) > 0, true);

    updateInventoryItem(createdItemID, (item) =>
      buildInventoryItem({
        ...item,
        ownerID: CORPORATION_ID,
        locationID: office.officeFolderID,
        flagID: 4,
      }),
    );

    voteManager.Handle_InsertVoteCase(
      [
        "Lock Blueprint",
        "Notification parity lockdown",
        voteItemLockdown,
        ["Lock", "Do not lock", createdItemID, 34, officeStationID],
        1,
      ],
      buildCorpSession(),
    );
    note = findNotification(spySession, "OnLockedItemChangeUI");
    assert.ok(note);
    assert.equal(Number(note.payloadTuple[0]), Number(createdItemID));
    assert.equal(Number(note.payloadTuple[1]), CORPORATION_ID);
    assert.equal(Number(note.payloadTuple[2]), Number(officeStationID));
  },
);
