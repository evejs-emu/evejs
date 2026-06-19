const path = require("path");

const config = require(path.join(__dirname, "../../config"));

function buildList(items = []) {
  return {
    type: "list",
    items,
  };
}

function buildDict(entries = []) {
  return {
    type: "dict",
    entries,
  };
}

function buildKeyVal(entries = []) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: buildDict(entries),
  };
}

function buildNamedObject(name, entries = []) {
  return {
    type: "object",
    name,
    args: buildDict(entries),
  };
}

function buildObjectEx1(name, args = [], stateEntries = null) {
  const header = [
    { type: "token", value: String(name || "") },
    Array.isArray(args) ? args : [args],
  ];

  if (Array.isArray(stateEntries) && stateEntries.length > 0) {
    header.push({
      type: "dict",
      entries: stateEntries,
    });
  }

  return {
    type: "objectex1",
    header,
    list: [],
    dict: [],
  };
}

function buildRow(header = [], line = []) {
  return {
    type: "object",
    name: "util.Row",
    args: buildDict([
      ["header", buildList(header)],
      ["line", buildList(line)],
    ]),
  };
}

function buildRowset(header = [], rows = [], name = "util.Rowset") {
  return {
    type: "object",
    name,
    args: buildDict([
      ["header", buildList(header)],
      ["columns", buildList(header)],
      ["RowClass", { type: "token", value: "util.Row" }],
      ["lines", buildList(rows)],
    ]),
  };
}

function buildPackedRowDescriptor(columns = [], virtualColumns = []) {
  const header = [
    { type: "token", value: "blue.DBRowDescriptor" },
    [columns],
  ];

  if (Array.isArray(virtualColumns) && virtualColumns.length > 0) {
    header.push(buildList(virtualColumns));
  }

  return {
    type: "objectex1",
    header,
    list: [],
    dict: [],
  };
}

function buildPackedRow(columns = [], fields = {}, virtualColumns = []) {
  return {
    type: "packedrow",
    header: buildPackedRowDescriptor(columns, virtualColumns),
    columns,
    fields,
  };
}

function buildDbRowset(
  columns = [],
  rows = [],
  name = "eve.common.script.sys.rowset.Rowset",
) {
  return {
    type: "object",
    name,
    args: buildDict([
      ["header", buildPackedRowDescriptor(columns)],
      ["columns", buildList(columns.map(([columnName]) => columnName))],
      ["RowClass", { type: "token", value: "blue.DBRow" }],
      ["lines", buildList(Array.isArray(rows) ? rows : [])],
    ]),
  };
}

function buildIndexRowset(
  header = [],
  keyedRows = [],
  keyColumn = null,
  name = "eve.common.script.sys.rowset.IndexRowset",
) {
  return {
    type: "object",
    name,
    args: buildDict([
      ["header", buildList(header)],
      ["columns", buildList(header)],
      ["RowClass", { type: "token", value: "util.Row" }],
      ["idName", keyColumn],
      [
        "items",
        buildDict(
          keyedRows.map(([key, line]) => [key, buildList(Array.isArray(line) ? line : [])]),
        ),
      ],
    ]),
  };
}

function buildPagedResultSet(
  collection = [],
  totalCount = 0,
  page = 0,
  perPage = 50,
) {
  return buildObjectEx1("eve.common.script.util.pagedCollection.PagedResultSet", [
    buildList(Array.isArray(collection) ? collection : []),
    Math.max(0, Number(totalCount) || 0),
    Math.max(0, Number(page) || 0),
    Math.max(1, Number(perPage) || 1),
  ]);
}

function buildPythonSet(values = []) {
  const normalizedValues = [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeNumber(value, 0))
      .filter((value) => Number.isFinite(value)),
  )].sort((left, right) => left - right);

  return buildObjectEx1("__builtin__.set", [buildList(normalizedValues)]);
}

function currentFileTime() {
  return BigInt(Date.now()) * 10000n + 116444736000000000n;
}

function normalizeBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }

    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }

    if (value && typeof value === "object" && value.type === "long") {
      return normalizeBigInt(value.value, fallback);
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function buildFiletimeLong(rawValue = null) {
  return {
    type: "long",
    value: normalizeBigInt(rawValue, currentFileTime()),
  };
}

function buildMarshalReal(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  return {
    type: "real",
    value: Number.isFinite(numericValue) ? numericValue : fallback,
  };
}

function buildMarshalRealVectorList(value, fallback = [0, 0, 0]) {
  const fallbackVector = Array.isArray(fallback)
    ? fallback
    : [
        normalizeNumber(fallback && fallback.x, 0),
        normalizeNumber(fallback && fallback.y, 0),
        normalizeNumber(fallback && fallback.z, 0),
      ];

  const sourceVector = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value.x, value.y, value.z]
      : fallbackVector;

  return [
    buildMarshalReal(sourceVector[0], fallbackVector[0]),
    buildMarshalReal(sourceVector[1], fallbackVector[1]),
    buildMarshalReal(sourceVector[2], fallbackVector[2]),
  ];
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (value.type === "wstring" || value.type === "token") {
      return normalizeText(value.value, fallback);
    }

    if (value.type === "int" || value.type === "long") {
      return normalizeText(value.value, fallback);
    }
  }

  return String(value);
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (Buffer.isBuffer(value)) {
    return normalizeNumber(value.toString("utf8"), fallback);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  if (typeof value === "object") {
    if (
      value.type === "int" ||
      value.type === "long" ||
      value.type === "float" ||
      value.type === "double" ||
      value.type === "bool" ||
      value.type === "wstring" ||
      value.type === "token"
    ) {
      return normalizeNumber(value.value, fallback);
    }
  }

  return fallback;
}

function parseCPickedIntegerSet(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.type !== "cpicked" ||
    (!Buffer.isBuffer(value.data) && !value.data)
  ) {
    return [];
  }

  const rawBuffer = Buffer.isBuffer(value.data)
    ? value.data
    : Buffer.from(value.data);
  const ascii = rawBuffer.toString("ascii");
  if (
    !ascii.includes("set\n") ||
    (!ascii.includes("c__builtin__\nset\n") &&
      !ascii.includes("cbuiltins\nset\n"))
  ) {
    return [];
  }

  const numbers = [];
  const integerPattern = /(^|\n)I(-?\d+)\na/g;
  const longPattern = /(^|\n)L(-?\d+)L\na/g;
  let match = integerPattern.exec(ascii);
  while (match) {
    numbers.push(Number(match[2]) || 0);
    match = integerPattern.exec(ascii);
  }
  match = longPattern.exec(ascii);
  while (match) {
    numbers.push(Number(match[2]) || 0);
    match = longPattern.exec(ascii);
  }
  return numbers.filter((valueToKeep) => Number.isFinite(valueToKeep));
}

function extractList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value instanceof Set) {
    return [...value];
  }

  if (
    value &&
    typeof value === "object" &&
    value.type === "list" &&
    Array.isArray(value.items)
  ) {
    return value.items;
  }

  if (
    value &&
    typeof value === "object" &&
    value.type === "objectex1" &&
    Array.isArray(value.header)
  ) {
    const headerName =
      value.header[0] && typeof value.header[0] === "object"
        ? normalizeText(value.header[0].value, "")
        : "";
    const headerArgs = Array.isArray(value.header[1]) ? value.header[1] : [];
    if (
      (headerName === "__builtin__.set" || headerName === "builtins.set") &&
      headerArgs.length > 0
    ) {
      return extractList(headerArgs[0]);
    }
  }

  if (value && typeof value === "object" && value.type === "cpicked") {
    return parseCPickedIntegerSet(value);
  }

  return [];
}

function extractDictEntries(value) {
  if (
    value &&
    typeof value === "object" &&
    value.type === "dict" &&
    Array.isArray(value.entries)
  ) {
    return value.entries;
  }

  return [];
}

function isMarshalKeyValName(value) {
  const normalizedName = normalizeText(value, "");
  return (
    normalizedName === "util.KeyVal" ||
    normalizedName === "utillib.KeyVal" ||
    normalizedName === "KeyVal"
  );
}

function mapMarshalEntriesToObject(entries = [], depth = 0) {
  return Object.fromEntries(
    (Array.isArray(entries) ? entries : []).map(([entryKey, entryValue]) => [
      unwrapMarshalValue(entryKey, depth + 1),
      unwrapMarshalValue(entryValue, depth + 1),
    ]),
  );
}

function unwrapMarshalValue(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => unwrapMarshalValue(entry, depth + 1));
  }

  if (value instanceof Set) {
    return [...value].map((entry) => unwrapMarshalValue(entry, depth + 1));
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([entryKey, entryValue]) => [
        unwrapMarshalValue(entryKey, depth + 1),
        unwrapMarshalValue(entryValue, depth + 1),
      ]),
    );
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  switch (value.type) {
    case "token":
    case "wstring":
    case "rawstr":
      return normalizeText(value.value, "");
    case "long":
    case "int":
    case "float":
    case "double":
    case "real":
    case "varinteger":
    case "bool":
      return unwrapMarshalValue(value.value, depth + 1);
    case "list":
    case "tuple":
    case "set":
      return Array.isArray(value.items)
        ? value.items.map((entry) => unwrapMarshalValue(entry, depth + 1))
        : [];
    case "dict":
      return mapMarshalEntriesToObject(value.entries, depth + 1);
    case "object":
      if (isMarshalKeyValName(value.name)) {
        if (
          value.args &&
          value.args.type === "dict" &&
          Array.isArray(value.args.entries)
        ) {
          return mapMarshalEntriesToObject(value.args.entries, depth + 1);
        }
        return unwrapMarshalValue(value.args, depth + 1);
      }
      if (Object.prototype.hasOwnProperty.call(value, "args")) {
        return unwrapMarshalValue(value.args, depth + 1);
      }
      break;
    case "objectex1":
    case "objectex2": {
      const headerName =
        Array.isArray(value.header) && value.header.length > 0
          ? normalizeText(value.header[0], "")
          : "";
      const headerArgs =
        Array.isArray(value.header) && value.header.length > 1 && Array.isArray(value.header[1])
          ? value.header[1]
          : [];

      if (isMarshalKeyValName(headerName)) {
        if (
          Array.isArray(value.header) &&
          value.header.length > 2 &&
          value.header[2] &&
          value.header[2].type === "dict" &&
          Array.isArray(value.header[2].entries)
        ) {
          return mapMarshalEntriesToObject(value.header[2].entries, depth + 1);
        }
        return headerArgs.length > 0
          ? unwrapMarshalValue(headerArgs[0], depth + 1)
          : {};
      }

      if (
        headerName === "__builtin__.set" ||
        headerName === "builtins.set" ||
        headerName === "set"
      ) {
        return headerArgs.length > 0
          ? unwrapMarshalValue(headerArgs[0], depth + 1)
          : [];
      }

      return {
        header: unwrapMarshalValue(value.header, depth + 1),
        list: unwrapMarshalValue(value.list, depth + 1),
        dict: unwrapMarshalValue(value.dict, depth + 1),
      };
    }
    default:
      if (Object.prototype.hasOwnProperty.call(value, "value")) {
        return unwrapMarshalValue(value.value, depth + 1);
      }
      break;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      unwrapMarshalValue(entryValue, depth + 1),
    ]),
  );
}

function marshalObjectToObject(value) {
  if (!value) {
    return {};
  }

  const unwrapped = unwrapMarshalValue(value);
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    return { ...unwrapped };
  }

  return {};
}

function resolveBoundNodeId() {
  return config.proxyNodeId;
}

function ensureSessionBoundObjectState(session) {
  if (!session || typeof session !== "object") {
    return null;
  }
  if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
    session._boundObjectIDs = {};
  }
  if (!session._boundObjectState || typeof session._boundObjectState !== "object") {
    session._boundObjectState = {};
  }
  return session._boundObjectState;
}

function buildBoundObjectResponse(service, args, session, kwargs) {
  const nestedCall = args && args.length > 1 ? args[1] : null;
  const boundObjectState = ensureSessionBoundObjectState(session);
  const serviceName =
    service && typeof service.name === "string" && service.name.trim() !== ""
      ? service.name
      : null;
  const existingObjectID =
    session &&
    session._boundObjectIDs &&
    serviceName &&
    typeof session._boundObjectIDs[serviceName] === "string" &&
    session._boundObjectIDs[serviceName].trim() !== ""
      ? session._boundObjectIDs[serviceName]
      : null;
  const existingObjectState =
    boundObjectState && serviceName && boundObjectState[serviceName]
      ? boundObjectState[serviceName]
      : null;
  const shouldReuseBoundObject = Boolean(
    service &&
      service.reuseBoundObjectForSession === true &&
      existingObjectID,
  );
  const objectId = shouldReuseBoundObject
    ? [
        existingObjectID,
        existingObjectState && existingObjectState.boundAtFileTime
          ? existingObjectState.boundAtFileTime
          : currentFileTime(),
      ]
    : [`N=${config.proxyNodeId}:${config.getNextBoundId()}`, currentFileTime()];

  if (session) {
    if (!session._boundObjectIDs || typeof session._boundObjectIDs !== "object") {
      session._boundObjectIDs = {};
    }
    if (serviceName) {
      session._boundObjectIDs[serviceName] = objectId[0];
    }
    if (boundObjectState && serviceName) {
      boundObjectState[serviceName] = {
        objectID: objectId[0],
        boundAtFileTime: objectId[1],
      };
    }
    session.lastBoundObjectID = objectId[0];
  }

  let callResult = null;
  if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
    const methodName = normalizeText(nestedCall[0], "");
    const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
    const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

    callResult = service.callMethod(
      methodName,
      Array.isArray(callArgs) ? callArgs : [callArgs],
      session,
      callKwargs,
    );
  }

  return [
    {
      type: "substruct",
      value: {
        type: "substream",
        value: objectId,
      },
    },
    callResult != null ? callResult : null,
  ];
}

module.exports = {
  buildList,
  buildDict,
  buildKeyVal,
  buildNamedObject,
  buildObjectEx1,
  buildRow,
  buildRowset,
  buildPackedRowDescriptor,
  buildPackedRow,
  buildDbRowset,
  buildIndexRowset,
  buildPagedResultSet,
  buildPythonSet,
  currentFileTime,
  normalizeBigInt,
  buildFiletimeLong,
  buildMarshalReal,
  buildMarshalRealVectorList,
  normalizeText,
  normalizeNumber,
  extractList,
  extractDictEntries,
  isMarshalKeyValName,
  unwrapMarshalValue,
  marshalObjectToObject,
  resolveBoundNodeId,
  buildBoundObjectResponse,
};
