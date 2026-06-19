const path = require("path");

const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  resolveCalendarTag,
  toPositiveInt,
} = require(path.join(__dirname, "./calendarAccess"));

function buildEventRow(event, session) {
  return buildKeyVal([
    ["eventID", toPositiveInt(event && event.eventID, 0)],
    ["ownerID", toPositiveInt(event && event.ownerID, 0)],
    ["eventDateTime", buildFiletimeLong(event && event.eventDateTime)],
    [
      "eventDuration",
      event && event.eventDuration == null
        ? null
        : Math.max(0, Math.trunc(normalizeNumber(event.eventDuration, 0))),
    ],
    ["eventTitle", String((event && event.title) || "")],
    ["importance", Math.max(0, Math.trunc(normalizeNumber(event && event.importance, 0)))],
    ["dateModified", buildFiletimeLong(event && event.updatedAt)],
    ["isDeleted", Boolean(event && event.isDeleted)],
    [
      "flag",
      resolveCalendarTag(
        event && event.ownerID,
        session,
        event && event.autoEventType,
      ),
    ],
    [
      "autoEventType",
      event && event.autoEventType == null
        ? null
        : Math.trunc(normalizeNumber(event.autoEventType, 0)),
    ],
  ]);
}

function buildEventDetails(event) {
  return buildKeyVal([
    ["eventText", String((event && event.description) || "")],
    ["creatorID", toPositiveInt(event && event.creatorID, 0)],
  ]);
}

function buildCharacterResponseRow(response) {
  return buildKeyVal([
    ["eventID", toPositiveInt(response && response.eventID, 0)],
    ["status", Math.trunc(normalizeNumber(response && response.status, 0))],
  ]);
}

function buildEventResponseRow(response) {
  return buildKeyVal([
    ["characterID", toPositiveInt(response && response.characterID, 0)],
    ["status", Math.trunc(normalizeNumber(response && response.status, 0))],
  ]);
}

function buildEventListPayload(events, session) {
  return buildList([
    buildList(
      (Array.isArray(events) ? events : []).map((event) => buildEventRow(event, session)),
    ),
  ]);
}

function buildResponsesForCharacterPayload(rows) {
  return buildList(
    (Array.isArray(rows) ? rows : []).map((row) => buildCharacterResponseRow(row)),
  );
}

function buildResponsesToEventPayload(rows) {
  return buildList(
    (Array.isArray(rows) ? rows : []).map((row) => buildEventResponseRow(row)),
  );
}

function buildExternalResponseEventKV(event, session) {
  const ownerID = toPositiveInt(event && event.ownerID, 0);
  return buildKeyVal([
    ["ownerID", ownerID],
    ["flag", ownerID],
    ["eventDateTime", buildFiletimeLong(event && event.eventDateTime)],
  ]);
}

function buildServerEditorSnapshot(payload = {}) {
  return buildDict(
    Object.entries(payload).map(([key, value]) => [key, value]),
  );
}

module.exports = {
  buildEventRow,
  buildEventDetails,
  buildCharacterResponseRow,
  buildEventResponseRow,
  buildEventListPayload,
  buildResponsesForCharacterPayload,
  buildResponsesToEventPayload,
  buildExternalResponseEventKV,
  buildServerEditorSnapshot,
};
