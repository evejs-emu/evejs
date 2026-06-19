const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const database = require(path.join(repoRoot, "server/src/newDatabase"));
const publicGatewayLocal = require(path.join(
  repoRoot,
  "server/src/_secondary/express/publicGatewayLocal",
));
const {
  grantCharacterSkillLevels,
} = require(path.join(repoRoot, "server/src/services/skills/skillState"));
const {
  MERCENARY_DEN_MANAGEMENT_SKILL_TYPE_ID,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovConstants",
));
const {
  getSovereigntyProtoTypes,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovGatewayProto",
));
const {
  resetMercenaryDenStateForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/mercenaryDenState",
));
const {
  resetSovereigntyStateForTests,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovState",
));

const ACTIVE_CHARACTER_ID = 140000003;
const OTHER_CHARACTER_ID = 140000002;
const SKYHOOK_OWNER_CORPORATION_ID = 98000000;
const SOLAR_SYSTEM_ID = 30000142;
const FIRST_DEN_ID = 770000001;
const SECOND_DEN_ID = 770000002;
const FIRST_ACTIVITY_ID = "00000000-0000-0000-0000-000000000111";
const SECOND_ACTIVITY_ID = "00000000-0000-0000-0000-000000000222";

const SOV_TYPES = getSovereigntyProtoTypes();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildGatewayEnvelope(
  typeName,
  payloadBuffer = Buffer.alloc(0),
  activeCharacterID = 0,
) {
  const envelope = publicGatewayLocal._testing.RequestEnvelope.create({
    payload: {
      type_url: `type.googleapis.com/${typeName}`,
      value: Buffer.from(payloadBuffer),
    },
    authoritative_context: activeCharacterID
      ? {
          active_character: { sequential: activeCharacterID },
          identity: {
            character: { sequential: activeCharacterID },
          },
        }
      : undefined,
  });
  return Buffer.from(
    publicGatewayLocal._testing.RequestEnvelope.encode(envelope).finish(),
  );
}

function decodeGatewayResponse(buffer) {
  return publicGatewayLocal._testing.ResponseEnvelope.decode(buffer);
}

function encodeMessage(messageType, payload = {}) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

function sendGatewayRequest(
  requestTypeName,
  requestMessageType,
  payload = {},
  activeCharacterID = ACTIVE_CHARACTER_ID,
) {
  const responseBuffer = publicGatewayLocal.buildGatewayResponseForRequest(
    buildGatewayEnvelope(
      requestTypeName,
      requestMessageType ? encodeMessage(requestMessageType, payload) : Buffer.alloc(0),
      activeCharacterID,
    ),
  );
  return decodeGatewayResponse(responseBuffer);
}

class FakeGatewayNoticeStream extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.closed = false;
    this.frames = [];
  }

  respond() {}

  sendTrailers() {}

  write(buffer) {
    this.frames.push(Buffer.from(buffer));
    return true;
  }

  end() {
    this.closed = true;
  }
}

function decodeGrpcFramePayload(frame) {
  assert.equal(frame[0], 0);
  const payloadLength = frame.readUInt32BE(1);
  assert.equal(frame.length, payloadLength + 5);
  return frame.subarray(5);
}

function decodeGatewayNotices(stream) {
  const NoticeEnvelope = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.Notice",
  );
  return stream.frames.map((frame) =>
    NoticeEnvelope.decode(decodeGrpcFramePayload(frame)),
  );
}

function seedMercenaryDens(t) {
  const sovereigntySnapshot = cloneValue(
    database.read("sovereignty", "/").data || {},
  );
  const skillsSnapshot = cloneValue(database.read("skills", "/").data || {});
  const charactersSnapshot = cloneValue(database.read("characters", "/").data || {});

  t.after(() => {
    database.write("sovereignty", "/", cloneValue(sovereigntySnapshot));
    database.write("skills", "/", cloneValue(skillsSnapshot));
    database.write("characters", "/", cloneValue(charactersSnapshot));
    resetMercenaryDenStateForTests();
    resetSovereigntyStateForTests();
  });

  resetMercenaryDenStateForTests();
  resetSovereigntyStateForTests();

  grantCharacterSkillLevels(ACTIVE_CHARACTER_ID, [
    {
      typeID: MERCENARY_DEN_MANAGEMENT_SKILL_TYPE_ID,
      level: 4,
    },
  ]);

  const table = cloneValue(database.read("sovereignty", "/").data || {});
  table.mercenaryDens = {
    [String(FIRST_DEN_ID)]: {
      mercenaryDenID: FIRST_DEN_ID,
      ownerCharacterID: ACTIVE_CHARACTER_ID,
      skyhookID: 660000001,
      solarSystemID: SOLAR_SYSTEM_ID,
      planetID: 40000001,
      typeID: 1,
      enabled: true,
      cargoExtractionEnabled: true,
      skyhookOwnerCorporationID: SKYHOOK_OWNER_CORPORATION_ID,
      nextGenerationAtMs: Date.now() + 6 * 60 * 60 * 1000,
      activities: [
        {
          activityID: FIRST_ACTIVITY_ID,
          mercenaryDenID: FIRST_DEN_ID,
          solarSystemID: SOLAR_SYSTEM_ID,
          started: false,
          expiryMs: Date.now() + 2 * 60 * 60 * 1000,
          template: {
            templateID: 1,
            nameMessageID: 330000001,
            descriptionMessageID: 330000011,
            dungeonID: 8800001,
            developmentImpact: 1,
            anarchyImpact: 0,
            infomorphBonus: 2,
          },
        },
      ],
    },
    [String(SECOND_DEN_ID)]: {
      mercenaryDenID: SECOND_DEN_ID,
      ownerCharacterID: ACTIVE_CHARACTER_ID,
      skyhookID: 660000002,
      solarSystemID: SOLAR_SYSTEM_ID,
      planetID: 40000002,
      typeID: 1,
      enabled: false,
      cargoExtractionEnabled: false,
      skyhookOwnerCorporationID: SKYHOOK_OWNER_CORPORATION_ID,
      nextGenerationAtMs: Date.now() + 3 * 60 * 60 * 1000,
      activities: [
        {
          activityID: SECOND_ACTIVITY_ID,
          mercenaryDenID: SECOND_DEN_ID,
          solarSystemID: SOLAR_SYSTEM_ID,
          started: false,
          expiryMs: Date.now() + 90 * 60 * 1000,
          template: {
            templateID: 2,
            nameMessageID: 330000002,
            descriptionMessageID: 330000012,
            dungeonID: 8800002,
            developmentImpact: 0,
            anarchyImpact: 1,
            infomorphBonus: 1,
          },
        },
      ],
    },
  };
  database.write("sovereignty", "/", table);
  resetMercenaryDenStateForTests();
  resetSovereigntyStateForTests();
}

test("mercenary den gateway request families round-trip on exact proto payloads with live started notices", (t) => {
  seedMercenaryDens(t);

  const stream = new FakeGatewayNoticeStream();
  assert.equal(
    publicGatewayLocal.handleGatewayStream(stream, {
      ":path": "/eve_public.gateway.Notices/Consume",
    }),
    true,
  );
  t.after(() => {
    stream.emit("close");
  });

  const ownedResponse = sendGatewayRequest(
    "eve_public.sovereignty.mercenaryden.api.GetAllOwnedRequest",
    SOV_TYPES.mercenaryDenGetAllOwnedRequest,
    {},
  );
  assert.equal(ownedResponse.status_code, 200);
  const ownedPayload = SOV_TYPES.mercenaryDenGetAllOwnedResponse.decode(
    ownedResponse.payload.value,
  );
  assert.deepEqual(
    ownedPayload.id.map((entry) => Number(entry.sequential)),
    [FIRST_DEN_ID, SECOND_DEN_ID],
  );

  const maximumResponse = sendGatewayRequest(
    "eve_public.sovereignty.mercenaryden.api.GetMaximumForCharacterRequest",
    SOV_TYPES.mercenaryDenGetMaximumForCharacterRequest,
    {},
  );
  const maximumPayload = SOV_TYPES.mercenaryDenGetMaximumForCharacterResponse.decode(
    maximumResponse.payload.value,
  );
  assert.equal(Number(maximumPayload.current_maximum), 5);
  assert.equal(Number(maximumPayload.absolute_maximum), 6);

  const ownerResponse = sendGatewayRequest(
    "eve_public.sovereignty.mercenaryden.api.GetAsOwnerRequest",
    SOV_TYPES.mercenaryDenGetAsOwnerRequest,
    { id: { sequential: FIRST_DEN_ID } },
  );
  assert.equal(ownerResponse.status_code, 200);
  const ownerPayload = SOV_TYPES.mercenaryDenGetAsOwnerResponse.decode(
    ownerResponse.payload.value,
  );
  assert.equal(Number(ownerPayload.attributes.owner.sequential), ACTIVE_CHARACTER_ID);
  assert.equal(Number(ownerPayload.attributes.skyhook.sequential), 660000001);
  assert.equal(ownerPayload.enabled, true);
  assert.equal(ownerPayload.cargo_extraction_enabled, true);
  assert.equal(
    Number(ownerPayload.skyhook_owner.sequential),
    SKYHOOK_OWNER_CORPORATION_ID,
  );

  const allActivitiesResponse = sendGatewayRequest(
    "eve_public.sovereignty.mercenaryden.activity.api.GetAllRequest",
    SOV_TYPES.mercenaryActivityGetAllRequest,
    {},
  );
  assert.equal(allActivitiesResponse.status_code, 200);
  const allActivitiesPayload = SOV_TYPES.mercenaryActivityGetAllResponse.decode(
    allActivitiesResponse.payload.value,
  );
  assert.deepEqual(
    allActivitiesPayload.activities.map((entry) =>
      Buffer.from(entry.id.uuid).toString("hex"),
    ),
    [
      FIRST_ACTIVITY_ID.replace(/-/g, ""),
      SECOND_ACTIVITY_ID.replace(/-/g, ""),
    ],
  );

  const perDenResponse = sendGatewayRequest(
    "eve_public.sovereignty.mercenaryden.activity.api.GetForMercenaryDenRequest",
    SOV_TYPES.mercenaryActivityGetForDenRequest,
    { mercenary_den: { sequential: FIRST_DEN_ID } },
  );
  assert.equal(perDenResponse.status_code, 200);
  const perDenPayload = SOV_TYPES.mercenaryActivityGetForDenResponse.decode(
    perDenResponse.payload.value,
  );
  assert.equal(perDenPayload.activities.length, 1);
  assert.equal(
    Number(perDenPayload.activities[0].attributes.mercenary_den.sequential),
    FIRST_DEN_ID,
  );
  assert.equal(Number(perDenPayload.next_generation_at.seconds) > 0, true);

  const capacityResponse = sendGatewayRequest(
    "eve_public.sovereignty.mercenaryden.activity.api.GetCapacityRequest",
    SOV_TYPES.mercenaryActivityGetCapacityRequest,
    {},
  );
  assert.equal(capacityResponse.status_code, 200);
  const capacityPayload = SOV_TYPES.mercenaryActivityGetCapacityResponse.decode(
    capacityResponse.payload.value,
  );
  assert.equal(Number(capacityPayload.capacity), 3);

  stream.frames = [];
  const startResponse = sendGatewayRequest(
    "eve_public.sovereignty.mercenaryden.activity.api.StartRequest",
    SOV_TYPES.mercenaryActivityStartRequest,
    { id: { uuid: Buffer.from(FIRST_ACTIVITY_ID.replace(/-/g, ""), "hex") } },
  );
  assert.equal(startResponse.status_code, 200);
  const startPayload = SOV_TYPES.mercenaryActivityStartResponse.decode(
    startResponse.payload.value,
  );
  assert.equal(startPayload.attributes.started, true);
  assert.equal(
    Number(startPayload.attributes.mercenary_den.sequential),
    FIRST_DEN_ID,
  );

  const notices = decodeGatewayNotices(stream);
  const startedNoticeEnvelope = notices.find(
    (notice) =>
      notice.payload.type_url ===
      "type.googleapis.com/eve_public.sovereignty.mercenaryden.activity.api.StartedNotice",
  );
  assert.ok(startedNoticeEnvelope);
  const startedNotice = SOV_TYPES.mercenaryActivityStartedNotice.decode(
    startedNoticeEnvelope.payload.value,
  );
  assert.equal(startedNotice.activity.started, true);
  assert.equal(
    Number(startedNoticeEnvelope.target_group.character),
    ACTIVE_CHARACTER_ID,
  );

  const forbiddenResponse = sendGatewayRequest(
    "eve_public.sovereignty.mercenaryden.api.GetAsOwnerRequest",
    SOV_TYPES.mercenaryDenGetAsOwnerRequest,
    { id: { sequential: FIRST_DEN_ID } },
    OTHER_CHARACTER_ID,
  );
  assert.equal(forbiddenResponse.status_code, 403);
});
