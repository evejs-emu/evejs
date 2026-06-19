const fs = require("fs");
const path = require("path");

const config = require(path.join(__dirname, "../../server/src/config"));

const rootDir = path.resolve(__dirname, "../..");
const dataRoot = path.join(rootDir, "server/src/newDatabase/data");

const GROUP_ORDER = [
  "Basics",
  "Structures & Safety",
  "Client Compatibility",
  "Network",
  "Market & Services",
  "HyperNet",
  "World & Performance",
  "NPC & Crimewatch",
  "Advanced",
];

const UI_METADATA = {
  devMode: {
    group: "Basics",
    label: "Developer Mode",
    control: "boolean",
  },
  upwellGmBypassRestrictions: {
    group: "Structures & Safety",
    label: "Upwell GM Bypass Restrictions",
    control: "boolean",
  },
  upwellTimerScale: {
    group: "Structures & Safety",
    label: "Upwell Timer Scale",
    control: "number",
  },
  logLevel: {
    group: "Basics",
    label: "Server Log Level",
    control: "select",
    options: [
      {
        value: 0,
        label: "0 - Silent",
      },
      {
        value: 1,
        label: "1 - Normal logging",
      },
      {
        value: 2,
        label: "2 - Verbose debug",
      },
    ],
  },
  omegaLicenseEnabled: {
    group: "Basics",
    label: "Omega License Flow",
    control: "boolean",
  },
  clientVersion: {
    group: "Client Compatibility",
    label: "Client Version",
    control: "number",
  },
  clientBuild: {
    group: "Client Compatibility",
    label: "Client Build",
    control: "number",
  },
  eveBirthday: {
    group: "Client Compatibility",
    label: "EVE Birthday",
    control: "number",
  },
  machoVersion: {
    group: "Client Compatibility",
    label: "MachoNet Version",
    control: "number",
  },
  projectCodename: {
    group: "Client Compatibility",
    label: "Project Codename",
    control: "text",
  },
  projectRegion: {
    group: "Client Compatibility",
    label: "Project Region",
    control: "text",
  },
  projectVersion: {
    group: "Client Compatibility",
    label: "Project Version String",
    control: "text",
  },
  defaultCountryCode: {
    group: "Client Compatibility",
    label: "Default Country Code",
    control: "text",
  },
  proxyNodeId: {
    group: "Client Compatibility",
    label: "Proxy Node ID",
    control: "number",
  },
  serverPort: {
    group: "Network",
    label: "Server TCP Port",
    control: "number",
  },
  imageServerUrl: {
    group: "Network",
    label: "Image Server URL",
    control: "text",
  },
  microservicesRedirectUrl: {
    group: "Network",
    label: "Microservices Redirect URL",
    control: "text",
  },
  xmppServerPort: {
    group: "Network",
    label: "XMPP Server Port",
    control: "number",
  },
  marketDaemonHost: {
    group: "Market & Services",
    label: "Market Daemon Host",
    control: "text",
  },
  marketDaemonPort: {
    group: "Market & Services",
    label: "Market Daemon Port",
    control: "number",
  },
  marketDaemonConnectTimeoutMs: {
    group: "Market & Services",
    label: "Market Daemon Connect Timeout (ms)",
    control: "number",
  },
  marketDaemonRequestTimeoutMs: {
    group: "Market & Services",
    label: "Market Daemon Request Timeout (ms)",
    control: "number",
  },
  marketDaemonRetryDelayMs: {
    group: "Market & Services",
    label: "Market Daemon Retry Delay (ms)",
    control: "number",
  },
  hyperNetKillSwitch: {
    group: "HyperNet",
    label: "HyperNet Kill Switch",
    control: "boolean",
  },
  hyperNetPlexPriceOverride: {
    group: "HyperNet",
    label: "HyperNet PLEX Price Override",
    control: "number",
  },
  hyperNetDevAutoGrantCores: {
    group: "HyperNet",
    label: "HyperNet Dev Auto-Grant Cores",
    control: "boolean",
  },
  hyperNetSeedEnabled: {
    group: "HyperNet",
    label: "HyperNet Startup Seeding",
    control: "boolean",
  },
  hyperNetSeedOwnerId: {
    group: "HyperNet",
    label: "HyperNet Seed Owner ID",
    control: "number",
  },
  hyperNetSeedRestockEnabled: {
    group: "HyperNet",
    label: "HyperNet Seed Restock",
    control: "boolean",
  },
  hyperNetSeedMinShips: {
    group: "HyperNet",
    label: "HyperNet Seed Minimum Ships",
    control: "number",
  },
  hyperNetSeedMaxShips: {
    group: "HyperNet",
    label: "HyperNet Seed Maximum Ships",
    control: "number",
  },
  hyperNetSeedMinItems: {
    group: "HyperNet",
    label: "HyperNet Seed Minimum Items",
    control: "number",
  },
  hyperNetSeedMaxItems: {
    group: "HyperNet",
    label: "HyperNet Seed Maximum Items",
    control: "number",
  },
  spaceDebrisLifetimeMs: {
    group: "World & Performance",
    label: "Space Debris Lifetime (ms)",
    control: "number",
  },
  tidiAutoscaler: {
    group: "World & Performance",
    label: "Time Dilation Autoscaler",
    control: "boolean",
  },
  NewEdenSystemLoading: {
    group: "World & Performance",
    label: "New Eden Startup Loading",
    control: "select",
    options: [
      {
        value: 1,
        label: "1 - Lazy boot (Jita + New Caldari)",
      },
      {
        value: 2,
        label: "2 - Preload all high-sec systems",
      },
      {
        value: 3,
        label: "3 - Preload every system in New Eden",
      },
      {
        value: 4,
        label: "4 - OnGoingLazy (lazy preload, all gates active)",
      },
    ],
  },
  asteroidFieldsEnabled: {
    group: "World & Performance",
    label: "Generated Asteroid Fields",
    control: "boolean",
  },
  npcAuthoredStartupEnabled: {
    group: "NPC & Crimewatch",
    label: "Authored NPC Startup Rules",
    control: "boolean",
  },
  npcDefaultConcordStartupEnabled: {
    group: "NPC & Crimewatch",
    label: "Default CONCORD Gate Coverage",
    control: "boolean",
  },
  npcDefaultConcordGateAutoAggroNpcsEnabled: {
    group: "NPC & Crimewatch",
    label: "Gate CONCORD Auto-Aggro NPCs",
    control: "boolean",
  },
  npcDefaultConcordStationScreensEnabled: {
    group: "NPC & Crimewatch",
    label: "CONCORD Station Screens",
    control: "boolean",
  },
  crimewatchConcordResponseEnabled: {
    group: "NPC & Crimewatch",
    label: "Crimewatch CONCORD Response",
    control: "boolean",
  },
  crimewatchConcordPodKillEnabled: {
    group: "NPC & Crimewatch",
    label: "Crimewatch CONCORD Pod Kill",
    control: "boolean",
  },
};

const PLAYER_TABLE_PATHS = {
  accounts: path.join(dataRoot, "accounts/data.json"),
  characters: path.join(dataRoot, "characters/data.json"),
  skills: path.join(dataRoot, "skills/data.json"),
  items: path.join(dataRoot, "items/data.json"),
};

const TYPE_TABLE_PATHS = {
  itemTypes: path.join(dataRoot, "itemTypes/data.json"),
  shipTypes: path.join(dataRoot, "shipTypes/data.json"),
  skillTypes: path.join(dataRoot, "skillTypes/data.json"),
};

function humanizeKey(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (firstChar) => firstChar.toUpperCase());
}

function inferGroup(entry, metadata = {}) {
  if (metadata.group) {
    return metadata.group;
  }

  const key = String(entry && entry.key || "");
  if (key.startsWith("upwell")) {
    return "Structures & Safety";
  }
  if (key.startsWith("marketDaemon")) {
    return "Market & Services";
  }
  if (key.startsWith("hyperNet")) {
    return "HyperNet";
  }
  if (key.startsWith("npc") || key.startsWith("crimewatch")) {
    return "NPC & Crimewatch";
  }
  if (
    [
      "clientVersion",
      "clientBuild",
      "eveBirthday",
      "machoVersion",
      "projectCodename",
      "projectRegion",
      "projectVersion",
      "defaultCountryCode",
      "proxyNodeId",
    ].includes(key)
  ) {
    return "Client Compatibility";
  }
  if (
    [
      "serverPort",
      "imageServerUrl",
      "microservicesRedirectUrl",
      "xmppServerPort",
    ].includes(key)
  ) {
    return "Network";
  }
  if (
    [
      "spaceDebrisLifetimeMs",
      "tidiAutoscaler",
      "NewEdenSystemLoading",
      "asteroidFieldsEnabled",
    ].includes(key)
  ) {
    return "World & Performance";
  }
  if (["devMode", "logLevel", "omegaLicenseEnabled"].includes(key)) {
    return "Basics";
  }
  return "Advanced";
}

function formatSelectOptionLabel(entry, value) {
  const key = String(entry && entry.key || "");
  if (key === "logLevel") {
    if (Number(value) === 0) {
      return "0 - Silent";
    }
    if (Number(value) === 1) {
      return "1 - Normal logging";
    }
    if (Number(value) === 2) {
      return "2 - Verbose debug";
    }
  }
  if (key === "NewEdenSystemLoading") {
    if (Number(value) === 1) {
      return "1 - Lazy boot (Jita + New Caldari)";
    }
    if (Number(value) === 2) {
      return "2 - Preload all high-sec systems";
    }
    if (Number(value) === 3) {
      return "3 - Preload every system in New Eden";
    }
    if (Number(value) === 4) {
      return "4 - OnGoingLazy (lazy preload, all gates active)";
    }
  }
  return String(value);
}

function buildControlOptions(entry, metadata = {}) {
  if (Array.isArray(metadata.options) && metadata.options.length > 0) {
    return metadata.options.map((option) => ({
      value: option.value,
      label: option.label,
    }));
  }
  if (Array.isArray(entry.allowedValues) && entry.allowedValues.length > 0) {
    return entry.allowedValues.map((value) => ({
      value,
      label: formatSelectOptionLabel(entry, value),
    }));
  }
  return [];
}

function inferControl(entry, metadata) {
  if (metadata.control) {
    return metadata.control;
  }
  if (Array.isArray(metadata.options) && metadata.options.length > 0) {
    return "select";
  }
  if (Array.isArray(entry.allowedValues) && entry.allowedValues.length > 0) {
    return "select";
  }
  if (entry.valueType === "boolean") {
    return "boolean";
  }
  if (entry.valueType === "number") {
    return "number";
  }
  return "text";
}

function buildConfigEntries(snapshot) {
  return config
    .getConfigDefinitions()
    .map((entry, index) => {
      const metadata = UI_METADATA[entry.key] || {};
      const description = Array.isArray(entry.description)
        ? entry.description
        : [entry.description];
      const options = buildControlOptions(entry, metadata);
      const control = inferControl(entry, {
        ...metadata,
        options,
      });
      return {
        key: entry.key,
        label: metadata.label || humanizeKey(entry.key),
        group: inferGroup(entry, metadata),
        order: index,
        control,
        options,
        valueType: entry.valueType,
        defaultValue: snapshot.defaults[entry.key],
        fileValue: snapshot.fileConfig[entry.key],
        currentValue: snapshot.resolvedConfig[entry.key],
        localValue: snapshot.localRawConfig[entry.key],
        sharedValue: snapshot.sharedRawConfig[entry.key],
        source: snapshot.sources[entry.key],
        envVar: entry.envVar || null,
        envOverrideValue: Object.prototype.hasOwnProperty.call(
          snapshot.envConfig,
          entry.key,
        )
          ? snapshot.envConfig[entry.key]
          : null,
        validValues: entry.validValues,
        description,
      };
    })
    .sort((left, right) => {
      const leftGroupIndex = GROUP_ORDER.indexOf(left.group);
      const rightGroupIndex = GROUP_ORDER.indexOf(right.group);
      const normalizedLeftGroupIndex =
        leftGroupIndex === -1 ? GROUP_ORDER.length : leftGroupIndex;
      const normalizedRightGroupIndex =
        rightGroupIndex === -1 ? GROUP_ORDER.length : rightGroupIndex;

      if (normalizedLeftGroupIndex !== normalizedRightGroupIndex) {
        return normalizedLeftGroupIndex - normalizedRightGroupIndex;
      }

      return left.order - right.order;
    });
}

function buildGroupOrder(entries = []) {
  const usedGroups = new Set(
    entries
      .map((entry) => String(entry && entry.group || "").trim())
      .filter(Boolean),
  );
  const orderedGroups = GROUP_ORDER.filter((group) => usedGroups.has(group));
  const additionalGroups = [...usedGroups]
    .filter((group) => !GROUP_ORDER.includes(group))
    .sort();
  return [
    ...orderedGroups,
    ...additionalGroups,
  ];
}

function buildConfigExportPayload(snapshot = config.getConfigStateSnapshot()) {
  const entries = buildConfigEntries(snapshot);
  const environmentOverrides = Object.keys(snapshot.envConfig);
  return {
    generatedAt: new Date().toISOString(),
    groupOrder: buildGroupOrder(entries),
    paths: {
      repoRoot: snapshot.rootDir,
      sharedConfigPath: snapshot.sharedConfigPath,
      localConfigPath: snapshot.localConfigPath,
    },
    environmentOverrides,
    notes:
      environmentOverrides.length > 0
        ? [
            "Some settings are currently overridden by EVEJS_* environment variables.",
            "Saving still updates evejs.config.local.json, but runtime will keep using the environment value until that override is removed.",
          ]
        : [],
    entries,
  };
}

function readJsonFromStdin() {
  const input = fs.readFileSync(0, "utf8").trim();
  if (input === "") {
    return {};
  }
  return JSON.parse(input);
}

function saveConfig() {
  const payload = readJsonFromStdin();
  const values =
    payload && typeof payload === "object" && !Array.isArray(payload) && payload.values
      ? payload.values
      : payload;
  const snapshot = config.saveLocalConfig(values);
  return buildConfigExportPayload(snapshot);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function detectRecordId(record) {
  if (!isPlainObject(record)) {
    return null;
  }

  for (const key of [
    "stationID",
    "solarSystemID",
    "corporationID",
    "typeID",
    "itemID",
    "characterID",
    "id",
  ]) {
    if (record[key] !== undefined && record[key] !== null) {
      return String(record[key]);
    }
  }

  return null;
}

function mapArrayRecords(records) {
  return Object.fromEntries(
    records
      .map((record) => [detectRecordId(record), record])
      .filter(([key, value]) => typeof key === "string" && key !== "" && isPlainObject(value)),
  );
}

function getRecordMap(data) {
  if (isPlainObject(data.records)) {
    return data.records;
  }

  for (const collectionKey of ["stations", "solarSystems", "shipTypes", "corporations"]) {
    if (Array.isArray(data?.[collectionKey])) {
      return mapArrayRecords(data[collectionKey]);
    }
  }

  const arrayValue = Object.values(data || {}).find((value) => Array.isArray(value));
  if (Array.isArray(arrayValue)) {
    return mapArrayRecords(arrayValue);
  }

  return Object.fromEntries(
    Object.entries(data || {}).filter(
      ([key, value]) =>
        !["source", "_meta"].includes(key) && isPlainObject(value),
    ),
  );
}

function getReferenceName(record, preferredKeys) {
  if (!isPlainObject(record)) {
    return null;
  }

  for (const key of preferredKeys) {
    if (typeof record[key] === "string" && record[key].trim() !== "") {
      return record[key];
    }
  }

  return null;
}

function loadReferenceMaps() {
  const corporations = getRecordMap(
    readJsonFile(path.join(dataRoot, "corporations/data.json")),
  );
  const stations = getRecordMap(
    readJsonFile(path.join(dataRoot, "stations/data.json")),
  );
  const solarSystems = getRecordMap(
    readJsonFile(path.join(dataRoot, "solarSystems/data.json")),
  );
  const shipTypes = getRecordMap(
    readJsonFile(path.join(dataRoot, "shipTypes/data.json")),
  );

  return {
    corporationNames: Object.fromEntries(
      Object.entries(corporations).map(([key, value]) => [
        key,
        getReferenceName(value, ["corporationName", "name"]) || key,
      ]),
    ),
    stationNames: Object.fromEntries(
      Object.entries(stations).map(([key, value]) => [
        key,
        getReferenceName(value, ["stationName", "name"]) || key,
      ]),
    ),
    solarSystemNames: Object.fromEntries(
      Object.entries(solarSystems).map(([key, value]) => [
        key,
        getReferenceName(value, ["solarSystemName", "name"]) || key,
      ]),
    ),
    shipTypeNames: Object.fromEntries(
      Object.entries(shipTypes).map(([key, value]) => [
        key,
        getReferenceName(value, ["typeName", "name"]) || key,
      ]),
    ),
  };
}

function loadPlayerTables() {
  const accounts = readJsonFile(PLAYER_TABLE_PATHS.accounts);
  const characters = readJsonFile(PLAYER_TABLE_PATHS.characters);
  const skills = readJsonFile(PLAYER_TABLE_PATHS.skills);
  const items = readJsonFile(PLAYER_TABLE_PATHS.items);

  return {
    accounts,
    characters,
    skills,
    items,
  };
}

function loadTypeTables() {
  const itemTypesPayload = readJsonFile(TYPE_TABLE_PATHS.itemTypes);
  const shipTypesPayload = readJsonFile(TYPE_TABLE_PATHS.shipTypes);
  const skillTypesPayload = readJsonFile(TYPE_TABLE_PATHS.skillTypes);

  return {
    itemTypes: Array.isArray(itemTypesPayload?.types) ? itemTypesPayload.types : [],
    shipTypes: Array.isArray(shipTypesPayload?.ships) ? shipTypesPayload.ships : [],
    skillTypes: Array.isArray(skillTypesPayload?.skills) ? skillTypesPayload.skills : [],
  };
}

function buildAccountMaps(accounts) {
  const accountEntries = Object.entries(accounts || {});
  const accountKeyById = new Map();
  const accountById = new Map();

  for (const [accountKey, account] of accountEntries) {
    const normalizedId = String(account?.id ?? "");
    if (normalizedId !== "") {
      accountKeyById.set(normalizedId, accountKey);
      accountById.set(normalizedId, account);
    }
  }

  return {
    accountEntries,
    accountKeyById,
    accountById,
  };
}

function formatLocationLabel(characterId, item, itemsById, references) {
  const locationId = item?.locationID;
  const normalizedLocationId = String(locationId ?? "");
  if (normalizedLocationId === "") {
    return "Unknown location";
  }

  if (normalizedLocationId === String(characterId)) {
    return "Character inventory";
  }

  const parentItem = itemsById.get(normalizedLocationId);
  if (parentItem) {
    return parentItem.itemName || parentItem.shipName || `Inside item ${normalizedLocationId}`;
  }

  if (references.stationNames[normalizedLocationId]) {
    return references.stationNames[normalizedLocationId];
  }
  if (references.solarSystemNames[normalizedLocationId]) {
    return references.solarSystemNames[normalizedLocationId];
  }

  return normalizedLocationId;
}

function buildPlayerSummary(
  characterId,
  character,
  accountKey,
  account,
  characterSkills,
  characterItems,
  references,
) {
  const corporationName =
    references.corporationNames[String(character?.corporationID ?? "")] ||
    (character?.corporationID ? String(character.corporationID) : "Unknown");
  const stationName =
    references.stationNames[String(character?.stationID ?? "")] ||
    (character?.stationID ? String(character.stationID) : "Unknown");
  const solarSystemName =
    references.solarSystemNames[String(character?.solarSystemID ?? "")] ||
    (character?.solarSystemID ? String(character.solarSystemID) : "Unknown");
  const shipName =
    character?.shipName ||
    references.shipTypeNames[String(character?.shipTypeID ?? "")] ||
    "Unknown ship";
  const itemCount = characterItems.length;
  const shipCount = characterItems.filter(
    (item) => Number(item?.categoryID) === 6,
  ).length;
  const skillCount = Object.keys(characterSkills || {}).length;
  const warningMessages = [];

  if (String(characterId) === "140000001") {
    warningMessages.push("Placeholder character. Deleting or corrupting it can break the server.");
  }
  if (character?.characterName === "DO NOT DELETE") {
    warningMessages.push("This character is intentionally marked DO NOT DELETE.");
  }

  const searchText = [
    character?.characterName,
    accountKey,
    shipName,
    stationName,
    solarSystemName,
    corporationName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    characterId: String(characterId),
    characterName: character?.characterName || `Character ${characterId}`,
    accountId: character?.accountId ?? null,
    accountName: accountKey || "Unknown account",
    banned: Boolean(account?.banned),
    corporationName,
    stationName,
    solarSystemName,
    shipName,
    shipTypeID: character?.shipTypeID ?? null,
    balance: character?.balance ?? 0,
    plexBalance: character?.plexBalance ?? 0,
    aurBalance: character?.aurBalance ?? 0,
    skillPoints: character?.skillPoints ?? 0,
    securityStatus: character?.securityStatus ?? 0,
    itemCount,
    shipCount,
    skillCount,
    warningMessages,
    searchText,
  };
}

function buildSkillList(skillMap) {
  return Object.entries(skillMap || {})
    .map(([skillKey, skill]) => ({
      skillKey: String(skillKey),
      typeID: skill?.typeID ?? Number(skillKey),
      itemName: skill?.itemName || `Skill ${skillKey}`,
      groupName: skill?.groupName || "",
      groupID: skill?.groupID ?? null,
      skillRank: skill?.skillRank ?? 1,
      skillLevel: skill?.skillLevel ?? 0,
      trainedSkillLevel: skill?.trainedSkillLevel ?? 0,
      effectiveSkillLevel: skill?.effectiveSkillLevel ?? 0,
      skillPoints: skill?.skillPoints ?? 0,
      inTraining: Boolean(skill?.inTraining),
      raw: cloneValue(skill),
    }))
    .sort((left, right) => {
      const nameComparison = left.itemName.localeCompare(right.itemName);
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.skillKey.localeCompare(right.skillKey);
    });
}

function buildItemList(characterId, items, references) {
  const itemsById = new Map(items.map((item) => [String(item.itemID), item]));
  return items
    .map((item) => ({
      itemKey: String(item.itemID),
      typeID: item?.typeID ?? null,
      itemName: item?.itemName || item?.shipName || `Item ${item?.itemID}`,
      typeName:
        item?.itemName ||
        references.shipTypeNames[String(item?.typeID ?? "")] ||
        `Type ${item?.typeID ?? "unknown"}`,
      quantity: item?.quantity ?? null,
      stacksize: item?.stacksize ?? null,
      categoryID: item?.categoryID ?? null,
      groupID: item?.groupID ?? null,
      locationLabel: formatLocationLabel(characterId, item, itemsById, references),
      raw: cloneValue(item),
    }))
    .sort((left, right) => {
      const nameComparison = left.itemName.localeCompare(right.itemName);
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.itemKey.localeCompare(right.itemKey);
    });
}

function buildSkillCatalog(skillsTable) {
  const catalog = new Map();

  for (const skillMap of Object.values(skillsTable || {})) {
    for (const [skillKey, skill] of Object.entries(skillMap || {})) {
      const normalizedSkillKey = String(skillKey);
      if (!catalog.has(normalizedSkillKey)) {
        catalog.set(normalizedSkillKey, {
          skillKey: normalizedSkillKey,
          typeID: skill?.typeID ?? Number(normalizedSkillKey),
          itemName: skill?.itemName || `Skill ${normalizedSkillKey}`,
          groupName: skill?.groupName || "",
          groupID: skill?.groupID ?? null,
          skillRank: skill?.skillRank ?? 1,
          published: skill?.published ?? true,
        });
      }
    }
  }

  return [...catalog.values()].sort((left, right) => {
    const groupComparison = (left.groupName || "").localeCompare(right.groupName || "");
    if (groupComparison !== 0) {
      return groupComparison;
    }
    const nameComparison = left.itemName.localeCompare(right.itemName);
    if (nameComparison !== 0) {
      return nameComparison;
    }
    return left.skillKey.localeCompare(right.skillKey);
  });
}

function buildShipCatalog(shipTypes) {
  return shipTypes
    .filter((ship) => Boolean(ship?.published))
    .map((ship) => ({
      typeID: ship.typeID,
      name: ship.name || `Ship ${ship.typeID}`,
      groupID: ship.groupID ?? null,
      groupName: ship.groupName || "",
      categoryID: ship.categoryID ?? 6,
      mass: ship.mass ?? 0,
      volume: ship.volume ?? 0,
      capacity: ship.capacity ?? 0,
      radius: ship.radius ?? 0,
      raceID: ship.raceID ?? null,
      basePrice: ship.basePrice ?? null,
      published: Boolean(ship?.published),
    }))
    .sort((left, right) => {
      const groupComparison = (left.groupName || "").localeCompare(right.groupName || "");
      if (groupComparison !== 0) {
        return groupComparison;
      }
      return left.name.localeCompare(right.name);
    });
}

function buildItemTypeSearchResults(itemTypes, queryText, limit = 80) {
  const normalizedQuery = String(queryText || "").trim().toLowerCase();
  const publishedTypes = itemTypes.filter(
    (type) => Boolean(type?.published) && Number(type?.categoryID ?? 0) !== 6,
  );

  const scored = publishedTypes
    .map((type) => {
      const name = type?.name || `Type ${type?.typeID}`;
      const groupName = type?.groupName || "";
      const haystack = `${name} ${groupName}`.toLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) {
        return null;
      }
      const exactName = normalizedQuery && name.toLowerCase() === normalizedQuery ? 0 : 1;
      const startsWith = normalizedQuery && name.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      return {
        score: `${exactName}${startsWith}${name}`,
        typeID: type.typeID,
        name,
        groupID: type.groupID ?? null,
        groupName,
        categoryID: type.categoryID ?? null,
        volume: type.volume ?? 0,
        capacity: type.capacity ?? 0,
        radius: type.radius ?? 0,
        mass: type.mass ?? 0,
        portionSize: type.portionSize ?? 1,
        basePrice: type.basePrice ?? null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.score.localeCompare(right.score))
    .slice(0, limit);

  return scored.map(({ score, ...entry }) => entry);
}

function buildNextItemIdSeed(itemsTable) {
  let maxItemId = 990000000;
  for (const item of Object.values(itemsTable || {})) {
    const itemId = Number(item?.itemID ?? 0);
    if (Number.isFinite(itemId) && itemId > maxItemId) {
      maxItemId = itemId;
    }
  }
  return maxItemId + 1;
}

function buildPlayerList(tables, references) {
  const { accounts, characters, skills, items } = tables;
  const { accountKeyById, accountById } = buildAccountMaps(accounts);
  const itemsByOwnerId = new Map();

  for (const item of Object.values(items || {})) {
    const ownerId = String(item?.ownerID ?? "");
    if (ownerId === "") {
      continue;
    }
    if (!itemsByOwnerId.has(ownerId)) {
      itemsByOwnerId.set(ownerId, []);
    }
    itemsByOwnerId.get(ownerId).push(item);
  }

  return Object.entries(characters || {})
    .map(([characterId, character]) => {
      const accountId = String(character?.accountId ?? "");
      const accountKey = accountKeyById.get(accountId) || "";
      const account = accountById.get(accountId) || null;
      const characterSkills = isPlainObject(skills?.[characterId])
        ? skills[characterId]
        : {};
      const characterItems = itemsByOwnerId.get(String(characterId)) || [];
      return buildPlayerSummary(
        characterId,
        character,
        accountKey,
        account,
        characterSkills,
        characterItems,
        references,
      );
    })
    .sort((left, right) => {
      const nameComparison = left.characterName.localeCompare(right.characterName);
      if (nameComparison !== 0) {
        return nameComparison;
      }
      return left.characterId.localeCompare(right.characterId);
    });
}

function buildPlayerDetail(characterId, tables, references) {
  const normalizedCharacterId = String(characterId);
  const character = tables.characters?.[normalizedCharacterId];
  if (!isPlainObject(character)) {
    throw new Error(`Character ${normalizedCharacterId} was not found.`);
  }

  const { accountKeyById, accountById } = buildAccountMaps(tables.accounts);
  const accountId = String(character?.accountId ?? "");
  const accountKey = accountKeyById.get(accountId) || "";
  const account = accountById.get(accountId);
  if (!accountKey || !isPlainObject(account)) {
    throw new Error(`Account ${accountId || "unknown"} for character ${normalizedCharacterId} was not found.`);
  }

  const skills = isPlainObject(tables.skills?.[normalizedCharacterId])
    ? tables.skills[normalizedCharacterId]
    : {};
  const items = Object.values(tables.items || {}).filter(
    (item) => String(item?.ownerID ?? "") === normalizedCharacterId,
  );
  const summary = buildPlayerSummary(
    normalizedCharacterId,
    character,
    accountKey,
    account,
    skills,
    items,
    references,
  );

  return {
    summary,
    originalAccountKey: accountKey,
    accountName: accountKey,
    account: cloneValue(account),
    characterId: normalizedCharacterId,
    character: cloneValue(character),
    skills: cloneValue(skills),
    items: Object.fromEntries(
      items
        .map((item) => [String(item.itemID), cloneValue(item)])
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    ),
    skillsList: buildSkillList(skills),
    itemsList: buildItemList(normalizedCharacterId, items, references),
    metrics: {
      itemCount: summary.itemCount,
      shipCount: summary.shipCount,
      skillCount: summary.skillCount,
      walletJournalCount: Array.isArray(character?.walletJournal)
        ? character.walletJournal.length
        : 0,
      bookmarkCount: Array.isArray(character?.bookmarks)
        ? character.bookmarks.length
        : 0,
    },
    references: {
      corporationName: summary.corporationName,
      stationName: summary.stationName,
      solarSystemName: summary.solarSystemName,
      shipName: summary.shipName,
    },
    warningMessages: [...summary.warningMessages],
  };
}

function buildDatabasePayload(selectedCharacterId) {
  const tables = loadPlayerTables();
  const typeTables = loadTypeTables();
  const references = loadReferenceMaps();
  const players = buildPlayerList(tables, references);
  const skillCatalog = buildSkillCatalog(tables.skills);
  const shipCatalog = buildShipCatalog(typeTables.shipTypes);
  const resolvedCharacterId =
    selectedCharacterId && players.some((player) => player.characterId === String(selectedCharacterId))
      ? String(selectedCharacterId)
      : players[0]?.characterId || null;

  return {
    generatedAt: new Date().toISOString(),
    paths: {
      dataRoot,
      ...PLAYER_TABLE_PATHS,
    },
    playerCount: players.length,
    players,
    skillCatalog,
    shipCatalog,
    nextItemIdSeed: buildNextItemIdSeed(tables.items),
    selectedCharacterId: resolvedCharacterId,
    selectedPlayer: resolvedCharacterId
      ? buildPlayerDetail(resolvedCharacterId, tables, references)
      : null,
  };
}

function searchDatabaseTypes(kind, queryText) {
  const typeTables = loadTypeTables();
  switch (kind) {
    case "ship":
      return buildShipCatalog(typeTables.shipTypes).filter((entry) => {
        const normalizedQuery = String(queryText || "").trim().toLowerCase();
        if (!normalizedQuery) {
          return true;
        }
        return `${entry.name} ${entry.groupName}`.toLowerCase().includes(normalizedQuery);
      }).slice(0, 80);
    case "item":
      return buildItemTypeSearchResults(typeTables.itemTypes, queryText, 80);
    default:
      throw new Error(`Unknown database type search kind "${kind}". Use "ship" or "item".`);
  }
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function saveDatabasePlayer() {
  const payload = readJsonFromStdin();
  requirePlainObject(payload, "Database save payload");

  const characterId = requireNonEmptyString(payload.characterId, "characterId");
  const originalAccountKey = requireNonEmptyString(
    payload.originalAccountKey,
    "originalAccountKey",
  );
  const accountName = requireNonEmptyString(payload.accountName, "accountName");
  requirePlainObject(payload.account, "account");
  requirePlainObject(payload.character, "character");
  requirePlainObject(payload.skills, "skills");
  requirePlainObject(payload.items, "items");

  const tables = loadPlayerTables();
  if (!Object.prototype.hasOwnProperty.call(tables.characters, characterId)) {
    throw new Error(`Character ${characterId} was not found.`);
  }
  if (!Object.prototype.hasOwnProperty.call(tables.accounts, originalAccountKey)) {
    throw new Error(`Account ${originalAccountKey} was not found.`);
  }
  if (
    originalAccountKey !== accountName &&
    Object.prototype.hasOwnProperty.call(tables.accounts, accountName)
  ) {
    throw new Error(`An account named ${accountName} already exists.`);
  }

  const nextAccounts = cloneValue(tables.accounts);
  const nextCharacters = cloneValue(tables.characters);
  const nextSkills = cloneValue(tables.skills);
  const nextItems = cloneValue(tables.items);

  if (originalAccountKey === accountName) {
    nextAccounts[originalAccountKey] = cloneValue(payload.account);
  } else {
    delete nextAccounts[originalAccountKey];
    nextAccounts[accountName] = cloneValue(payload.account);
  }
  nextCharacters[characterId] = cloneValue(payload.character);
  nextSkills[characterId] = cloneValue(payload.skills);

  for (const [itemKey, item] of Object.entries(nextItems)) {
    if (String(item?.ownerID ?? "") === characterId) {
      delete nextItems[itemKey];
    }
  }
  for (const [itemKey, item] of Object.entries(payload.items)) {
    nextItems[String(itemKey)] = cloneValue(item);
  }

  writeJsonFile(PLAYER_TABLE_PATHS.accounts, nextAccounts);
  writeJsonFile(PLAYER_TABLE_PATHS.characters, nextCharacters);
  writeJsonFile(PLAYER_TABLE_PATHS.skills, nextSkills);
  writeJsonFile(PLAYER_TABLE_PATHS.items, nextItems);

  return buildDatabasePayload(characterId);
}

function main() {
  const command = process.argv[2] || "export";
  const argument = process.argv[3] || "";
  const secondaryArgument = process.argv[4] || "";

  switch (command) {
    case "export":
      process.stdout.write(
        `${JSON.stringify(buildConfigExportPayload(), null, 2)}\n`,
      );
      return;
    case "save":
      process.stdout.write(`${JSON.stringify(saveConfig(), null, 2)}\n`);
      return;
    case "database-export":
      process.stdout.write(
        `${JSON.stringify(buildDatabasePayload(argument || null), null, 2)}\n`,
      );
      return;
    case "database-save":
      process.stdout.write(
        `${JSON.stringify(saveDatabasePlayer(), null, 2)}\n`,
      );
      return;
    case "database-type-search":
      process.stdout.write(
        `${JSON.stringify(searchDatabaseTypes(argument || "item", secondaryArgument || ""), null, 2)}\n`,
      );
      return;
    default:
      throw new Error(
        `Unknown command "${command}". Use "export", "save", "database-export", "database-save", or "database-type-search".`,
      );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`[eve.js] ${error.message}\n`);
  process.exit(1);
}
