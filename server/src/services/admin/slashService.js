const path = require("path");
const rotatingLog = require(path.join(__dirname, "../../utils/rotatingLog"));

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const chatHub = require(path.join(__dirname, "../chat/chatHub"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { AVAILABLE_SLASH_COMMANDS, executeChatCommand } = require(path.join(
  __dirname,
  "../chat/chatCommands",
));
const { flushPendingCommandSessionEffects } = require(path.join(
  __dirname,
  "../chat/commandSessionEffects",
));

const debugLogPath = path.join(__dirname, "../../../logs/slash-debug.log");

function appendSlashDebug(entry) {
  if (!log.isVerboseDebugEnabled()) {
    return;
  }
  try {
    rotatingLog.append(debugLogPath, `[${new Date().toISOString()}] ${entry}\n`);
  } catch (error) {
    log.warn(`[SlashService] Failed to write debug log: ${error.message}`);
  }
}

function textValue(value, depth = 0) {
  if (depth > 6) {
    return "";
  }

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
    return textValue(value.value, depth + 1);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = textValue(item, depth + 1).trim();
      if (extracted) {
        return extracted;
      }
    }
    return "";
  }

  if (value && typeof value === "object") {
    if (value.type === "substream" || value.type === "substruct") {
      return textValue(value.value, depth + 1);
    }

    if (value.type === "list" && Array.isArray(value.items)) {
      return textValue(value.items, depth + 1);
    }

    if (value.type === "dict" && Array.isArray(value.entries)) {
      for (const [, entryValue] of value.entries) {
        const extracted = textValue(entryValue, depth + 1).trim();
        if (extracted) {
          return extracted;
        }
      }
      return "";
    }
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function summarizeValue(value, depth = 0) {
  if (depth > 3) {
    return "<max-depth>";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer:${value.toString("utf8")}>`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => summarizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const summary = {};
    for (const [key, entryValue] of Object.entries(value)) {
      summary[key] = summarizeValue(entryValue, depth + 1);
    }
    return summary;
  }

  return String(value);
}

function extractCommand(args, kwargs) {
  const fromArgs = textValue(args).trim();
  if (fromArgs) {
    return fromArgs;
  }

  const fromKwargs = textValue(kwargs).trim();
  if (fromKwargs) {
    return fromKwargs;
  }

  return "";
}

function extractKwarg(kwargs, key) {
  if (!kwargs) {
    return undefined;
  }

  if (kwargs.type === "dict" && Array.isArray(kwargs.entries)) {
    const match = kwargs.entries.find((entry) => entry[0] === key);
    return match ? match[1] : undefined;
  }

  if (typeof kwargs === "object") {
    return kwargs[key];
  }

  return undefined;
}

function extractFeedbackChannel(args, kwargs) {
  const fromKwargs = textValue(
    extractKwarg(kwargs, "channelID") ??
      extractKwarg(kwargs, "channelName") ??
      extractKwarg(kwargs, "roomJid"),
  ).trim();
  if (fromKwargs) {
    return fromKwargs;
  }

  if (Array.isArray(args) && args.length > 1) {
    const fromArgs = textValue(args[1]).trim();
    if (fromArgs) {
      return fromArgs;
    }
  }

  return null;
}

class SlashService extends BaseService {
  constructor() {
    super("slash");
  }

  _throwCommandListError() {
    const quotedCommands = AVAILABLE_SLASH_COMMANDS.map(
      (command) => `'${command}'`,
    ).join(", ");
    throwWrappedUserError("", {
      reason: `Commands: [${quotedCommands}]`,
    });
  }

  Handle_ReportSlashCommandUsage(args, session, kwargs) {
    const command = extractCommand(args, kwargs);
    appendSlashDebug(
      `ReportSlashCommandUsage user=${session ? session.userid : "?"} char=${session ? session.characterID : "?"} command=${JSON.stringify(command)} args=${JSON.stringify(summarizeValue(args))} kwargs=${JSON.stringify(summarizeValue(kwargs))}`,
    );
    return null;
  }

  Handle_SlashCmd(args, session, kwargs) {
    const command = extractCommand(args, kwargs).trim();
    const feedbackChannel = extractFeedbackChannel(args, kwargs);

    log.debug(`[SlashService] SlashCmd: ${command}`);
    appendSlashDebug(
      `SlashCmd user=${session ? session.userid : "?"} char=${session ? session.characterID : "?"} command=${JSON.stringify(command)} args=${JSON.stringify(summarizeValue(args))} kwargs=${JSON.stringify(summarizeValue(kwargs))}`,
    );

    if (command === "/") {
      this._throwCommandListError();
    }

    try {
      if (!command) {
        this._throwCommandListError();
      }

      const result = executeChatCommand(session, command, chatHub, {
        emitChatFeedback: true,
        feedbackChannel,
        serviceManager: this.serviceManager,
      });

      if (!result.handled) {
        const message = `Unknown command: ${command}. Use /help.`;
        chatHub.sendSystemMessage(session, message, feedbackChannel);
        return message;
      }

      return result.message || null;
    } catch (error) {
      const message = `Command failed: ${error.message}`;
      log.err(`[SlashService] ${message}`);
      appendSlashDebug(
        `SlashCmd error user=${session ? session.userid : "?"} char=${session ? session.characterID : "?"} command=${JSON.stringify(command)} args=${JSON.stringify(summarizeValue(args))} kwargs=${JSON.stringify(summarizeValue(kwargs))} error=${error.stack || error.message}`,
      );
      chatHub.sendSystemMessage(session, message, feedbackChannel);
      return message;
    }
  }

  afterCallResponse(methodName, session) {
    if (methodName !== "SlashCmd") {
      return;
    }

    flushPendingCommandSessionEffects(session);
  }
}

module.exports = SlashService;
