const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const spaceRuntime = require(path.join(repoRoot, "server/src/space/runtime"));
const DogmaService = require(path.join(
  repoRoot,
  "server/src/services/dogma/dogmaService",
));
const {
  getActiveShipRecord,
  getCharacterRecord,
} = require(path.join(
  repoRoot,
  "server/src/services/character/characterState",
));
const {
  getFittedModuleItems,
  isModuleOnline,
} = require(path.join(
  repoRoot,
  "server/src/services/fitting/liveFittingState",
));
const {
  resolveItemByTypeID,
} = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemTypeRegistry",
));

function findOnlineModuleCandidate() {
  const charactersResult = database.read("characters", "/");
  assert.equal(charactersResult.success, true, "Failed to read characters");

  const characterIDs = Object.keys(charactersResult.data || {})
    .map((characterID) => Number(characterID) || 0)
    .filter((characterID) => characterID > 0)
    .sort((left, right) => left - right);

  for (const characterID of characterIDs) {
    const characterRecord = getCharacterRecord(characterID);
    const ship = getActiveShipRecord(characterID);
    if (!characterRecord || !ship) {
      continue;
    }

    const fittedModules = getFittedModuleItems(characterID, ship.itemID);
    for (const moduleItem of fittedModules) {
      if (!isModuleOnline(moduleItem)) {
        continue;
      }
      return {
        characterID,
        characterRecord,
        ship,
        moduleItem,
      };
    }
  }

  assert.fail("Expected a character with an online fitted module");
}

function buildSession(candidate) {
  return {
    clientID: candidate.characterID + 9311,
    userid: candidate.characterID,
    characterID: candidate.characterID,
    charid: candidate.characterID,
    corporationID: candidate.characterRecord.corporationID || 0,
    allianceID: candidate.characterRecord.allianceID || 0,
    warFactionID: candidate.characterRecord.warFactionID || 0,
    characterName:
      candidate.characterRecord.characterName ||
      candidate.characterRecord.name ||
      `char-${candidate.characterID}`,
    shipName: candidate.ship.itemName || `ship-${candidate.ship.itemID}`,
    shipID: candidate.ship.itemID,
    shipid: candidate.ship.itemID,
    activeShipID: candidate.ship.itemID,
    socket: { destroyed: false },
    notifications: [],
    _space: {
      shipID: candidate.ship.itemID,
      systemID:
        Number(candidate.characterRecord.solarSystemID || candidate.characterRecord.solarsystemid || 0) ||
        Number(candidate.ship.locationID || 0),
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set(),
      freshlyVisibleDynamicEntityIDs: new Set(),
    },
    sendNotification(name, idType, payload) {
      this.notifications.push({ name, idType, payload });
    },
    sendSessionChange(change) {
      this.sessionChange = change;
    },
  };
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

function assertActivationThrowsUserError({
  dogma,
  session,
  moduleItem,
  errorMsg,
  expectedMessage,
  expectedDict = {},
}) {
  const originalActivateGenericModule = spaceRuntime.activateGenericModule;

  try {
    spaceRuntime.activateGenericModule = () => ({
      success: false,
      errorMsg,
    });

    let thrown = null;
    try {
      dogma.Handle_Activate([
        moduleItem.itemID,
        "targetAttack",
        900000000001,
        1000,
      ], session);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, "Expected activation failure to throw a wrapped UserError");
    assert.equal(getWrappedUserErrorMessage(thrown), expectedMessage);
    const wrappedDict = getWrappedUserErrorDict(thrown);
    for (const [key, value] of Object.entries(expectedDict)) {
      assert.equal(
        wrappedDict[key],
        value,
        `expected wrapped UserError key '${key}' to match`,
      );
    }
  } finally {
    spaceRuntime.activateGenericModule = originalActivateGenericModule;
  }
}

test("DogmaIM activation surfaces TARGET_OUT_OF_RANGE as a client-safe CustomNotify", () => {
  const candidate = findOnlineModuleCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  const originalActivateGenericModule = spaceRuntime.activateGenericModule;
  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  const moduleType = resolveItemByTypeID(Number(candidate.moduleItem.typeID) || 0);
  const expectedModuleName =
    candidate.moduleItem.itemName ||
    (moduleType && (moduleType.name || moduleType.typeName)) ||
    "module";

  try {
    spaceRuntime.activateGenericModule = () => ({
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
    });
    spaceRuntime.getSceneForSession = () => ({
      getEntityByID(targetID) {
        return targetID > 0
          ? {
            itemID: Number(targetID) || 0,
            itemName: "Vedmak",
            typeID: 0,
          }
          : null;
      },
    });

    let thrown = null;
    try {
      dogma.Handle_Activate([
        candidate.moduleItem.itemID,
        "targetAttack",
        900000000001,
        1000,
      ], session);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, "Expected activation failure to throw a wrapped UserError");
    assert.equal(getWrappedUserErrorMessage(thrown), "CustomNotify");
    const notify = getWrappedUserErrorDict(thrown).notify;
    assert.equal(typeof notify, "string");
    assert.match(notify, /too far away/i);
    assert.ok(
      notify.includes("Vedmak"),
      `expected out-of-range notify to include target name, got: ${notify}`,
    );
    assert.ok(
      notify.includes(expectedModuleName),
      `expected out-of-range notify to include module name, got: ${notify}`,
    );
    assert.doesNotMatch(notify, /\[[^\]]+\]/);
  } finally {
    spaceRuntime.activateGenericModule = originalActivateGenericModule;
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
  }
});

test("DogmaIM activation surfaces NO_FUEL as a client-visible CustomNotify", () => {
  const candidate = findOnlineModuleCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  assertActivationThrowsUserError({
    dogma,
    session,
    moduleItem: candidate.moduleItem,
    errorMsg: "NO_FUEL",
    expectedMessage: "CustomNotify",
    expectedDict: {
      notify: "You do not have enough fuel to activate that module.",
    },
  });
});

test("DogmaIM activation surfaces NO_AMMO as NoCharges", () => {
  const candidate = findOnlineModuleCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  assertActivationThrowsUserError({
    dogma,
    session,
    moduleItem: candidate.moduleItem,
    errorMsg: "NO_AMMO",
    expectedMessage: "NoCharges",
  });
});

test("DogmaIM activation surfaces MODULE_ALREADY_ACTIVE as EffectAlreadyActive2", () => {
  const candidate = findOnlineModuleCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  assertActivationThrowsUserError({
    dogma,
    session,
    moduleItem: candidate.moduleItem,
    errorMsg: "MODULE_ALREADY_ACTIVE",
    expectedMessage: "EffectAlreadyActive2",
  });
});

test("DogmaIM activation surfaces TARGET_REQUIRED as a client-visible CustomNotify", () => {
  const candidate = findOnlineModuleCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  assertActivationThrowsUserError({
    dogma,
    session,
    moduleItem: candidate.moduleItem,
    errorMsg: "TARGET_REQUIRED",
    expectedMessage: "CustomNotify",
    expectedDict: {
      notify: "You need an active target to activate that module.",
    },
  });
});

test("DogmaIM targeting surfaces TARGET_JAMMED as a client-visible CustomNotify", () => {
  const dogma = new DogmaService();
  let thrown = null;
  try {
    dogma._throwTargetingUserError("TARGET_JAMMED");
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "Expected TARGET_JAMMED to throw a wrapped UserError");
  assert.equal(getWrappedUserErrorMessage(thrown), "CustomNotify");
  assert.equal(
    getWrappedUserErrorDict(thrown).notify,
    "You cannot lock that target while jammed except against the ships currently jamming you.",
  );
});

test("DogmaIM targeting surfaces TARGET_LOCK_LIMIT_REACHED as a client-visible CustomNotify", () => {
  const dogma = new DogmaService();
  let thrown = null;
  try {
    dogma._throwTargetingUserError("TARGET_LOCK_LIMIT_REACHED");
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "Expected TARGET_LOCK_LIMIT_REACHED to throw a wrapped UserError");
  assert.equal(getWrappedUserErrorMessage(thrown), "CustomNotify");
  assert.equal(
    getWrappedUserErrorDict(thrown).notify,
    "You cannot lock any more targets.",
  );
});

test("DogmaIM AddTarget surfaces TARGET_LOCK_LIMIT_REACHED as a client-visible CustomNotify", () => {
  const candidate = findOnlineModuleCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  const originalAddTarget = spaceRuntime.addTarget;

  try {
    spaceRuntime.addTarget = () => ({
      success: false,
      errorMsg: "TARGET_LOCK_LIMIT_REACHED",
    });

    let thrown = null;
    try {
      dogma.Handle_AddTarget([2990001119], session);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, "Expected AddTarget failure to throw a wrapped UserError");
    assert.equal(getWrappedUserErrorMessage(thrown), "CustomNotify");
    assert.equal(
      getWrappedUserErrorDict(thrown).notify,
      "You cannot lock any more targets.",
    );
  } finally {
    spaceRuntime.addTarget = originalAddTarget;
  }
});

test("DogmaIM activation surfaces TARGET_NOT_LOCKED as a client-visible CustomNotify", () => {
  const candidate = findOnlineModuleCandidate();
  const session = buildSession(candidate);
  const dogma = new DogmaService();
  assertActivationThrowsUserError({
    dogma,
    session,
    moduleItem: candidate.moduleItem,
    errorMsg: "TARGET_NOT_LOCKED",
    expectedMessage: "CustomNotify",
    expectedDict: {
      notify: "That target is not locked.",
    },
  });
});
