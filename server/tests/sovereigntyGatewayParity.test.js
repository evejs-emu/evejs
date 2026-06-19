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
  grantItemToCharacterStationHangar,
  ITEMS_TABLE,
} = require(path.join(repoRoot, "server/src/services/inventory/itemStore"));
const structureState = require(path.join(
  repoRoot,
  "server/src/services/structure/structureState",
));
const sessionRegistry = require(path.join(
  repoRoot,
  "server/src/services/chat/sessionRegistry",
));
const {
  getSovereigntyProtoRoot,
  getSovereigntyProtoTypes,
} = require(path.join(
  repoRoot,
  "server/src/services/sovereignty/sovGatewayProto",
));
const {
  getSovereigntyStaticSnapshot,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovStaticData"));
const {
  getHubUpgrades,
  getHubResources,
  getWorkforceConfiguration,
  getWorkforceState,
  resetSovereigntyModernStateForTests,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovModernState"));
const {
  resetSovereigntyStateForTests,
  upsertSystemState,
} = require(path.join(repoRoot, "server/src/services/sovereignty/sovState"));

const ACTIVE_CHARACTER_ID = 140000003;
const UNAUTHORIZED_CHARACTER_ID = 140000002;
const CORPORATION_ID = 98000000;
const ALLIANCE_ID = 99000000;
const SKYHOOK_ITEM_ID_OFFSET = 1000000000000;
const HUB_1_ID = 660000001;
const HUB_2_ID = 660000002;
const CLAIM_1_ID = 550000001;
const CLAIM_2_ID = 550000002;
const SOV_PROTO_ROOT = getSovereigntyProtoRoot();
const SOV_TYPES = getSovereigntyProtoTypes();
const STATIC_LOCAL_HUB_ID = 440000102;
const STRUCTURES_TABLE = "structures";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("published static SovHubs bootstrap empty modern upgrade and workforce state", (t) => {
  const sovereigntySnapshot = cloneValue(
    database.read("sovereignty", "/").data || {},
  );
  const structuresSnapshot = cloneValue(
    database.read(STRUCTURES_TABLE, "/").data || {},
  );
  t.after(() => {
    database.write("sovereignty", "/", sovereigntySnapshot);
    database.write(STRUCTURES_TABLE, "/", structuresSnapshot);
    structureState.clearStructureCaches();
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
  });

  database.write(STRUCTURES_TABLE, "/", {
    ...(structuresSnapshot || {}),
    structures: [
      ...((structuresSnapshot && structuresSnapshot.structures) || []).filter(
        (structure) => Number(structure && structure.structureID) !== STATIC_LOCAL_HUB_ID,
      ),
      {
        structureID: STATIC_LOCAL_HUB_ID,
        typeID: 32458,
        name: "Fixture Static SovHub",
        itemName: "Fixture Static SovHub",
        ownerCorpID: CORPORATION_ID,
        ownerID: CORPORATION_ID,
        allianceID: ALLIANCE_ID,
        solarSystemID: 30000142,
        position: { x: 0, y: 0, z: 0 },
        rotation: [0, 0, 0],
        radius: 45000,
        state: 1,
        destroyedAt: 0,
        published: true,
      },
    ],
  });
  structureState.clearStructureCaches();

  const table = cloneValue(sovereigntySnapshot);
  table.hubs = table.hubs || {};
  delete table.hubs[String(STATIC_LOCAL_HUB_ID)];
  database.write("sovereignty", "/", table);
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();

  const identity = {
    corporationID: CORPORATION_ID,
    allianceID: ALLIANCE_ID,
    solarSystemID: 30000142,
  };
  const upgrades = getHubUpgrades(STATIC_LOCAL_HUB_ID, identity);
  const configuration = getWorkforceConfiguration(
    STATIC_LOCAL_HUB_ID,
    identity,
  );
  const workforce = getWorkforceState(STATIC_LOCAL_HUB_ID, identity);

  assert.equal(upgrades && upgrades.ok, undefined);
  assert.deepEqual(upgrades.upgrades, []);
  assert.equal(configuration && configuration.ok, undefined);
  assert.equal(configuration.configuration.mode, "inactive");
  assert.equal(workforce && workforce.ok, undefined);
  assert.equal(workforce.state.mode, "inactive");

  const upgradeResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.upgrade.api.GetHubUpgradesRequest",
    SOV_TYPES.upgradeGetHubUpgradesRequest,
    { hub: { sequential: STATIC_LOCAL_HUB_ID } },
  );
  assert.equal(upgradeResponse.status_code, 200);
  const upgradePayload = SOV_TYPES.upgradeGetHubUpgradesResponse.decode(
    upgradeResponse.payload.value,
  );
  assert.deepEqual(upgradePayload.hub_upgrades.upgrades, []);

  const configurationResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.workforce.api.GetConfigurationRequest",
    SOV_TYPES.workforceGetConfigurationRequest,
    { hub: { sequential: STATIC_LOCAL_HUB_ID } },
  );
  assert.equal(configurationResponse.status_code, 200);

  const stateResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.workforce.api.GetStateRequest",
    SOV_TYPES.workforceGetStateRequest,
    { hub: { sequential: STATIC_LOCAL_HUB_ID } },
  );
  assert.equal(stateResponse.status_code, 200);
});

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

function decodeGrpcFramePayload(frame) {
  assert.equal(frame[0], 0);
  const payloadLength = frame.readUInt32BE(1);
  assert.equal(frame.length, payloadLength + 5);
  return frame.subarray(5);
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

function decodeGatewayNotices(stream) {
  const NoticeEnvelope = publicGatewayLocal._testing.PROTO_ROOT.lookupType(
    "eve_public.Notice",
  );
  return stream.frames.map((frame) =>
    NoticeEnvelope.decode(decodeGrpcFramePayload(frame)),
  );
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

function pickFixtureSystems(staticSnapshot) {
  const systemScores = [...staticSnapshot.planetsBySolarSystemID.entries()]
    .map(([solarSystemID, planetIDs]) => ({
      solarSystemID,
      workforce: planetIDs.reduce((sum, planetID) => {
        const definition = staticSnapshot.planetDefinitionsByPlanetID.get(planetID);
        return sum + Number(definition && definition.workforce ? definition.workforce : 0);
      }, 0),
      planetCount: planetIDs.length,
    }))
    .filter((entry) => entry.planetCount > 0)
    .sort((left, right) => {
      if (right.workforce !== left.workforce) {
        return right.workforce - left.workforce;
      }
      return left.solarSystemID - right.solarSystemID;
    });
  assert.ok(systemScores.length >= 2, "expected at least two sovereignty-capable systems");
  return [systemScores[0].solarSystemID, systemScores[1].solarSystemID];
}

function seedSovereigntyGatewayFixture(t) {
  const sovereigntySnapshot = cloneValue(
    database.read("sovereignty", "/").data || {},
  );
  const itemsSnapshot = cloneValue(database.read(ITEMS_TABLE, "/").data || {});
  t.after(() => {
    database.write("sovereignty", "/", cloneValue(sovereigntySnapshot));
    database.write(ITEMS_TABLE, "/", cloneValue(itemsSnapshot));
    resetSovereigntyStateForTests();
    resetSovereigntyModernStateForTests();
  });

  database.write("sovereignty", "/", {
    ...(sovereigntySnapshot || {}),
    alliances: {},
    systems: {},
    hubs: {},
    skyhooks: {},
    mercenaryDens: {},
  });
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();

  const staticSnapshot = getSovereigntyStaticSnapshot();
  const [solarSystem1, solarSystem2] = pickFixtureSystems(staticSnapshot);
  const system1Planets = staticSnapshot.planetsBySolarSystemID.get(solarSystem1) || [];
  const system2Planets = staticSnapshot.planetsBySolarSystemID.get(solarSystem2) || [];
  assert.ok(system1Planets.length > 0);
  assert.ok(system2Planets.length > 0);

  upsertSystemState(solarSystem1, {
    solarSystemID: solarSystem1,
    allianceID: ALLIANCE_ID,
    corporationID: CORPORATION_ID,
    claimStructureID: CLAIM_1_ID,
    infrastructureHubID: HUB_1_ID,
    devIndices: {
      claimedForDays: 100,
    },
  });
  upsertSystemState(solarSystem2, {
    solarSystemID: solarSystem2,
    allianceID: ALLIANCE_ID,
    corporationID: CORPORATION_ID,
    claimStructureID: CLAIM_2_ID,
    infrastructureHubID: HUB_2_ID,
    devIndices: {
      claimedForDays: 100,
    },
  });

  assert.ok(getHubResources(HUB_1_ID), "expected first hub to bootstrap");
  assert.ok(getHubResources(HUB_2_ID), "expected second hub to bootstrap");
  const initialHub1Resources = getHubResources(HUB_1_ID);

  const planet1ID = system1Planets[0];
  const planet2ID = system1Planets[1] || system2Planets[0];
  const skyhook1SolarSystemID = solarSystem1;
  const skyhook2SolarSystemID = system1Planets[1] ? solarSystem1 : solarSystem2;
  const skyhook1ID = SKYHOOK_ITEM_ID_OFFSET + planet1ID;
  const skyhook2ID = SKYHOOK_ITEM_ID_OFFSET + planet2ID;
  const upgradeDefinition =
    staticSnapshot.upgradeDefinitions.find(
      (definition) =>
        Number(definition.powerRequired || 0) <=
          Number(initialHub1Resources.power.available || 0) &&
        Number(definition.workforceRequired || 0) <=
          Number(initialHub1Resources.workforce.available || 0),
    ) || staticSnapshot.upgradeDefinitions[0];
  assert.ok(upgradeDefinition, "expected at least one sovereignty upgrade definition");

  const table = cloneValue(database.read("sovereignty", "/").data || {});
  table.hubs[String(HUB_1_ID)].installedUpgrades = [
    {
      typeID: upgradeDefinition.installationTypeID,
      online: false,
    },
  ];
  table.hubs[String(HUB_1_ID)].upgradesLastUpdatedMs = Date.now();
  table.skyhooks[String(skyhook1ID)].active = true;
  table.skyhooks[String(skyhook1ID)].theftVulnerability = {
    startMs: Date.now() - 60_000,
    endMs: Date.now() + 60 * 60 * 1000,
  };
  table.skyhooks[String(skyhook2ID)].active = false;
  table.skyhooks[String(skyhook2ID)].theftVulnerability = {
    startMs: Date.now() + 15 * 60 * 1000,
    endMs: Date.now() + 75 * 60 * 1000,
  };
  database.write("sovereignty", "/", table);
  resetSovereigntyStateForTests();
  resetSovereigntyModernStateForTests();

  const sessionStamp = Number.MAX_SAFE_INTEGER - 1000;
  const ownerSession = {
    characterID: ACTIVE_CHARACTER_ID,
    corporationID: CORPORATION_ID,
    corpid: CORPORATION_ID,
    allianceID: ALLIANCE_ID,
    allianceid: ALLIANCE_ID,
    solarsystemid2: solarSystem1,
    solarsystemid: solarSystem1,
    lastActivity: sessionStamp + 1,
    connectTime: sessionStamp + 1,
    clientID: 9_900_001,
    socket: { destroyed: false },
  };
  const unauthorizedSession = {
    characterID: UNAUTHORIZED_CHARACTER_ID,
    corporationID: 1000044,
    corpid: 1000044,
    allianceID: 0,
    allianceid: 0,
    solarsystemid2: solarSystem1,
    solarsystemid: solarSystem1,
    lastActivity: sessionStamp + 2,
    connectTime: sessionStamp + 2,
    clientID: 9_900_002,
    socket: { destroyed: false },
  };
  sessionRegistry.register(ownerSession);
  sessionRegistry.register(unauthorizedSession);
  t.after(() => {
    sessionRegistry.unregister(ownerSession);
    sessionRegistry.unregister(unauthorizedSession);
  });

  return {
    staticSnapshot,
    solarSystem1,
    solarSystem2,
    hub1ID: HUB_1_ID,
    hub2ID: HUB_2_ID,
    skyhook1ID,
    skyhook2ID,
    skyhook1SolarSystemID,
    skyhook2SolarSystemID,
    upgradeDefinition,
  };
}

test("sovereignty resource and hub readers serve proto-shaped payloads with ownership gating", (t) => {
  const fixture = seedSovereigntyGatewayFixture(t);

  const definitionsResponse = sendGatewayRequest(
    "eve_public.sovereignty.resource.planet.api.GetAllDefinitionsRequest",
    SOV_TYPES.planetGetAllDefinitionsRequest,
    { no_known_version: true },
  );
  assert.equal(definitionsResponse.status_code, 200);
  const definitionsPayload = SOV_TYPES.planetGetAllDefinitionsResponse.decode(
    definitionsResponse.payload.value,
  );
  assert.ok(definitionsPayload.definitions.length > 0);
  assert.equal(
    Number(definitionsPayload.version.major),
    fixture.staticSnapshot.planetDefinitionsVersion.major,
  );

  const notModifiedResponse = sendGatewayRequest(
    "eve_public.sovereignty.resource.planet.api.GetAllDefinitionsRequest",
    SOV_TYPES.planetGetAllDefinitionsRequest,
    { known_version: definitionsPayload.version },
  );
  assert.equal(notModifiedResponse.status_code, 304);

  const versionMissResponse = sendGatewayRequest(
    "eve_public.sovereignty.resource.planet.api.GetDefinitionsVersionRequest",
    SOV_TYPES.planetGetDefinitionsVersionRequest,
    {
      version: {
        major: 1,
        minor: 0,
        patch: 0,
      },
    },
  );
  assert.equal(versionMissResponse.status_code, 404);

  const starResponse = sendGatewayRequest(
    "eve_public.sovereignty.resource.star.api.GetAllConfigurationsRequest",
    SOV_TYPES.starGetAllConfigurationsRequest,
    {},
  );
  assert.equal(starResponse.status_code, 200);
  const starPayload = SOV_TYPES.starGetAllConfigurationsResponse.decode(
    starResponse.payload.value,
  );
  assert.ok(starPayload.configurations.length > 0);

  const resourcesResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.api.GetResourcesRequest",
    SOV_TYPES.hubGetResourcesRequest,
    { hub: { sequential: fixture.hub1ID } },
  );
  assert.equal(resourcesResponse.status_code, 200);
  const resourcesPayload = SOV_TYPES.hubGetResourcesResponse.decode(
    resourcesResponse.payload.value,
  );
  assert.ok(Number(resourcesPayload.power.local_harvest) >= 100);
  assert.ok(Number(resourcesPayload.workforce.local_harvest) > 0);

  const forbiddenResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.api.GetResourcesRequest",
    SOV_TYPES.hubGetResourcesRequest,
    { hub: { sequential: fixture.hub1ID } },
    UNAUTHORIZED_CHARACTER_ID,
  );
  assert.equal(forbiddenResponse.status_code, 403);

  const allLocalResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.GetAllLocalRequest",
    SOV_TYPES.skyhookGetAllLocalRequest,
    {},
  );
  assert.equal(allLocalResponse.status_code, 200);
  const allLocalPayload = SOV_TYPES.skyhookGetAllLocalResponse.decode(
    allLocalResponse.payload.value,
  );
  assert.equal(Number(allLocalPayload.solar_system.sequential), fixture.solarSystem1);
  assert.ok(
    allLocalPayload.skyhooks.some(
      (entry) => Number(entry.skyhook.sequential) === fixture.skyhook1ID,
    ),
  );

  const vulnerableSystemsResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.GetSolarSystemsWithTheftVulnerableSkyhooksRequest",
    SOV_TYPES.skyhookGetSolarSystemsWithTheftVulnerableRequest,
    {},
  );
  assert.equal(vulnerableSystemsResponse.status_code, 200);
  const vulnerableSystemsPayload =
    SOV_TYPES.skyhookGetSolarSystemsWithTheftVulnerableResponse.decode(
      vulnerableSystemsResponse.payload.value,
    );
  assert.ok(
    vulnerableSystemsPayload.solar_systems.some(
      (entry) => Number(entry.sequential) === fixture.skyhook1SolarSystemID,
    ),
  );
});

test("sovereignty hub upgrade, fuel, and workforce flows round-trip with live notices", (t) => {
  const fixture = seedSovereigntyGatewayFixture(t);
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

  const getUpgradesResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.upgrade.api.GetHubUpgradesRequest",
    SOV_TYPES.upgradeGetHubUpgradesRequest,
    { hub: { sequential: fixture.hub1ID } },
  );
  assert.equal(getUpgradesResponse.status_code, 200);
  const getUpgradesPayload = SOV_TYPES.upgradeGetHubUpgradesResponse.decode(
    getUpgradesResponse.payload.value,
  );
  assert.equal(getUpgradesPayload.hub_upgrades.upgrades.length, 1);
  assert.equal(
    Number(getUpgradesPayload.hub_upgrades.upgrades[0].attributes.power_state),
    1,
  );

  stream.frames = [];
  const configureResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.upgrade.api.ProcessConfigurationRequest",
    SOV_TYPES.upgradeProcessConfigurationRequest,
    {
      hub: { sequential: fixture.hub1ID },
      new_upgrades: [],
      configuration: [
        {
          upgrade_type: {
            sequential: fixture.upgradeDefinition.installationTypeID,
          },
          online: true,
        },
      ],
    },
  );
  assert.equal(configureResponse.status_code, 200);
  const configurePayload = SOV_TYPES.upgradeProcessConfigurationResponse.decode(
    configureResponse.payload.value,
  );
  assert.equal(configurePayload.hub_upgrades.upgrades.length, 1);
  assert.equal(
    Number(configurePayload.hub_upgrades.upgrades[0].attributes.power_state),
    2,
  );
  const configureNotices = decodeGatewayNotices(stream);
  assert.ok(
    configureNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.hub.upgrade.api.HubUpgradesConfiguredNotice",
    ),
  );
  assert.ok(
    configureNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.hub.api.ResourcesSimulatedNotice",
    ),
  );

  const fuelGrant = grantItemToCharacterStationHangar(
    ACTIVE_CHARACTER_ID,
    60003760,
    { typeID: fixture.upgradeDefinition.fuelTypeID },
    25,
  );
  assert.equal(fuelGrant.success, true);
  const fuelItemID = Number(
    fuelGrant.data &&
      fuelGrant.data.items &&
      fuelGrant.data.items[0] &&
      fuelGrant.data.items[0].itemID,
  );
  assert.ok(fuelItemID > 0);

  const addFuelResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.fuel.api.AddRequest",
    SOV_TYPES.fuelAddRequest,
    {
      hub: { sequential: fixture.hub1ID },
      fuel_item: { sequential: fuelItemID },
      amount: 25,
    },
  );
  assert.equal(addFuelResponse.status_code, 200);

  const fuelResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.fuel.api.GetRequest",
    SOV_TYPES.fuelGetRequest,
    { hub: { sequential: fixture.hub1ID } },
  );
  assert.equal(fuelResponse.status_code, 200);
  const fuelPayload = SOV_TYPES.fuelGetResponse.decode(fuelResponse.payload.value);
  const matchingFuel = fuelPayload.fuels.find(
    (entry) => Number(entry.fuel_type.sequential) === fixture.upgradeDefinition.fuelTypeID,
  );
  assert.ok(matchingFuel);
  assert.equal(Number(matchingFuel.amount), 25);

  const resourcesBeforeWorkforce = SOV_TYPES.hubGetResourcesResponse.decode(
    sendGatewayRequest(
      "eve_public.sovereignty.hub.api.GetResourcesRequest",
      SOV_TYPES.hubGetResourcesRequest,
      { hub: { sequential: fixture.hub1ID } },
    ).payload.value,
  );

  stream.frames = [];
  const workforceConfigureResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.workforce.api.ConfigureRequest",
    SOV_TYPES.workforceConfigureRequest,
    {
      hub: { sequential: fixture.hub1ID },
      configuration: {
        import_settings: {
          sources: [{ source: { sequential: fixture.solarSystem2 } }],
        },
      },
    },
  );
  assert.equal(workforceConfigureResponse.status_code, 200);

  const workforceConfigResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.workforce.api.GetConfigurationRequest",
    SOV_TYPES.workforceGetConfigurationRequest,
    { hub: { sequential: fixture.hub1ID } },
  );
  const workforceConfigPayload =
    SOV_TYPES.workforceGetConfigurationResponse.decode(
      workforceConfigResponse.payload.value,
    );
  assert.equal(
    workforceConfigPayload.configuration.import_settings.sources.length,
    1,
  );
  assert.equal(
    Number(
      workforceConfigPayload.configuration.import_settings.sources[0].source.sequential,
    ),
    fixture.solarSystem2,
  );

  const workforceStateResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.workforce.api.GetStateRequest",
    SOV_TYPES.workforceGetStateRequest,
    { hub: { sequential: fixture.hub1ID } },
  );
  assert.equal(workforceStateResponse.status_code, 200);
  const workforceStatePayload = SOV_TYPES.workforceGetStateResponse.decode(
    workforceStateResponse.payload.value,
  );
  assert.equal(workforceStatePayload.state.import_state.sources.length, 1);
  assert.ok(Number(workforceStatePayload.state.import_state.sources[0].amount) > 0);

  const networkableResponse = sendGatewayRequest(
    "eve_public.sovereignty.hub.workforce.api.GetNetworkableHubsRequest",
    SOV_TYPES.workforceGetNetworkableHubsRequest,
    { hub: { sequential: fixture.hub1ID } },
  );
  assert.equal(networkableResponse.status_code, 200);
  const networkablePayload =
    SOV_TYPES.workforceGetNetworkableHubsResponse.decode(
      networkableResponse.payload.value,
    );
  assert.ok(
    networkablePayload.hubs.some(
      (entry) => Number(entry.hub.sequential) === fixture.hub2ID,
    ),
  );

  const resourcesAfterWorkforce = SOV_TYPES.hubGetResourcesResponse.decode(
    sendGatewayRequest(
      "eve_public.sovereignty.hub.api.GetResourcesRequest",
      SOV_TYPES.hubGetResourcesRequest,
      { hub: { sequential: fixture.hub1ID } },
    ).payload.value,
  );
  assert.ok(
    Number(resourcesAfterWorkforce.workforce.available) >
      Number(resourcesBeforeWorkforce.workforce.available),
  );

  const workforceNotices = decodeGatewayNotices(stream);
  assert.ok(
    workforceNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.resource.transfer.workforce.api.ConfiguredNotice",
    ),
  );
  assert.ok(
    workforceNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.resource.transfer.workforce.api.StateChangedNotice",
    ),
  );
  assert.ok(
    workforceNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.hub.api.ResourcesSimulatedNotice",
    ),
  );
});

test("sovereignty skyhook requests and live notices stay on parity with the dedicated gateway service", (t) => {
  const fixture = seedSovereigntyGatewayFixture(t);
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

  const byCorporationResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.GetAllByCorporationRequest",
    SOV_TYPES.skyhookGetAllByCorporationRequest,
    { corporation: { sequential: CORPORATION_ID } },
  );
  assert.equal(byCorporationResponse.status_code, 200);
  const byCorporationPayload = SOV_TYPES.skyhookGetAllByCorporationResponse.decode(
    byCorporationResponse.payload.value,
  );
  assert.ok(byCorporationPayload.skyhooks.length >= 2);

  const vulnerableResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.GetTheftVulnerableSkyhooksInSolarSystemRequest",
    SOV_TYPES.skyhookGetTheftVulnerableInSolarSystemRequest,
    { solar_system: { sequential: fixture.skyhook1SolarSystemID } },
  );
  assert.equal(vulnerableResponse.status_code, 200);
  const vulnerablePayload =
    SOV_TYPES.skyhookGetTheftVulnerableInSolarSystemResponse.decode(
      vulnerableResponse.payload.value,
    );
  assert.ok(
    vulnerablePayload.skyhooks.some(
      (entry) => Number(entry.skyhook.sequential) === fixture.skyhook1ID,
    ),
  );

  stream.frames = [];
  const activateResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.ActivateRequest",
    SOV_TYPES.skyhookActivateRequest,
    { skyhook: { sequential: fixture.skyhook2ID } },
  );
  assert.equal(activateResponse.status_code, 200);
  const activateNotices = decodeGatewayNotices(stream);
  assert.ok(
    activateNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.skyhook.api.ActivationNotice",
    ),
  );
  assert.ok(
    activateNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.skyhook.api.TheftVulnerabilityWindowScheduledNotice",
    ),
  );
  assert.ok(
    activateNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.skyhook.api.AllInSolarSystemNotice",
    ),
  );

  const activatedSkyhookResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.GetRequest",
    SOV_TYPES.skyhookGetRequest,
    { skyhook: { sequential: fixture.skyhook2ID } },
  );
  assert.equal(activatedSkyhookResponse.status_code, 200);
  const activatedSkyhookPayload = SOV_TYPES.skyhookGetResponse.decode(
    activatedSkyhookResponse.payload.value,
  );
  assert.equal(activatedSkyhookPayload.active, true);

  stream.frames = [];
  const modifyReagentsResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.admin.ModifyReagentsRequest",
    SOV_TYPES.skyhookModifyReagentsRequest,
    {
      skyhook: { sequential: fixture.skyhook2ID },
      reagents: [
        {
          reagent_type: { sequential: 81143 },
          secured_stock: 111,
          unsecured_stock: 222,
          now: true,
        },
      ],
    },
  );
  assert.equal(modifyReagentsResponse.status_code, 200);
  const modifyNotices = decodeGatewayNotices(stream);
  assert.ok(
    modifyNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.skyhook.api.ReagentSimulationsNotice",
    ),
  );
  assert.ok(
    modifyNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.skyhook.api.AllInSolarSystemNotice",
    ),
  );

  stream.frames = [];
  const deactivateResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.DeactivateRequest",
    SOV_TYPES.skyhookDeactivateRequest,
    { skyhook: { sequential: fixture.skyhook1ID } },
  );
  assert.equal(deactivateResponse.status_code, 200);
  const deactivateNotices = decodeGatewayNotices(stream);
  assert.ok(
    deactivateNotices.some(
      (notice) =>
        notice.payload.type_url ===
        "type.googleapis.com/eve_public.sovereignty.skyhook.api.TheftVulnerabilityWindowEndedNotice",
    ),
  );

  const localSkyhookResponse = sendGatewayRequest(
    "eve_public.sovereignty.skyhook.api.GetRequest",
    SOV_TYPES.skyhookGetRequest,
    { skyhook: { sequential: fixture.skyhook1ID } },
  );
  const localSkyhookPayload = SOV_TYPES.skyhookGetResponse.decode(
    localSkyhookResponse.payload.value,
  );
  assert.equal(localSkyhookPayload.active, false);
});
