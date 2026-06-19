const path = require("path");
const zlib = require("zlib");

const config = require(path.join(__dirname, "../../config"));
const {
  buildDict,
  currentFileTime,
  normalizeBigInt,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { marshalEncode } = require(path.join(
  __dirname,
  "../../network/tcp/utils/marshal",
));

const CACHE_MODE = "proxy";
const CRC_HQX_POLY = 0x1021;
const CRC_HQX_SEED_OFFSET = 170472;
const MAX_VERSIONS_PER_OBJECT = 4;
const COMPRESS_THRESHOLD_BYTES = 170;
const COMPRESS_LEVEL = 1;

const cachedObjects = new Map();

function buildRawString(value) {
  return {
    type: "rawstr",
    value: String(value ?? ""),
  };
}

function buildSignedLong(value, fallback = 0n) {
  return {
    type: "long",
    value: normalizeBigInt(value, fallback),
  };
}

function buildVersionTuple(version = null) {
  const normalizedVersion = normalizeObjectVersion(version);
  if (!normalizedVersion) {
    return null;
  }

  return [buildSignedLong(normalizedVersion[0]), normalizedVersion[1]];
}

function buildCacheDetails({ versionCheck = "run", sessionInfo = null } = {}) {
  const entries = [[buildRawString("versionCheck"), buildRawString(versionCheck || "run")]];
  if (sessionInfo) {
    entries.push([buildRawString("sessionInfo"), buildRawString(sessionInfo)]);
  }
  return buildDict(entries);
}

function buildMethodCacheKey({
  serviceName = "marketProxy",
  method,
  args = [],
  sessionInfoValue = undefined,
}) {
  const key = [
    buildRawString(serviceName || "marketProxy"),
    buildRawString(method || ""),
  ];
  if (sessionInfoValue !== undefined && sessionInfoValue !== null) {
    key.push(
      typeof sessionInfoValue === "string"
        ? buildRawString(sessionInfoValue)
        : sessionInfoValue,
    );
  }
  if (Array.isArray(args)) {
    key.push(
      ...args.map((entry) =>
        typeof entry === "string" ? buildRawString(entry) : entry,
      ),
    );
  }
  return key;
}

function buildMethodObjectId(methodCacheKey) {
  return [buildRawString("Method Call"), buildRawString(CACHE_MODE), methodCacheKey];
}

function computeCrcHqx(buffer, seed = 0) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  let crc = seed & 0xffff;

  for (let index = 0; index < source.length; index += 1) {
    crc ^= source[index] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ CRC_HQX_POLY) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc;
}

function normalizeObjectVersion(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  return [
    normalizeBigInt(value[0], 0n),
    Number(value[1]) || 0,
  ];
}

function serializeForCacheKey(value) {
  return JSON.stringify(normalizeCacheIdentity(value));
}

function serializeVersionKey(version) {
  const normalizedVersion = normalizeObjectVersion(version);
  if (!normalizedVersion) {
    return "none";
  }
  return `${normalizedVersion[0].toString()}:${normalizedVersion[1]}`;
}

function maybeCompressPickle(rawPickle) {
  if (!Buffer.isBuffer(rawPickle) || rawPickle.length <= COMPRESS_THRESHOLD_BYTES) {
    return {
      pickle: rawPickle,
      compressed: 0,
    };
  }

  try {
    const compressedPickle = zlib.deflateSync(rawPickle, {
      level: COMPRESS_LEVEL,
    });
    if (compressedPickle.length < rawPickle.length) {
      return {
        pickle: compressedPickle,
        compressed: 1,
      };
    }
  } catch (error) {
    // Fall back to the raw marshal payload if compression fails.
  }

  return {
    pickle: rawPickle,
    compressed: 0,
  };
}

function buildUtilCachedObjectReference(record) {
  return {
    type: "object",
    name: buildRawString("util.CachedObject"),
    args: [
      record.objectId,
      record.nodeId,
      buildVersionTuple(record.objectVersion),
    ],
  };
}

function buildCachedObjectResponse(record) {
  return {
    type: "object",
    name: buildRawString("objectCaching.CachedObject"),
    args: [
      buildVersionTuple(record.objectVersion),
      null,
      record.nodeId,
      record.shared ? 1 : 0,
      { type: "bytes", value: record.pickle },
      record.compressed ? 1 : 0,
      record.objectId,
    ],
  };
}

function computeSignedAdler32(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const MOD_ADLER = 65521;
  let a = 1;
  let b = 0;

  for (let index = 0; index < source.length; index += 1) {
    a = (a + source[index]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }

  const unsignedValue = (((b << 16) | a) >>> 0);
  return unsignedValue > 0x7fffffff
    ? unsignedValue - 0x100000000
    : unsignedValue;
}

function buildCachedMethodCallResult(result, options = {}) {
  const {
    serviceName = "marketProxy",
    method,
    args = [],
    versionCheck = "run",
    sessionInfo = null,
    sessionInfoValue = undefined,
  } = options;
  const details = buildCacheDetails({ versionCheck, sessionInfo });
  const rawPickle = marshalEncode(result);
  const version = [
    buildSignedLong(currentFileTime()),
    computeSignedAdler32(rawPickle),
  ];

  return {
    type: "object",
    name: buildRawString(
      "carbon.common.script.net.objectCaching.CachedMethodCallResult",
    ),
    args: [
      details,
      { type: "bytes", value: rawPickle },
      version,
    ],
  };
}

function getCachableObjectResponse(shared, objectId, objectVersion, nodeId) {
  const objectIdKey = serializeForCacheKey(objectId);
  const bucket = cachedObjects.get(objectIdKey);
  if (!bucket) {
    return null;
  }

  const requestedVersionKey = serializeVersionKey(objectVersion);
  let record = bucket.records.get(requestedVersionKey);
  if (!record && bucket.currentVersionKey) {
    record = bucket.records.get(bucket.currentVersionKey) || null;
  }
  if (!record) {
    return null;
  }

  return buildCachedObjectResponse({
    ...record,
    shared: Boolean(shared),
    nodeId: Number(nodeId) || record.nodeId,
  });
}

function describeObjectId(objectId) {
  try {
    if (!Array.isArray(objectId) || objectId.length < 3) {
      return normalizeText(normalizeCacheIdentity(objectId), "unknown");
    }
    const methodCall = Array.isArray(objectId[2]) ? objectId[2] : [];
    return `${normalizeText(normalizeCacheIdentity(methodCall[0]), "unknown")}::${normalizeText(normalizeCacheIdentity(methodCall[1]), "unknown")}`;
  } catch (error) {
    return "unknown";
  }
}

function normalizeCacheIdentity(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCacheIdentity(entry));
  }
  if (typeof value === "object") {
    if (value.type === "rawstr" || value.type === "wstring" || value.type === "token") {
      return normalizeText(value.value, "");
    }
    if (value.type === "long" || value.type === "int") {
      return normalizeBigInt(value.value, 0n).toString();
    }
    if (value.type === "dict" && Array.isArray(value.entries)) {
      return value.entries.map(([key, entryValue]) => [
        normalizeCacheIdentity(key),
        normalizeCacheIdentity(entryValue),
      ]);
    }
  }
  return normalizeText(value, "");
}

module.exports = {
  buildCachedMethodCallResult,
  getCachableObjectResponse,
  __testHooks: {
    buildMethodCacheKey,
    buildMethodObjectId,
    computeSignedAdler32,
    computeCrcHqx,
    describeObjectId,
    normalizeObjectVersion,
  },
};
