const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const CharFittingMgrService = require(path.join(
  repoRoot,
  "server/src/services/fitting/charFittingMgrService",
));
const CorpFittingMgrService = require(path.join(
  repoRoot,
  "server/src/services/fitting/corpFittingMgrService",
));
const AllianceFittingMgrService = require(path.join(
  repoRoot,
  "server/src/services/fitting/allianceFittingMgrService",
));
const MachoNetService = require(path.join(
  repoRoot,
  "server/src/services/machoNet/machoNetService",
));
const {
  COMMUNITY_FITTING_CORP,
  resetSavedFittingStoreForTests,
} = require(path.join(repoRoot, "server/src/_secondary/fitting/fittingStore"));
const {
  resolveItemByName,
} = require(path.join(repoRoot, "server/src/services/inventory/itemTypeRegistry"));
const {
  unwrapMarshalValue,
} = require(path.join(repoRoot, "server/src/services/_shared/serviceHelpers"));

const CHARACTER_ID = 140000003;
const CORPORATION_ID = 98000000;
const ALLIANCE_ID = 99000000;
const RIFTER_TYPE_ID = 587;
const LOW_SLOT_FLAG = 11;
const MED_SLOT_FLAG = 19;
const HI_SLOT_FLAG = 27;
const CARGO_FLAG = 5;

function getWrappedUserErrorMessage(error) {
  return error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
      ? error.machoErrorResponse.payload.header[1][0]
      : null;
}

function captureThrownError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected function to throw");
}

function resetStore() {
  database.write(
    "savedFittings",
    "/",
    {
      _meta: {
        version: 1,
        nextFittingID: 1,
      },
      owners: {},
    },
    { force: true },
  );
  resetSavedFittingStoreForTests();
}

function buildSession() {
  const notifications = [];
  return {
    clientID: 7000001,
    userid: 7000001,
    characterID: CHARACTER_ID,
    charid: CHARACTER_ID,
    corporationID: CORPORATION_ID,
    corpid: CORPORATION_ID,
    allianceID: ALLIANCE_ID,
    allianceid: ALLIANCE_ID,
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function requireTypeID(name) {
  const result = resolveItemByName(name);
  assert.equal(result && result.success, true, `Expected item lookup for ${name}`);
  return result.match.typeID;
}

function buildFitting(name = "Parity Fit", description = "saved fitting parity") {
  return {
    name,
    description,
    shipTypeID: RIFTER_TYPE_ID,
    fitData: [
      [requireTypeID("Damage Control I"), LOW_SLOT_FLAG, 1],
      [requireTypeID("1MN Afterburner I"), MED_SLOT_FLAG, 1],
      [requireTypeID("125mm Gatling AutoCannon I"), HI_SLOT_FLAG, 1],
      [requireTypeID("EMP S"), CARGO_FLAG, 500],
    ],
  };
}

test.beforeEach(() => {
  resetStore();
});

test.after(() => {
  resetStore();
});

test("char fitting manager supports CRUD and reuses cached payloads until mutation", () => {
  const service = new CharFittingMgrService();
  const session = buildSession();
  const fittingID = service.Handle_SaveFitting(
    [CHARACTER_ID, buildFitting("Personal Alpha", "first pass")],
    session,
    null,
  );

  assert.equal(Number(fittingID) > 0, true);
  assert.deepEqual(
    session.notifications.find((entry) => entry && entry.name === "OnFittingDeleted"),
    undefined,
  );

  const firstPayload = service.Handle_GetFittings([CHARACTER_ID], session, null);
  const secondPayload = service.Handle_GetFittings([CHARACTER_ID], session, null);
  assert.strictEqual(secondPayload, firstPayload);

  const firstFittings = unwrapMarshalValue(firstPayload);
  assert.equal(firstFittings[fittingID].name, "Personal Alpha");
  assert.equal(firstFittings[fittingID].shipTypeID, RIFTER_TYPE_ID);
  assert.equal(firstFittings[fittingID].fitData.length, 4);

  service.Handle_UpdateNameAndDescription(
    [fittingID, CHARACTER_ID, "Personal Beta", "renamed"],
    session,
    null,
  );
  const renamedPayload = service.Handle_GetFittings([CHARACTER_ID], session, null);
  assert.notStrictEqual(renamedPayload, firstPayload);
  const renamedFittings = unwrapMarshalValue(renamedPayload);
  assert.equal(renamedFittings[fittingID].name, "Personal Beta");
  assert.equal(renamedFittings[fittingID].description, "renamed");

  const updatedFit = buildFitting("Personal Beta", "updated fit data");
  updatedFit.fitData = updatedFit.fitData.slice(0, 2);
  const updatedID = service.Handle_UpdateFitting(
    [CHARACTER_ID, updatedFit],
    session,
    { fittingID },
  );
  assert.equal(updatedID, fittingID);

  const updatedFittings = unwrapMarshalValue(
    service.Handle_GetFittings([CHARACTER_ID], session, null),
  );
  assert.equal(updatedFittings[fittingID].fitData.length, 2);

  assert.equal(service.Handle_DeleteFitting([CHARACTER_ID, fittingID], session, null), null);
  assert.deepEqual(
    session.notifications.find((entry) => entry && entry.name === "OnFittingDeleted"),
    {
      name: "OnFittingDeleted",
      idType: "clientID",
      payload: [CHARACTER_ID, fittingID],
    },
  );
  assert.deepEqual(
    unwrapMarshalValue(service.Handle_GetFittings([CHARACTER_ID], session, null)),
    {},
  );
});

test("saving a new personal fitting emits the live OnFittingAdded client notification", () => {
  const service = new CharFittingMgrService();
  const session = buildSession();

  const fittingID = service.Handle_SaveFitting(
    [CHARACTER_ID, buildFitting("Immediate Refresh", "notify")],
    session,
    null,
  );

  assert.equal(Number(fittingID) > 0, true);
  assert.deepEqual(
    session.notifications.find((entry) => entry && entry.name === "OnFittingAdded"),
    {
      name: "OnFittingAdded",
      idType: "clientID",
      payload: [CHARACTER_ID, fittingID],
    },
  );
});

test("bulk save returns temp-to-real mappings and bulk delete returns deleted ids", () => {
  const service = new CharFittingMgrService();
  const session = buildSession();
  const saveManyResult = service.Handle_SaveManyFittings(
    [
      CHARACTER_ID,
      {
        "-1": buildFitting("Bulk One", "first"),
        "-2": buildFitting("Bulk Two", "second"),
      },
    ],
    session,
    null,
  );

  const mappings = unwrapMarshalValue(saveManyResult);
  assert.equal(Array.isArray(mappings), true);
  assert.equal(mappings.length, 2);
  assert.deepEqual(
    mappings.map((entry) => entry.tempFittingID).sort((left, right) => left - right),
    [-2, -1],
  );
  assert.equal(
    mappings.every((entry) => Number(entry.realFittingID) > 0),
    true,
  );
  assert.deepEqual(
    session.notifications
      .filter((entry) => entry && entry.name === "OnFittingAdded")
      .map((entry) => entry.payload)
      .sort((left, right) => left[1] - right[1]),
    mappings
      .map((entry) => [CHARACTER_ID, entry.realFittingID])
      .sort((left, right) => left[1] - right[1]),
  );

  const savedFittings = unwrapMarshalValue(
    service.Handle_GetFittings([CHARACTER_ID], session, null),
  );
  assert.equal(Object.keys(savedFittings).length, 2);

  const deleted = unwrapMarshalValue(
    service.Handle_DeleteManyFittings(
      [CHARACTER_ID, mappings.map((entry) => entry.realFittingID)],
      session,
      null,
    ),
  );
  assert.deepEqual(
    deleted.sort((left, right) => left - right),
    mappings.map((entry) => entry.realFittingID).sort((left, right) => left - right),
  );
  assert.deepEqual(
    session.notifications.find((entry) => entry && entry.name === "OnManyFittingsDeleted"),
    {
      name: "OnManyFittingsDeleted",
      idType: "clientID",
      payload: [CHARACTER_ID, deleted],
    },
  );
  assert.deepEqual(
    unwrapMarshalValue(service.Handle_GetFittings([CHARACTER_ID], session, null)),
    {},
  );
});

test("corp, alliance, and community fitting surfaces all resolve through the shared store", () => {
  const session = buildSession();
  const corpService = new CorpFittingMgrService();
  const allianceService = new AllianceFittingMgrService();

  const corpFittingID = corpService.Handle_SaveFitting(
    [CORPORATION_ID, buildFitting("Corp Fit", "corp")],
    session,
    null,
  );
  const allianceFittingID = allianceService.Handle_SaveFitting(
    [ALLIANCE_ID, buildFitting("Alliance Fit", "alliance")],
    session,
    null,
  );

  const corpFittings = unwrapMarshalValue(
    corpService.Handle_GetFittings([CORPORATION_ID], session, null),
  );
  const allianceFittings = unwrapMarshalValue(
    allianceService.Handle_GetFittings([ALLIANCE_ID], session, null),
  );
  const communityFittings = corpService.Handle_GetCommunityFittings([], session, null);

  assert.equal(corpFittings[corpFittingID].ownerID, CORPORATION_ID);
  assert.equal(allianceFittings[allianceFittingID].ownerID, ALLIANCE_ID);
  assert.deepEqual(communityFittings, {
    type: "dict",
    entries: [],
  });
  assert.equal(COMMUNITY_FITTING_CORP, 1000282);
});

test("fitting managers reject cross-owner access and machoNet advertises allianceFittingMgr", () => {
  const session = buildSession();
  const charService = new CharFittingMgrService();
  const machoNet = new MachoNetService();

  const error = captureThrownError(() =>
    charService.Handle_GetFittings([CORPORATION_ID], session, null),
  );
  assert.equal(getWrappedUserErrorMessage(error), "CustomNotify");

  const serviceInfo = machoNet.getServiceInfoDict();
  const advertisedServices = new Map(serviceInfo.entries);
  assert.equal(advertisedServices.get("allianceFittingMgr"), null);
});
