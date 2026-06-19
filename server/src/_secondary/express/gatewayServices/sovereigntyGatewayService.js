const path = require("path");

const {
  bufferFromBytes,
  compareSemver,
  encodePayload,
  getActiveCharacterID,
  timestampFromMs,
  timestampToMs,
} = require("./gatewayServiceHelpers");
const {
  getSovereigntyProtoTypes,
} = require(path.join(
  __dirname,
  "../../../services/sovereignty/sovGatewayProto",
));
const {
  POWER_STATE,
  addHubFuel,
  configureWorkforce,
  getActiveCharacterIdentity,
  getHubIDForSolarSystem,
  getHubFuel,
  getHubResources,
  getHubUpgrades,
  getSkyhook,
  getWorkforceConfiguration,
  getWorkforceState,
  listLocalSkyhooks,
  listNetworkableHubs,
  listSkyhooksByCorporation,
  listSolarSystemsWithTheftVulnerableSkyhooks,
  listTheftVulnerableSkyhooksInSolarSystem,
  listUpgradeDefinitions,
  modifySkyhookReagents,
  processHubUpgradeConfiguration,
  setSkyhookActivation,
  uninstallHubUpgrade,
} = require(path.join(__dirname, "../../../services/sovereignty/sovModernState"));
const {
  getSovereigntyStaticSnapshot,
} = require(path.join(__dirname, "../../../services/sovereignty/sovStaticData"));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.sovereignty.hub.api.GetResourcesRequest",
  "eve_public.sovereignty.resource.planet.api.GetAllDefinitionsRequest",
  "eve_public.sovereignty.resource.planet.api.GetDefinitionsVersionRequest",
  "eve_public.sovereignty.resource.star.api.GetAllConfigurationsRequest",
  "eve_public.sovereignty.hub.upgrade.api.GetDefinitionsRequest",
  "eve_public.sovereignty.hub.upgrade.api.GetHubUpgradesRequest",
  "eve_public.sovereignty.hub.upgrade.api.ProcessConfigurationRequest",
  "eve_public.sovereignty.hub.upgrade.api.UninstallRequest",
  "eve_public.sovereignty.hub.fuel.api.GetRequest",
  "eve_public.sovereignty.hub.fuel.api.AddRequest",
  "eve_public.sovereignty.hub.workforce.api.GetConfigurationRequest",
  "eve_public.sovereignty.hub.workforce.api.ConfigureRequest",
  "eve_public.sovereignty.hub.workforce.api.GetStateRequest",
  "eve_public.sovereignty.hub.workforce.api.GetNetworkableHubsRequest",
  "eve_public.sovereignty.skyhook.api.GetRequest",
  "eve_public.sovereignty.skyhook.api.GetAllLocalRequest",
  "eve_public.sovereignty.skyhook.api.GetAllByCorporationRequest",
  "eve_public.sovereignty.skyhook.api.ActivateRequest",
  "eve_public.sovereignty.skyhook.api.DeactivateRequest",
  "eve_public.sovereignty.skyhook.api.GetSolarSystemsWithTheftVulnerableSkyhooksRequest",
  "eve_public.sovereignty.skyhook.api.GetTheftVulnerableSkyhooksInSolarSystemRequest",
  "eve_public.sovereignty.skyhook.api.admin.ModifyReagentsRequest",
]);

function buildErrorResult(requestTypeName, statusCode, errorCode = "") {
  return {
    statusCode,
    statusMessage: String(errorCode || ""),
    responseTypeName: requestTypeName.replace(/Request$/, "Response"),
    responsePayloadBuffer: Buffer.alloc(0),
  };
}

function decodePayload(messageType, requestEnvelope) {
  return messageType.decode(
    bufferFromBytes(requestEnvelope && requestEnvelope.payload && requestEnvelope.payload.value),
  );
}

function buildSequentialIdentifier(id) {
  return {
    sequential: Number(id || 0),
  };
}

function buildDurationFromSeconds(value) {
  return {
    seconds: Math.max(0, Math.trunc(Number(value || 0))),
    nanos: 0,
  };
}

function buildSemanticVersion(version = {}) {
  return {
    major: Number(version.major || 0),
    minor: Number(version.minor || 0),
    patch: Number(version.patch || 0),
    prerelease_tags: Array.isArray(version.prerelease_tags)
      ? version.prerelease_tags.map((entry) => String(entry))
      : [],
    build_tags: Array.isArray(version.build_tags)
      ? version.build_tags.map((entry) => String(entry))
      : [],
  };
}

function buildPlanetDefinitionPayload(definition) {
  return {
    planet: buildSequentialIdentifier(definition.planetID),
    power: Number(definition.power || 0),
    workforce: Number(definition.workforce || 0),
    reagent_definitions: (definition.reagentDefinitions || []).map((reagent) => ({
      type: buildSequentialIdentifier(reagent.reagentTypeID),
      reagent_type: buildSequentialIdentifier(reagent.reagentTypeID),
      definition: {
        amount_per_cycle: Number(reagent.amountPerCycle || 0),
        cycle_period: buildDurationFromSeconds(reagent.cyclePeriodSeconds),
        secured_percentage: Number(reagent.securedPercentage || 0),
        secured_capacity: Number(reagent.securedCapacity || 0),
        unsecured_capacity: Number(reagent.unsecuredCapacity || 0),
      },
    })),
  };
}

function buildStarConfigurationPayload(configuration) {
  return {
    star: buildSequentialIdentifier(configuration.starID),
    power: Number(configuration.power || 0),
  };
}

function buildUpgradeDefinitionPayload(definition) {
  return {
    installation_type: buildSequentialIdentifier(definition.installationTypeID),
    power_required: Number(definition.powerRequired || 0),
    workforce_required: Number(definition.workforceRequired || 0),
    fuel_type: buildSequentialIdentifier(definition.fuelTypeID),
    fuel_consumption_per_hour: Number(definition.fuelConsumptionPerHour || 0),
    fuel_startup_cost: Number(definition.fuelStartupCost || 0),
    mutually_exclusive_group: String(definition.mutuallyExclusiveGroup || ""),
    power_produced: Number(definition.powerProduced || 0),
    workforce_produced: Number(definition.workforceProduced || 0),
  };
}

function buildHubUpgradesPayload(hubUpgrades) {
  return {
    hub: buildSequentialIdentifier(hubUpgrades.hubID),
    upgrades: (hubUpgrades.upgrades || []).map((upgrade) => ({
      identifier: {
        hub: buildSequentialIdentifier(hubUpgrades.hubID),
        installation_type: buildSequentialIdentifier(upgrade.installationTypeID),
        upgrade_type: buildSequentialIdentifier(upgrade.typeID),
      },
      attributes: {
        definition: buildUpgradeDefinitionPayload(upgrade.definition),
        power_state: upgrade.powerState || POWER_STATE.POWER_STATE_OFFLINE,
      },
    })),
    last_updated: timestampFromMs(hubUpgrades.lastUpdatedMs),
  };
}

function buildFuelPayload(fuelState) {
  return {
    fuels: (fuelState.fuels || []).map((fuel) => ({
      fuel_type: buildSequentialIdentifier(fuel.fuelTypeID),
      amount: Number(fuel.amount || 0),
      burned_per_hour: Number(fuel.burnedPerHour || 0),
    })),
    last_updated: timestampFromMs(fuelState.lastUpdatedMs),
  };
}

function buildWorkforceConfigurationPayload(configuration) {
  if (!configuration || configuration.mode === "inactive") {
    return {
      inactive: true,
    };
  }
  if (configuration.mode === "transit") {
    return {
      transit: true,
    };
  }
  if (configuration.mode === "import") {
    return {
      import_settings: {
        sources: (configuration.sourceSystemIDs || []).map((sourceSystemID) => ({
          source: buildSequentialIdentifier(sourceSystemID),
        })),
      },
    };
  }
  return {
    export_settings: {
      destination: configuration.destinationSystemID
        ? buildSequentialIdentifier(configuration.destinationSystemID)
        : undefined,
      amount: Number(configuration.amount || 0),
      destination_system: configuration.destinationSystemID
        ? buildSequentialIdentifier(configuration.destinationSystemID)
        : undefined,
      no_destination: !configuration.destinationSystemID,
    },
  };
}

function buildWorkforceStatePayload(state) {
  if (!state || state.mode === "inactive") {
    return {
      inactive: true,
    };
  }
  if (state.mode === "transit") {
    return {
      transit: {},
    };
  }
  if (state.mode === "import") {
    return {
      import_state: {
        sources: (state.sources || []).map((entry) => ({
          source: buildSequentialIdentifier(entry.sourceSystemID),
          amount: Number(entry.amount || 0),
        })),
      },
    };
  }
  return {
    export_state: {
      destination: state.destinationSystemID
        ? buildSequentialIdentifier(state.destinationSystemID)
        : undefined,
      amount: Number(state.amount || 0),
      destination_system: state.destinationSystemID
        ? buildSequentialIdentifier(state.destinationSystemID)
        : undefined,
      no_destination: !state.destinationSystemID,
      connected: state.connected
        ? {
            destination_system: buildSequentialIdentifier(state.destinationSystemID),
            exported_quantity: Number(state.amount || 0),
          }
        : undefined,
      disconnected: state.connected
        ? undefined
        : {
            local_reserve: Number(state.amount || 0),
          },
    },
  };
}

function buildSkyhookWorkforcePayload(workforceAmount) {
  if (Number(workforceAmount || 0) > 0) {
    return {
      amount: Number(workforceAmount || 0),
    };
  }
  return {
    none: true,
  };
}

function buildSkyhookTheftPayload(vulnerability) {
  return {
    vulnerable: Boolean(vulnerability && vulnerability.vulnerable),
    start: timestampFromMs(vulnerability && vulnerability.startMs),
    end: timestampFromMs(vulnerability && vulnerability.endMs),
  };
}

function buildSkyhookSimulationPayload(simulation) {
  return {
    reagent: buildSequentialIdentifier(simulation.reagentTypeID),
    reagent_type: buildSequentialIdentifier(simulation.reagentTypeID),
    simulation: {
      secured_stock: Number(simulation.securedStock || 0),
      unsecured_stock: Number(simulation.unsecuredStock || 0),
      last_cycle: timestampFromMs(simulation.lastCycleMs),
    },
  };
}

function buildSkyhookDefinitionPayload(definition) {
  return {
    reagent: buildSequentialIdentifier(definition.reagentTypeID),
    reagent_type: buildSequentialIdentifier(definition.reagentTypeID),
    definition: {
      amount_per_cycle: Number(definition.amountPerCycle || 0),
      cycle_period: buildDurationFromSeconds(definition.cyclePeriodSeconds),
      secured_percentage: Number(definition.securedPercentage || 0),
      secured_capacity: Number(definition.securedCapacity || 0),
      unsecured_capacity: Number(definition.unsecuredCapacity || 0),
    },
  };
}

function buildSkyhookPayload(skyhook) {
  return {
    skyhook: buildSequentialIdentifier(skyhook.skyhookID),
    reagent_simulations: (skyhook.reagentSimulations || []).map(
      buildSkyhookSimulationPayload,
    ),
    active: Boolean(skyhook.active),
    reagent_definitions: (skyhook.reagentDefinitions || []).map(
      buildSkyhookDefinitionPayload,
    ),
    theft_vulnerability: buildSkyhookTheftPayload(skyhook.theftVulnerability),
    workforce: buildSkyhookWorkforcePayload(skyhook.workforceAmount),
    planet_resources_definitions_version: buildSemanticVersion(
      skyhook.planetResourcesVersion,
    ),
  };
}

function buildSkyhookNoticePayload(skyhook) {
  return {
    skyhook: buildSequentialIdentifier(skyhook.skyhookID),
    reagent_simulations: (skyhook.reagentSimulations || []).map(
      buildSkyhookSimulationPayload,
    ),
    active: Boolean(skyhook.active),
    reagent_definitions: (skyhook.reagentDefinitions || []).map(
      buildSkyhookDefinitionPayload,
    ),
    theft_vulnerability: buildSkyhookTheftPayload(skyhook.theftVulnerability),
    workforce_available:
      Number(skyhook.workforceAmount || 0) > 0
        ? Number(skyhook.workforceAmount || 0)
        : undefined,
    none: Number(skyhook.workforceAmount || 0) > 0 ? undefined : true,
    effective_workforce: buildSkyhookWorkforcePayload(skyhook.workforceAmount),
    planet_resources_definitions_version: buildSemanticVersion(
      skyhook.planetResourcesVersion,
    ),
  };
}

function buildSkyhookTheftVulnerableEntryPayload(entry) {
  return {
    skyhook: buildSequentialIdentifier(entry.skyhookID),
    planet: buildSequentialIdentifier(entry.planetID),
    expiry: timestampFromMs(entry.endMs),
    start: timestampFromMs(entry.startMs),
  };
}

function createSovereigntyGatewayService({ publishGatewayNotice }) {
  const types = getSovereigntyProtoTypes();

  function publishNotice(typeName, messageType, payload, targetGroup) {
    if (typeof publishGatewayNotice !== "function") {
      return;
    }
    publishGatewayNotice(
      typeName,
      encodePayload(messageType, payload),
      targetGroup,
    );
  }

  function publishHubStateNotices(hubID) {
    const resources = getHubResources(hubID);
    const upgrades = getHubUpgrades(hubID);
    if (!resources || !upgrades) {
      return;
    }
    publishNotice(
      "eve_public.sovereignty.hub.api.ResourcesSimulatedNotice",
      types.hubResourcesSimulatedNotice,
      {
        hub: buildSequentialIdentifier(hubID),
        solar_system: buildSequentialIdentifier(resources.solarSystemID),
        power: {
          available: Number(resources.power.available || 0),
          allocated: Number(resources.power.allocated || 0),
          local_harvest: Number(resources.power.localHarvest || 0),
        },
        workforce: {
          available: Number(resources.workforce.available || 0),
          allocated: Number(resources.workforce.allocated || 0),
          local_harvest: Number(resources.workforce.localHarvest || 0),
        },
      },
      { solar_system: resources.solarSystemID },
    );
    publishNotice(
      "eve_public.sovereignty.hub.upgrade.api.HubUpgradesSimulatedNotice",
      types.upgradeSimulatedNotice,
      {
        hub_upgrades: buildHubUpgradesPayload(upgrades),
      },
      { solar_system: upgrades.solarSystemID },
    );
  }

  function publishSkyhookAllInSystemNotice(solarSystemID, identity) {
    const localData = listLocalSkyhooks({
      solarSystemID,
      corporationID: identity && identity.corporationID,
    });
    publishNotice(
      "eve_public.sovereignty.skyhook.api.AllInSolarSystemNotice",
      types.skyhookAllInSolarSystemNotice,
      {
        solar_system: buildSequentialIdentifier(solarSystemID),
        skyhooks: (localData.skyhooks || []).map(buildSkyhookNoticePayload),
      },
      { solar_system: solarSystemID },
    );
  }

  function publishSkyhookVulnerabilityNotice(skyhook, previousSkyhook = null) {
    if (!skyhook || !skyhook.skyhookID) {
      return;
    }

    const previousVulnerability = previousSkyhook && previousSkyhook.theftVulnerability
      ? previousSkyhook.theftVulnerability
      : null;
    const nextVulnerability = skyhook.theftVulnerability || null;
    const wasVulnerable = Boolean(previousVulnerability && previousVulnerability.vulnerable);
    const isVulnerable = Boolean(nextVulnerability && nextVulnerability.vulnerable);

    if (!skyhook.active) {
      if (wasVulnerable) {
        publishNotice(
          "eve_public.sovereignty.skyhook.api.TheftVulnerabilityWindowEndedNotice",
          types.skyhookTheftWindowEndedNotice,
          {
            skyhook: buildSequentialIdentifier(skyhook.skyhookID),
          },
          { solar_system: skyhook.solarSystemID },
        );
      }
      return;
    }

    if (isVulnerable) {
      publishNotice(
        "eve_public.sovereignty.skyhook.api.TheftVulnerabilityWindowStartedNotice",
        types.skyhookTheftWindowStartedNotice,
        {
          skyhook: buildSequentialIdentifier(skyhook.skyhookID),
          end_time: timestampFromMs(nextVulnerability.endMs),
        },
        { solar_system: skyhook.solarSystemID },
      );
      return;
    }

    if (
      nextVulnerability &&
      Number(nextVulnerability.startMs || 0) > Date.now() &&
      Number(nextVulnerability.endMs || 0) > Number(nextVulnerability.startMs || 0)
    ) {
      publishNotice(
        "eve_public.sovereignty.skyhook.api.TheftVulnerabilityWindowScheduledNotice",
        types.skyhookTheftWindowScheduledNotice,
        {
          skyhook: buildSequentialIdentifier(skyhook.skyhookID),
          start_time: timestampFromMs(nextVulnerability.startMs),
          end_time: timestampFromMs(nextVulnerability.endMs),
        },
        { solar_system: skyhook.solarSystemID },
      );
    }
  }

  return {
    name: "sovereignty",
    handledRequestTypes: HANDLED_REQUEST_TYPES,
    getEmptySuccessResponseType(requestTypeName) {
      return HANDLED_REQUEST_TYPES.includes(requestTypeName)
        ? requestTypeName.replace(/Request$/, "Response")
        : null;
    },
    handleRequest(requestTypeName, requestEnvelope) {
      if (!HANDLED_REQUEST_TYPES.includes(requestTypeName)) {
        return null;
      }

      const activeCharacterID = getActiveCharacterID(requestEnvelope);
      const identity = getActiveCharacterIdentity(activeCharacterID);

      if (requestTypeName === "eve_public.sovereignty.hub.api.GetResourcesRequest") {
        const decoded = decodePayload(types.hubGetResourcesRequest, requestEnvelope);
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const state = getHubResources(hubID, identity);
        if (state && state.ok === false) {
          return buildErrorResult(requestTypeName, state.statusCode, state.errorCode);
        }
        if (!state) {
          return buildErrorResult(requestTypeName, 404, "NOT_FOUND");
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.hub.api.GetResourcesResponse",
          responsePayloadBuffer: encodePayload(types.hubGetResourcesResponse, {
            power: {
              available: Number(state.power.available || 0),
              allocated: Number(state.power.allocated || 0),
              local_harvest: Number(state.power.localHarvest || 0),
            },
            workforce: {
              available: Number(state.workforce.available || 0),
              allocated: Number(state.workforce.allocated || 0),
              local_harvest: Number(state.workforce.localHarvest || 0),
            },
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.resource.planet.api.GetAllDefinitionsRequest") {
        const decoded = decodePayload(types.planetGetAllDefinitionsRequest, requestEnvelope);
        const staticSnapshot = getSovereigntyStaticSnapshot();
        const knownVersion = decoded && decoded.known_version
          ? buildSemanticVersion(decoded.known_version)
          : null;
        if (
          knownVersion &&
          compareSemver(
            knownVersion,
            staticSnapshot.planetDefinitionsVersion,
          ) === 0
        ) {
          return buildErrorResult(requestTypeName, 304, "NOT_MODIFIED");
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.resource.planet.api.GetAllDefinitionsResponse",
          responsePayloadBuffer: encodePayload(types.planetGetAllDefinitionsResponse, {
            definitions: staticSnapshot.planetDefinitions.map(
              buildPlanetDefinitionPayload,
            ),
            version: buildSemanticVersion(staticSnapshot.planetDefinitionsVersion),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.resource.planet.api.GetDefinitionsVersionRequest") {
        const decoded = decodePayload(
          types.planetGetDefinitionsVersionRequest,
          requestEnvelope,
        );
        const staticSnapshot = getSovereigntyStaticSnapshot();
        const requestedVersion = buildSemanticVersion(decoded && decoded.version);
        if (
          compareSemver(requestedVersion, staticSnapshot.planetDefinitionsVersion) !==
          0
        ) {
          return buildErrorResult(requestTypeName, 404, "NOT_FOUND");
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.resource.planet.api.GetDefinitionsVersionResponse",
          responsePayloadBuffer: encodePayload(
            types.planetGetDefinitionsVersionResponse,
            {
              definitions: staticSnapshot.planetDefinitions.map(
                buildPlanetDefinitionPayload,
              ),
            },
          ),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.resource.star.api.GetAllConfigurationsRequest") {
        const staticSnapshot = getSovereigntyStaticSnapshot();
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.resource.star.api.GetAllConfigurationsResponse",
          responsePayloadBuffer: encodePayload(types.starGetAllConfigurationsResponse, {
            configurations: staticSnapshot.starConfigurations.map(
              buildStarConfigurationPayload,
            ),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.upgrade.api.GetDefinitionsRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.hub.upgrade.api.GetDefinitionsResponse",
          responsePayloadBuffer: encodePayload(types.upgradeGetDefinitionsResponse, {
            definitions: listUpgradeDefinitions().map(buildUpgradeDefinitionPayload),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.upgrade.api.GetHubUpgradesRequest") {
        const decoded = decodePayload(types.upgradeGetHubUpgradesRequest, requestEnvelope);
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const hubUpgrades = getHubUpgrades(hubID, identity);
        if (hubUpgrades && hubUpgrades.ok === false) {
          return buildErrorResult(requestTypeName, hubUpgrades.statusCode, hubUpgrades.errorCode);
        }
        if (!hubUpgrades) {
          return buildErrorResult(requestTypeName, 404, "NOT_FOUND");
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.hub.upgrade.api.GetHubUpgradesResponse",
          responsePayloadBuffer: encodePayload(types.upgradeGetHubUpgradesResponse, {
            hub_upgrades: buildHubUpgradesPayload(hubUpgrades),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.upgrade.api.ProcessConfigurationRequest") {
        const decoded = decodePayload(
          types.upgradeProcessConfigurationRequest,
          requestEnvelope,
        );
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const result = processHubUpgradeConfiguration(
          hubID,
          (decoded && decoded.new_upgrades || []).map((entry) => Number(entry && entry.sequential) || 0),
          (decoded && decoded.configuration || []).map((entry) => ({
            typeID: Number(entry && entry.upgrade_type && entry.upgrade_type.sequential) || 0,
            online: Boolean(entry && entry.online),
          })),
          identity,
        );
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        const hubUpgrades = getHubUpgrades(result.hubID);
        publishNotice(
          "eve_public.sovereignty.hub.upgrade.api.HubUpgradesConfiguredNotice",
          types.upgradeConfiguredNotice,
          {
            hub_upgrades: buildHubUpgradesPayload(hubUpgrades),
          },
          { solar_system: result.solarSystemID },
        );
        publishHubStateNotices(result.hubID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.hub.upgrade.api.ProcessConfigurationResponse",
          responsePayloadBuffer: encodePayload(types.upgradeProcessConfigurationResponse, {
            hub_upgrades: buildHubUpgradesPayload(hubUpgrades),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.upgrade.api.UninstallRequest") {
        const decoded = decodePayload(types.upgradeUninstallRequest, requestEnvelope);
        const hubID = Number(
          decoded && decoded.upgrade && decoded.upgrade.hub && decoded.upgrade.hub.sequential,
        ) || 0;
        const upgradeTypeID = Number(
          decoded &&
            decoded.upgrade &&
            decoded.upgrade.upgrade_type &&
            decoded.upgrade.upgrade_type.sequential,
        ) || 0;
        const result = uninstallHubUpgrade(hubID, upgradeTypeID, identity);
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        publishNotice(
          "eve_public.sovereignty.hub.upgrade.api.UninstalledNotice",
          types.upgradeUninstalledNotice,
          {
            upgrade: {
              hub: buildSequentialIdentifier(result.hubID),
              installation_type: buildSequentialIdentifier(result.upgradeTypeID),
              upgrade_type: buildSequentialIdentifier(result.upgradeTypeID),
            },
            upgrade_type: buildSequentialIdentifier(result.upgradeTypeID),
            hub: buildSequentialIdentifier(result.hubID),
          },
          { solar_system: result.solarSystemID },
        );
        publishHubStateNotices(result.hubID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.hub.upgrade.api.UninstallResponse",
          responsePayloadBuffer: encodePayload(types.upgradeUninstallResponse, {}),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.fuel.api.GetRequest") {
        const decoded = decodePayload(types.fuelGetRequest, requestEnvelope);
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const state = getHubFuel(hubID, identity);
        if (state && state.ok === false) {
          return buildErrorResult(requestTypeName, state.statusCode, state.errorCode);
        }
        if (!state) {
          return buildErrorResult(requestTypeName, 404, "NOT_FOUND");
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.hub.fuel.api.GetResponse",
          responsePayloadBuffer: encodePayload(types.fuelGetResponse, buildFuelPayload(state)),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.fuel.api.AddRequest") {
        const decoded = decodePayload(types.fuelAddRequest, requestEnvelope);
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const result = addHubFuel(
          hubID,
          Number(decoded && decoded.fuel_item && decoded.fuel_item.sequential) || 0,
          Number(decoded && decoded.amount) || 0,
          identity,
        );
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        publishHubStateNotices(result.hubID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.hub.fuel.api.AddResponse",
          responsePayloadBuffer: encodePayload(types.fuelAddResponse, {}),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.workforce.api.GetConfigurationRequest") {
        const decoded = decodePayload(types.workforceGetConfigurationRequest, requestEnvelope);
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const state = getWorkforceConfiguration(hubID, identity);
        if (state && state.ok === false) {
          return buildErrorResult(requestTypeName, state.statusCode, state.errorCode);
        }
        if (!state) {
          return buildErrorResult(requestTypeName, 404, "NOT_FOUND");
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.hub.workforce.api.GetConfigurationResponse",
          responsePayloadBuffer: encodePayload(types.workforceGetConfigurationResponse, {
            configuration: buildWorkforceConfigurationPayload(state.configuration),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.workforce.api.ConfigureRequest") {
        const decoded = decodePayload(types.workforceConfigureRequest, requestEnvelope);
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const configurationPayload = decoded && decoded.configuration;
        const nextConfiguration = configurationPayload && configurationPayload.import_settings
          ? {
              mode: "import",
              sourceSystemIDs: (configurationPayload.import_settings.sources || []).map(
                (entry) => Number(entry && entry.source && entry.source.sequential) || 0,
              ),
            }
          : configurationPayload && configurationPayload.export_settings
            ? {
                mode: "export",
                destinationSystemID: Number(
                  configurationPayload.export_settings.destination_system &&
                    configurationPayload.export_settings.destination_system.sequential,
                ) || null,
                amount: Number(configurationPayload.export_settings.amount) || 0,
              }
            : configurationPayload && configurationPayload.transit
              ? { mode: "transit" }
              : { mode: "inactive" };
        const result = configureWorkforce(hubID, nextConfiguration, identity);
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        publishNotice(
          "eve_public.sovereignty.resource.transfer.workforce.api.ConfiguredNotice",
          types.workforceConfiguredNotice,
          {
            solar_system: buildSequentialIdentifier(result.solarSystemID),
            old_configuration: buildWorkforceConfigurationPayload(result.previousConfiguration),
            new_configuration: buildWorkforceConfigurationPayload(result.nextConfiguration),
            hub: buildSequentialIdentifier(result.hubID),
          },
          { solar_system: result.solarSystemID },
        );
        publishNotice(
          "eve_public.sovereignty.resource.transfer.workforce.api.StateChangedNotice",
          types.workforceStateChangedNotice,
          {
            solar_system: buildSequentialIdentifier(result.solarSystemID),
            old_state: buildWorkforceStatePayload(result.previousState),
            new_state: buildWorkforceStatePayload(result.nextState),
            hub: buildSequentialIdentifier(result.hubID),
          },
          { solar_system: result.solarSystemID },
        );
        publishHubStateNotices(result.hubID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.hub.workforce.api.ConfigureResponse",
          responsePayloadBuffer: encodePayload(types.workforceConfigureResponse, {}),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.workforce.api.GetStateRequest") {
        const decoded = decodePayload(types.workforceGetStateRequest, requestEnvelope);
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const state = getWorkforceState(hubID, identity);
        if (state && state.ok === false) {
          return buildErrorResult(requestTypeName, state.statusCode, state.errorCode);
        }
        if (!state) {
          return buildErrorResult(requestTypeName, 404, "NOT_FOUND");
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.hub.workforce.api.GetStateResponse",
          responsePayloadBuffer: encodePayload(types.workforceGetStateResponse, {
            state: buildWorkforceStatePayload(state.state),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.hub.workforce.api.GetNetworkableHubsRequest") {
        const decoded = decodePayload(
          types.workforceGetNetworkableHubsRequest,
          requestEnvelope,
        );
        const hubID = Number(decoded && decoded.hub && decoded.hub.sequential) || 0;
        const state = listNetworkableHubs(hubID, identity);
        if (state && state.ok === false) {
          return buildErrorResult(requestTypeName, state.statusCode, state.errorCode);
        }
        if (!state) {
          return buildErrorResult(requestTypeName, 404, "NOT_FOUND");
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.hub.workforce.api.GetNetworkableHubsResponse",
          responsePayloadBuffer: encodePayload(
            types.workforceGetNetworkableHubsResponse,
            {
              hubs: (state.hubs || []).map((hub) => ({
                hub: buildSequentialIdentifier(hub.hubID),
                system: buildSequentialIdentifier(hub.solarSystemID),
                configuration: buildWorkforceConfigurationPayload(hub.configuration),
                state: buildWorkforceStatePayload(hub.state),
              })),
            },
          ),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.skyhook.api.GetRequest") {
        const decoded = decodePayload(types.skyhookGetRequest, requestEnvelope);
        const skyhookID = Number(decoded && decoded.skyhook && decoded.skyhook.sequential) || 0;
        const result = getSkyhook(skyhookID, identity);
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.skyhook.api.GetResponse",
          responsePayloadBuffer: encodePayload(types.skyhookGetResponse, {
            ...buildSkyhookPayload(result.skyhook),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.skyhook.api.GetAllLocalRequest") {
        const result = listLocalSkyhooks(identity);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.sovereignty.skyhook.api.GetAllLocalResponse",
          responsePayloadBuffer: encodePayload(types.skyhookGetAllLocalResponse, {
            solar_system: buildSequentialIdentifier(result.solarSystemID),
            skyhooks: (result.skyhooks || []).map(buildSkyhookPayload),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.skyhook.api.GetAllByCorporationRequest") {
        const decoded = decodePayload(types.skyhookGetAllByCorporationRequest, requestEnvelope);
        const corporationID = Number(
          decoded && decoded.corporation && decoded.corporation.sequential,
        ) || 0;
        const result = listSkyhooksByCorporation(corporationID, identity);
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.skyhook.api.GetAllByCorporationResponse",
          responsePayloadBuffer: encodePayload(types.skyhookGetAllByCorporationResponse, {
            skyhooks: (result.skyhooks || []).map(buildSkyhookPayload),
          }),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.skyhook.api.ActivateRequest" || requestTypeName === "eve_public.sovereignty.skyhook.api.DeactivateRequest") {
        const decoded = decodePayload(
          requestTypeName === "eve_public.sovereignty.skyhook.api.ActivateRequest"
            ? types.skyhookActivateRequest
            : types.skyhookDeactivateRequest,
          requestEnvelope,
        );
        const skyhookID = Number(decoded && decoded.skyhook && decoded.skyhook.sequential) || 0;
        const previousSkyhookResult = getSkyhook(skyhookID, identity);
        const result = setSkyhookActivation(
          skyhookID,
          requestTypeName === "eve_public.sovereignty.skyhook.api.ActivateRequest",
          identity,
        );
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        publishNotice(
          "eve_public.sovereignty.skyhook.api.ActivationNotice",
          types.skyhookActivationNotice,
          {
            solar_system: buildSequentialIdentifier(result.solarSystemID),
            planet: buildSequentialIdentifier(result.planetID),
            skyhook: buildSequentialIdentifier(result.skyhookID),
            active: Boolean(result.skyhook.active),
          },
          { solar_system: result.solarSystemID },
        );
        publishSkyhookVulnerabilityNotice(
          result.skyhook,
          previousSkyhookResult && previousSkyhookResult.ok
            ? previousSkyhookResult.skyhook
            : null,
        );
        publishSkyhookAllInSystemNotice(result.solarSystemID, identity);
        const hubID = getHubIDForSolarSystem(result.solarSystemID);
        if (hubID) {
          publishHubStateNotices(hubID);
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: requestTypeName.replace(/Request$/, "Response"),
          responsePayloadBuffer: encodePayload(
            requestTypeName === "eve_public.sovereignty.skyhook.api.ActivateRequest"
              ? types.skyhookActivateResponse
              : types.skyhookDeactivateResponse,
            {},
          ),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.skyhook.api.GetSolarSystemsWithTheftVulnerableSkyhooksRequest") {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.skyhook.api.GetSolarSystemsWithTheftVulnerableSkyhooksResponse",
          responsePayloadBuffer: encodePayload(
            types.skyhookGetSolarSystemsWithTheftVulnerableResponse,
            {
              solar_systems: listSolarSystemsWithTheftVulnerableSkyhooks().map(
                buildSequentialIdentifier,
              ),
            },
          ),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.skyhook.api.GetTheftVulnerableSkyhooksInSolarSystemRequest") {
        const decoded = decodePayload(
          types.skyhookGetTheftVulnerableInSolarSystemRequest,
          requestEnvelope,
        );
        const solarSystemID = Number(
          decoded && decoded.solar_system && decoded.solar_system.sequential,
        ) || 0;
        const result = listTheftVulnerableSkyhooksInSolarSystem(solarSystemID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.skyhook.api.GetTheftVulnerableSkyhooksInSolarSystemResponse",
          responsePayloadBuffer: encodePayload(
            types.skyhookGetTheftVulnerableInSolarSystemResponse,
            {
              skyhooks: result.map(buildSkyhookTheftVulnerableEntryPayload),
            },
          ),
        };
      }

      if (requestTypeName === "eve_public.sovereignty.skyhook.api.admin.ModifyReagentsRequest") {
        const decoded = decodePayload(types.skyhookModifyReagentsRequest, requestEnvelope);
        const skyhookID = Number(decoded && decoded.skyhook && decoded.skyhook.sequential) || 0;
        const result = modifySkyhookReagents(
          skyhookID,
          (decoded && decoded.reagents || []).map((entry) => ({
            reagentTypeID: Number(entry && (entry.reagent_type || entry.reagent) && (entry.reagent_type || entry.reagent).sequential) || 0,
            securedStock: Number(entry && entry.secured_stock) || 0,
            unsecuredStock: Number(entry && entry.unsecured_stock) || 0,
            timestampMs:
              entry && entry.timestamp
                ? timestampToMs(entry.timestamp)
                : Date.now(),
          })),
          identity,
        );
        if (!result.ok) {
          return buildErrorResult(requestTypeName, result.statusCode, result.errorCode);
        }
        publishNotice(
          "eve_public.sovereignty.skyhook.api.ReagentSimulationsNotice",
          types.skyhookReagentSimulationsNotice,
          {
            skyhook: buildSequentialIdentifier(result.skyhookID),
            planet: buildSequentialIdentifier(result.planetID),
            simulations: (result.skyhook.reagentSimulations || []).map(
              buildSkyhookSimulationPayload,
            ),
          },
          { solar_system: result.solarSystemID },
        );
        publishSkyhookAllInSystemNotice(result.solarSystemID, identity);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.sovereignty.skyhook.api.admin.ModifyReagentsResponse",
          responsePayloadBuffer: encodePayload(types.skyhookModifyReagentsResponse, {}),
        };
      }

      return null;
    },
  };
}

module.exports = {
  createSovereigntyGatewayService,
};
