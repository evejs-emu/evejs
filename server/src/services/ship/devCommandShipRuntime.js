const path = require("path");

const {
  getActiveShipRecord,
  getCharacterRecord,
  activateShipForSession,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  ITEM_FLAGS,
  grantItemToCharacterLocation,
  grantItemsToCharacterStationHangar,
  moveItemTypeFromCharacterLocation,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveShipByName,
} = require(path.join(__dirname, "../chat/shipTypeRegistry"));
const {
  resolveItemByName,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  buildShipResourceState,
  listFittedItems,
  selectAutoFitFlagForType,
  validateFitForShip,
  getModuleChargeCapacity,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getDockedLocationID,
  isDockedSession,
} = require(path.join(__dirname, "../structure/structureLocation"));
const {
  buildStoppedSpawnStateNearEntity,
  boardPreparedShipInSpace,
} = require(path.join(__dirname, "./spaceShipSwapRuntime"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));

const CAPSULE_TYPE_ID = 670;
const DEFAULT_HOME_STATION_ID = 60003760;
const DEFAULT_BURST_CHARGE_QUANTITY = 100;
const DEFAULT_INDUSTRIAL_CORE_FUEL_QUANTITY = 25_000;
const DEFAULT_TRIG_CHARGE_QUANTITY = 300;

function createTrigPreset({
  shipName,
  weaponName,
  primaryChargeName,
  alternateChargeNames = [],
  propulsionName = null,
} = {}) {
  const modules = [
    Object.freeze({ name: weaponName, quantity: 1, forceFit: true }),
    Object.freeze({ name: "Warp Scrambler II", quantity: 1, forceFit: true }),
    Object.freeze({ name: "Stasis Webifier II", quantity: 1, forceFit: true }),
  ];
  if (propulsionName) {
    modules.unshift(Object.freeze({ name: propulsionName, quantity: 1, forceFit: true }));
  }

  const cargoChargeNames = [
    primaryChargeName,
    ...alternateChargeNames,
  ].filter((value, index, array) => value && array.indexOf(value) === index);

  return Object.freeze({
    commandName: "/trig",
    shipName,
    modules: Object.freeze(modules),
    cargo: Object.freeze(cargoChargeNames.map((name) => Object.freeze({
      name,
      quantity: DEFAULT_TRIG_CHARGE_QUANTITY,
    }))),
    preloadCharges: Object.freeze([
      Object.freeze({
        moduleName: weaponName,
        chargeName: primaryChargeName,
        fullClip: true,
      }),
    ]),
  });
}

const DEV_COMMAND_SHIP_PRESETS = Object.freeze({
  cburst: Object.freeze({
    commandName: "/cburst",
    shipName: "Claymore",
    modules: Object.freeze([
      Object.freeze({ name: "Armor Command Burst II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Information Command Burst II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Mining Foreman Burst II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Shield Command Burst II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Skirmish Command Burst II", quantity: 1, forceFit: true }),
    ]),
    cargo: Object.freeze([
      Object.freeze({ name: "Armor Energizing Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Armor Reinforcement Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Rapid Repair Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Electronic Superiority Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Electronic Hardening Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Sensor Optimization Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Mining Laser Field Enhancement Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Mining Laser Optimization Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Mining Equipment Preservation Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Shield Harmonizing Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Shield Extension Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Active Shielding Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Evasive Maneuvers Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Interdiction Maneuvers Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
      Object.freeze({ name: "Rapid Deployment Charge", quantity: DEFAULT_BURST_CHARGE_QUANTITY }),
    ]),
    preloadCharges: Object.freeze([
      Object.freeze({
        moduleName: "Armor Command Burst II",
        chargeName: "Armor Reinforcement Charge",
        fullClip: true,
      }),
      Object.freeze({
        moduleName: "Information Command Burst II",
        chargeName: "Sensor Optimization Charge",
        fullClip: true,
      }),
      Object.freeze({
        moduleName: "Mining Foreman Burst II",
        chargeName: "Mining Laser Optimization Charge",
        fullClip: true,
      }),
      Object.freeze({
        moduleName: "Shield Command Burst II",
        chargeName: "Shield Extension Charge",
        fullClip: true,
      }),
      Object.freeze({
        moduleName: "Skirmish Command Burst II",
        chargeName: "Rapid Deployment Charge",
        fullClip: true,
      }),
    ]),
  }),
  orca: Object.freeze({
    commandName: "/orca",
    shipName: "Orca",
    modules: Object.freeze([
      Object.freeze({ name: "Large Asteroid Ore Compressor I", quantity: 1 }),
      Object.freeze({ name: "Mining Foreman Burst II", quantity: 1 }),
      Object.freeze({ name: "Small Tractor Beam II", quantity: 2 }),
      Object.freeze({ name: "Drone Link Augmentor II", quantity: 2 }),
      Object.freeze({ name: "Large Shield Extender II", quantity: 5 }),
      Object.freeze({ name: "Damage Control II", quantity: 1 }),
      Object.freeze({ name: "Reinforced Bulkheads II", quantity: 1 }),
    ]),
    cargo: Object.freeze([
      Object.freeze({
        name: "Mining Laser Field Enhancement Charge",
        quantity: DEFAULT_BURST_CHARGE_QUANTITY,
      }),
      Object.freeze({
        name: "Mining Equipment Preservation Charge",
        quantity: DEFAULT_BURST_CHARGE_QUANTITY,
      }),
      Object.freeze({
        name: "Mining Laser Optimization Charge",
        quantity: DEFAULT_BURST_CHARGE_QUANTITY,
      }),
    ]),
    preloadCharges: Object.freeze([
      Object.freeze({
        moduleName: "Mining Foreman Burst II",
        chargeName: "Mining Laser Optimization Charge",
        fullClip: true,
      }),
    ]),
  }),
  probe: Object.freeze({
    commandName: "/probe",
    shipName: "Nestor",
    modules: Object.freeze([
      Object.freeze({ name: "500MN Y-T8 Compact Microwarpdrive", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Zeugma Integrated Analyzer", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Scan Rangefinding Array II", quantity: 4, forceFit: true }),
      Object.freeze({ name: "Moreau's Modified Expanded Scan Probe Launcher", quantity: 1, forceFit: true }),
    ]),
    cargo: Object.freeze([
      Object.freeze({
        name: "Satori-Horigu Combat Scanner Probe",
        quantity: 200,
      }),
    ]),
    preloadCharges: Object.freeze([
      Object.freeze({
        moduleName: "Moreau's Modified Expanded Scan Probe Launcher",
        chargeName: "Satori-Horigu Combat Scanner Probe",
        fullClip: true,
      }),
    ]),
  }),
  probe2: Object.freeze({
    commandName: "/probe2",
    shipName: "Stratios",
    modules: Object.freeze([
      Object.freeze({ name: "Damage Control II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Multispectrum Energized Membrane II", quantity: 2, forceFit: true }),
      Object.freeze({ name: "Co-Processor II", quantity: 2, forceFit: true }),
      Object.freeze({ name: "Relic Analyzer II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Data Analyzer II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "10MN Y-S8 Compact Afterburner", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Cargo Scanner II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Scan Rangefinding Array II", quantity: 1, forceFit: true }),
      Object.freeze({ name: "250mm 'Scout' Accelerator Cannon", quantity: 3, forceFit: true }),
      Object.freeze({ name: "Sisters Expanded Probe Launcher", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Covert Ops Cloaking Device II", quantity: 1, forceFit: true }),
    ]),
    droneBay: Object.freeze([
      Object.freeze({ name: "Hobgoblin II", quantity: 5 }),
      Object.freeze({ name: "Hammerhead II", quantity: 5 }),
    ]),
    cargo: Object.freeze([
      Object.freeze({ name: "Sisters Core Scanner Probe", quantity: 72 }),
      Object.freeze({ name: "Federation Navy Uranium Charge M", quantity: 845 }),
      Object.freeze({ name: "Sisters Combat Scanner Probe", quantity: 16 }),
      Object.freeze({ name: "Small Tractor Beam I", quantity: 2 }),
    ]),
    preloadCharges: Object.freeze([
      Object.freeze({
        moduleName: "Sisters Expanded Probe Launcher",
        chargeName: "Sisters Core Scanner Probe",
        fullClip: true,
      }),
    ]),
  }),
  trigdamavik: createTrigPreset({
    shipName: "Damavik",
    weaponName: "Light Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma S",
    alternateChargeNames: ["Mystic S", "Occult S"],
    propulsionName: "5MN Y-T8 Compact Microwarpdrive",
  }),
  trignergal: createTrigPreset({
    shipName: "Nergal",
    weaponName: "Light Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma S",
    alternateChargeNames: ["Mystic S", "Occult S"],
    propulsionName: "5MN Y-T8 Compact Microwarpdrive",
  }),
  trigkikimora: createTrigPreset({
    shipName: "Kikimora",
    weaponName: "Light Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma S",
    alternateChargeNames: ["Mystic S", "Occult S"],
    propulsionName: "5MN Y-T8 Compact Microwarpdrive",
  }),
  trigdraugur: createTrigPreset({
    shipName: "Draugur",
    weaponName: "Light Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma S",
    alternateChargeNames: ["Mystic S", "Occult S"],
    propulsionName: "5MN Y-T8 Compact Microwarpdrive",
  }),
  trigvedmak: createTrigPreset({
    shipName: "Vedmak",
    weaponName: "Heavy Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma M",
    alternateChargeNames: ["Mystic M", "Occult M"],
    propulsionName: "50MN Y-T8 Compact Microwarpdrive",
  }),
  trigrodiva: createTrigPreset({
    shipName: "Rodiva",
    weaponName: "Heavy Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma M",
    alternateChargeNames: ["Mystic M", "Occult M"],
    propulsionName: "50MN Y-T8 Compact Microwarpdrive",
  }),
  trigikitursa: createTrigPreset({
    shipName: "Ikitursa",
    weaponName: "Heavy Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma M",
    alternateChargeNames: ["Mystic M", "Occult M"],
    propulsionName: "50MN Y-T8 Compact Microwarpdrive",
  }),
  trigzarmazd: createTrigPreset({
    shipName: "Zarmazd",
    weaponName: "Heavy Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma M",
    alternateChargeNames: ["Mystic M", "Occult M"],
    propulsionName: "50MN Y-T8 Compact Microwarpdrive",
  }),
  trigdrekavac: createTrigPreset({
    shipName: "Drekavac",
    weaponName: "Heavy Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma M",
    alternateChargeNames: ["Mystic M", "Occult M"],
    propulsionName: "50MN Y-T8 Compact Microwarpdrive",
  }),
  trigleshak: createTrigPreset({
    shipName: "Leshak",
    weaponName: "Supratidal Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma L",
    alternateChargeNames: ["Mystic L", "Occult L"],
    propulsionName: "500MN Y-T8 Compact Microwarpdrive",
  }),
  trigzirnitra: createTrigPreset({
    shipName: "Zirnitra",
    weaponName: "Ultratidal Entropic Disintegrator II",
    primaryChargeName: "Baryon Exotic Plasma XL",
    alternateChargeNames: ["Mystic XL", "Occult XL"],
  }),
  guardian: Object.freeze({
    commandName: "/guardian",
    shipName: "Guardian",
    modules: Object.freeze([
      Object.freeze({ name: "Medium Remote Armor Repairer II", quantity: 4 }),
      Object.freeze({ name: "Medium Remote Capacitor Transmitter II", quantity: 2 }),
    ]),
    cargo: Object.freeze([]),
    preloadCharges: Object.freeze([]),
  }),
  basilisk: Object.freeze({
    commandName: "/basilisk",
    shipName: "Basilisk",
    modules: Object.freeze([
      Object.freeze({ name: "Medium Remote Shield Booster II", quantity: 4 }),
      Object.freeze({ name: "Medium Remote Capacitor Transmitter II", quantity: 2 }),
    ]),
    cargo: Object.freeze([]),
    preloadCharges: Object.freeze([]),
  }),
  ewar: Object.freeze({
    commandName: "/ewar",
    shipName: "Gnosis",
    modules: Object.freeze([
      Object.freeze({ name: "500MN Y-T8 Compact Microwarpdrive", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Gotan's Modified Stasis Webifier", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Tisiphone's Modified Target Painter", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Gotan's Modified Heavy Warp Scrambler", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Gotan's Modified Heavy Warp Disruptor", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Dread Guristas Multispectral ECM", quantity: 1, forceFit: true }),
      Object.freeze({ name: "Draclira's Modified Heavy Energy Neutralizer", quantity: 3, forceFit: true }),
      Object.freeze({ name: "Draclira's Modified Heavy Energy Nosferatu", quantity: 3, forceFit: true }),
    ]),
    cargo: Object.freeze([]),
    preloadCharges: Object.freeze([]),
  }),
});

const TRIG_COMMAND_PRESET_KEYS = Object.freeze({
  damavik: "trigdamavik",
  nergal: "trignergal",
  kikimora: "trigkikimora",
  draugur: "trigdraugur",
  vedmak: "trigvedmak",
  rodiva: "trigrodiva",
  ikitursa: "trigikitursa",
  zarmazd: "trigzarmazd",
  drekavac: "trigdrekavac",
  leshak: "trigleshak",
  zirnitra: "trigzirnitra",
  frigate: "trigdamavik",
  assaultfrigate: "trignergal",
  destroyer: "trigkikimora",
  commanddestroyer: "trigdraugur",
  cruiser: "trigvedmak",
  logistics: "trigrodiva",
  hac: "trigikitursa",
  logi: "trigzarmazd",
  battlecruiser: "trigdrekavac",
  battleship: "trigleshak",
  dread: "trigzirnitra",
  light: "trigdamavik",
  heavy: "trigvedmak",
  supratidal: "trigleshak",
  ultratidal: "trigzirnitra",
  small: "trigdamavik",
  medium: "trigvedmak",
  large: "trigleshak",
  xl: "trigzirnitra",
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function magnitude(vector) {
  const resolved = cloneVector(vector);
  return Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const resolved = cloneVector(vector, fallback);
  const length = magnitude(resolved);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback, { x: 1, y: 0, z: 0 });
  }
  return {
    x: resolved.x / length,
    y: resolved.y / length,
    z: resolved.z / length,
  };
}

function scaleVector(vector, scalar) {
  const resolved = cloneVector(vector);
  const resolvedScalar = toFiniteNumber(scalar, 0);
  return {
    x: resolved.x * resolvedScalar,
    y: resolved.y * resolvedScalar,
    z: resolved.z * resolvedScalar,
  };
}

function addVectors(left, right) {
  const resolvedLeft = cloneVector(left);
  const resolvedRight = cloneVector(right);
  return {
    x: resolvedLeft.x + resolvedRight.x,
    y: resolvedLeft.y + resolvedRight.y,
    z: resolvedLeft.z + resolvedRight.z,
  };
}

function syncInventoryChangesToSession(session, changes = []) {
  if (!session) {
    return;
  }
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || change.previousState || {},
      {
        emitCfgLocation: true,
      },
    );
  }
}

function resolveDevCommandShipPreset(commandKey) {
  return DEV_COMMAND_SHIP_PRESETS[String(commandKey || "").trim().toLowerCase()] || null;
}

function resolveTrigCommandPresetKey(argumentText = "") {
  const normalized = String(argumentText || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) {
    return "trigleshak";
  }
  return TRIG_COMMAND_PRESET_KEYS[normalized] || null;
}

function resolveShipTypeByPreset(preset) {
  const shipLookup = resolveShipByName(String(preset && preset.shipName || ""));
  if (!shipLookup || !shipLookup.success || !shipLookup.match) {
    return {
      success: false,
      errorMsg: "SHIP_TYPE_NOT_FOUND",
    };
  }
  return {
    success: true,
    data: shipLookup.match,
  };
}

function resolvePresetModuleEntries(preset) {
  const resolvedEntries = [];
  for (const rawEntry of Array.isArray(preset && preset.modules) ? preset.modules : []) {
    const itemLookup = resolveItemByName(String(rawEntry && rawEntry.name || ""));
    if (!itemLookup || !itemLookup.success || !itemLookup.match) {
      return {
        success: false,
        errorMsg: "MODULE_TYPE_NOT_FOUND",
        data: {
          name: String(rawEntry && rawEntry.name || ""),
        },
      };
    }

    resolvedEntries.push({
      itemType: itemLookup.match,
      quantity: Math.max(1, toInt(rawEntry && rawEntry.quantity, 1)),
      forceFit: rawEntry && rawEntry.forceFit === true,
    });
  }

  return {
    success: true,
    data: resolvedEntries,
  };
}

function resolvePresetCargoEntries(preset) {
  const resolvedEntries = [];
  for (const rawEntry of Array.isArray(preset && preset.cargo) ? preset.cargo : []) {
    const itemLookup = resolveItemByName(String(rawEntry && rawEntry.name || ""));
    if (!itemLookup || !itemLookup.success || !itemLookup.match) {
      return {
        success: false,
        errorMsg: "CARGO_TYPE_NOT_FOUND",
        data: {
          name: String(rawEntry && rawEntry.name || ""),
        },
      };
    }
    resolvedEntries.push({
      itemType: itemLookup.match,
      quantity: Math.max(1, toInt(rawEntry && rawEntry.quantity, 1)),
    });
  }

  return {
    success: true,
    data: resolvedEntries,
  };
}

function resolvePresetDroneBayEntries(preset) {
  const resolvedEntries = [];
  for (const rawEntry of Array.isArray(preset && preset.droneBay) ? preset.droneBay : []) {
    const itemLookup = resolveItemByName(String(rawEntry && rawEntry.name || ""));
    if (!itemLookup || !itemLookup.success || !itemLookup.match) {
      return {
        success: false,
        errorMsg: "DRONE_TYPE_NOT_FOUND",
        data: {
          name: String(rawEntry && rawEntry.name || ""),
        },
      };
    }

    resolvedEntries.push({
      itemType: itemLookup.match,
      quantity: Math.max(1, toInt(rawEntry && rawEntry.quantity, 1)),
    });
  }

  return {
    success: true,
    data: resolvedEntries,
  };
}

function resolvePresetPreloadCharges(preset) {
  const resolvedEntries = [];
  for (const rawEntry of Array.isArray(preset && preset.preloadCharges) ? preset.preloadCharges : []) {
    const moduleLookup = resolveItemByName(String(rawEntry && rawEntry.moduleName || ""));
    const chargeLookup = resolveItemByName(String(rawEntry && rawEntry.chargeName || ""));
    if (!moduleLookup || !moduleLookup.success || !moduleLookup.match) {
      return {
        success: false,
        errorMsg: "PRELOAD_MODULE_NOT_FOUND",
        data: {
          name: String(rawEntry && rawEntry.moduleName || ""),
        },
      };
    }
    if (!chargeLookup || !chargeLookup.success || !chargeLookup.match) {
      return {
        success: false,
        errorMsg: "PRELOAD_CHARGE_NOT_FOUND",
        data: {
          name: String(rawEntry && rawEntry.chargeName || ""),
        },
      };
    }

    resolvedEntries.push({
      moduleType: moduleLookup.match,
      chargeType: chargeLookup.match,
      quantity:
        rawEntry && rawEntry.fullClip === true
          ? null
          : Math.max(1, toInt(rawEntry && rawEntry.quantity, 1)),
      fullClip: rawEntry && rawEntry.fullClip === true,
    });
  }

  return {
    success: true,
    data: resolvedEntries,
  };
}

function resolvePreferredStagingLocationID(session) {
  const dockedLocationID = toInt(getDockedLocationID(session), 0);
  if (dockedLocationID > 0) {
    return dockedLocationID;
  }

  const characterRecord = getCharacterRecord(session && session.characterID) || {};
  return toInt(
    characterRecord.homeStationID ||
      characterRecord.cloneStationID ||
      session && (session.stationid || session.stationID) ||
      DEFAULT_HOME_STATION_ID,
    DEFAULT_HOME_STATION_ID,
  );
}

function buildPlannedFittedModuleItem(charID, shipItem, itemType, flagID, itemID) {
  return {
    itemID,
    typeID: toInt(itemType && itemType.typeID, 0),
    groupID: toInt(itemType && itemType.groupID, 0),
    categoryID: toInt(itemType && itemType.categoryID, 0),
    flagID: toInt(flagID, 0),
    locationID: toInt(shipItem && shipItem.itemID, 0),
    ownerID: toInt(charID, 0),
    singleton: 1,
    quantity: 1,
    stacksize: 1,
    itemName: String(itemType && itemType.name || ""),
    moduleState: {
      online: true,
    },
  };
}

function canPlannedModulesStayOnline(charID, shipItem, plannedModules) {
  const resourceState = buildShipResourceState(charID, shipItem, {
    fittedItems: plannedModules,
  });
  return {
    resourceState,
    success:
      resourceState.cpuLoad <= resourceState.cpuOutput + 1e-6 &&
      resourceState.powerLoad <= resourceState.powerOutput + 1e-6 &&
      resourceState.upgradeLoad <= resourceState.upgradeCapacity + 1e-6,
  };
}

function tryPlanNextModuleFit(charID, shipItem, itemType, fittedItems) {
  const nextFlagID = selectAutoFitFlagForType(
    shipItem,
    fittedItems,
    toInt(itemType && itemType.typeID, 0),
  );
  if (!nextFlagID) {
    return {
      success: false,
      errorMsg: "NO_SLOT_AVAILABLE",
    };
  }

  const probeItem = buildPlannedFittedModuleItem(
    charID,
    shipItem,
    itemType,
    nextFlagID,
    -1000 - (Array.isArray(fittedItems) ? fittedItems.length : 0),
  );
  const validation = validateFitForShip(
    charID,
    shipItem,
    probeItem,
    nextFlagID,
    fittedItems,
  );
  if (!validation.success && validation.errorMsg !== "SKILL_REQUIRED") {
    return validation;
  }

  const plannedItems = [...(Array.isArray(fittedItems) ? fittedItems : []), probeItem];
  const resourceCheck = canPlannedModulesStayOnline(charID, shipItem, plannedItems);
  if (!resourceCheck.success) {
    return {
      success: false,
      errorMsg:
        resourceCheck.resourceState.upgradeLoad >
        resourceCheck.resourceState.upgradeCapacity + 1e-6
          ? "NOT_ENOUGH_CALIBRATION"
          : resourceCheck.resourceState.cpuLoad >
            resourceCheck.resourceState.cpuOutput + 1e-6
            ? "NOT_ENOUGH_CPU"
            : "NOT_ENOUGH_POWER",
      data: {
        resourceState: resourceCheck.resourceState,
      },
    };
  }

  return {
    success: true,
    data: {
      flagID: nextFlagID,
      plannedItems,
      resourceState: resourceCheck.resourceState,
    },
  };
}

function fitGrantedItemTypeToShip(session, locationID, shipItem, itemType, count, options = {}) {
  const numericCount = Math.max(1, toInt(count, 1));
  const syncToSession = options.syncToSession !== false;
  const forceFit = options.forceFit === true;
  let fittedCount = 0;
  let forcedCount = 0;
  let latestResourceState = null;

  for (let index = 0; index < numericCount; index += 1) {
    const fittedItems = listFittedItems(session.characterID, shipItem.itemID);
    const nextFit = tryPlanNextModuleFit(
      session.characterID,
      shipItem,
      itemType,
      fittedItems,
    );
    let destinationFlagID =
      nextFit && nextFit.success && nextFit.data
        ? toInt(nextFit.data.flagID, 0)
        : 0;
    if (destinationFlagID <= 0 && forceFit) {
      destinationFlagID = toInt(
        selectAutoFitFlagForType(
          shipItem,
          fittedItems,
          toInt(itemType && itemType.typeID, 0),
        ),
        0,
      );
    }
    if (destinationFlagID <= 0) {
      return {
        success: false,
        errorMsg: (nextFit && nextFit.errorMsg) || "NO_SLOT_AVAILABLE",
        data: {
          fittedCount,
          forcedCount,
          resourceState: latestResourceState,
        },
      };
    }

    const moveResult = moveItemTypeFromCharacterLocation(
      session.characterID,
      locationID,
      ITEM_FLAGS.HANGAR,
      shipItem.itemID,
      destinationFlagID,
      itemType.typeID,
      1,
    );
    if (!moveResult.success) {
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "FIT_MOVE_FAILED",
        data: {
          fittedCount,
          forcedCount,
          resourceState: latestResourceState,
        },
      };
    }

    if (syncToSession) {
      syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
    }
    fittedCount += 1;
    if (!nextFit.success) {
      forcedCount += 1;
    } else {
      latestResourceState = nextFit.data.resourceState;
    }
  }

  return {
    success: true,
    data: {
      fittedCount,
      forcedCount,
      resourceState: latestResourceState,
    },
  };
}

function moveGrantedItemTypeToShipFlag(
  session,
  locationID,
  shipItem,
  destinationFlagID,
  itemType,
  quantity,
  options = {},
) {
  const moveResult = moveItemTypeFromCharacterLocation(
    session.characterID,
    locationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    destinationFlagID,
    itemType.typeID,
    quantity,
  );
  if (moveResult.success && options.syncToSession !== false) {
    syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
  }
  return moveResult;
}

function moveGrantedItemTypeToShipCargo(session, locationID, shipItem, itemType, quantity, options = {}) {
  return moveGrantedItemTypeToShipFlag(
    session,
    locationID,
    shipItem,
    ITEM_FLAGS.CARGO_HOLD,
    itemType,
    quantity,
    options,
  );
}

function moveGrantedItemTypeToShipDroneBay(session, locationID, shipItem, itemType, quantity, options = {}) {
  return moveGrantedItemTypeToShipFlag(
    session,
    locationID,
    shipItem,
    ITEM_FLAGS.DRONE_BAY,
    itemType,
    quantity,
    options,
  );
}

function loadGrantedChargeTypeIntoFirstMatchingModule(
  session,
  locationID,
  shipItem,
  moduleType,
  chargeType,
  quantity,
  options = {},
) {
  const fittedModules = listFittedItems(session.characterID, shipItem.itemID)
    .filter((item) => toInt(item && item.typeID, 0) === toInt(moduleType && moduleType.typeID, 0))
    .sort((left, right) => toInt(left && left.flagID, 0) - toInt(right && right.flagID, 0));
  const targetModule = fittedModules[0] || null;
  if (!targetModule) {
    return {
      success: false,
      errorMsg: "TARGET_MODULE_NOT_FITTED",
    };
  }

  const moduleCapacity = Math.max(
    1,
    toInt(
      getModuleChargeCapacity(
        toInt(targetModule.typeID, 0),
        toInt(chargeType && chargeType.typeID, 0),
      ),
      1,
    ),
  );
  const requestedQuantity = Math.max(1, toInt(quantity, 1));
  const loadQuantity = Math.min(moduleCapacity, requestedQuantity);

  const moveResult = moveItemTypeFromCharacterLocation(
    session.characterID,
    locationID,
    ITEM_FLAGS.HANGAR,
    shipItem.itemID,
    targetModule.flagID,
    chargeType.typeID,
    loadQuantity,
  );
  if (moveResult.success && options.syncToSession !== false) {
    syncInventoryChangesToSession(session, moveResult.data && moveResult.data.changes);
  }
  return moveResult;
}

function resolvePreloadChargeQuantity(preloadEntry) {
  if (!preloadEntry) {
    return 1;
  }
  if (preloadEntry.fullClip === true) {
    return Math.max(
      1,
      toInt(
        getModuleChargeCapacity(
          toInt(preloadEntry.moduleType && preloadEntry.moduleType.typeID, 0),
          toInt(preloadEntry.chargeType && preloadEntry.chargeType.typeID, 0),
        ),
        1,
      ),
    );
  }
  return Math.max(1, toInt(preloadEntry.quantity, 1));
}

function stagePresetShipForLocation(session, preset, locationID, options = {}) {
  const shipTypeResult = resolveShipTypeByPreset(preset);
  if (!shipTypeResult.success || !shipTypeResult.data) {
    return shipTypeResult;
  }

  const createResult = grantItemToCharacterLocation(
    session.characterID,
    locationID,
    ITEM_FLAGS.HANGAR,
    shipTypeResult.data,
    1,
  );
  if (!createResult.success || !createResult.data || !Array.isArray(createResult.data.items)) {
    return {
      success: false,
      errorMsg: createResult.errorMsg || "SHIP_CREATE_FAILED",
    };
  }
  const shipItem = createResult.data.items[0] || null;
  if (!shipItem) {
    return {
      success: false,
      errorMsg: "SHIP_CREATE_FAILED",
    };
  }

  const syncToSession = options.syncToSession !== false;
  if (syncToSession) {
    syncInventoryChangesToSession(session, createResult.data.changes);
  }

  const moduleResult = resolvePresetModuleEntries(preset);
  if (!moduleResult.success || !moduleResult.data) {
    return moduleResult;
  }
  const cargoResult = resolvePresetCargoEntries(preset);
  if (!cargoResult.success || !cargoResult.data) {
    return cargoResult;
  }
  const droneBayResult = resolvePresetDroneBayEntries(preset);
  if (!droneBayResult.success || !droneBayResult.data) {
    return droneBayResult;
  }
  const preloadResult = resolvePresetPreloadCharges(preset);
  if (!preloadResult.success || !preloadResult.data) {
    return preloadResult;
  }

  const cargoGrantQuantityByTypeID = new Map();
  for (const cargoEntry of cargoResult.data) {
    const currentQuantity = cargoGrantQuantityByTypeID.get(cargoEntry.itemType.typeID) || 0;
    cargoGrantQuantityByTypeID.set(
      cargoEntry.itemType.typeID,
      currentQuantity + cargoEntry.quantity,
    );
  }
  for (const preloadEntry of preloadResult.data) {
    const currentQuantity = cargoGrantQuantityByTypeID.get(preloadEntry.chargeType.typeID) || 0;
    cargoGrantQuantityByTypeID.set(
      preloadEntry.chargeType.typeID,
      currentQuantity + resolvePreloadChargeQuantity(preloadEntry),
    );
  }

  const grantItemTypesByTypeID = new Map();
  for (const cargoEntry of cargoResult.data) {
    grantItemTypesByTypeID.set(cargoEntry.itemType.typeID, cargoEntry.itemType);
  }
  for (const preloadEntry of preloadResult.data) {
    grantItemTypesByTypeID.set(preloadEntry.chargeType.typeID, preloadEntry.chargeType);
  }

  const grantEntries = [
    ...moduleResult.data.map((entry) => ({
      itemType: entry.itemType,
      quantity: entry.quantity,
    })),
    ...droneBayResult.data.map((entry) => ({
      itemType: entry.itemType,
      quantity: entry.quantity,
    })),
    ...[...cargoGrantQuantityByTypeID.entries()].map(([typeID, quantity]) => ({
      itemType: grantItemTypesByTypeID.get(typeID) || null,
      quantity,
    })),
  ].filter((entry) => entry && entry.itemType && entry.quantity > 0);

  const grantResult = grantItemsToCharacterStationHangar(
    session.characterID,
    locationID,
    grantEntries,
  );
  if (!grantResult.success) {
    return {
      success: false,
      errorMsg: grantResult.errorMsg || "GRANT_FAILED",
      data: {
        shipItem,
      },
    };
  }
  if (syncToSession) {
    syncInventoryChangesToSession(session, grantResult.data && grantResult.data.changes);
  }

  const fitSummaries = [];
  for (const moduleEntry of moduleResult.data) {
    const fitResult = fitGrantedItemTypeToShip(
      session,
      locationID,
      shipItem,
      moduleEntry.itemType,
      moduleEntry.quantity,
      {
        syncToSession,
        forceFit: moduleEntry.forceFit,
      },
    );
    if (!fitResult.success) {
      return {
        success: false,
        errorMsg: fitResult.errorMsg || "FIT_FAILED",
        data: {
          shipItem,
          fitSummaries,
        },
      };
    }
    fitSummaries.push({
      itemType: moduleEntry.itemType,
      quantity: moduleEntry.quantity,
      forceFit: moduleEntry.forceFit,
      forcedCount: fitResult.data && fitResult.data.forcedCount || 0,
    });
  }

  for (const cargoEntry of cargoResult.data) {
    const moveResult = moveGrantedItemTypeToShipCargo(
      session,
      locationID,
      shipItem,
      cargoEntry.itemType,
      cargoEntry.quantity,
      {
        syncToSession,
      },
    );
    if (!moveResult.success) {
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "CARGO_MOVE_FAILED",
        data: {
          shipItem,
          fitSummaries,
        },
      };
    }
  }

  for (const droneEntry of droneBayResult.data) {
    const moveResult = moveGrantedItemTypeToShipDroneBay(
      session,
      locationID,
      shipItem,
      droneEntry.itemType,
      droneEntry.quantity,
      {
        syncToSession,
      },
    );
    if (!moveResult.success) {
      return {
        success: false,
        errorMsg: moveResult.errorMsg || "DRONE_MOVE_FAILED",
        data: {
          shipItem,
          fitSummaries,
        },
      };
    }
  }

  const preloadSummaries = [];
  for (const preloadEntry of preloadResult.data) {
    const loadResult = loadGrantedChargeTypeIntoFirstMatchingModule(
      session,
      locationID,
      shipItem,
      preloadEntry.moduleType,
      preloadEntry.chargeType,
      resolvePreloadChargeQuantity(preloadEntry),
      {
        syncToSession,
      },
    );
    if (!loadResult.success) {
      return {
        success: false,
        errorMsg: loadResult.errorMsg || "PRELOAD_FAILED",
        data: {
          shipItem,
          fitSummaries,
          preloadSummaries,
        },
      };
    }
    preloadSummaries.push({
      moduleType: preloadEntry.moduleType,
      chargeType: preloadEntry.chargeType,
      quantity: preloadEntry.quantity,
    });
  }

  return {
    success: true,
    data: {
      shipItem,
      fitSummaries,
      preloadSummaries,
      shipType: shipTypeResult.data,
      locationID,
    },
  };
}

function boardDockedPreparedShip(session, shipItem) {
  const activationResult = activateShipForSession(session, shipItem.itemID, {
    emitNotifications: true,
    logSelection: false,
  });
  return {
    success: activationResult.success === true,
    activeShip: activationResult.activeShip || getActiveShipRecord(session.characterID),
    errorMsg: activationResult.errorMsg || null,
  };
}

function buildDockedResultMessage(preset, shipItem, fitSummaries = []) {
  const fitText = fitSummaries
    .map((entry) => {
      const forcedText = entry && entry.forcedCount > 0
        ? ` (${entry.forcedCount} forced)`
        : "";
      return `${entry.quantity}x ${entry.itemType.name}${forcedText}`;
    })
    .join(", ");
  return [
    `Spawned ${preset.shipName} ${shipItem.itemID} in your hangar.`,
    fitText ? `Fitted ${fitText}.` : null,
    "Boarded the prepared hull in station.",
  ].filter(Boolean).join(" ");
}

function buildSpaceResultMessage(preset, shipItem, fitSummaries = [], destroyResult = null) {
  const fitText = fitSummaries
    .map((entry) => {
      const forcedText = entry && entry.forcedCount > 0
        ? ` (${entry.forcedCount} forced)`
        : "";
      return `${entry.quantity}x ${entry.itemType.name}${forcedText}`;
    })
    .join(", ");
  const actionText =
    destroyResult && destroyResult.destroyedShipID
      ? `Destroyed ship ${destroyResult.destroyedShipID} and boarded`
      : "Boarded";
  return [
    `${actionText} a new ${preset.shipName} in space as ship ${shipItem.itemID}.`,
    fitText ? `Fitted ${fitText}.` : null,
  ].filter(Boolean).join(" ");
}

function handleDevCommandShip(session, presetKey) {
  const preset = resolveDevCommandShipPreset(presetKey);
  if (!preset) {
    return {
      success: false,
      message: "Unknown developer ship preset.",
    };
  }

  if (!session || !session.characterID) {
    return {
      success: false,
      message: `Select a character before using ${preset.commandName}.`,
    };
  }

  const docked = isDockedSession(session) || toInt(getDockedLocationID(session), 0) > 0;
  const inSpace = Boolean(session && session._space && session._space.systemID);
  if (!docked && !inSpace) {
    return {
      success: false,
      message: `${preset.commandName} requires a docked or in-space character session.`,
    };
  }

  const stagingLocationID = resolvePreferredStagingLocationID(session);
  if (stagingLocationID <= 0) {
    return {
      success: false,
      message: `Could not resolve a staging location for ${preset.commandName}.`,
    };
  }

  const stageResult = stagePresetShipForLocation(
    session,
    preset,
    stagingLocationID,
    {
      syncToSession: docked,
    },
  );
  if (!stageResult.success || !stageResult.data || !stageResult.data.shipItem) {
    return {
      success: false,
      message: `${preset.commandName} failed while preparing the hull: ${stageResult.errorMsg || "PREP_FAILED"}.`,
    };
  }

  if (docked) {
    const boardResult = boardDockedPreparedShip(session, stageResult.data.shipItem);
    if (!boardResult.success) {
      return {
        success: false,
        message: `${preset.commandName} prepared the hull, but boarding failed: ${boardResult.errorMsg || "BOARD_FAILED"}.`,
      };
    }
    return {
      success: true,
      message: buildDockedResultMessage(
        preset,
        stageResult.data.shipItem,
        stageResult.data.fitSummaries,
      ),
    };
  }

  const spaceBoardResult = boardPreparedShipInSpace(session, stageResult.data.shipItem);
  if (!spaceBoardResult.success) {
    return {
      success: false,
      message: `${preset.commandName} prepared the hull, but the in-space swap failed: ${spaceBoardResult.errorMsg || "SPACE_SWAP_FAILED"}.`,
    };
  }

  return {
    success: true,
    message: buildSpaceResultMessage(
      preset,
      stageResult.data.shipItem,
      stageResult.data.fitSummaries,
      spaceBoardResult.data && spaceBoardResult.data.destroyResult,
    ),
  };
}

function handleOrcaCommand(session) {
  return handleDevCommandShip(session, "orca");
}

function handleProbeCommand(session) {
  return handleDevCommandShip(session, "probe");
}

function handleProbe2Command(session) {
  return handleDevCommandShip(session, "probe2");
}

function handleCburstCommand(session) {
  return handleDevCommandShip(session, "cburst");
}

function handleGuardianCommand(session) {
  return handleDevCommandShip(session, "guardian");
}

function handleBasiliskCommand(session) {
  return handleDevCommandShip(session, "basilisk");
}

function handleEwarCommand(session) {
  return handleDevCommandShip(session, "ewar");
}

function handleTrigCommand(session, argumentText = "") {
  const presetKey = resolveTrigCommandPresetKey(argumentText);
  if (!presetKey) {
    return {
      success: false,
      message: "Usage: /trig [damavik|nergal|kikimora|draugur|vedmak|rodiva|ikitursa|zarmazd|drekavac|leshak|zirnitra|light|heavy|supratidal|ultratidal].",
    };
  }
  return handleDevCommandShip(session, presetKey);
}

module.exports = {
  DEV_COMMAND_SHIP_PRESETS,
  TRIG_COMMAND_PRESET_KEYS,
  resolveDevCommandShipPreset,
  resolveTrigCommandPresetKey,
  buildStoppedSpawnStateNearEntity,
  boardPreparedShipInSpace,
  fitGrantedItemTypeToShip,
  moveGrantedItemTypeToShipCargo,
  moveGrantedItemTypeToShipDroneBay,
  loadGrantedChargeTypeIntoFirstMatchingModule,
  handleDevCommandShip,
  handleCburstCommand,
  handleOrcaCommand,
  handleProbeCommand,
  handleProbe2Command,
  handleGuardianCommand,
  handleBasiliskCommand,
  handleEwarCommand,
  handleTrigCommand,
};
