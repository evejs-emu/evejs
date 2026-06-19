const path = require("path");
const protobuf = require("protobufjs");

const {
  durationToMs,
  encodePayload,
  getActiveCharacterID,
} = require("./gatewayServiceHelpers");
const chatRuntime = require(path.join(
  __dirname,
  "../../chat/chatRuntime",
));
const sessionRegistry = require(path.join(
  __dirname,
  "../../../services/chat/sessionRegistry",
));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.chat.local.api.GetMembershipListRequest",
  "eve_public.chat.local.api.BroadcastMessageRequest",
  "eve_public.chat.local.api.admin.MuteRequest",
]);

const LOCAL_CHAT_PROTO_ROOT = protobuf.Root.fromJSON({
  nested: {
    google: {
      nested: {
        protobuf: {
          nested: {
            Duration: {
              fields: {
                seconds: { type: "int64", id: 1 },
                nanos: { type: "int32", id: 2 },
              },
            },
          },
        },
      },
    },
    eve_public: {
      nested: {
        character: {
          nested: {
            Identifier: {
              fields: {
                sequential: { type: "uint32", id: 1 },
              },
            },
          },
        },
        corporation: {
          nested: {
            Identifier: {
              fields: {
                sequential: { type: "uint32", id: 1 },
              },
            },
          },
        },
        alliance: {
          nested: {
            Identifier: {
              fields: {
                sequential: { type: "uint32", id: 1 },
              },
            },
          },
        },
        faction: {
          nested: {
            Identifier: {
              fields: {
                sequential: { type: "uint32", id: 1 },
              },
            },
          },
        },
        solarsystem: {
          nested: {
            Identifier: {
              fields: {
                sequential: { type: "uint32", id: 1 },
              },
            },
          },
        },
        chat: {
          nested: {
            local: {
              nested: {
                Classification: {
                  values: {
                    CLASSIFICATION_UNSPECIFIED: 0,
                    CLASSIFICATION_INVISIBLE: 1,
                    CLASSIFICATION_DEVELOPER: 2,
                    CLASSIFICATION_ADMINISTRATOR: 3,
                    CLASSIFICATION_GAMEMASTER: 4,
                    CLASSIFICATION_VOLUNTEER: 5,
                    CLASSIFICATION_NPC: 6,
                  },
                },
                Character: {
                  oneofs: {
                    alliance_membership: {
                      oneof: ["no_alliance", "alliance"],
                    },
                    faction_membership: {
                      oneof: ["no_faction", "faction"],
                    },
                  },
                  fields: {
                    character: {
                      type: "eve_public.character.Identifier",
                      id: 1,
                    },
                    corporation: {
                      type: "eve_public.corporation.Identifier",
                      id: 2,
                    },
                    no_alliance: { type: "bool", id: 3 },
                    alliance: {
                      type: "eve_public.alliance.Identifier",
                      id: 4,
                    },
                    no_faction: { type: "bool", id: 5 },
                    faction: {
                      type: "eve_public.faction.Identifier",
                      id: 6,
                    },
                    classification: {
                      type: "eve_public.chat.local.Classification",
                      id: 7,
                    },
                  },
                },
                api: {
                  nested: {
                    GetMembershipListRequest: {
                      fields: {},
                    },
                    GetMembershipListResponse: {
                      fields: {
                        members: {
                          rule: "repeated",
                          type: "eve_public.chat.local.Character",
                          id: 1,
                        },
                        solar_system: {
                          type: "eve_public.solarsystem.Identifier",
                          id: 2,
                        },
                      },
                    },
                    BroadcastMessageRequest: {
                      fields: {
                        message: { type: "string", id: 1 },
                      },
                    },
                    BroadcastMessageResponse: {
                      fields: {},
                    },
                    MembershipListNotice: {
                      fields: {
                        members: {
                          rule: "repeated",
                          type: "eve_public.chat.local.Character",
                          id: 1,
                        },
                        solar_system: {
                          type: "eve_public.solarsystem.Identifier",
                          id: 2,
                        },
                      },
                    },
                    MembershipRefreshedNotice: {
                      fields: {
                        member: {
                          type: "eve_public.chat.local.Character",
                          id: 1,
                        },
                        solar_system: {
                          type: "eve_public.solarsystem.Identifier",
                          id: 2,
                        },
                      },
                    },
                    JoinNotice: {
                      fields: {
                        member: {
                          type: "eve_public.chat.local.Character",
                          id: 1,
                        },
                        solar_system: {
                          type: "eve_public.solarsystem.Identifier",
                          id: 2,
                        },
                      },
                    },
                    LeaveNotice: {
                      fields: {
                        character: {
                          type: "eve_public.character.Identifier",
                          id: 1,
                        },
                        solar_system: {
                          type: "eve_public.solarsystem.Identifier",
                          id: 2,
                        },
                      },
                    },
                    MessageBroadcastNotice: {
                      fields: {
                        author: {
                          type: "eve_public.character.Identifier",
                          id: 1,
                        },
                        solar_system: {
                          type: "eve_public.solarsystem.Identifier",
                          id: 2,
                        },
                        message: { type: "string", id: 3 },
                      },
                    },
                    admin: {
                      nested: {
                        MuteRequest: {
                          fields: {
                            character: {
                              type: "eve_public.character.Identifier",
                              id: 1,
                            },
                            duration: {
                              type: "google.protobuf.Duration",
                              id: 2,
                            },
                            reason: { type: "string", id: 3 },
                          },
                        },
                        MuteResponse: {
                          fields: {},
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

const TYPES = Object.freeze({
  getMembershipListRequest: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.GetMembershipListRequest",
  ),
  getMembershipListResponse: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.GetMembershipListResponse",
  ),
  broadcastMessageRequest: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.BroadcastMessageRequest",
  ),
  broadcastMessageResponse: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.BroadcastMessageResponse",
  ),
  membershipListNotice: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.MembershipListNotice",
  ),
  membershipRefreshedNotice: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.MembershipRefreshedNotice",
  ),
  joinNotice: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.JoinNotice",
  ),
  leaveNotice: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.LeaveNotice",
  ),
  messageBroadcastNotice: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.MessageBroadcastNotice",
  ),
  muteRequest: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.admin.MuteRequest",
  ),
  muteResponse: LOCAL_CHAT_PROTO_ROOT.lookupType(
    "eve_public.chat.local.api.admin.MuteResponse",
  ),
});

let noticesBound = false;

function decodePayload(messageType, requestEnvelope) {
  return messageType.decode(
    Buffer.from(
      requestEnvelope &&
        requestEnvelope.payload &&
        requestEnvelope.payload.value
        ? requestEnvelope.payload.value
        : Buffer.alloc(0),
    ),
  );
}

function buildSolarSystemIdentifier(solarSystemID) {
  return {
    sequential: Number(solarSystemID || 0) || 0,
  };
}

function buildCharacterIdentifier(characterID) {
  return {
    sequential: Number(characterID || 0) || 0,
  };
}

function buildLocalMemberPayload(member) {
  const payload = {
    character: {
      sequential: Number(
        member && member.character && member.character.sequential,
      ) || 0,
    },
    corporation: {
      sequential: Number(
        member && member.corporation && member.corporation.sequential,
      ) || 0,
    },
    classification: member && member.classification
      ? member.classification
      : "CLASSIFICATION_UNSPECIFIED",
  };

  const allianceID = Number(
    member &&
      member.alliance &&
      member.alliance.sequential,
  ) || 0;
  if (allianceID > 0) {
    payload.alliance = {
      sequential: allianceID,
    };
  } else {
    payload.no_alliance = true;
  }

  const factionID = Number(
    member &&
      member.faction &&
      member.faction.sequential,
  ) || 0;
  if (factionID > 0) {
    payload.faction = {
      sequential: factionID,
    };
  } else {
    payload.no_faction = true;
  }

  return payload;
}

function buildMembershipPayload(payload) {
  return {
    members: (Array.isArray(payload && payload.members) ? payload.members : [])
      .map(buildLocalMemberPayload),
    solar_system: buildSolarSystemIdentifier(payload && payload.solarSystemID),
  };
}

function buildSuccessResult(responseTypeName, messageType, payload = {}) {
  return {
    statusCode: 200,
    statusMessage: "",
    responseTypeName,
    responsePayloadBuffer: encodePayload(messageType, payload),
  };
}

function buildErrorResult(statusCode, statusMessage, responseTypeName) {
  return {
    statusCode,
    statusMessage,
    responseTypeName,
    responsePayloadBuffer: Buffer.alloc(0),
  };
}

function resolveSession(requestEnvelope) {
  const activeCharacterID = getActiveCharacterID(requestEnvelope);
  if (!activeCharacterID) {
    return null;
  }
  return sessionRegistry.findSessionByCharacterID(activeCharacterID);
}

function publishTypedNotice(context, typeName, messageType, payload, targetGroup) {
  if (!context || typeof context.publishGatewayNotice !== "function") {
    return;
  }
  context.publishGatewayNotice(
    typeName,
    encodePayload(messageType, payload),
    targetGroup,
  );
}

function bindRuntimeNotices(context) {
  if (noticesBound || !context || typeof context.publishGatewayNotice !== "function") {
    return;
  }
  noticesBound = true;

  chatRuntime.on("local-membership-list", (event) => {
    if (!event || !event.targetCharacterID) {
      return;
    }
    publishTypedNotice(
      context,
      "eve_public.chat.local.api.MembershipListNotice",
      TYPES.membershipListNotice,
      buildMembershipPayload(event),
      {
        character: Number(event.targetCharacterID) || 0,
      },
    );
  });

  chatRuntime.on("local-membership-refresh", (event) => {
    if (!event) {
      return;
    }
    publishTypedNotice(
      context,
      "eve_public.chat.local.api.MembershipRefreshedNotice",
      TYPES.membershipRefreshedNotice,
      {
        member: buildLocalMemberPayload(event.member),
        solar_system: buildSolarSystemIdentifier(event.solarSystemID),
      },
      {
        solar_system: Number(event.solarSystemID) || 0,
      },
    );
  });

  chatRuntime.on("local-join", (event) => {
    if (!event) {
      return;
    }
    publishTypedNotice(
      context,
      "eve_public.chat.local.api.JoinNotice",
      TYPES.joinNotice,
      {
        member: buildLocalMemberPayload(event.member),
        solar_system: buildSolarSystemIdentifier(event.solarSystemID),
      },
      {
        solar_system: Number(event.solarSystemID) || 0,
      },
    );
  });

  chatRuntime.on("local-leave", (event) => {
    if (!event) {
      return;
    }
    publishTypedNotice(
      context,
      "eve_public.chat.local.api.LeaveNotice",
      TYPES.leaveNotice,
      {
        character: buildCharacterIdentifier(event.characterID),
        solar_system: buildSolarSystemIdentifier(event.solarSystemID),
      },
      {
        solar_system: Number(event.solarSystemID) || 0,
      },
    );
  });

  chatRuntime.on("local-message", (event) => {
    if (!event) {
      return;
    }
    publishTypedNotice(
      context,
      "eve_public.chat.local.api.MessageBroadcastNotice",
      TYPES.messageBroadcastNotice,
      {
        author: buildCharacterIdentifier(event.authorCharacterID),
        solar_system: buildSolarSystemIdentifier(event.solarSystemID),
        message: String(event.message || ""),
      },
      {
        solar_system: Number(event.solarSystemID) || 0,
      },
    );
  });
}

function createLocalChatGatewayService(context = {}) {
  bindRuntimeNotices(context);

  return {
    name: "local-chat",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType() {
      return null;
    },
    handleRequest(requestTypeName, requestEnvelope) {
      const session = resolveSession(requestEnvelope);
      if (!session) {
        if (
          requestTypeName === "eve_public.chat.local.api.GetMembershipListRequest"
        ) {
          return buildErrorResult(
            404,
            "active character session not found",
            "eve_public.chat.local.api.GetMembershipListResponse",
          );
        }
        if (
          requestTypeName === "eve_public.chat.local.api.BroadcastMessageRequest"
        ) {
          return buildErrorResult(
            404,
            "active character session not found",
            "eve_public.chat.local.api.BroadcastMessageResponse",
          );
        }
        if (
          requestTypeName === "eve_public.chat.local.api.admin.MuteRequest"
        ) {
          return buildErrorResult(
            404,
            "active character session not found",
            "eve_public.chat.local.api.admin.MuteResponse",
          );
        }
      }

      if (requestTypeName === "eve_public.chat.local.api.GetMembershipListRequest") {
        decodePayload(TYPES.getMembershipListRequest, requestEnvelope);
        const payload = chatRuntime.publishLocalMembershipListForSession(session);
        return buildSuccessResult(
          "eve_public.chat.local.api.GetMembershipListResponse",
          TYPES.getMembershipListResponse,
          buildMembershipPayload(payload),
        );
      }

      if (requestTypeName === "eve_public.chat.local.api.BroadcastMessageRequest") {
        const payload = decodePayload(TYPES.broadcastMessageRequest, requestEnvelope);
        try {
          chatRuntime.broadcastLocalMessage(session, payload && payload.message);
        } catch (error) {
          return buildErrorResult(
            error && error.code === "muted" ? 403 : 400,
            error && error.message ? error.message : "broadcast failed",
            "eve_public.chat.local.api.BroadcastMessageResponse",
          );
        }
        return buildSuccessResult(
          "eve_public.chat.local.api.BroadcastMessageResponse",
          TYPES.broadcastMessageResponse,
        );
      }

      if (requestTypeName === "eve_public.chat.local.api.admin.MuteRequest") {
        const payload = decodePayload(TYPES.muteRequest, requestEnvelope);
        const targetCharacterID = Number(
          payload &&
            payload.character &&
            payload.character.sequential,
        ) || 0;
        chatRuntime.muteLocalCharacter(
          session,
          targetCharacterID,
          durationToMs(payload && payload.duration),
          payload && payload.reason,
        );
        return buildSuccessResult(
          "eve_public.chat.local.api.admin.MuteResponse",
          TYPES.muteResponse,
        );
      }

      return null;
    },
  };
}

module.exports = {
  LOCAL_CHAT_PROTO_ROOT,
  createLocalChatGatewayService,
};
