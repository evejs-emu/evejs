const protobuf = require("protobufjs");
const protoBundle = require("./sovGatewayProto.bundle.json");

const SOVEREIGNTY_PROTO_ENTRY_FILES = Object.freeze([
  "eve_public/sovereignty/hub/api/requests.proto",
  "eve_public/sovereignty/hub/api/notices.proto",
  "eve_public/sovereignty/hub/upgrade/api/requests.proto",
  "eve_public/sovereignty/hub/upgrade/api/notices.proto",
  "eve_public/sovereignty/hub/fuel/api/requests.proto",
  "eve_public/sovereignty/hub/workforce/api/requests.proto",
  "eve_public/sovereignty/hub/workforce/api/notices.proto",
  "eve_public/sovereignty/resource/planet/api/requests.proto",
  "eve_public/sovereignty/resource/star/api/requests.proto",
  "eve_public/sovereignty/skyhook/api/requests.proto",
  "eve_public/sovereignty/skyhook/api/notices.proto",
  "eve_public/sovereignty/skyhook/api/admin/admin.proto",
  "eve_public/sovereignty/mercenaryden/api/requests.proto",
  "eve_public/sovereignty/mercenaryden/api/notices.proto",
  "eve_public/sovereignty/mercenaryden/activity/api/requests.proto",
  "eve_public/sovereignty/mercenaryden/activity/api/notices.proto",
]);

let protoRootCache = null;
let protoTypeCache = null;

function buildSovereigntyProtoRoot() {
  const rootJson = protoBundle.root || protoBundle;
  return protobuf.Root.fromJSON(rootJson).resolveAll();
}

function getSovereigntyProtoRoot() {
  if (!protoRootCache) {
    protoRootCache = buildSovereigntyProtoRoot();
  }
  return protoRootCache;
}

function lookupType(name) {
  return getSovereigntyProtoRoot().lookupType(name);
}

function getSovereigntyProtoTypes() {
  if (protoTypeCache) {
    return protoTypeCache;
  }

  const root = getSovereigntyProtoRoot();
  protoTypeCache = {
    hubGetResourcesRequest: root.lookupType(
      "eve_public.sovereignty.hub.api.GetResourcesRequest",
    ),
    hubGetResourcesResponse: root.lookupType(
      "eve_public.sovereignty.hub.api.GetResourcesResponse",
    ),
    hubResourcesSimulatedNotice: root.lookupType(
      "eve_public.sovereignty.hub.api.ResourcesSimulatedNotice",
    ),
    planetGetAllDefinitionsRequest: root.lookupType(
      "eve_public.sovereignty.resource.planet.api.GetAllDefinitionsRequest",
    ),
    planetGetAllDefinitionsResponse: root.lookupType(
      "eve_public.sovereignty.resource.planet.api.GetAllDefinitionsResponse",
    ),
    planetGetDefinitionsVersionRequest: root.lookupType(
      "eve_public.sovereignty.resource.planet.api.GetDefinitionsVersionRequest",
    ),
    planetGetDefinitionsVersionResponse: root.lookupType(
      "eve_public.sovereignty.resource.planet.api.GetDefinitionsVersionResponse",
    ),
    starGetAllConfigurationsRequest: root.lookupType(
      "eve_public.sovereignty.resource.star.api.GetAllConfigurationsRequest",
    ),
    starGetAllConfigurationsResponse: root.lookupType(
      "eve_public.sovereignty.resource.star.api.GetAllConfigurationsResponse",
    ),
    upgradeGetDefinitionsRequest: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.GetDefinitionsRequest",
    ),
    upgradeGetDefinitionsResponse: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.GetDefinitionsResponse",
    ),
    upgradeGetHubUpgradesRequest: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.GetHubUpgradesRequest",
    ),
    upgradeGetHubUpgradesResponse: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.GetHubUpgradesResponse",
    ),
    upgradeProcessConfigurationRequest: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.ProcessConfigurationRequest",
    ),
    upgradeProcessConfigurationResponse: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.ProcessConfigurationResponse",
    ),
    upgradeUninstallRequest: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.UninstallRequest",
    ),
    upgradeUninstallResponse: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.UninstallResponse",
    ),
    upgradeConfiguredNotice: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.HubUpgradesConfiguredNotice",
    ),
    upgradeSimulatedNotice: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.HubUpgradesSimulatedNotice",
    ),
    upgradeUninstalledNotice: root.lookupType(
      "eve_public.sovereignty.hub.upgrade.api.UninstalledNotice",
    ),
    fuelGetRequest: root.lookupType(
      "eve_public.sovereignty.hub.fuel.api.GetRequest",
    ),
    fuelGetResponse: root.lookupType(
      "eve_public.sovereignty.hub.fuel.api.GetResponse",
    ),
    fuelAddRequest: root.lookupType(
      "eve_public.sovereignty.hub.fuel.api.AddRequest",
    ),
    fuelAddResponse: root.lookupType(
      "eve_public.sovereignty.hub.fuel.api.AddResponse",
    ),
    workforceGetConfigurationRequest: root.lookupType(
      "eve_public.sovereignty.hub.workforce.api.GetConfigurationRequest",
    ),
    workforceGetConfigurationResponse: root.lookupType(
      "eve_public.sovereignty.hub.workforce.api.GetConfigurationResponse",
    ),
    workforceConfigureRequest: root.lookupType(
      "eve_public.sovereignty.hub.workforce.api.ConfigureRequest",
    ),
    workforceConfigureResponse: root.lookupType(
      "eve_public.sovereignty.hub.workforce.api.ConfigureResponse",
    ),
    workforceGetStateRequest: root.lookupType(
      "eve_public.sovereignty.hub.workforce.api.GetStateRequest",
    ),
    workforceGetStateResponse: root.lookupType(
      "eve_public.sovereignty.hub.workforce.api.GetStateResponse",
    ),
    workforceGetNetworkableHubsRequest: root.lookupType(
      "eve_public.sovereignty.hub.workforce.api.GetNetworkableHubsRequest",
    ),
    workforceGetNetworkableHubsResponse: root.lookupType(
      "eve_public.sovereignty.hub.workforce.api.GetNetworkableHubsResponse",
    ),
    workforceConfiguredNotice: root.lookupType(
      "eve_public.sovereignty.resource.transfer.workforce.api.ConfiguredNotice",
    ),
    workforceStateChangedNotice: root.lookupType(
      "eve_public.sovereignty.resource.transfer.workforce.api.StateChangedNotice",
    ),
    skyhookGetRequest: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetRequest",
    ),
    skyhookGetResponse: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetResponse",
    ),
    skyhookGetAllLocalRequest: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetAllLocalRequest",
    ),
    skyhookGetAllLocalResponse: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetAllLocalResponse",
    ),
    skyhookGetAllByCorporationRequest: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetAllByCorporationRequest",
    ),
    skyhookGetAllByCorporationResponse: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetAllByCorporationResponse",
    ),
    skyhookActivateRequest: root.lookupType(
      "eve_public.sovereignty.skyhook.api.ActivateRequest",
    ),
    skyhookActivateResponse: root.lookupType(
      "eve_public.sovereignty.skyhook.api.ActivateResponse",
    ),
    skyhookDeactivateRequest: root.lookupType(
      "eve_public.sovereignty.skyhook.api.DeactivateRequest",
    ),
    skyhookDeactivateResponse: root.lookupType(
      "eve_public.sovereignty.skyhook.api.DeactivateResponse",
    ),
    skyhookGetSolarSystemsWithTheftVulnerableRequest: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetSolarSystemsWithTheftVulnerableSkyhooksRequest",
    ),
    skyhookGetSolarSystemsWithTheftVulnerableResponse: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetSolarSystemsWithTheftVulnerableSkyhooksResponse",
    ),
    skyhookGetTheftVulnerableInSolarSystemRequest: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetTheftVulnerableSkyhooksInSolarSystemRequest",
    ),
    skyhookGetTheftVulnerableInSolarSystemResponse: root.lookupType(
      "eve_public.sovereignty.skyhook.api.GetTheftVulnerableSkyhooksInSolarSystemResponse",
    ),
    skyhookModifyReagentsRequest: root.lookupType(
      "eve_public.sovereignty.skyhook.api.admin.ModifyReagentsRequest",
    ),
    skyhookModifyReagentsResponse: root.lookupType(
      "eve_public.sovereignty.skyhook.api.admin.ModifyReagentsResponse",
    ),
    skyhookReagentSimulationsNotice: root.lookupType(
      "eve_public.sovereignty.skyhook.api.ReagentSimulationsNotice",
    ),
    skyhookReagentDefinitionsNotice: root.lookupType(
      "eve_public.sovereignty.skyhook.api.ReagentDefinitionsNotice",
    ),
    skyhookAllInSolarSystemNotice: root.lookupType(
      "eve_public.sovereignty.skyhook.api.AllInSolarSystemNotice",
    ),
    skyhookTheftWindowScheduledNotice: root.lookupType(
      "eve_public.sovereignty.skyhook.api.TheftVulnerabilityWindowScheduledNotice",
    ),
    skyhookTheftWindowStartedNotice: root.lookupType(
      "eve_public.sovereignty.skyhook.api.TheftVulnerabilityWindowStartedNotice",
    ),
    skyhookTheftWindowEndedNotice: root.lookupType(
      "eve_public.sovereignty.skyhook.api.TheftVulnerabilityWindowEndedNotice",
    ),
    skyhookActivationNotice: root.lookupType(
      "eve_public.sovereignty.skyhook.api.ActivationNotice",
    ),
    skyhookWorkforceChangedNotice: root.lookupType(
      "eve_public.sovereignty.skyhook.api.WorkforceChangedNotice",
    ),
    mercenaryDenGetAsOwnerRequest: root.lookupType(
      "eve_public.sovereignty.mercenaryden.api.GetAsOwnerRequest",
    ),
    mercenaryDenGetAsOwnerResponse: root.lookupType(
      "eve_public.sovereignty.mercenaryden.api.GetAsOwnerResponse",
    ),
    mercenaryDenGetAllOwnedRequest: root.lookupType(
      "eve_public.sovereignty.mercenaryden.api.GetAllOwnedRequest",
    ),
    mercenaryDenGetAllOwnedResponse: root.lookupType(
      "eve_public.sovereignty.mercenaryden.api.GetAllOwnedResponse",
    ),
    mercenaryDenGetMaximumForCharacterRequest: root.lookupType(
      "eve_public.sovereignty.mercenaryden.api.GetMaximumForCharacterRequest",
    ),
    mercenaryDenGetMaximumForCharacterResponse: root.lookupType(
      "eve_public.sovereignty.mercenaryden.api.GetMaximumForCharacterResponse",
    ),
    mercenaryActivityGetForDenRequest: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.GetForMercenaryDenRequest",
    ),
    mercenaryActivityGetForDenResponse: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.GetForMercenaryDenResponse",
    ),
    mercenaryActivityGetAllRequest: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.GetAllRequest",
    ),
    mercenaryActivityGetAllResponse: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.GetAllResponse",
    ),
    mercenaryActivityStartRequest: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.StartRequest",
    ),
    mercenaryActivityStartResponse: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.StartResponse",
    ),
    mercenaryActivityGetCapacityRequest: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.GetCapacityRequest",
    ),
    mercenaryActivityGetCapacityResponse: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.GetCapacityResponse",
    ),
    mercenaryActivityAddedNotice: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.AddedNotice",
    ),
    mercenaryActivityStartedNotice: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.StartedNotice",
    ),
    mercenaryActivityCompletedNotice: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.CompletedNotice",
    ),
    mercenaryActivityRemovedNotice: root.lookupType(
      "eve_public.sovereignty.mercenaryden.activity.api.RemovedNotice",
    ),
  };

  return protoTypeCache;
}

module.exports = {
  SOVEREIGNTY_PROTO_ENTRY_FILES,
  buildSovereigntyProtoRoot,
  getSovereigntyProtoRoot,
  getSovereigntyProtoTypes,
  lookupType,
};
