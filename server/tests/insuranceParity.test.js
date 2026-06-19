const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const InsuranceService = require(path.join(
  repoRoot,
  "server/src/services/insurance/insuranceService",
));
const insuranceRuntime = require(path.join(
  repoRoot,
  "server/src/services/insurance/insuranceRuntime",
));
const insurancePrices = require(path.join(
  repoRoot,
  "server/src/services/insurance/insurancePriceAuthority",
));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  grantItemToOwnerLocation,
  resetInventoryStoreForTests,
  setShipPackagingState,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(repoRoot, "server/src/services/character/characterState"));
const {
  ACCOUNT_KEY,
  JOURNAL_ENTRY_TYPE,
  getCharacterWallet,
  setCharacterBalance,
} = require(path.join(repoRoot, "server/src/services/account/walletState"));
const {
  getCorporationWalletBalance,
  setCorporationWalletDivisionBalance,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpWalletState",
));
const {
  updateRuntimeState,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/corporationRuntimeState",
));
const {
  unwrapMarshalValue,
} = require(path.join(repoRoot, "server/src/services/_shared/serviceHelpers"));
const {
  NOTIFICATION_TYPE,
} = require(path.join(
  repoRoot,
  "server/src/services/notifications/notificationConstants",
));

const INSURABLE_TEST_SHIP_TYPE_ID = 582;
const ROLE_ACCOUNTANT = 256n;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readTable(tableName) {
  const result = database.read(tableName, "/");
  assert.equal(result.success, true, `failed to read ${tableName}`);
  return cloneValue(result.data || {});
}

function writeTable(tableName, payload) {
  const result = database.write(tableName, "/", cloneValue(payload));
  assert.equal(result.success, true, `failed to write ${tableName}`);
}

function resetInsuranceContracts() {
  writeTable("insuranceContracts", {
    _meta: {
      schemaVersion: 1,
      nextContractID: 1,
    },
    contractsByShipID: {},
    contractHistoryByID: {},
    payoutLedgerByLossID: {},
  });
  insuranceRuntime.resetInsuranceRuntimeCacheForTests();
}

function listStoredNotifications(characterID) {
  const notifications = readTable("notifications");
  const box = notifications && notifications.boxes
    ? notifications.boxes[String(characterID)]
    : null;
  return box && box.byID
    ? Object.values(box.byID)
    : [];
}

function getWrappedUserErrorMessage(error) {
  return error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
    ? error.machoErrorResponse.payload.header[1][0]
    : null;
}

function getWrappedUserErrorDict(error) {
  const dictHeader = error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    Array.isArray(error.machoErrorResponse.payload.header) &&
    Array.isArray(error.machoErrorResponse.payload.header[1])
    ? error.machoErrorResponse.payload.header[1][1]
    : null;
  return dictHeader && Array.isArray(dictHeader.entries)
    ? Object.fromEntries(dictHeader.entries)
    : {};
}

function captureThrownError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected function to throw");
}

function findDockedCandidate() {
  const characters = readTable("characters");
  const candidates = Object.keys(characters)
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .map((characterID) => {
      const character = getCharacterRecord(characterID);
      const stationID = Number(character && (character.stationID || character.stationid)) || 0;
      const corporationID = Number(character && character.corporationID) || 0;
      if (!character || stationID <= 0 || corporationID <= 0) {
        return null;
      }
      return {
        characterID,
        stationID,
        corporationID,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.characterID - right.characterID);
  assert.ok(candidates.length > 0, "expected at least one docked character");
  return candidates[0];
}

function buildSession(candidate, overrides = {}) {
  const notifications = [];
  return {
    clientID: 9800001,
    userid: 9800001,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    corporationID: candidate.corporationID,
    corpid: candidate.corporationID,
    corprole: overrides.corprole ?? 0,
    stationid: candidate.stationID,
    stationID: candidate.stationID,
    structureid: null,
    structureID: null,
    locationid: candidate.stationID,
    solarsystemid: 30000142,
    solarsystemid2: 30000142,
    _notifications: notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function grantPersonalShip(candidate) {
  const result = grantItemToCharacterLocation(
    candidate.characterID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    {
      typeID: INSURABLE_TEST_SHIP_TYPE_ID,
      name: "Bantam",
    },
    1,
  );
  assert.equal(result.success, true, "expected personal ship grant");
  return result.data.items[0];
}

function grantCorpShip(candidate) {
  const result = grantItemToOwnerLocation(
    candidate.corporationID,
    candidate.stationID,
    ITEM_FLAGS.HANGAR,
    {
      typeID: INSURABLE_TEST_SHIP_TYPE_ID,
      name: "Bantam",
    },
    1,
  );
  assert.equal(result.success, true, "expected corp ship grant");
  return result.data.items[0];
}

function basicPremium() {
  return insurancePrices.centsToIsk(
    insurancePrices.computePremiumCents(
      insurancePrices.getFullInsurancePriceCents(INSURABLE_TEST_SHIP_TYPE_ID),
      0.5,
    ),
  );
}

function platinumPremium() {
  return insurancePrices.centsToIsk(
    insurancePrices.computePremiumCents(
      insurancePrices.getFullInsurancePriceCents(INSURABLE_TEST_SHIP_TYPE_ID),
      1.0,
    ),
  );
}

function assertRestoredTables(originals) {
  writeTable("items", originals.items);
  writeTable("insuranceContracts", originals.insuranceContracts);
  writeTable("notifications", originals.notifications);
  updateRuntimeState(() => cloneValue(originals.corporationRuntime));
  resetInventoryStoreForTests();
  insuranceRuntime.resetInsuranceRuntimeCacheForTests();
  insurancePrices.resetInsurancePriceCacheForTests();
}

test("insurance price authority matches client formula and RPC shape", () => {
  const service = new InsuranceService();
  const fullPrice = insuranceRuntime.getFullInsurancePrice(INSURABLE_TEST_SHIP_TYPE_ID);
  assert.ok(fullPrice > 0, "expected repo-owned TQ price for test ship");
  assert.equal(service.Handle_GetInsurancePrice([INSURABLE_TEST_SHIP_TYPE_ID]), fullPrice);

  const pricesDict = unwrapMarshalValue(
    service.Handle_GetInsurancePrices([{
      type: "list",
      items: [INSURABLE_TEST_SHIP_TYPE_ID],
    }]),
  );
  assert.equal(pricesDict[String(INSURABLE_TEST_SHIP_TYPE_ID)], fullPrice);
  assert.equal(
    basicPremium(),
    Math.round(fullPrice * ((0.5 - 0.4) * 0.5) * 100) / 100,
  );
});

test("personal ship insurance supports contracts, replacement prompt, wallet journal, and uninsure", () => {
  const candidate = findDockedCandidate();
  const originalCharacter = getCharacterRecord(candidate.characterID);
  const originals = {
    items: readTable("items"),
    insuranceContracts: readTable("insuranceContracts"),
    notifications: readTable("notifications"),
    corporationRuntime: readTable("corporationRuntime"),
  };
  try {
    resetInsuranceContracts();
    setCharacterBalance(candidate.characterID, 1_000_000_000, {
      description: "insurance parity test setup",
    });
    const session = buildSession(candidate);
    const service = new InsuranceService();
    const ship = grantPersonalShip(candidate);
    const premium = basicPremium();

    assert.equal(
      service.Handle_InsureShip([ship.itemID, premium, false], session),
      null,
    );
    assert.ok(
      session._notifications.some((entry) => entry.name === "OnShipInsured"),
      "expected OnShipInsured client event",
    );

    const contracts = unwrapMarshalValue(service.Handle_GetContracts([], session));
    assert.equal(contracts.length, 1);
    assert.equal(contracts[0].shipID, ship.itemID);
    assert.equal(contracts[0].ownerID, candidate.characterID);
    assert.equal(contracts[0].fraction, 0.5);

    const wallet = getCharacterWallet(candidate.characterID);
    const latestJournal = getCharacterRecord(candidate.characterID).walletJournal[0];
    assert.equal(latestJournal.entryTypeID, JOURNAL_ENTRY_TYPE.INSURANCE);
    assert.equal(latestJournal.referenceID, -candidate.stationID);
    assert.equal(
      Math.round((1_000_000_000 - premium) * 100) / 100,
      wallet.balance,
    );

    const duplicateError = captureThrownError(() => {
      service.Handle_InsureShip([ship.itemID, premium, false], session);
    });
    assert.equal(getWrappedUserErrorMessage(duplicateError), "InsureShipFailedSingleContract");
    assert.equal(getWrappedUserErrorDict(duplicateError).ownerName, candidate.characterID);

    assert.equal(
      service.Handle_InsureShip(
        [ship.itemID, platinumPremium(), false],
        session,
        { type: "dict", entries: [["voidOld", true]] },
      ),
      null,
    );
    const replacedContract = insuranceRuntime.getContractForShip(session, ship.itemID);
    assert.equal(replacedContract.fraction, 1.0);

    assert.equal(service.Handle_UnInsureShip([ship.itemID], session), null);
    assert.equal(insuranceRuntime.getContractForShip(session, ship.itemID), null);
  } finally {
    updateCharacterRecord(candidate.characterID, () => originalCharacter);
    assertRestoredTables(originals);
  }
});

test("ship loss pays default insurance, contract insurance, and suppresses CONCORD payouts", () => {
  const candidate = findDockedCandidate();
  const originalCharacter = getCharacterRecord(candidate.characterID);
  const originals = {
    items: readTable("items"),
    insuranceContracts: readTable("insuranceContracts"),
    notifications: readTable("notifications"),
    corporationRuntime: readTable("corporationRuntime"),
  };
  try {
    resetInsuranceContracts();
    setCharacterBalance(candidate.characterID, 1_000_000, {
      description: "insurance parity payout test setup",
    });
    const defaultShip = grantPersonalShip(candidate);
    const fullPriceCents = insurancePrices.getFullInsurancePriceCents(defaultShip.typeID);
    const defaultPayout = insurancePrices.centsToIsk(
      insurancePrices.computePayoutCents(fullPriceCents, 0.4),
    );
    const defaultResult = insuranceRuntime.handleShipDestroyed({
      shipID: defaultShip.itemID,
      typeID: defaultShip.typeID,
      ownerID: candidate.characterID,
      ownerCharacterID: candidate.characterID,
      lossID: "insurance-default-loss",
    });
    assert.equal(defaultResult.success, true);
    assert.equal(defaultResult.paid, true);
    assert.equal(defaultResult.data.amount, defaultPayout);
    assert.equal(getCharacterWallet(candidate.characterID).balance, 1_000_000 + defaultPayout);
    assert.ok(
      listStoredNotifications(candidate.characterID).some((record) =>
        record.typeID === NOTIFICATION_TYPE.INSURANCE_PAYOUT &&
        record.data &&
        record.data.itemID === defaultShip.itemID &&
        record.data.payout === true
      ),
      "default payout notification includes the destroyed ship itemID required by the client body template",
    );

    const service = new InsuranceService();
    const session = buildSession(candidate);
    const platinumShip = grantPersonalShip(candidate);
    setCharacterBalance(candidate.characterID, 1_000_000, {
      description: "insurance parity contract payout setup",
    });
    service.Handle_InsureShip([platinumShip.itemID, platinumPremium(), false], session);
    const afterPremium = getCharacterWallet(candidate.characterID).balance;
    const storedContractState = insuranceRuntime._testing.ensureContractState();
    const storedPayoutCents = 123456;
    storedContractState.contractsByShipID[String(platinumShip.itemID)].payoutCents =
      storedPayoutCents;
    const platinumResult = insuranceRuntime.handleShipDestroyed({
      shipID: platinumShip.itemID,
      typeID: platinumShip.typeID,
      ownerID: candidate.characterID,
      ownerCharacterID: candidate.characterID,
      pilotCharacterID: candidate.characterID,
      lossID: "insurance-platinum-loss",
    });
    assert.equal(platinumResult.success, true);
    assert.equal(platinumResult.paid, true);
    assert.equal(platinumResult.data.amount, insurancePrices.centsToIsk(storedPayoutCents));
    assert.equal(
      getCharacterWallet(candidate.characterID).balance,
      Math.round(
        (afterPremium + insurancePrices.centsToIsk(storedPayoutCents)) * 100,
      ) / 100,
    );
    assert.equal(insuranceRuntime.getContractForShip(session, platinumShip.itemID), null);

    const concordShip = grantPersonalShip(candidate);
    setCharacterBalance(candidate.characterID, 1_000_000, {
      description: "insurance parity concord setup",
    });
    service.Handle_InsureShip([concordShip.itemID, platinumPremium(), false], session);
    const afterConcordPremium = getCharacterWallet(candidate.characterID).balance;
    const concordResult = insuranceRuntime.handleShipDestroyed({
      shipID: concordShip.itemID,
      typeID: concordShip.typeID,
      ownerID: candidate.characterID,
      ownerCharacterID: candidate.characterID,
      attackerEntity: {
        npcEntityType: "concord",
      },
      lossID: "insurance-concord-loss",
    });
    assert.equal(concordResult.success, true);
    assert.equal(concordResult.paid, false);
    assert.equal(getCharacterWallet(candidate.characterID).balance, afterConcordPremium);
    assert.equal(insuranceRuntime.getContractForShip(session, concordShip.itemID), null);
  } finally {
    updateCharacterRecord(candidate.characterID, () => originalCharacter);
    assertRestoredTables(originals);
  }
});

test("corp ship insurance uses accountant roles, corp wallet, and corp contract visibility", () => {
  const candidate = findDockedCandidate();
  const originalCharacter = getCharacterRecord(candidate.characterID);
  const originals = {
    items: readTable("items"),
    insuranceContracts: readTable("insuranceContracts"),
    notifications: readTable("notifications"),
    corporationRuntime: readTable("corporationRuntime"),
  };
  try {
    resetInsuranceContracts();
    setCorporationWalletDivisionBalance(candidate.corporationID, ACCOUNT_KEY.CASH, 1_000_000_000, {
      description: "insurance parity corp setup",
    });
    const session = buildSession(candidate, {
      corprole: ROLE_ACCOUNTANT,
    });
    const service = new InsuranceService();
    const ship = grantCorpShip(candidate);
    const premium = basicPremium();

    assert.equal(
      service.Handle_InsureShip([ship.itemID, premium, true], session),
      null,
    );
    const contracts = unwrapMarshalValue(service.Handle_GetContracts([1], session));
    assert.equal(contracts.length, 1);
    assert.equal(contracts[0].ownerID, candidate.corporationID);
    assert.equal(
      getCorporationWalletBalance(candidate.corporationID, ACCOUNT_KEY.CASH),
      Math.round((1_000_000_000 - premium) * 100) / 100,
    );

    const payout = insuranceRuntime.handleShipDestroyed({
      shipID: ship.itemID,
      typeID: ship.typeID,
      ownerID: candidate.corporationID,
      ownerCharacterID: candidate.characterID,
      pilotCharacterID: candidate.characterID,
      lossID: "insurance-corp-loss",
    });
    assert.equal(payout.success, true);
    assert.equal(payout.paid, true);
    assert.equal(
      getCorporationWalletBalance(candidate.corporationID, ACCOUNT_KEY.CASH),
      Math.round((1_000_000_000 - premium + payout.data.amount) * 100) / 100,
    );
  } finally {
    updateCharacterRecord(candidate.characterID, () => originalCharacter);
    assertRestoredTables(originals);
  }
});

test("repackaging a ship invalidates an active insurance contract", () => {
  const candidate = findDockedCandidate();
  const originalCharacter = getCharacterRecord(candidate.characterID);
  const originals = {
    items: readTable("items"),
    insuranceContracts: readTable("insuranceContracts"),
    notifications: readTable("notifications"),
    corporationRuntime: readTable("corporationRuntime"),
  };
  try {
    resetInsuranceContracts();
    setCharacterBalance(candidate.characterID, 1_000_000_000, {
      description: "insurance parity repackage setup",
    });
    const session = buildSession(candidate);
    const service = new InsuranceService();
    const ship = grantPersonalShip(candidate);
    service.Handle_InsureShip([ship.itemID, basicPremium(), false], session);
    assert.ok(insuranceRuntime.getContractForShip(session, ship.itemID));

    const repackageResult = setShipPackagingState(ship.itemID, true);
    assert.equal(repackageResult.success, true);
    assert.equal(insuranceRuntime.getContractForShip(session, ship.itemID), null);
  } finally {
    updateCharacterRecord(candidate.characterID, () => originalCharacter);
    assertRestoredTables(originals);
  }
});
