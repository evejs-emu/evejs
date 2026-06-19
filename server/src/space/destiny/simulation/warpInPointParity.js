"use strict";

const CATEGORY_CELESTIAL = 2;
const GROUP_SUN = 6;
const GROUP_PLANET = 7;
const GROUP_ASTEROID_BELT = 9;
const GROUP_WRECK = 186;
const MIN_WARP_IN_POINT_RADIUS = 90000;
const JUMP_RADIUS_FACTOR = 130;

const DEFAULT_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clonePosition(position) {
  if (!position || typeof position !== "object") {
    return { ...DEFAULT_POSITION };
  }
  return {
    x: toFiniteNumber(position.x, 0),
    y: toFiniteNumber(position.y, 0),
    z: toFiniteNumber(position.z, 0),
  };
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const integer = Math.trunc(numeric);
  return integer > 0 ? integer : fallback;
}

function seedToKey(seed) {
  let value = BigInt(Math.trunc(toFiniteNumber(seed, 0)));
  if (value < 0n) {
    value = -value;
  }
  if (value === 0n) {
    return [0];
  }
  const key = [];
  while (value > 0n) {
    key.push(Number(value & 0xffffffffn));
    value >>= 32n;
  }
  return key;
}

function createPythonRandom(seed) {
  const n = 624;
  const m = 397;
  const matrixA = 0x9908b0df;
  const upperMask = 0x80000000;
  const lowerMask = 0x7fffffff;
  const mt = new Uint32Array(n);
  let mti = n + 1;

  function initGenrand(initialSeed) {
    mt[0] = initialSeed >>> 0;
    for (mti = 1; mti < n; mti += 1) {
      const previous = mt[mti - 1] ^ (mt[mti - 1] >>> 30);
      mt[mti] = (Math.imul(1812433253, previous) + mti) >>> 0;
    }
  }

  function initByArray(key) {
    initGenrand(19650218);
    let i = 1;
    let j = 0;
    let k = Math.max(n, key.length);
    for (; k > 0; k -= 1) {
      const previous = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (mt[i] ^ Math.imul(previous, 1664525)) >>> 0;
      mt[i] = (mt[i] + (key[j] >>> 0) + j) >>> 0;
      i += 1;
      j += 1;
      if (i >= n) {
        mt[0] = mt[n - 1];
        i = 1;
      }
      if (j >= key.length) {
        j = 0;
      }
    }
    for (k = n - 1; k > 0; k -= 1) {
      const previous = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (mt[i] ^ Math.imul(previous, 1566083941)) >>> 0;
      mt[i] = (mt[i] - i) >>> 0;
      i += 1;
      if (i >= n) {
        mt[0] = mt[n - 1];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  function genrandInt32() {
    const mag01 = [0, matrixA];
    let y;
    if (mti >= n) {
      let kk = 0;
      for (; kk < n - m; kk += 1) {
        y = (mt[kk] & upperMask) | (mt[kk + 1] & lowerMask);
        mt[kk] = (mt[kk + m] ^ (y >>> 1) ^ mag01[y & 1]) >>> 0;
      }
      for (; kk < n - 1; kk += 1) {
        y = (mt[kk] & upperMask) | (mt[kk + 1] & lowerMask);
        mt[kk] = (mt[kk + (m - n)] ^ (y >>> 1) ^ mag01[y & 1]) >>> 0;
      }
      y = (mt[n - 1] & upperMask) | (mt[0] & lowerMask);
      mt[n - 1] = (mt[m - 1] ^ (y >>> 1) ^ mag01[y & 1]) >>> 0;
      mti = 0;
    }

    y = mt[mti];
    mti += 1;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  initByArray(seedToKey(seed));

  return {
    random() {
      return (
        ((genrandInt32() >>> 5) * 67108864 + (genrandInt32() >>> 6)) /
        9007199254740992
      );
    },
  };
}

function isKnownCelestialGroup(groupID) {
  return groupID === GROUP_SUN ||
    groupID === GROUP_PLANET ||
    groupID === 8 ||
    groupID === 9 ||
    groupID === 10 ||
    groupID === 995 ||
    groupID === 1915 ||
    groupID === 1940;
}

function isKnownCelestialKind(kind) {
  return kind === "celestial" ||
    kind === "sun" ||
    kind === "planet" ||
    kind === "moon" ||
    kind === "asteroidBelt" ||
    kind === "stargate";
}

function isAsteroidBeltTarget(target) {
  if (!target || typeof target !== "object") {
    return false;
  }
  return target.kind === "asteroidBelt" ||
    toPositiveInt(target.groupID, 0) === GROUP_ASTEROID_BELT;
}

function hasClientWarpInPoint(target) {
  if (!target || typeof target !== "object") {
    return false;
  }

  if (isAsteroidBeltTarget(target)) {
    return false;
  }

  const radius = toFiniteNumber(target.radius, 0);
  if (radius < MIN_WARP_IN_POINT_RADIUS) {
    return false;
  }

  const groupID = toPositiveInt(target.groupID, 0);
  if (groupID === GROUP_WRECK) {
    return false;
  }

  const categoryID = toPositiveInt(target.categoryID, 0);
  if (categoryID > 0) {
    return categoryID === CATEGORY_CELESTIAL;
  }

  return isKnownCelestialGroup(groupID) || isKnownCelestialKind(target.kind);
}

function getSunWarpInPoint(target) {
  const position = clonePosition(target && target.position);
  const radius = toFiniteNumber(target && target.radius, 0);
  const offset = 100000;
  return {
    x: position.x + (radius + offset) * Math.cos(radius),
    y: position.y + radius / 5,
    z: position.z - (radius + offset) * Math.sin(radius),
  };
}

function getPlanetWarpInPoint(target) {
  const position = clonePosition(target && target.position);
  const radius = toFiniteNumber(target && target.radius, 0);
  const dx = Number(position.x);
  const dz = Number(-position.z);
  const denominator = Math.sqrt((dx ** 2) + (dz ** 2));
  if (!Number.isFinite(denominator) || denominator <= 0 || radius <= 0) {
    return null;
  }

  let f = dz / denominator;
  if ((dz > 0 && dx > 0) || (dz < 0 && dx > 0)) {
    f *= -1.0;
  }
  let theta = Math.asin(f);
  const myRandom = createPythonRandom(toPositiveInt(target && target.itemID, 0));
  const rr = (myRandom.random() - 1.0) / 3.0;
  theta += rr;

  const offset = 1000000;
  const factor = 20.0;
  let dd = Math.pow(
    (factor - (5.0 * Math.log10(radius / 1000000)) - 0.5) / factor,
    factor,
  ) * factor;
  dd = Math.min(10.0, Math.max(0.0, dd));
  dd += 0.5;
  const distance = radius + offset + (radius * dd);

  return {
    x: position.x + Math.sin(theta) * distance,
    y: position.y + radius * Math.sin(rr) * 0.5,
    z: position.z - Math.cos(theta) * distance,
  };
}

function getGenericWarpInPoint(target) {
  const position = clonePosition(target && target.position);
  const radius = toFiniteNumber(target && target.radius, 0);
  const offset = 5000000;
  const p = JUMP_RADIUS_FACTOR / 100.0;
  return {
    x: position.x + (radius + offset) * Math.cos(radius),
    y: position.y + p * radius - 7500.0,
    z: position.z - (radius + offset) * Math.sin(radius),
  };
}

function getClientParityWarpInPoint(target) {
  if (!hasClientWarpInPoint(target)) {
    return null;
  }

  const groupID = toPositiveInt(target && target.groupID, 0);
  if (groupID === GROUP_PLANET || target.kind === "planet") {
    return getPlanetWarpInPoint(target);
  }
  if (groupID === GROUP_SUN || target.kind === "sun") {
    return getSunWarpInPoint(target);
  }
  return getGenericWarpInPoint(target);
}

module.exports = {
  CATEGORY_CELESTIAL,
  GROUP_ASTEROID_BELT,
  GROUP_PLANET,
  GROUP_SUN,
  GROUP_WRECK,
  MIN_WARP_IN_POINT_RADIUS,
  createPythonRandom,
  getClientParityWarpInPoint,
  getGenericWarpInPoint,
  getPlanetWarpInPoint,
  getSunWarpInPoint,
  hasClientWarpInPoint,
};
