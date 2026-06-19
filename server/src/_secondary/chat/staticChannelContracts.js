const HELP_CHANNEL_BY_LANGUAGE = Object.freeze({
  en: Object.freeze({
    roomName: "system_263238_263262",
    displayName: "English Help",
    type: "help",
    scope: "help",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "Help Channels",
      featuredOrder: 200,
    }),
  }),
  de: Object.freeze({
    roomName: "system_263238_263267",
    displayName: "German Help",
    type: "help",
    scope: "help",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "Help Channels",
      featuredOrder: 200,
    }),
  }),
  ru: Object.freeze({
    roomName: "system_263238_263301",
    displayName: "Russian Help",
    type: "help",
    scope: "help",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "Help Channels",
      featuredOrder: 200,
    }),
  }),
  ja: Object.freeze({
    roomName: "system_263238_263302",
    displayName: "Japanese Help",
    type: "help",
    scope: "help",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "Help Channels",
      featuredOrder: 200,
    }),
  }),
  fr: Object.freeze({
    roomName: "system_263238_504075",
    displayName: "French Help",
    type: "help",
    scope: "help",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "Help Channels",
      featuredOrder: 200,
    }),
  }),
  ko: Object.freeze({
    roomName: "system_263238_553782",
    displayName: "Korean Help",
    type: "help",
    scope: "help",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "Help Channels",
      featuredOrder: 200,
    }),
  }),
  es: Object.freeze({
    roomName: "system_263238_263262",
    displayName: "English Help",
    type: "help",
    scope: "help",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "Help Channels",
      featuredOrder: 200,
    }),
  }),
  zh: Object.freeze({
    roomName: "system_263238_263262",
    displayName: "English Help",
    type: "help",
    scope: "help",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "Help Channels",
      featuredOrder: 200,
    }),
  }),
});

const ROOKIE_HELP_CHANNEL = Object.freeze({
  roomName: "system_263238_263259",
  displayName: "Rookie Help",
  type: "rookiehelp",
  scope: "rookiehelp",
  static: true,
  verifiedContract: true,
  contractSource: "codeccpfull_v23.02",
  metadata: Object.freeze({
    browserCategoryName: "Help Channels",
    featuredOrder: 200,
  }),
});

const CUSTOM_DISCOVERABLE_CHANNELS = Object.freeze([
  Object.freeze({
    roomName: "player_900001",
    displayName: "EveJS Elysian chat",
    type: "player",
    scope: "player",
    entityID: 900001,
    static: false,
    verifiedContract: false,
    contractSource: "evejs_custom",
    motd:
      "Welcome to EveJS Elysian. Fly dangerous, keep comms sharp, and help us forge full chat parity together.",
    inviteToken: "player_900001",
    metadata: Object.freeze({
      joinLink: "joinChannel:player_900001",
      inviteToken: "player_900001",
      featuredOrder: -1000,
    }),
  }),
]);

const PUBLIC_SYSTEM_CHANNELS = Object.freeze([
  Object.freeze({
    roomName: "system_263328_530248",
    displayName: "Resource Wars",
    type: "public",
    scope: "public",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "System Channels",
      featuredOrder: 100,
    }),
  }),
  Object.freeze({
    roomName: "system_263328_263289",
    displayName: "Incursions",
    type: "public",
    scope: "public",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "System Channels",
      featuredOrder: 100,
    }),
  }),
  Object.freeze({
    roomName: "system_263331_263368",
    displayName: "Mining",
    type: "public",
    scope: "public",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "System Channels",
      featuredOrder: 100,
    }),
  }),
  Object.freeze({
    roomName: "system_263328_263339",
    displayName: "Scanning",
    type: "public",
    scope: "public",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "System Channels",
      featuredOrder: 100,
    }),
  }),
  Object.freeze({
    roomName: "system_263328_263308",
    displayName: "Missions",
    type: "public",
    scope: "public",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "System Channels",
      featuredOrder: 100,
    }),
  }),
  Object.freeze({
    roomName: "system_263328_263306",
    displayName: "Events",
    type: "public",
    scope: "public",
    static: true,
    verifiedContract: true,
    contractSource: "codeccpfull_v23.02",
    metadata: Object.freeze({
      browserCategoryName: "System Channels",
      featuredOrder: 100,
    }),
  }),
]);

function cloneContract(contract) {
  return contract ? { ...contract } : null;
}

function normalizeLanguageCode(languageID) {
  const normalizedValue = String(languageID || "")
    .trim()
    .toLowerCase();
  if (!normalizedValue) {
    return "en";
  }

  const exactMatch = /^[a-z]{2}$/.exec(normalizedValue);
  if (exactMatch) {
    return exactMatch[0];
  }

  const prefixMatch = /^[a-z]{2}/.exec(normalizedValue);
  return prefixMatch ? prefixMatch[0] : "en";
}

const VERIFIED_STATIC_CHANNELS = Object.freeze(
  Array.from(
    new Map(
      [
        ROOKIE_HELP_CHANNEL,
        ...Object.values(HELP_CHANNEL_BY_LANGUAGE),
        ...PUBLIC_SYSTEM_CHANNELS,
      ].map((contract) => [contract.roomName, contract]),
    ).values(),
  ),
);

const DISCOVERABLE_STATIC_CHANNELS = Object.freeze(
  Array.from(
    new Map(
      [
        ...CUSTOM_DISCOVERABLE_CHANNELS,
        ...VERIFIED_STATIC_CHANNELS,
      ].map((contract) => [contract.roomName, contract]),
    ).values(),
  ),
);

const STATIC_CHANNEL_BY_ROOM_NAME = Object.freeze(
  Object.fromEntries(
    DISCOVERABLE_STATIC_CHANNELS.map((contract) => [contract.roomName, contract]),
  ),
);

function getHelpChannelContract(languageID = "en") {
  const normalizedLanguage = normalizeLanguageCode(languageID);
  return cloneContract(
    HELP_CHANNEL_BY_LANGUAGE[normalizedLanguage] || HELP_CHANNEL_BY_LANGUAGE.en,
  );
}

function getRookieHelpChannelContract() {
  return cloneContract(ROOKIE_HELP_CHANNEL);
}

function getStaticChannelContract(roomName) {
  const normalizedRoomName = String(roomName || "").trim();
  if (!normalizedRoomName) {
    return null;
  }
  return cloneContract(STATIC_CHANNEL_BY_ROOM_NAME[normalizedRoomName] || null);
}

function listVerifiedStaticChannelContracts() {
  return VERIFIED_STATIC_CHANNELS.map((contract) => cloneContract(contract));
}

function listDiscoverableStaticChannelContracts() {
  return DISCOVERABLE_STATIC_CHANNELS.map((contract) => cloneContract(contract));
}

module.exports = {
  getHelpChannelContract,
  getRookieHelpChannelContract,
  getStaticChannelContract,
  listDiscoverableStaticChannelContracts,
  listVerifiedStaticChannelContracts,
  normalizeLanguageCode,
};
