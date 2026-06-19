const path = require("path");
const protobuf = require("protobufjs");
const log = require(path.join(__dirname, "../../../utils/logger"));

const {
  cloneValue,
  encodePayload,
  getActiveCharacterID,
  timestampFromMs,
  uuidBufferToString,
  uuidStringToBuffer,
} = require("./gatewayServiceHelpers");
const {
  DEFAULT_DURATION_SECONDS,
  HERALDRY_CORPORATION_ID,
  getCatalogueItems,
  getCorporationIDForCharacter,
  getLicense,
  getLicenseForStructure,
  getLicensesForCorporation,
  getPaintworksForSolarSystem,
  issueLicenses,
  revokeLicense,
} = require(path.join(
  __dirname,
  "../../../services/structure/structurePaintworkState",
));
const sessionRegistry = require(path.join(
  __dirname,
  "../../../services/chat/sessionRegistry",
));

const HANDLED_REQUEST_TYPES = Object.freeze([
  "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
  "eve_public.cosmetic.structure.paintwork.license.api.RevokeRequest",
  "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueRequest",
  "eve_public.cosmetic.structure.paintwork.license.api.GetRequest",
  "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationRequest",
  "eve_public.cosmetic.structure.paintwork.license.api.admin.IssueRequest",
  "eve_public.cosmetic.structure.paintwork.license.api.admin.RevokeRequest",
  "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemRequest",
  "eve_public.cosmetic.structure.paintwork.api.GetRequest",
]);

const ERROR_STATUS_BY_CODE = Object.freeze({
  INVALID_DATA: 400,
  INSUFFICIENT_ROLES: 401,
  INSUFFICIENT_BALANCE: 402,
  FORBIDDEN_REQUEST: 403,
  NOT_FOUND: 404,
});

function getCharacterRecord(characterID) {
  const characterState = require(path.join(
    __dirname,
    "../../../services/character/characterState",
  ));
  return characterState && typeof characterState.getCharacterRecord === "function"
    ? characterState.getCharacterRecord(characterID)
    : null;
}

function buildStructurePaintworkProtoRoot() {
  const root = new protobuf.Root();

  root.define("google.protobuf")
    .add(
      new protobuf.Type("Duration").add(
        new protobuf.Field("seconds", 1, "int64"),
      ),
    )
    .add(
      new protobuf.Type("Timestamp")
        .add(new protobuf.Field("seconds", 1, "int64"))
        .add(new protobuf.Field("nanos", 2, "int32")),
    );

  root.define("eve_public.character").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );
  root.define("eve_public.corporation").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );
  root.define("eve_public.corporation.loyalty").add(
    new protobuf.Type("Points")
      .add(new protobuf.Field("amount", 1, "uint64"))
      .add(
        new protobuf.Field(
          "associated_corporation",
          2,
          "eve_public.corporation.Identifier",
        ),
      ),
  );
  root.define("eve_public.structure").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );
  root.define("eve_public.structuretype").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );
  root.define("eve_public.solarsystem").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );

  root.define("eve_public.cosmetic.structure.paintwork")
    .add(
      new protobuf.Type("Slot")
        .add(new protobuf.Field("paint", 1, "uint32"))
        .add(new protobuf.Field("empty", 2, "bool")),
    )
    .add(
      new protobuf.Type("SlotConfiguration")
        .add(
          new protobuf.Field(
            "first",
            1,
            "eve_public.cosmetic.structure.paintwork.Slot",
          ),
        )
        .add(
          new protobuf.Field(
            "second",
            2,
            "eve_public.cosmetic.structure.paintwork.Slot",
          ),
        )
        .add(
          new protobuf.Field(
            "third",
            3,
            "eve_public.cosmetic.structure.paintwork.Slot",
          ),
        )
        .add(
          new protobuf.Field(
            "fourth",
            4,
            "eve_public.cosmetic.structure.paintwork.Slot",
          ),
        )
        .add(
          new protobuf.Field(
            "primary",
            5,
            "eve_public.cosmetic.structure.paintwork.Slot",
          ),
        )
        .add(
          new protobuf.Field(
            "secondary",
            6,
            "eve_public.cosmetic.structure.paintwork.Slot",
          ),
        )
        .add(
          new protobuf.Field(
            "detailing",
            7,
            "eve_public.cosmetic.structure.paintwork.Slot",
          ),
        ),
    );

  root.define("eve_public.cosmetic.structure.paintwork.license")
    .add(
      new protobuf.Type("Identifier").add(
        new protobuf.Field("uuid", 1, "bytes"),
      ),
    )
    .add(
      new protobuf.Type("Attributes")
        .add(
          new protobuf.Field(
            "corporation",
            1,
            "eve_public.corporation.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "activator",
            2,
            "eve_public.character.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "issued",
            3,
            "google.protobuf.Timestamp",
          ),
        )
        .add(
          new protobuf.Field(
            "duration",
            4,
            "google.protobuf.Duration",
          ),
        )
        .add(
          new protobuf.Field(
            "structure",
            5,
            "eve_public.structure.Identifier",
          ),
        ),
    );

  root.define("eve_public.cosmetic.structure.paintwork.license.api")
    .add(
      new protobuf.Type("IssueRequest")
        .add(
          new protobuf.Field(
            "paintwork",
            1,
            "eve_public.cosmetic.structure.paintwork.SlotConfiguration",
          ),
        )
        .add(
          new protobuf.Field("duration", 2, "google.protobuf.Duration"),
        )
        .add(
          new protobuf.Field(
            "structures",
            3,
            "eve_public.structure.Identifier",
            "repeated",
          ),
        ),
    )
    .add(
      new protobuf.Type("IssueResponse")
        .add(
          new protobuf.Field(
            "licenses",
            1,
            "eve_public.cosmetic.structure.paintwork.license.api.IssueResponse.LicenseStructure",
            "repeated",
          ),
        )
        .add(
          new protobuf.Type("LicenseStructure")
            .add(
              new protobuf.Field(
                "id",
                1,
                "eve_public.cosmetic.structure.paintwork.license.Identifier",
              ),
            )
            .add(
              new protobuf.Field(
                "attributes",
                2,
                "eve_public.cosmetic.structure.paintwork.license.Attributes",
              ),
            )
            .add(
              new protobuf.Field(
                "structure",
                3,
                "eve_public.structure.Identifier",
              ),
            ),
        ),
    )
    .add(
      new protobuf.Type("RevokeRequest").add(
        new protobuf.Field(
          "license",
          1,
          "eve_public.cosmetic.structure.paintwork.license.Identifier",
        ),
      ),
    )
    .add(new protobuf.Type("RevokeResponse"))
    .add(new protobuf.Type("GetCatalogueRequest"))
    .add(
      new protobuf.Type("GetCatalogueResponse")
        .add(
          new protobuf.Field(
            "items",
            1,
            "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueResponse.Item",
            "repeated",
          ),
        )
        .add(
          new protobuf.Type("Item")
            .add(
              new protobuf.Field(
                "structure_type",
                1,
                "eve_public.structuretype.Identifier",
              ),
            )
            .add(
              new protobuf.Field(
                "duration",
                2,
                "google.protobuf.Duration",
              ),
            )
            .add(
              new protobuf.Field(
                "price",
                3,
                "eve_public.corporation.loyalty.Points",
              ),
            ),
        ),
    )
    .add(
      new protobuf.Type("GetRequest").add(
        new protobuf.Field(
          "id",
          1,
          "eve_public.cosmetic.structure.paintwork.license.Identifier",
        ),
      ),
    )
    .add(
      new protobuf.Type("GetResponse").add(
        new protobuf.Field(
          "attributes",
          2,
          "eve_public.cosmetic.structure.paintwork.license.Attributes",
        ),
      ),
    )
    .add(new protobuf.Type("GetAllOwnedByCorporationRequest"))
    .add(
      new protobuf.Type("GetAllOwnedByCorporationResponse")
        .add(
          new protobuf.Field(
            "licenses",
            1,
            "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationResponse.License",
            "repeated",
          ),
        )
        .add(
          new protobuf.Type("License")
            .add(
              new protobuf.Field(
                "identifier",
                1,
                "eve_public.cosmetic.structure.paintwork.license.Identifier",
              ),
            )
            .add(
              new protobuf.Field(
                "attributes",
                2,
                "eve_public.cosmetic.structure.paintwork.license.Attributes",
              ),
            ),
        ),
    );

  root.define("eve_public.cosmetic.structure.paintwork.license.api.admin")
    .add(
      new protobuf.Type("IssueRequest")
        .add(
          new protobuf.Field(
            "paintwork",
            1,
            "eve_public.cosmetic.structure.paintwork.SlotConfiguration",
          ),
        )
        .add(
          new protobuf.Field("duration", 2, "google.protobuf.Duration"),
        )
        .add(
          new protobuf.Field(
            "structures",
            3,
            "eve_public.structure.Identifier",
            "repeated",
          ),
        )
        .add(new protobuf.Field("use_catalogue", 4, "bool"))
        .add(
          new protobuf.Field(
            "price",
            5,
            "eve_public.corporation.loyalty.Points",
          ),
        ),
    )
    .add(
      new protobuf.Type("IssueResponse")
        .add(
          new protobuf.Field(
            "licenses",
            1,
            "eve_public.cosmetic.structure.paintwork.license.api.admin.IssueResponse.LicenseStructure",
            "repeated",
          ),
        )
        .add(
          new protobuf.Type("LicenseStructure")
            .add(
              new protobuf.Field(
                "id",
                1,
                "eve_public.cosmetic.structure.paintwork.license.Identifier",
              ),
            )
            .add(
              new protobuf.Field(
                "attributes",
                2,
                "eve_public.cosmetic.structure.paintwork.license.Attributes",
              ),
            )
            .add(
              new protobuf.Field(
                "structure",
                3,
                "eve_public.structure.Identifier",
              ),
            ),
        ),
    )
    .add(
      new protobuf.Type("RevokeRequest").add(
        new protobuf.Field(
          "license",
          1,
          "eve_public.cosmetic.structure.paintwork.license.Identifier",
        ),
      ),
    )
    .add(new protobuf.Type("RevokeResponse"));

  root.define("eve_public.cosmetic.structure.paintwork.api")
    .add(
      new protobuf.Type("SetNotice")
        .add(
          new protobuf.Field(
            "structure",
            1,
            "eve_public.structure.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "paintwork",
            2,
            "eve_public.cosmetic.structure.paintwork.SlotConfiguration",
          ),
        ),
    )
    .add(
      new protobuf.Type("SetAllInSolarSystemNotice")
        .add(
          new protobuf.Field(
            "paintworks",
            1,
            "eve_public.cosmetic.structure.paintwork.api.SetAllInSolarSystemNotice.StructurePaintwork",
            "repeated",
          ),
        )
        .add(
          new protobuf.Field(
            "solar_system",
            2,
            "eve_public.solarsystem.Identifier",
          ),
        )
        .add(
          new protobuf.Type("StructurePaintwork")
            .add(
              new protobuf.Field(
                "structure",
                1,
                "eve_public.structure.Identifier",
              ),
            )
            .add(
              new protobuf.Field(
                "paintwork",
                2,
                "eve_public.cosmetic.structure.paintwork.SlotConfiguration",
              ),
            ),
        ),
    )
    .add(new protobuf.Type("GetAllInSolarSystemRequest"))
    .add(
      new protobuf.Type("GetAllInSolarSystemResponse")
        .add(
          new protobuf.Field(
            "paintworks",
            1,
            "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemResponse.StructurePaintwork",
            "repeated",
          ),
        )
        .add(
          new protobuf.Type("StructurePaintwork")
            .add(
              new protobuf.Field(
                "structure",
                1,
                "eve_public.structure.Identifier",
              ),
            )
            .add(
              new protobuf.Field(
                "paintwork",
                2,
                "eve_public.cosmetic.structure.paintwork.SlotConfiguration",
              ),
            ),
        ),
    )
    .add(
      new protobuf.Type("GetRequest")
        .add(
          new protobuf.Field(
            "structure",
            1,
            "eve_public.structure.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "solar_system",
            2,
            "eve_public.solarsystem.Identifier",
          ),
        ),
    )
    .add(
      new protobuf.Type("GetResponse")
        .add(
          new protobuf.Field(
            "license",
            1,
            "eve_public.cosmetic.structure.paintwork.license.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "paintwork",
            2,
            "eve_public.cosmetic.structure.paintwork.SlotConfiguration",
          ),
        ),
    );

  return root;
}

function decodePayload(messageType, requestEnvelope) {
  return messageType.decode(
    Buffer.from(
      requestEnvelope &&
        requestEnvelope.payload &&
        requestEnvelope.payload.value
        ? requestEnvelope.payload.value
        : Buffer.alloc(0),
    ),
  );
}

function buildLicenseIdentifier(licenseID) {
  return {
    uuid: uuidStringToBuffer(licenseID),
  };
}

function buildSequentialIdentifier(id) {
  return {
    sequential: Number(id || 0) || 0,
  };
}

function buildDuration(seconds) {
  const value = Number(seconds || 0);
  return {
    seconds: Math.max(0, Math.trunc(value || 0)),
  };
}

function buildPaintworkPayload(paintwork) {
  const source = paintwork && typeof paintwork === "object" ? paintwork : {};
  const payload = {};
  for (const slotName of [
    "first",
    "second",
    "third",
    "fourth",
    "primary",
    "secondary",
    "detailing",
  ]) {
    if (!source[slotName] || typeof source[slotName] !== "object") {
      continue;
    }
    if (source[slotName].paint !== undefined && source[slotName].paint !== null) {
      payload[slotName] = {
        paint: Number(source[slotName].paint || 0) || 0,
      };
      continue;
    }
    payload[slotName] = {
      empty: Boolean(source[slotName].empty),
    };
  }
  return payload;
}

function buildLicenseAttributes(license) {
  return {
    corporation: buildSequentialIdentifier(license.corporationID),
    activator: buildSequentialIdentifier(license.activatorCharacterID),
    issued: timestampFromMs(license.issuedAtMs),
    duration: buildDuration(license.durationSeconds),
    structure: buildSequentialIdentifier(license.structureID),
  };
}

function buildIssuedLicensePayload(license) {
  return {
    id: buildLicenseIdentifier(license.licenseID),
    attributes: buildLicenseAttributes(license),
    structure: buildSequentialIdentifier(license.structureID),
  };
}

function buildOwnedLicensePayload(license) {
  return {
    identifier: buildLicenseIdentifier(license.licenseID),
    attributes: buildLicenseAttributes(license),
  };
}

function publishLiveStructurePaintworkNotices(changedStructures = []) {
  if (!Array.isArray(changedStructures) || changedStructures.length === 0) {
    return;
  }

  try {
    const {
      publishStructurePaintworkSetAllInSolarSystemNotice,
      publishStructurePaintworkSetNotice,
    } = require(path.join(__dirname, "../publicGatewayLocal"));
    const solarSystemIDs = new Set();

    for (const changedStructure of changedStructures) {
      const structureID = Number(
        changedStructure && changedStructure.structureID,
      ) || 0;
      const solarSystemID = Number(
        changedStructure && changedStructure.solarSystemID,
      ) || 0;
      if (!structureID) {
        continue;
      }
      publishStructurePaintworkSetNotice(structureID, {
        solarSystemID,
        paintwork:
          changedStructure &&
          Object.prototype.hasOwnProperty.call(changedStructure, "paintwork")
            ? cloneValue(changedStructure.paintwork)
            : undefined,
      });
      if (solarSystemID > 0) {
        solarSystemIDs.add(solarSystemID);
      }
    }

    for (const solarSystemID of solarSystemIDs) {
      publishStructurePaintworkSetAllInSolarSystemNotice(solarSystemID);
    }
  } catch (error) {
    log.warn(
      `[StructurePaintworkGatewayService] Failed publishing live paintwork notices: ${error.message}`,
    );
  }
}

function extractStructureIDs(structures) {
  if (!Array.isArray(structures)) {
    return [];
  }
  return structures
    .map((structure) => Number(structure && structure.sequential) || 0)
    .filter(Boolean);
}

function extractLicenseID(identifier) {
  return uuidBufferToString(identifier && identifier.uuid);
}

function resolveActiveSolarSystemID(characterID) {
  const liveSession = sessionRegistry.findSessionByCharacterID(characterID);
  const liveSolarSystemID = Number(
    liveSession &&
      (liveSession.solarsystemid2 || liveSession.solarsystemid || 0),
  ) || 0;
  if (liveSolarSystemID > 0) {
    return liveSolarSystemID;
  }
  const character = getCharacterRecord(characterID) || {};
  return Number(character.solarSystemID || 0) || 0;
}

function buildErrorResult(errorCode, responseTypeName) {
  return {
    statusCode: ERROR_STATUS_BY_CODE[errorCode] || 400,
    statusMessage: "",
    responseTypeName,
    responsePayloadBuffer: Buffer.alloc(0),
  };
}

function createStructurePaintworkGatewayService() {
  const protoRoot = buildStructurePaintworkProtoRoot();
  const types = {
    licenseIssueRequest: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest",
    ),
    licenseIssueResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.IssueResponse",
    ),
    licenseRevokeRequest: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.RevokeRequest",
    ),
    licenseRevokeResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.RevokeResponse",
    ),
    licenseGetCatalogueResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueResponse",
    ),
    licenseGetRequest: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.GetRequest",
    ),
    licenseGetResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.GetResponse",
    ),
    licenseGetAllOwnedResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationResponse",
    ),
    adminIssueRequest: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.admin.IssueRequest",
    ),
    adminIssueResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.admin.IssueResponse",
    ),
    adminRevokeRequest: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.admin.RevokeRequest",
    ),
    adminRevokeResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.license.api.admin.RevokeResponse",
    ),
    paintworkGetRequest: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.api.GetRequest",
    ),
    paintworkGetResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.api.GetResponse",
    ),
    paintworkGetAllInSolarSystemResponse: protoRoot.lookupType(
      "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemResponse",
    ),
  };

  return {
    name: "structure-paintwork",
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
      const corporationID = getCorporationIDForCharacter(activeCharacterID);

      if (
        requestTypeName ===
          "eve_public.cosmetic.structure.paintwork.license.api.IssueRequest" ||
        requestTypeName ===
          "eve_public.cosmetic.structure.paintwork.license.api.admin.IssueRequest"
      ) {
        const decoded = decodePayload(
          requestTypeName.includes(".admin.")
            ? types.adminIssueRequest
            : types.licenseIssueRequest,
          requestEnvelope,
        );
        const result = issueLicenses(
          activeCharacterID,
          cloneValue(decoded && decoded.paintwork),
          Number(
            decoded &&
              decoded.duration &&
              decoded.duration.seconds,
          ) || DEFAULT_DURATION_SECONDS,
          extractStructureIDs(decoded && decoded.structures),
          requestTypeName.includes(".admin.")
            ? {
                adminRequest: true,
                useCatalogue: Boolean(decoded && decoded.use_catalogue),
                priceAmount:
                  decoded &&
                  decoded.price &&
                  decoded.price.amount !== undefined
                    ? Number(decoded.price.amount || 0)
                    : null,
              }
            : undefined,
        );
        if (!result.success) {
          return buildErrorResult(
            result.errorMsg,
            requestTypeName.replace(/Request$/, "Response"),
          );
        }
        publishLiveStructurePaintworkNotices(result.data);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: requestTypeName.replace(/Request$/, "Response"),
          responsePayloadBuffer: encodePayload(
            requestTypeName.includes(".admin.")
              ? types.adminIssueResponse
              : types.licenseIssueResponse,
            {
              licenses: result.data.map(buildIssuedLicensePayload),
            },
          ),
        };
      }

      if (
        requestTypeName ===
          "eve_public.cosmetic.structure.paintwork.license.api.RevokeRequest" ||
        requestTypeName ===
          "eve_public.cosmetic.structure.paintwork.license.api.admin.RevokeRequest"
      ) {
        const decoded = decodePayload(
          requestTypeName.includes(".admin.")
            ? types.adminRevokeRequest
            : types.licenseRevokeRequest,
          requestEnvelope,
        );
        const result = revokeLicense(
          activeCharacterID,
          extractLicenseID(decoded && decoded.license),
          requestTypeName.includes(".admin.")
            ? {
                adminRequest: true,
              }
            : undefined,
        );
        if (!result.success) {
          return buildErrorResult(
            result.errorMsg,
            requestTypeName.replace(/Request$/, "Response"),
          );
        }
        publishLiveStructurePaintworkNotices([
          {
            structureID: result.data && result.data.structureID,
            solarSystemID: result.data && result.data.solarSystemID,
            paintwork: {},
          },
        ]);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: requestTypeName.replace(/Request$/, "Response"),
          responsePayloadBuffer: encodePayload(
            requestTypeName.includes(".admin.")
              ? types.adminRevokeResponse
              : types.licenseRevokeResponse,
            {},
          ),
        };
      }

      if (
        requestTypeName ===
        "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueRequest"
      ) {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.cosmetic.structure.paintwork.license.api.GetCatalogueResponse",
          responsePayloadBuffer: encodePayload(types.licenseGetCatalogueResponse, {
            items: getCatalogueItems().map((item) => ({
              structure_type: buildSequentialIdentifier(item.structureTypeID),
              duration: buildDuration(item.durationSeconds),
              price: {
                amount: Number(item.priceAmount || 0),
                associated_corporation: buildSequentialIdentifier(
                  item.associatedCorporationID || HERALDRY_CORPORATION_ID,
                ),
              },
            })),
          }),
        };
      }

      if (
        requestTypeName ===
        "eve_public.cosmetic.structure.paintwork.license.api.GetRequest"
      ) {
        const decoded = decodePayload(types.licenseGetRequest, requestEnvelope);
        const license = getLicense(extractLicenseID(decoded && decoded.id));
        if (!license) {
          return buildErrorResult(
            "NOT_FOUND",
            "eve_public.cosmetic.structure.paintwork.license.api.GetResponse",
          );
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.cosmetic.structure.paintwork.license.api.GetResponse",
          responsePayloadBuffer: encodePayload(types.licenseGetResponse, {
            attributes: buildLicenseAttributes(license),
          }),
        };
      }

      if (
        requestTypeName ===
        "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationRequest"
      ) {
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.cosmetic.structure.paintwork.license.api.GetAllOwnedByCorporationResponse",
          responsePayloadBuffer: encodePayload(types.licenseGetAllOwnedResponse, {
            licenses: getLicensesForCorporation(corporationID).map(
              buildOwnedLicensePayload,
            ),
          }),
        };
      }

      if (
        requestTypeName ===
        "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemRequest"
      ) {
        const solarSystemID = resolveActiveSolarSystemID(activeCharacterID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.cosmetic.structure.paintwork.api.GetAllInSolarSystemResponse",
          responsePayloadBuffer: encodePayload(
            types.paintworkGetAllInSolarSystemResponse,
            {
              paintworks: getPaintworksForSolarSystem(solarSystemID).map(
                (license) => ({
                  structure: buildSequentialIdentifier(license.structureID),
                  paintwork: buildPaintworkPayload(license.paintwork),
                }),
              ),
            },
          ),
        };
      }

      if (
        requestTypeName === "eve_public.cosmetic.structure.paintwork.api.GetRequest"
      ) {
        const decoded = decodePayload(types.paintworkGetRequest, requestEnvelope);
        const structureID = Number(
          decoded && decoded.structure && decoded.structure.sequential,
        ) || 0;
        const requestedSolarSystemID = Number(
          decoded &&
            decoded.solar_system &&
            decoded.solar_system.sequential,
        ) || 0;
        const license = getLicenseForStructure(structureID);
        if (
          !license ||
          (requestedSolarSystemID > 0 &&
            Number(license.solarSystemID || 0) !== requestedSolarSystemID)
        ) {
          return buildErrorResult(
            "NOT_FOUND",
            "eve_public.cosmetic.structure.paintwork.api.GetResponse",
          );
        }
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.cosmetic.structure.paintwork.api.GetResponse",
          responsePayloadBuffer: encodePayload(types.paintworkGetResponse, {
            license: buildLicenseIdentifier(license.licenseID),
            paintwork: buildPaintworkPayload(license.paintwork),
          }),
        };
      }

      return null;
    },
  };
}

module.exports = {
  buildStructurePaintworkProtoRoot,
  createStructurePaintworkGatewayService,
};
