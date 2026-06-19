const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const AllianceRegistryRuntimeService = require(path.join(
  repoRoot,
  "server/src/services/corporation/allianceRegistryRuntime",
));
const CorpMgrService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpmgrService",
));
const CorpRegistryRuntimeService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpRegistryRuntime",
));
const CorpService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpService",
));
const {
  StandingMgrService,
} = require(path.join(
  repoRoot,
  "server/src/services/character/standingMgrService",
));
const FwCharacterEnlistmentMgrService = require(path.join(
  repoRoot,
  "server/src/services/corporation/fwCharacterEnlistmentMgrService",
));
const {
  ensureRuntimeInitialized,
  updateCorporationRuntime,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));

function dictEntriesToMap(dictPayload) {
  assert.equal(dictPayload && dictPayload.type, "dict");
  return new Map(dictPayload.entries);
}

function keyValEntriesToMap(keyValPayload) {
  assert.equal(keyValPayload && keyValPayload.name, "util.KeyVal");
  return dictEntriesToMap(keyValPayload.args);
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
    "eve.common.script.sys.rowset.Rowset",
  );
  const rowsetState = dictEntriesToMap(rowsetPayload.args);
  const header = rowsetState.get("header").items;
  const lines = rowsetState.get("lines").items;
  return lines.map((line) => new Map(header.map((columnName, index) => [columnName, line.items[index]])));
}

test("alliance info window gets iterable member rows while alliance service cache stays indexed", () => {
  const service = new AllianceRegistryRuntimeService();
  const session = { allianceID: 99000000, allianceid: 99000000 };

  const infoPayload = service.Handle_GetAllianceMembers([99000000], session);
  assert.equal(infoPayload && infoPayload.name, "eve.common.script.sys.rowset.Rowset");
  const infoState = dictEntriesToMap(infoPayload.args);
  const infoHeader = infoState.get("header").items;
  const infoLines = infoState.get("lines").items;
  assert.deepEqual(infoHeader, [
    "corporationID",
    "allianceID",
    "chosenExecutorID",
    "startDate",
    "deleted",
  ]);
  assert.equal(infoLines.length > 0, true);
  assert.equal(infoLines[0].items.length, infoHeader.length);

  const servicePayload = service.Handle_GetMembers([99000000], session);
  assert.equal(
    servicePayload && servicePayload.name,
    "eve.common.script.sys.rowset.IndexRowset",
  );
  const serviceState = dictEntriesToMap(servicePayload.args);
  assert.equal(serviceState.get("idName"), "corporationID");
});

test("alliance GetAlliance payload includes CCP cache headers for the client rowset bootstrap", () => {
  const service = new AllianceRegistryRuntimeService();
  const payload = service.Handle_GetAlliance([99000000], {
    allianceID: 99000000,
    allianceid: 99000000,
  });
  const state = keyValEntriesToMap(payload);

  assert.deepEqual(state.get("__header__"), [
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
  ]);
  assert.equal(Number(state.get("allianceID")), 99000000);
  assert.equal(typeof state.get("allianceName"), "string");
  assert.equal(state.get("url"), null);
});

test("corp and alliance name suggestion APIs return CCP-style objects with named attributes", () => {
  const service = new CorpRegistryRuntimeService();

  const tickerPayload = service.Handle_GetSuggestedTickerNames(["DREAD"]);
  assert.equal(tickerPayload && tickerPayload.type, "list");
  assert.equal(tickerPayload.items.length > 0, true);
  const tickerState = dictEntriesToMap(tickerPayload.items[0].args);
  assert.equal(typeof tickerState.get("tickerName"), "string");
  assert.equal(tickerState.get("tickerName").length > 0, true);

  const shortNamePayload = service.Handle_GetSuggestedAllianceShortNames(["Elysian"]);
  assert.equal(shortNamePayload && shortNamePayload.type, "list");
  assert.equal(shortNamePayload.items.length > 0, true);
  const shortNameState = dictEntriesToMap(shortNamePayload.items[0].args);
  assert.equal(typeof shortNameState.get("shortName"), "string");
  assert.equal(shortNameState.get("shortName").length > 0, true);
});

test("corp member owner priming payload returns iterable owner rows instead of a tuple-set header pair", () => {
  const service = new CorpRegistryRuntimeService();
  const payload = service.Handle_GetEveOwners([], {
    corporationID: 98000000,
    corpid: 98000000,
  });

  assert.equal(payload && payload.type, "list");
  assert.equal(payload.items.length > 0, true);

  const firstOwner = rowEntriesToMap(payload.items[0]);
  assert.deepEqual(Array.from(firstOwner.keys()), [
    "ownerID",
    "ownerName",
    "typeID",
    "gender",
    "ownerNameID",
  ]);
  assert.equal(Number(firstOwner.get("ownerID")) > 0, true);
  assert.equal(typeof firstOwner.get("ownerName"), "string");
});

test("remote corporation rows include isRecruiting so standings and show-info corp caches stay column-aligned", () => {
  const service = new CorpMgrService();
  const payload = service.Handle_GetCorporations([98000000], {
    corporationID: 1000044,
    corpid: 1000044,
  });
  assert.equal(payload && payload.name, "util.Row");
  const state = dictEntriesToMap(payload.args);
  const header = state.get("header").items;
  const line = state.get("line").items;
  assert.equal(header.includes("isRecruiting"), true);
  assert.equal(line.length, header.length);
});

test("standing manager filters invalid corp-standing owners before the client primes eveowners", (t) => {
  const service = new StandingMgrService();
  const characterID = 140000003;
  const corporationID = 98000000;
  const originalCharacter = JSON.parse(
    JSON.stringify(getCharacterRecord(characterID) || {}),
  );

  t.after(() => {
    updateCharacterRecord(characterID, () => originalCharacter);
  });

  updateCharacterRecord(characterID, (record) => ({
    ...record,
    corporationID,
    standingData: {
      ...(record && record.standingData ? record.standingData : {}),
      corp: [
        { fromID: null, toID: corporationID, standing: 1.25 },
        { fromID: "1000125", toID: corporationID, standing: -2.5 },
        { fromID: corporationID, toID: 1000125, standing: 3.0 },
        { fromID: 1000044, toID: 1000009, standing: 4.5 },
      ],
    },
  }));

  const payload = service.Handle_GetCorpStandings([], {
    characterID,
    charid: characterID,
    corporationID,
    corpid: corporationID,
  });
  const payloadState = dictEntriesToMap(payload.args);
  assert.deepEqual(payloadState.get("header").items, ["fromID", "standing"]);
  const rows = rowsetToObjects(payload);

  assert.deepEqual(
    rows.map((row) => Number(row.get("fromID"))),
    [1000125],
  );
  assert.equal(
    rows.every((row) => row.has("toID") === false),
    true,
  );
  assert.deepEqual(
    rows.map((row) => Number(row.get("standing"))),
    [-2.5],
  );
});

test("standing manager returns char standings in the two-column rowset shape the client indexes by fromID", (t) => {
  const service = new StandingMgrService();
  const characterID = 140000004;
  const originalCharacter = JSON.parse(
    JSON.stringify(getCharacterRecord(characterID) || {}),
  );

  t.after(() => {
    updateCharacterRecord(characterID, () => originalCharacter);
  });

  updateCharacterRecord(characterID, (record) => ({
    ...record,
    standingData: {
      ...(record && record.standingData ? record.standingData : {}),
      char: [
        { fromID: 500001, toID: characterID, standing: 0.75 },
        { fromID: 1000044, toID: characterID, standing: -1.5 },
        { fromID: 500001, toID: 140099999, standing: 9.9 },
      ],
    },
  }));

  const payload = service.Handle_GetCharStandings([], {
    characterID,
    charid: characterID,
  });
  const payloadState = dictEntriesToMap(payload.args);
  assert.deepEqual(payloadState.get("header").items, ["fromID", "standing"]);

  const rows = rowsetToObjects(payload);
  assert.deepEqual(
    rows.map((row) => [Number(row.get("fromID")), Number(row.get("standing"))]),
    [
      [500001, 0.75],
      [1000044, -1.5],
    ],
  );
});

test("alliance classic contact and bulletin aliases preserve the client payload shapes", (t) => {
  const service = new AllianceRegistryRuntimeService();
  const session = {
    allianceID: 99000000,
    allianceid: 99000000,
    corporationID: 98000000,
    corpid: 98000000,
    characterID: 140000003,
    charid: 140000003,
  };
  const contactID = 1000044;
  let bulletinID = null;

  t.after(() => {
    service.Handle_RemoveAllianceContacts([[contactID]], session);
    if (bulletinID !== null) {
      service.Handle_DeleteBulletin([bulletinID], session);
    }
  });

  service.Handle_AddAllianceContact([contactID, 5], session);
  const contactListPayload = service.Handle_GetContactList([], session);
  const contactMap = dictEntriesToMap(contactListPayload);
  assert.equal(contactMap.has(contactID), true);

  bulletinID = service.Handle_AddBulletin(["Parity Title", "Parity Body"], session);
  const bulletinEntriesPayload = service.Handle_GetBulletinEntries([], session);
  assert.equal(bulletinEntriesPayload && bulletinEntriesPayload.type, "list");
  assert.equal(bulletinEntriesPayload.items[0].type, "packedrow");
  assert.equal(
    bulletinEntriesPayload.items.some((row) => {
      const state = rowEntriesToMap(row);
      return Number(state.get("bulletinID")) === Number(bulletinID);
    }),
    true,
  );

  const bulletinPayload = service.Handle_GetBulletin([bulletinID], session);
  assert.equal(bulletinPayload && bulletinPayload.type, "packedrow");
  const bulletinState = rowEntriesToMap(bulletinPayload);
  assert.equal(Number(bulletinState.get("bulletinID")), Number(bulletinID));
  assert.equal(bulletinState.get("title"), "Parity Title");

  service.Handle_UpdateBulletin([bulletinID, "Parity Title 2", "Parity Body 2"], session);
  const updatedBulletinState = rowEntriesToMap(
    service.Handle_GetBulletin([bulletinID], session),
  );
  assert.equal(updatedBulletinState.get("title"), "Parity Title 2");
  assert.equal(updatedBulletinState.get("body"), "Parity Body 2");
});

test("corp and alliance contact labels use CCP-style bitmask semantics", (t) => {
  const corpService = new CorpRegistryRuntimeService();
  const allianceService = new AllianceRegistryRuntimeService();
  const corpSession = {
    corporationID: 98000000,
    corpid: 98000000,
    characterID: 140000003,
    charid: 140000003,
  };
  const allianceSession = {
    allianceID: 99000000,
    allianceid: 99000000,
    corporationID: 98000000,
    corpid: 98000000,
    characterID: 140000003,
    charid: 140000003,
  };
  const corpContactID = 1000044;
  const allianceContactID = 1000045;
  let corpLabelA = null;
  let corpLabelB = null;
  let allianceLabelA = null;
  let allianceLabelB = null;

  t.after(() => {
    corpService.Handle_RemoveCorporateContacts([[corpContactID]], corpSession);
    allianceService.Handle_RemoveAllianceContacts([[allianceContactID]], allianceSession);
    if (corpLabelA !== null) {
      corpService.Handle_DeleteLabel([corpLabelA], corpSession);
    }
    if (corpLabelB !== null) {
      corpService.Handle_DeleteLabel([corpLabelB], corpSession);
    }
    if (allianceLabelA !== null) {
      allianceService.Handle_DeleteLabel([allianceLabelA], allianceSession);
    }
    if (allianceLabelB !== null) {
      allianceService.Handle_DeleteLabel([allianceLabelB], allianceSession);
    }
  });

  corpService.Handle_AddCorporateContact([corpContactID, 0], corpSession);
  corpLabelA = corpService.Handle_CreateLabel(["Corp Label A", 1], corpSession);
  corpLabelB = corpService.Handle_CreateLabel(["Corp Label B", 2], corpSession);
  assert.equal(corpLabelB, corpLabelA * 2);
  corpService.Handle_AssignLabels([[corpContactID], corpLabelA], corpSession);
  corpService.Handle_AssignLabels([[corpContactID], corpLabelB], corpSession);
  let corpContacts = dictEntriesToMap(
    corpService.Handle_GetCorporateContacts([], corpSession),
  );
  let corpContactState = dictEntriesToMap(corpContacts.get(corpContactID).args);
  assert.equal(Number(corpContactState.get("labelMask")), corpLabelA + corpLabelB);
  corpService.Handle_RemoveLabels([[corpContactID], corpLabelA], corpSession);
  corpContacts = dictEntriesToMap(corpService.Handle_GetCorporateContacts([], corpSession));
  corpContactState = dictEntriesToMap(corpContacts.get(corpContactID).args);
  assert.equal(Number(corpContactState.get("labelMask")), corpLabelB);
  corpService.Handle_DeleteLabel([corpLabelB], corpSession);
  corpLabelB = null;
  corpContacts = dictEntriesToMap(corpService.Handle_GetCorporateContacts([], corpSession));
  corpContactState = dictEntriesToMap(corpContacts.get(corpContactID).args);
  assert.equal(Number(corpContactState.get("labelMask")), 0);

  allianceService.Handle_AddAllianceContact([allianceContactID, 0], allianceSession);
  allianceLabelA = allianceService.Handle_CreateLabel(
    ["Alliance Label A", 1],
    allianceSession,
  );
  allianceLabelB = allianceService.Handle_CreateLabel(
    ["Alliance Label B", 2],
    allianceSession,
  );
  assert.equal(allianceLabelB, allianceLabelA * 2);
  allianceService.Handle_AssignLabels(
    [[allianceContactID], allianceLabelA],
    allianceSession,
  );
  allianceService.Handle_AssignLabels(
    [[allianceContactID], allianceLabelB],
    allianceSession,
  );
  let allianceContacts = dictEntriesToMap(
    allianceService.Handle_GetAllianceContacts([], allianceSession),
  );
  let allianceContactState = dictEntriesToMap(
    allianceContacts.get(allianceContactID).args,
  );
  assert.equal(
    Number(allianceContactState.get("labelMask")),
    allianceLabelA + allianceLabelB,
  );
  allianceService.Handle_RemoveLabels(
    [[allianceContactID], allianceLabelA],
    allianceSession,
  );
  allianceContacts = dictEntriesToMap(
    allianceService.Handle_GetAllianceContacts([], allianceSession),
  );
  allianceContactState = dictEntriesToMap(
    allianceContacts.get(allianceContactID).args,
  );
  assert.equal(Number(allianceContactState.get("labelMask")), allianceLabelB);
  allianceService.Handle_DeleteLabel([allianceLabelB], allianceSession);
  allianceLabelB = null;
  allianceContacts = dictEntriesToMap(
    allianceService.Handle_GetAllianceContacts([], allianceSession),
  );
  allianceContactState = dictEntriesToMap(
    allianceContacts.get(allianceContactID).args,
  );
  assert.equal(Number(allianceContactState.get("labelMask")), 0);
});

test("corporation medals support create, status, issue, and read payloads", (t) => {
  const service = new CorpService();
  const session = {
    corporationID: 98000000,
    corpid: 98000000,
    characterID: 140000003,
    charid: 140000003,
  };
  const corporationID = 98000000;
  const recipientID = 140000002;
  const runtimeTable = ensureRuntimeInitialized();
  const originalMedals = JSON.parse(
    JSON.stringify(
      (runtimeTable.corporations[String(corporationID)] || {}).medals || {
        medals: {},
        recipientsByMedalID: {},
      },
    ),
  );
  const originalNextMedalID = runtimeTable._meta.nextMedalID;

  t.after(() => {
    updateCorporationRuntime(corporationID, (runtime, _record, table) => {
      runtime.medals = originalMedals;
      table._meta.nextMedalID = originalNextMedalID;
      return runtime;
    });
  });

  const graphics = [
    { part: 1, graphic: 101, color: 201 },
    { part: 2, graphic: 102, color: 202 },
  ];
  const medalID = service.Handle_CreateMedal(
    ["Parity Medal", "Decoration parity", graphics],
    session,
  );
  assert.equal(Number(medalID) > 0, true);

  const [corpMedalsRowset, corpGraphicsRowset] = service.Handle_GetAllCorpMedals([
    corporationID,
  ]);
  const corpMedals = rowsetToObjects(corpMedalsRowset);
  const corpGraphics = rowsetToObjects(corpGraphicsRowset);
  assert.equal(
    corpMedals.some((medal) => Number(medal.get("medalID")) === Number(medalID)),
    true,
  );
  assert.equal(
    corpGraphics.filter((graphic) => Number(graphic.get("medalID")) === Number(medalID))
      .length,
    graphics.length,
  );

  service.Handle_GiveMedalToCharacters([[medalID], [recipientID], "For service"], session);
  const recipients = rowsetToObjects(service.Handle_GetRecipientsOfMedal([medalID], session));
  assert.equal(recipients.length, 1);
  assert.equal(Number(recipients[0].get("characterID")), recipientID);
  assert.equal(recipients[0].get("reason"), "For service");

  service.Handle_SetMedalStatus([{ [medalID]: 2 }], session);
  const [receivedMedalsRowset, receivedGraphicsRowset] = service.Handle_GetMedalsReceived([
    recipientID,
  ], session);
  const receivedMedals = rowsetToObjects(receivedMedalsRowset);
  const receivedGraphics = rowsetToObjects(receivedGraphicsRowset);
  assert.equal(receivedMedals.length, 1);
  assert.equal(Number(receivedMedals[0].get("medalID")), Number(medalID));
  assert.equal(Number(receivedMedals[0].get("status")), 2);
  assert.equal(receivedGraphics.length, graphics.length);

  const medalDetails = dictEntriesToMap(service.Handle_GetMedalDetails([medalID], session).args);
  const detailInfo = medalDetails.get("info");
  const detailGraphics = medalDetails.get("graphics");
  assert.equal(detailInfo.type, "list");
  assert.equal(detailInfo.items.length, 1);
  const detailInfoState = dictEntriesToMap(detailInfo.items[0].args);
  assert.equal(Number(detailInfoState.get("medalID")), Number(medalID));
  assert.equal(detailInfoState.get("title"), "Parity Medal");
  assert.equal(
    rowsetToObjects(detailGraphics).filter(
      (graphic) => Number(graphic.get("medalID")) === Number(medalID),
    ).length,
    graphics.length,
  );
});

test("corporation FW direct enlistment surfaces support whitelist and enlistment lifecycle", (t) => {
  const service = new FwCharacterEnlistmentMgrService();
  const corporationID = 98000000;
  const characterID = 140000003;
  const session = {
    corporationID,
    corpid: corporationID,
    characterID,
    charid: characterID,
    warFactionID: null,
    warfactionid: null,
  };
  const runtimeTable = ensureRuntimeInitialized();
  const originalAllowedFactions = JSON.parse(
    JSON.stringify(
      (((runtimeTable.corporations[String(corporationID)] || {}).fw || {})
        .allowedEnlistmentFactions) || [],
    ),
  );
  const originalCharacterRecord = JSON.parse(
    JSON.stringify(getCharacterRecord(characterID) || {}),
  );

  t.after(() => {
    updateCorporationRuntime(corporationID, (runtime) => {
      runtime.fw.allowedEnlistmentFactions = originalAllowedFactions;
      return runtime;
    });
    updateCharacterRecord(characterID, () => originalCharacterRecord);
  });

  const allowedFactions = [500001, 500004];
  const setAllowedPayload = service.Handle_SetMyCorpAllowedEnlistmentFactions(
    [allowedFactions],
    session,
  );
  assert.equal(setAllowedPayload.type, "list");
  assert.deepEqual(setAllowedPayload.items, allowedFactions);

  const getAllowedPayload = service.Handle_GetCorpAllowedEnlistmentFactions([
    corporationID,
  ]);
  assert.equal(getAllowedPayload.type, "list");
  assert.deepEqual(getAllowedPayload.items, allowedFactions);

  service.Handle_CreateMyDirectEnlistment([500001], session);
  const enlistment = service.Handle_GetMyEnlistment([], session);
  assert.equal(Number(enlistment[0]), 500001);
  assert.equal(Number(enlistment[1]), 500001);

  const zeroCooldown = service.Handle_GetMyDirectEnlistmentCooldownTimestamp([], session);
  assert.equal(String(zeroCooldown.value), "0");

  service.Handle_RemoveMyDirectEnlistment([], session);
  const removedEnlistment = service.Handle_GetMyEnlistment([], session);
  assert.equal(removedEnlistment[1], null);
  const cooldown = service.Handle_GetMyDirectEnlistmentCooldownTimestamp([], session);
  assert.equal(BigInt(String(cooldown.value)) > 0n, true);
});
