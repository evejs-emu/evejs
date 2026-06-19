function cloneValue(value) {
  if (value === undefined || value === null) {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function marshalValueToJs(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => marshalValueToJs(entry));
  }

  if (typeof value !== "object") {
    return value;
  }

  switch (value.type) {
    case "dict":
      return Object.fromEntries(
        Array.isArray(value.entries)
          ? value.entries.map(([key, entryValue]) => [
              String(marshalValueToJs(key)),
              marshalValueToJs(entryValue),
            ])
          : [],
      );
    case "list":
      return Array.isArray(value.items)
        ? value.items.map((entry) => marshalValueToJs(entry))
        : [];
    case "long":
    case "int":
    case "real":
    case "wstring":
    case "token":
      return marshalValueToJs(value.value);
    default:
      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [
          key,
          marshalValueToJs(entryValue),
        ]),
      );
  }
}

function getKwarg(kwargs, key) {
  if (!key) {
    return undefined;
  }

  const normalized = marshalValueToJs(kwargs);
  if (!normalized || typeof normalized !== "object") {
    return undefined;
  }

  return normalized[key];
}

function toMarshalValue(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return {
      type: "list",
      items: value.map((entry) => toMarshalValue(entry)),
    };
  }

  if (typeof value === "object") {
    if (typeof value.type === "string") {
      return value;
    }

    return {
      type: "dict",
      entries: Object.entries(value).map(([key, entryValue]) => [
        key,
        toMarshalValue(entryValue),
      ]),
    };
  }

  return null;
}

module.exports = {
  cloneValue,
  getKwarg,
  marshalValueToJs,
  toMarshalValue,
};
