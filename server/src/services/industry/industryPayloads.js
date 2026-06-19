const path = require("path");

const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildObjectEx1,
  marshalObjectToObject,
  normalizeNumber,
  normalizeText,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  INDUSTRY_ERROR_NAME,
} = require(path.join(__dirname, "./industryConstants"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function buildTuple(items = []) {
  return {
    type: "tuple",
    items: Array.isArray(items) ? items : [],
  };
}

function buildMarshalValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return buildList(value.map((entry) => buildMarshalValue(entry)));
  }

  if (typeof value === "object" && value.type) {
    return value;
  }

  if (typeof value === "object") {
    return buildDict(
      Object.entries(value).map(([key, entryValue]) => [
        normalizeNumber(key, key),
        buildMarshalValue(entryValue),
      ]),
    );
  }

  return value;
}

function buildIndustryErrorTuple(errorCode, args = []) {
  const numericCode = toInt(errorCode, 0);
  return buildTuple([
    buildKeyVal([
      ["value", numericCode],
      ["name", INDUSTRY_ERROR_NAME[numericCode] || `IndustryError${numericCode}`],
    ]),
    buildTuple(Array.isArray(args) ? args : []),
  ]);
}

function buildIndustryValidationErrors(errors = []) {
  return buildList(
    (Array.isArray(errors) ? errors : []).map((entry) =>
      buildIndustryErrorTuple(entry.code, entry.args)),
  );
}

function buildBlueprintInstancePayload(instance) {
  return buildKeyVal([
    ["typeID", toInt(instance && instance.typeID, 0)],
    ["itemID", toInt(instance && instance.itemID, 0)],
    ["timeEfficiency", toInt(instance && instance.timeEfficiency, 0)],
    ["materialEfficiency", toInt(instance && instance.materialEfficiency, 0)],
    ["runs", toInt(instance && instance.runs, 0)],
    ["quantity", toInt(instance && instance.quantity, -1)],
    ["locationID", toInt(instance && instance.locationID, 0)],
    ["locationTypeID", toInt(instance && instance.locationTypeID, 0)],
    ["locationFlagID", toInt(instance && instance.locationFlagID, 0)],
    ["flagID", toInt(instance && instance.flagID, 0)],
    ["facilityID", instance && instance.facilityID ? toInt(instance.facilityID, 0) : null],
    ["ownerID", toInt(instance && instance.ownerID, 0)],
    ["jobID", instance && instance.jobID ? toInt(instance.jobID, 0) : null],
    ["isImpounded", Boolean(instance && instance.isImpounded)],
    ["original", Boolean(instance && instance.original)],
    ["solarSystemID", toInt(instance && instance.solarSystemID, 0)],
  ]);
}

function buildJobPayload(job) {
  return buildKeyVal([
    ["activityID", toInt(job && job.activityID, 0)],
    ["jobID", toInt(job && job.jobID, 0)],
    ["blueprintID", toInt(job && job.blueprintID, 0)],
    ["blueprintTypeID", toInt(job && job.blueprintTypeID, 0)],
    ["blueprintCopy", Boolean(job && job.blueprintCopy)],
    ["blueprintLocationID", toInt(job && job.blueprintLocationID, 0)],
    ["blueprintLocationFlagID", toInt(job && job.blueprintLocationFlagID, 0)],
    ["facilityID", toInt(job && job.facilityID, 0)],
    ["ownerID", toInt(job && job.ownerID, 0)],
    ["status", toInt(job && job.status, 0)],
    ["installerID", toInt(job && job.installerID, 0)],
    ["completedCharacterID", toInt(job && job.completedCharacterID, 0)],
    ["solarSystemID", toInt(job && job.solarSystemID, 0)],
    ["stationID", toInt(job && job.stationID, 0)],
    ["startDate", buildFiletimeLong(job && job.startDate)],
    ["endDate", buildFiletimeLong(job && job.endDate)],
    ["pauseDate", job && job.pauseDate ? buildFiletimeLong(job.pauseDate) : null],
    ["runs", toInt(job && job.runs, 0)],
    ["licensedRuns", toInt(job && job.licensedRuns, 0)],
    ["successfulRuns", toInt(job && job.successfulRuns, 0)],
    ["cost", toInt(job && job.cost, 0)],
    ["timeInSeconds", toInt(job && job.timeInSeconds, 0)],
    ["probability", job && job.probability !== undefined ? Number(job.probability) : 1],
    ["productTypeID", toInt(job && job.productTypeID, 0)],
    ["optionalTypeID", job && job.optionalTypeID ? toInt(job.optionalTypeID, 0) : null],
    ["optionalTypeID2", job && job.optionalTypeID2 ? toInt(job.optionalTypeID2, 0) : null],
    ["outputLocationID", toInt(job && job.outputLocationID, 0)],
    ["outputFlagID", toInt(job && job.outputFlagID, 0)],
  ]);
}

function buildFacilityPayload(facility) {
  return buildKeyVal([
    ["facilityID", toInt(facility && facility.facilityID, 0)],
    ["typeID", toInt(facility && facility.typeID, 0)],
    ["ownerID", toInt(facility && facility.ownerID, 0)],
    ["tax", Number(facility && facility.tax !== undefined ? facility.tax : 0)],
    ["solarSystemID", toInt(facility && facility.solarSystemID, 0)],
    ["online", Boolean(facility && facility.online !== false)],
    ["serviceAccess", buildMarshalValue((facility && facility.serviceAccess) || {})],
    ["sccTaxModifier", Number(facility && facility.sccTaxModifier !== undefined ? facility.sccTaxModifier : 1)],
    ["rigModifiers", buildMarshalValue((facility && facility.rigModifiers) || {})],
    ["globalModifiers", buildMarshalValue((facility && facility.globalModifiers) || {})],
    [
      "activities",
      buildDict(
        Object.entries((facility && facility.activities) || {}).map(([activityID, entry]) => [
          toInt(activityID, 0),
          buildTuple(Array.isArray(entry) ? entry : []),
        ]),
      ),
    ],
  ]);
}

function buildLocationPayload(location) {
  return buildObjectEx1("industry.Location", [], [
    ["itemID", toInt(location && location.itemID, 0)],
    ["typeID", toInt(location && location.typeID, 0)],
    ["ownerID", toInt(location && location.ownerID, 0)],
    ["flagID", toInt(location && location.flagID, 0)],
    ["solarSystemID", toInt(location && location.solarSystemID, 0)],
    ["canView", Boolean(location && location.canView !== false)],
    ["canTake", Boolean(location && location.canTake !== false)],
  ]);
}

function extractIndustryLocationObject(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const objectName = normalizeText(unwrapMarshalValue(value.name), "");
  if (value.type === "object" && objectName === "industry.Location") {
    return marshalObjectToObject(value.args);
  }

  if (value.type === "objectex1" || value.type === "objectex2") {
    const header = Array.isArray(value.header) ? value.header : [];
    const headerName = normalizeText(unwrapMarshalValue(header[0]), "");
    if (headerName === "industry.Location") {
      if (Array.isArray(value.dict) && value.dict.length > 0) {
        return marshalObjectToObject({
          type: "dict",
          entries: value.dict,
        });
      }
      if (header.length > 1) {
        const headerArgs = unwrapMarshalValue(header[1]);
        if (headerArgs && typeof headerArgs === "object" && !Array.isArray(headerArgs)) {
          return { ...headerArgs };
        }
      }
    }
  }

  return null;
}

function buildFacilityTaxesPayload(taxes = {}) {
  const normalizeTax = (value) => (
    value === null || value === undefined ? null : Number(value)
  );
  return buildKeyVal([
    ["taxCorporation", normalizeTax(taxes && taxes.taxCorporation)],
    ["taxAlliance", normalizeTax(taxes && taxes.taxAlliance)],
    ["taxStandingsHorrible", normalizeTax(taxes && taxes.taxStandingsHorrible)],
    ["taxStandingsBad", normalizeTax(taxes && taxes.taxStandingsBad)],
    ["taxStandingsNeutral", normalizeTax(taxes && taxes.taxStandingsNeutral)],
    ["taxStandingsGood", normalizeTax(taxes && taxes.taxStandingsGood)],
    ["taxStandingsHigh", normalizeTax(taxes && taxes.taxStandingsHigh)],
  ]);
}

function buildAvailableMaterialsPayload(materials = {}) {
  return buildDict(
    Object.entries(materials || {}).map(([typeID, quantity]) => [
      toInt(typeID, 0),
      toInt(quantity, 0),
    ]),
  );
}

function parseLocationRequest(value) {
  const industryLocationValue = extractIndustryLocationObject(value);
  if (industryLocationValue && Object.keys(industryLocationValue).length > 0) {
    return {
      itemID: toInt(industryLocationValue.itemID, 0),
      typeID: toInt(industryLocationValue.typeID, 0),
      ownerID: toInt(industryLocationValue.ownerID, 0),
      flagID: toInt(industryLocationValue.flagID, 0),
      solarSystemID: toInt(industryLocationValue.solarSystemID, 0),
      canView: industryLocationValue.canView !== false,
      canTake: industryLocationValue.canTake !== false,
    };
  }
  const objectValue = marshalObjectToObject(value);
  if (objectValue && Object.keys(objectValue).length > 0) {
    return {
      itemID: toInt(objectValue.itemID, 0),
      typeID: toInt(objectValue.typeID, 0),
      ownerID: toInt(objectValue.ownerID, 0),
      flagID: toInt(objectValue.flagID, 0),
      solarSystemID: toInt(objectValue.solarSystemID, 0),
      canView: objectValue.canView !== false,
      canTake: objectValue.canTake !== false,
    };
  }
  const unwrapped = unwrapMarshalValue(value);
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    return {
      itemID: toInt(unwrapped.itemID, 0),
      typeID: toInt(unwrapped.typeID, 0),
      ownerID: toInt(unwrapped.ownerID, 0),
      flagID: toInt(unwrapped.flagID, 0),
      solarSystemID: toInt(unwrapped.solarSystemID, 0),
      canView: unwrapped.canView !== false,
      canTake: unwrapped.canTake !== false,
    };
  }
  return null;
}

function parseIndustryRequest(value) {
  const request = marshalObjectToObject(value);
  if (!request || Object.keys(request).length === 0) {
    return {};
  }

  const accountValue = Array.isArray(request.account)
    ? request.account
    : Array.isArray(unwrapMarshalValue(request.account))
      ? unwrapMarshalValue(request.account)
      : [];

  return {
    blueprintID: toInt(request.blueprintID, 0),
    blueprintTypeID: toInt(request.blueprintTypeID, 0),
    activityID: toInt(request.activityID, 0),
    facilityID: toInt(request.facilityID, 0),
    solarSystemID: toInt(request.solarSystemID, 0),
    characterID: toInt(request.characterID, 0),
    corporationID: toInt(request.corporationID, 0),
    account: accountValue.length >= 2
      ? [toInt(accountValue[0], 0), toInt(accountValue[1], 0)]
      : null,
    runs: toInt(request.runs, 0),
    cost: Number(normalizeNumber(request.cost, 0)),
    tax: Number(normalizeNumber(request.tax, 0)),
    time: Number(normalizeNumber(request.time, 0)),
    materials:
      request.materials && typeof request.materials === "object"
        ? Object.fromEntries(
            Object.entries(request.materials).map(([typeID, quantity]) => [
              toInt(typeID, 0),
              toInt(quantity, 0),
            ]),
          )
        : {},
    inputLocation: parseLocationRequest(request.inputLocation),
    outputLocation: parseLocationRequest(request.outputLocation),
    licensedRuns: toInt(request.licensedRuns, 0),
    productTypeID: toInt(request.productTypeID, 0),
    optionalTypeID: toInt(request.optionalTypeID, 0) || null,
    optionalTypeID2: toInt(request.optionalTypeID2, 0) || null,
    rawRequest: request,
  };
}

module.exports = {
  buildAvailableMaterialsPayload,
  buildBlueprintInstancePayload,
  buildFacilityPayload,
  buildFacilityTaxesPayload,
  buildIndustryErrorTuple,
  buildIndustryValidationErrors,
  buildJobPayload,
  buildLocationPayload,
  parseIndustryRequest,
};
