const { createCompatibilityGatewayService } = require("./compatibilityGatewayService");
const { createCorpGoalsGatewayService } = require("./corpGoalsGatewayService");
const { createCorpColorsGatewayService } = require("./corpColorsGatewayService");
const { createEvermarksGatewayService } = require("./evermarksGatewayService");
const { createFreelanceGatewayService } = require("./freelanceGatewayService");
const { createInsurgencyGatewayService } = require("./insurgencyGatewayService");
const {
  createMercenaryDenGatewayService,
} = require("./mercenaryDenGatewayService");
const {
  createLocalChatGatewayService,
} = require("./localChatGatewayService");
const {
  createNewEdenStoreGatewayService,
} = require("./newEdenStoreGatewayService");
const { createPlexVaultGatewayService } = require("./plexVaultGatewayService");
const {
  createSovereigntyGatewayService,
} = require("./sovereigntyGatewayService");
const {
  createStructurePaintworkGatewayService,
} = require("./structurePaintworkGatewayService");
const {
  createShipLogoGatewayService,
} = require("./shipLogoGatewayService");
const {
  createSkillPlanGatewayService,
} = require("./skillPlanGatewayService");
const {
  createMapTagsGatewayService,
} = require("./mapTagsGatewayService");
const {
  createCampaignGatewayService,
} = require("./campaignGatewayService");

function createGatewayServiceRegistry(context) {
  const services = [
    createCorpGoalsGatewayService(context),
    createCorpColorsGatewayService(context),
    createEvermarksGatewayService(context),
    createFreelanceGatewayService(context),
    createInsurgencyGatewayService(context),
    createNewEdenStoreGatewayService(context),
    createPlexVaultGatewayService(context),
    createStructurePaintworkGatewayService(context),
    createShipLogoGatewayService(context),
    createSovereigntyGatewayService(context),
    createMercenaryDenGatewayService(context),
    createLocalChatGatewayService(context),
    createSkillPlanGatewayService(context),
    createMapTagsGatewayService(context),
    createCampaignGatewayService(context),
    createCompatibilityGatewayService(context),
  ];

  return {
    services,
    getEmptySuccessResponseType(requestTypeName) {
      for (const service of services) {
        if (typeof service.getEmptySuccessResponseType !== "function") {
          continue;
        }

        const responseTypeName = service.getEmptySuccessResponseType(
          requestTypeName,
        );
        if (responseTypeName) {
          return responseTypeName;
        }
      }

      return null;
    },
    handleRequest(requestTypeName, requestEnvelope) {
      for (const service of services) {
        const result = service.handleRequest(requestTypeName, requestEnvelope);
        if (result) {
          return result;
        }
      }

      return null;
    },
  };
}

module.exports = {
  createGatewayServiceRegistry,
};
