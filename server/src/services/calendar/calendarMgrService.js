const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  extractList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const runtime = require(path.join(__dirname, "./calendarRuntimeState"));
const notifications = require(path.join(__dirname, "./calendarNotifications"));
const payloads = require(path.join(__dirname, "./calendarPayloads"));
const {
  SCOPE_ALLIANCE,
  SCOPE_CORPORATION,
  SCOPE_PERSONAL,
} = require(path.join(__dirname, "./calendarConstants"));

class CalendarMgrService extends BaseService {
  constructor() {
    super("calendarMgr");
    runtime.ensureLoaded();
  }

  Handle_CreatePersonalEvent(args, session) {
    const createdEvent = runtime.createEventRecord({
      session,
      scope: SCOPE_PERSONAL,
      eventDateTime: args && args[0],
      duration: args && args[1],
      title: args && args[2],
      description: args && args[3],
      importance: args && args[4],
      inviteeCharacterIDs: extractList(args && args[5]),
    });
    const createNotifyOptions = { excludeSession: session };
    notifications.notifyNewCalendarEvent(
      notifications.listOnlineViewerCharacterIDs(createdEvent, createNotifyOptions),
      createdEvent,
      createNotifyOptions,
    );
    return createdEvent.eventID;
  }

  Handle_CreateCorporationEvent(args, session) {
    const createdEvent = runtime.createEventRecord({
      session,
      scope: SCOPE_CORPORATION,
      eventDateTime: args && args[0],
      duration: args && args[1],
      title: args && args[2],
      description: args && args[3],
      importance: args && args[4],
    });
    notifications.notifyNewCalendarEvent(
      notifications.listOnlineViewerCharacterIDs(createdEvent),
      createdEvent,
    );
    return createdEvent.eventID;
  }

  Handle_CreateAllianceEvent(args, session) {
    const createdEvent = runtime.createEventRecord({
      session,
      scope: SCOPE_ALLIANCE,
      eventDateTime: args && args[0],
      duration: args && args[1],
      title: args && args[2],
      description: args && args[3],
      importance: args && args[4],
    });
    notifications.notifyNewCalendarEvent(
      notifications.listOnlineViewerCharacterIDs(createdEvent),
      createdEvent,
    );
    return createdEvent.eventID;
  }

  Handle_EditPersonalEvent(args, session) {
    const result = runtime.editEventRecord(session, args && args[0], args && args[1], {
      eventDateTime: args && args[2],
      duration: args && args[3],
      title: args && args[4],
      description: args && args[5],
      importance: args && args[6],
    });
    notifications.notifyEditCalendarEvent(
      notifications.listOnlineViewerCharacterIDs(result.event),
      result.event,
      result.oldEventDateTime,
    );
    return null;
  }

  Handle_EditCorporationEvent(args, session) {
    return this.Handle_EditPersonalEvent(args, session);
  }

  Handle_EditAllianceEvent(args, session) {
    return this.Handle_EditPersonalEvent(args, session);
  }

  Handle_DeleteEvent(args, session) {
    const deletedEvent = runtime.deleteEventRecord(session, args && args[0], args && args[1]);
    notifications.notifyRemoveCalendarEvent(
      notifications.listOnlineViewerCharacterIDs(deletedEvent),
      deletedEvent,
      true,
    );
    return null;
  }

  Handle_SendEventResponse(args, session) {
    const result = runtime.sendEventResponse(
      session,
      args && args[0],
      args && args[1],
      args && args[2],
    );
    const responseNotifyOptions = { excludeSession: session };
    notifications.notifyExternalEventResponse(
      notifications.listOnlineViewerCharacterIDs(result.event, responseNotifyOptions),
      result.event,
      result.response,
      responseNotifyOptions,
    );
    return null;
  }

  Handle_UpdateEventParticipants(args, session) {
    const result = runtime.updateEventParticipants(
      session,
      args && args[0],
      extractList(args && args[1]),
      extractList(args && args[2]),
    );
    if (result.addedCharacterIDs.length > 0) {
      notifications.notifyNewCalendarEvent(
        result.addedCharacterIDs,
        result.event,
      );
    }
    if (result.removedCharacterIDs.length > 0) {
      notifications.notifyRemoveCalendarEvent(
        result.removedCharacterIDs,
        result.event,
        false,
      );
    }
    return null;
  }

  Handle_GetResponsesForCharacter(args, session) {
    return payloads.buildResponsesForCharacterPayload(
      runtime.getResponsesForCharacter(session),
    );
  }

  Handle_GetResponsesToEvent(args, session) {
    return payloads.buildResponsesToEventPayload(
      runtime.getResponsesToEvent(session, args && args[0], args && args[1]),
    );
  }
}

module.exports = CalendarMgrService;
