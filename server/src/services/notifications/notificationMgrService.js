const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  extractList,
  marshalObjectToObject,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  deleteAllNotifications,
  deleteGroupNotifications,
  deleteNotifications,
  getAllNotifications,
  getNotificationsByGroupID,
  getUnprocessedNotifications,
  logNotificationInteraction,
  markAllAsProcessed,
  markAsProcessed,
  markGroupAsProcessed,
} = require(path.join(__dirname, "./notificationState"));

function toPositiveInteger(value, fallback = 0) {
  const numericValue = Math.trunc(normalizeNumber(value, fallback));
  return numericValue > 0 ? numericValue : fallback;
}

function getSessionCharacterID(session) {
  return toPositiveInteger(
    session &&
      (session.characterID || session.charID || session.charid || 0),
    0,
  );
}

function readKeywordIntArg(kwargs, keys = [], fallback = 0) {
  const normalizedKwargs = marshalObjectToObject(kwargs);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(normalizedKwargs, key)) {
      continue;
    }
    const numericValue = toPositiveInteger(normalizedKwargs[key], 0);
    if (numericValue > 0) {
      return numericValue;
    }
  }
  return fallback;
}

function readListArg(args, index = 0) {
  if (!Array.isArray(args) || args.length <= index) {
    return [];
  }
  return extractList(args[index]);
}

class NotificationMgrService extends BaseService {
  constructor() {
    super("notificationMgr");
  }

  Handle_GetAllNotifications(args, session, kwargs) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return [];
    }

    const fromID = readKeywordIntArg(
      kwargs,
      ["fromID"],
      toPositiveInteger(Array.isArray(args) ? args[0] : 0, 0),
    );
    return getAllNotifications(characterID, { fromID });
  }

  Handle_GetByGroupID(args, session, kwargs) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return [];
    }

    const groupID = readKeywordIntArg(
      kwargs,
      ["groupID"],
      toPositiveInteger(Array.isArray(args) ? args[0] : 0, 0),
    );
    return getNotificationsByGroupID(characterID, groupID);
  }

  Handle_GetUnprocessed(_args, session) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return [];
    }
    return getUnprocessedNotifications(characterID);
  }

  Handle_MarkGroupAsProcessed(args, session, kwargs) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return null;
    }

    const groupID = readKeywordIntArg(
      kwargs,
      ["groupID"],
      toPositiveInteger(Array.isArray(args) ? args[0] : 0, 0),
    );
    markGroupAsProcessed(characterID, groupID);
    return null;
  }

  Handle_MarkAllAsProcessed(_args, session) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return null;
    }

    markAllAsProcessed(characterID);
    return null;
  }

  Handle_MarkAsProcessed(args, session) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return null;
    }

    markAsProcessed(characterID, readListArg(args, 0));
    return null;
  }

  Handle_DeleteGroupNotifications(args, session, kwargs) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return null;
    }

    const groupID = readKeywordIntArg(
      kwargs,
      ["groupID"],
      toPositiveInteger(Array.isArray(args) ? args[0] : 0, 0),
    );
    deleteGroupNotifications(characterID, groupID, {
      excludeSession: session || null,
    });
    return null;
  }

  Handle_DeleteAllNotifications(_args, session) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return null;
    }

    deleteAllNotifications(characterID, {
      excludeSession: session || null,
    });
    return null;
  }

  Handle_DeleteNotifications(args, session) {
    const characterID = getSessionCharacterID(session);
    if (characterID <= 0) {
      return null;
    }

    deleteNotifications(characterID, readListArg(args, 0), {
      excludeSession: session || null,
    });
    return null;
  }

  Handle_LogNotificationInteraction(args, _session, kwargs) {
    const referenceID = readKeywordIntArg(
      kwargs,
      ["referenceID"],
      toPositiveInteger(Array.isArray(args) ? args[0] : 0, 0),
    );
    return logNotificationInteraction(referenceID);
  }
}

module.exports = NotificationMgrService;
