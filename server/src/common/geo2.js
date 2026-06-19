"use strict";

const TWO_PI = Math.PI * 2;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_FORWARD = Object.freeze({ x: 0, y: 0, z: 1 });
const IDENTITY_QUATERNION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const SIN_COEFFICIENT_0 = Object.freeze([
  f32(-0.16666667),
  f32(0.0083333310),
  f32(-0.00019840874),
  f32(2.7525562e-06),
]);
const SIN_COEFFICIENT_1 = f32(-2.3889859e-08);
const COS_COEFFICIENT_0 = Object.freeze([
  f32(-0.5),
  f32(0.041666638),
  f32(-0.0013888378),
  f32(2.4760495e-05),
]);
const COS_COEFFICIENT_1 = f32(-2.6051615e-07);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function f32(value) {
  return Math.fround(toFiniteNumber(value, 0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return ((numeric % 360) + 360) % 360;
}

function readVec3(value, fallback = ZERO_VECTOR) {
  if (Array.isArray(value)) {
    return {
      x: toFiniteNumber(value[0], fallback.x),
      y: toFiniteNumber(value[1], fallback.y),
      z: toFiniteNumber(value[2], fallback.z),
    };
  }

  if (value && typeof value === "object") {
    return {
      x: toFiniteNumber(value.x, fallback.x),
      y: toFiniteNumber(value.y, fallback.y),
      z: toFiniteNumber(value.z, fallback.z),
    };
  }

  return {
    x: toFiniteNumber(fallback.x, 0),
    y: toFiniteNumber(fallback.y, 0),
    z: toFiniteNumber(fallback.z, 0),
  };
}

function readQuaternion(value, fallback = IDENTITY_QUATERNION) {
  if (Array.isArray(value)) {
    return {
      x: toFiniteNumber(value[0], fallback.x),
      y: toFiniteNumber(value[1], fallback.y),
      z: toFiniteNumber(value[2], fallback.z),
      w: toFiniteNumber(value[3], fallback.w),
    };
  }

  if (value && typeof value === "object") {
    return {
      x: toFiniteNumber(value.x, fallback.x),
      y: toFiniteNumber(value.y, fallback.y),
      z: toFiniteNumber(value.z, fallback.z),
      w: toFiniteNumber(value.w, fallback.w),
    };
  }

  return { ...fallback };
}

function Vec3Subtract(left, right) {
  const a = readVec3(left);
  const b = readVec3(right);
  return {
    x: f32(f32(a.x) - f32(b.x)),
    y: f32(f32(a.y) - f32(b.y)),
    z: f32(f32(a.z) - f32(b.z)),
  };
}

function Vec3SubtractD(left, right) {
  const a = readVec3(left);
  const b = readVec3(right);
  return {
    x: toFiniteNumber(a.x, 0) - toFiniteNumber(b.x, 0),
    y: toFiniteNumber(a.y, 0) - toFiniteNumber(b.y, 0),
    z: toFiniteNumber(a.z, 0) - toFiniteNumber(b.z, 0),
  };
}

function Vec3Dot(left, right) {
  const a = readVec3(left);
  const b = readVec3(right);
  const x = f32(f32(a.x) * f32(b.x));
  const y = f32(f32(a.y) * f32(b.y));
  const z = f32(f32(a.z) * f32(b.z));
  return f32(f32(x + y) + z);
}

function Vec3Cross(left, right) {
  const a = readVec3(left);
  const b = readVec3(right);
  return {
    x: f32((f32(a.y) * f32(b.z)) - (f32(a.z) * f32(b.y))),
    y: f32((f32(a.z) * f32(b.x)) - (f32(a.x) * f32(b.z))),
    z: f32((f32(a.x) * f32(b.y)) - (f32(a.y) * f32(b.x))),
  };
}

function Vec3Normalize(value) {
  const v = readVec3(value);
  const x = f32(v.x);
  const y = f32(v.y);
  const z = f32(v.z);
  const lengthSquared = f32(f32(f32(x * x) + f32(y * y)) + f32(z * z));

  if (!Number.isFinite(lengthSquared) || lengthSquared <= 0) {
    return { ...ZERO_VECTOR };
  }

  const length = f32(Math.sqrt(lengthSquared));
  if (length <= 0) {
    return { ...ZERO_VECTOR };
  }

  return {
    x: f32(x / length),
    y: f32(y / length),
    z: f32(z / length),
  };
}

function Vec3NormalizeD(value) {
  const v = readVec3(value);
  const max = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));

  if (!Number.isFinite(max) || max <= 0) {
    return { ...ZERO_VECTOR };
  }

  const scaledX = v.x / max;
  const scaledY = v.y / max;
  const scaledZ = v.z / max;
  const length = Math.sqrt(
    (scaledX * scaledX) +
    (scaledY * scaledY) +
    (scaledZ * scaledZ),
  );
  const invLength = length > 0 ? 1 / length : 0;

  return {
    x: scaledX * invLength,
    y: scaledY * invLength,
    z: scaledZ * invLength,
  };
}

function Vec3NormalizeFloat32(value) {
  const v = readVec3(value);
  const x = f32(v.x);
  const y = f32(v.y);
  const z = f32(v.z);
  const max = f32(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)));

  if (!Number.isFinite(max) || max <= 0) {
    return { ...ZERO_VECTOR };
  }

  const scaledX = f32(x / max);
  const scaledY = f32(y / max);
  const scaledZ = f32(z / max);
  const length = f32(Math.sqrt(f32(
    (scaledX * scaledX) +
    (scaledY * scaledY) +
    (scaledZ * scaledZ),
  )));
  const invLength = length > 0 ? f32(1 / length) : 0;

  return {
    x: f32(scaledX * invLength),
    y: f32(scaledY * invLength),
    z: f32(scaledZ * invLength),
  };
}

function multiplyAddFloat32(left, right, addend) {
  return f32(f32(left * right) + addend);
}

function SinCosFloat32(value) {
  const x = f32(value);
  const x2 = f32(x * x);

  let sin = multiplyAddFloat32(SIN_COEFFICIENT_1, x2, SIN_COEFFICIENT_0[3]);
  sin = multiplyAddFloat32(sin, x2, SIN_COEFFICIENT_0[2]);
  sin = multiplyAddFloat32(sin, x2, SIN_COEFFICIENT_0[1]);
  sin = multiplyAddFloat32(sin, x2, SIN_COEFFICIENT_0[0]);
  sin = multiplyAddFloat32(sin, x2, 1);
  sin = f32(sin * x);

  let cos = multiplyAddFloat32(COS_COEFFICIENT_1, x2, COS_COEFFICIENT_0[3]);
  cos = multiplyAddFloat32(cos, x2, COS_COEFFICIENT_0[2]);
  cos = multiplyAddFloat32(cos, x2, COS_COEFFICIENT_0[1]);
  cos = multiplyAddFloat32(cos, x2, COS_COEFFICIENT_0[0]);
  cos = multiplyAddFloat32(cos, x2, 1);

  return { cos, sin };
}

function QuaternionRotationAxis(axis, angle) {
  const normalized = Vec3Normalize(axis);
  const halfAngle = f32(f32(angle) * 0.5);
  const { cos, sin } = SinCosFloat32(halfAngle);

  return {
    x: f32(normalized.x * sin),
    y: f32(normalized.y * sin),
    z: f32(normalized.z * sin),
    w: cos,
  };
}

function QuaternionRotationArc(from, to = DEFAULT_FORWARD) {
  const source = readVec3(from);
  const target = readVec3(to);
  const dot = clamp(Vec3Dot(source, target), -1, 1);

  if (dot <= -1) {
    return { ...IDENTITY_QUATERNION };
  }

  if (dot >= 1) {
    return { ...IDENTITY_QUATERNION };
  }

  return QuaternionRotationAxis(Vec3Cross(source, target), Math.acos(dot));
}

function MatrixRotationQuaternion(value) {
  const q = readQuaternion(value);
  const x = f32(q.x);
  const y = f32(q.y);
  const z = f32(q.z);
  const w = f32(q.w);
  const xx = f32(x * x);
  const yy = f32(y * y);
  const zz = f32(z * z);
  const xy = f32(x * y);
  const xz = f32(x * z);
  const yz = f32(y * z);
  const xw = f32(x * w);
  const yw = f32(y * w);
  const zw = f32(z * w);

  return {
    m11: f32(1 - (2 * (yy + zz))),
    m12: f32(2 * (xy - zw)),
    m13: f32(2 * (xz - yw)),
    m21: f32(2 * (xy + zw)),
    m22: f32(1 - (2 * (xx + zz))),
    m23: f32(2 * (yz + xw)),
    m31: f32(2 * (xz + yw)),
    m32: f32(2 * (yz - xw)),
    m33: f32(1 - (2 * (xx + yy))),
  };
}

function QuaternionRotationGetYawPitchRoll(quaternion) {
  const matrix = MatrixRotationQuaternion(quaternion);
  let yaw = f32(Math.atan2(matrix.m31, matrix.m33));
  if (yaw < 0) {
    yaw = f32(yaw + f32(TWO_PI));
  }

  return [
    yaw,
    f32(Math.asin(clamp(-matrix.m32, -1, 1))),
    f32(Math.atan2(matrix.m12, matrix.m22)),
  ];
}

function radiansToDegrees(value) {
  return toFiniteNumber(value, 0) * RAD_TO_DEG;
}

function degreesToRadians(value) {
  return toFiniteNumber(value, 0) * DEG_TO_RAD;
}

function GetYawAndPitchAngles(direction) {
  const normalized = Vec3Normalize(direction);
  return GetYawAndPitchAnglesFromNormalizedDirection(normalized);
}

function GetYawAndPitchAnglesFromNormalizedDirection(direction) {
  const quaternion = QuaternionRotationArc(direction, DEFAULT_FORWARD);
  const ypr = QuaternionRotationGetYawPitchRoll(quaternion);
  return [ypr[0], ypr[1]];
}

function GetYawAndPitchAnglesDeg(direction) {
  const ypr = GetYawAndPitchAngles(direction);
  return [
    normalizeDegrees(radiansToDegrees(ypr[0])),
    radiansToDegrees(ypr[1]),
  ];
}

function GetYawAndPitchAnglesDegFromNormalizedDirection(direction) {
  const ypr = GetYawAndPitchAnglesFromNormalizedDirection(direction);
  return [
    normalizeDegrees(radiansToDegrees(ypr[0])),
    radiansToDegrees(ypr[1]),
  ];
}

function GetYawAndPitchAnglesBetweenPoints(position0, position1) {
  return GetYawAndPitchAngles(Vec3Subtract(position1, position0));
}

function GetYawAndPitchAnglesDegBetweenPoints(position0, position1) {
  return GetYawAndPitchAnglesDeg(Vec3Subtract(position1, position0));
}

function buildDunRotationFromDirection(direction) {
  const [yaw, pitch] = GetYawAndPitchAnglesDeg(direction);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
    return null;
  }
  return [yaw, pitch, 0];
}

function buildDunRotationFromNormalizedDirection(direction) {
  const [yaw, pitch] = GetYawAndPitchAnglesDegFromNormalizedDirection(direction);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
    return null;
  }
  return [yaw, pitch, 0];
}

module.exports = {
  DEG_TO_RAD,
  DEFAULT_FORWARD,
  IDENTITY_QUATERNION,
  MatrixRotationQuaternion,
  QuaternionRotationArc,
  QuaternionRotationAxis,
  QuaternionRotationGetYawPitchRoll,
  RAD_TO_DEG,
  TWO_PI,
  Vec3Cross,
  Vec3Dot,
  Vec3Normalize,
  Vec3NormalizeD,
  Vec3NormalizeFloat32,
  Vec3Subtract,
  Vec3SubtractD,
  buildDunRotationFromDirection,
  buildDunRotationFromNormalizedDirection,
  clamp,
  degreesToRadians,
  f32,
  getYawAndPitchAngles: GetYawAndPitchAngles,
  getYawAndPitchAnglesBetweenPoints: GetYawAndPitchAnglesBetweenPoints,
  getYawAndPitchAnglesDeg: GetYawAndPitchAnglesDeg,
  getYawAndPitchAnglesDegBetweenPoints: GetYawAndPitchAnglesDegBetweenPoints,
  getYawAndPitchAnglesDegFromNormalizedDirection: GetYawAndPitchAnglesDegFromNormalizedDirection,
  getYawAndPitchAnglesFromNormalizedDirection: GetYawAndPitchAnglesFromNormalizedDirection,
  normalizeDegrees,
  SinCosFloat32,
  radiansToDegrees,
  readQuaternion,
  readVec3,
  toFiniteNumber,
};
