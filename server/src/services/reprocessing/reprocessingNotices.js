const path = require("path");

const {
  encodePayload,
} = require(path.join(
  __dirname,
  "../../_secondary/express/gatewayServices/gatewayServiceHelpers",
));
const {
  buildReprocessingGatewayProtoRoot,
} = require("./reprocessingGatewayProto");

const PROTO_ROOT = buildReprocessingGatewayProtoRoot();
const ReprocessedNotice = PROTO_ROOT.lookupType(
  "eve.industry.reprocess.api.Reprocessed",
);

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function buildSequentialIdentifier(value) {
  return {
    sequential: normalizePositiveInteger(value, 0),
  };
}

function resolvePublisher(publishGatewayNotice) {
  if (typeof publishGatewayNotice === "function") {
    return publishGatewayNotice;
  }

  try {
    const publicGatewayLocal = require(path.join(
      __dirname,
      "../../_secondary/express/publicGatewayLocal",
    ));
    return typeof publicGatewayLocal.publishGatewayNotice === "function"
      ? publicGatewayLocal.publishGatewayNotice
      : null;
  } catch (_error) {
    return null;
  }
}

function buildReprocessedPayload(event = {}) {
  const payload = {
    character: buildSequentialIdentifier(event.characterID),
    input_type: buildSequentialIdentifier(event.inputTypeID),
    quantity: normalizePositiveInteger(event.quantity, 0),
    outputs: (Array.isArray(event.outputs) ? event.outputs : [])
      .map((entry) => ({
        output_type: buildSequentialIdentifier(entry && entry.outputTypeID),
        quantity: normalizePositiveInteger(entry && entry.quantity, 0),
      }))
      .filter((entry) => entry.output_type.sequential > 0 && entry.quantity > 0),
  };

  if (String(event.dockedKind || "").trim() === "structure") {
    payload.structure = buildSequentialIdentifier(event.dockedLocationID);
  } else {
    payload.station = buildSequentialIdentifier(event.dockedLocationID);
  }

  return payload;
}

function publishReprocessedNotice(event = {}, options = {}) {
  const publisher = resolvePublisher(options.publishGatewayNotice);
  const targetCharacterID = normalizePositiveInteger(event.characterID, 0);
  if (!publisher || targetCharacterID <= 0) {
    return false;
  }

  publisher(
    "eve.industry.reprocess.api.Reprocessed",
    encodePayload(ReprocessedNotice, buildReprocessedPayload(event)),
    {
      character: targetCharacterID,
    },
  );
  return true;
}

module.exports = {
  buildReprocessedPayload,
  publishReprocessedNotice,
};
