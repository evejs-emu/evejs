/**
 * LSC (Large Scale Chat) Service
 *
 * Handles chat channel operations.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const chatHub = require(path.join(__dirname, "./chatHub"));
const { executeChatCommand } = require(path.join(__dirname, "./chatCommands"));
const { flushPendingCommandSessionEffects } = require(path.join(
  __dirname,
  "./commandSessionEffects",
));

function textValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (
    value &&
    typeof value === "object" &&
    (value.type === "wstring" || value.type === "token")
  ) {
    return value.value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

class LSCService extends BaseService {
  constructor() {
    super("LSC");
  }

  Handle_GetChannels(args, session) {
    log.debug("[LSCService] GetChannels");
    return chatHub.getChannelsForSession(session);
  }

  Handle_GetMyMessages(args, session) {
    log.debug("[LSCService] GetMyMessages");
    return { type: "list", items: [] };
  }

  Handle_JoinChannels(args, session) {
    log.debug("[LSCService] JoinChannels");
    const { result } = chatHub.joinLocalChannel(session);
    return { type: "list", items: [result] };
  }

  Handle_JoinChannel(args, session) {
    log.debug("[LSCService] JoinChannel");
    const { result } = chatHub.joinLocalChannel(session);
    return result;
  }

  Handle_LeaveChannels(args, session) {
    log.debug("[LSCService] LeaveChannels");
    chatHub.leaveLocalChannel(session);
    return null;
  }

  Handle_LeaveChannel(args, session) {
    log.debug("[LSCService] LeaveChannel");
    chatHub.leaveLocalChannel(session);
    return null;
  }

  Handle_SendMessage(args, session) {
    const rawMessage =
      args && args.length > 1 ? args[1] : args && args.length > 0 ? args[0] : "";
    const message = textValue(rawMessage).trim();
    log.debug(`[LSCService] SendMessage: ${message}`);

    if (!message) {
      return null;
    }

    const commandResult = executeChatCommand(session, message, chatHub, {
      serviceManager: this.serviceManager,
    });
    if (commandResult.refreshChatRolePresence) {
      chatHub.refreshSessionChatRolePresence(session);
    }
    if (!commandResult.handled) {
      chatHub.broadcastLocalMessage(session, message);
    }

    return null;
  }

  afterCallResponse(methodName, session) {
    if (methodName !== "SendMessage") {
      return;
    }

    flushPendingCommandSessionEffects(session);
  }
}

module.exports = LSCService;
