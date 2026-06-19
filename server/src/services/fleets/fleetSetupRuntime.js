const path = require("path");

const {
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function toInteger(value, fallback = 0) {
  const numericValue = normalizeNumber(value, fallback);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function parseScalar(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed === "null" || trimmed === "~") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^[+-]?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^[+-]?\d+\.\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  ) {
    const quote = trimmed[0];
    let value = trimmed.slice(1, -1);
    if (quote === "'") {
      value = value.replace(/''/g, "'");
    } else {
      value = value
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t");
    }
    return value;
  }
  return trimmed;
}

function findTopLevelColon(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (char === ":") {
      return index;
    }
  }
  return -1;
}

function getIndentation(line) {
  let indentation = 0;
  while (indentation < line.length && line[indentation] === " ") {
    indentation += 1;
  }
  return indentation;
}

function parseBlock(lines, startIndex, indentation) {
  if (startIndex >= lines.length) {
    return { value: null, nextIndex: startIndex };
  }

  const currentLine = lines[startIndex];
  if (currentLine.trim().startsWith("- ")) {
    return parseSequence(lines, startIndex, indentation);
  }
  return parseMapping(lines, startIndex, indentation);
}

function parseNestedBlock(lines, startIndex, indentation) {
  let index = startIndex;
  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }
  if (index >= lines.length) {
    return { value: null, nextIndex: index };
  }
  const nextIndentation = getIndentation(lines[index]);
  if (nextIndentation < indentation) {
    return { value: null, nextIndex: index };
  }
  return parseBlock(lines, index, nextIndentation);
}

function parseSequence(lines, startIndex, indentation) {
  const values = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const currentIndentation = getIndentation(line);
    if (currentIndentation < indentation) {
      break;
    }
    if (currentIndentation !== indentation || !line.trim().startsWith("- ")) {
      break;
    }

    const content = line.trim().slice(2);
    if (content === "") {
      const nested = parseNestedBlock(lines, index + 1, indentation + 2);
      values.push(nested.value);
      index = nested.nextIndex;
      continue;
    }

    const colonIndex = findTopLevelColon(content);
    if (colonIndex < 0) {
      values.push(parseScalar(content));
      index += 1;
      continue;
    }

    const key = content.slice(0, colonIndex).trim();
    const remainder = content.slice(colonIndex + 1).trim();
    const entry = {};
    if (remainder !== "") {
      entry[key] = parseScalar(remainder);
      index += 1;
    } else {
      const nested = parseNestedBlock(lines, index + 1, indentation + 2);
      entry[key] = nested.value;
      index = nested.nextIndex;
    }

    while (index < lines.length) {
      const continuationLine = lines[index];
      if (continuationLine.trim() === "") {
        index += 1;
        continue;
      }

      const continuationIndentation = getIndentation(continuationLine);
      if (continuationIndentation < indentation + 2) {
        break;
      }
      if (continuationIndentation !== indentation + 2) {
        break;
      }
      if (continuationLine.trim().startsWith("- ")) {
        break;
      }

      const continuation = parseMapping(lines, index, indentation + 2);
      Object.assign(entry, continuation.value);
      index = continuation.nextIndex;
    }

    values.push(entry);
  }
  return { value: values, nextIndex: index };
}

function parseMapping(lines, startIndex, indentation) {
  const value = {};
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const currentIndentation = getIndentation(line);
    if (currentIndentation < indentation) {
      break;
    }
    if (currentIndentation !== indentation) {
      break;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      break;
    }

    const colonIndex = findTopLevelColon(trimmed);
    if (colonIndex < 0) {
      index += 1;
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    if (remainder !== "") {
      value[key] = parseScalar(remainder);
      index += 1;
      continue;
    }

    const nested = parseNestedBlock(lines, index + 1, indentation + 2);
    value[key] = nested.value;
    index = nested.nextIndex;
  }
  return { value, nextIndex: index };
}

function parseYamlLikeList(rawValue) {
  const lines = String(rawValue || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => String(line || "").trim() !== "" && !String(line || "").trim().startsWith("#"));

  if (lines.length === 0) {
    return [];
  }

  const parsed = parseBlock(lines, 0, getIndentation(lines[0]));
  return Array.isArray(parsed.value) ? parsed.value : [];
}

function tryParseJson(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return null;
  }
}

function normalizeWingInfo(rawWing = {}) {
  const squadNames = Array.isArray(rawWing.squadNames)
    ? rawWing.squadNames
    : [];
  return {
    wingName: normalizeText(rawWing.wingName, "").slice(0, 10),
    wingIdx: toInteger(rawWing.wingIdx, 0),
    squadNames: squadNames.map((name) => normalizeText(name, "").slice(0, 10)),
  };
}

function normalizeFleetSetup(rawSetup = {}) {
  const setupName = normalizeText(rawSetup.setupName, "").trim();
  if (!setupName) {
    return null;
  }

  const rawWingsInfo = rawSetup.wingsInfo && typeof rawSetup.wingsInfo === "object"
    ? Object.values(rawSetup.wingsInfo)
    : [];
  const wings = rawWingsInfo
    .map((wing) => normalizeWingInfo(wing))
    .sort((left, right) => left.wingIdx - right.wingIdx);

  return {
    setupName,
    motd: Object.prototype.hasOwnProperty.call(rawSetup, "motd")
      ? normalizeText(rawSetup.motd, "")
      : undefined,
    isFreeMove: Object.prototype.hasOwnProperty.call(rawSetup, "isFreeMove")
      ? Boolean(rawSetup.isFreeMove)
      : undefined,
    maxFleetSize: Object.prototype.hasOwnProperty.call(rawSetup, "maxFleetSize")
      ? toInteger(rawSetup.maxFleetSize, 0)
      : undefined,
    defaultSquad: Array.isArray(rawSetup.defaultSquad)
      ? rawSetup.defaultSquad.slice(0, 3)
      : undefined,
    wings,
  };
}

function parseFleetSetupsSetting(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return new Map();
  }

  const jsonParsed = typeof rawValue === "string" ? tryParseJson(rawValue) : rawValue;
  const parsedValue = Array.isArray(jsonParsed)
    ? jsonParsed
    : (jsonParsed && typeof jsonParsed === "object" ? Object.values(jsonParsed) : parseYamlLikeList(rawValue));

  const byName = new Map();
  for (const rawSetup of Array.isArray(parsedValue) ? parsedValue : []) {
    const setup = normalizeFleetSetup(rawSetup);
    if (!setup) {
      continue;
    }
    byName.set(setup.setupName, setup);
  }
  return byName;
}

function getFleetSetupByName(rawValue, setupName) {
  const normalizedName = normalizeText(setupName, "").trim();
  if (!normalizedName) {
    return null;
  }
  return parseFleetSetupsSetting(rawValue).get(normalizedName) || null;
}

module.exports = {
  parseFleetSetupsSetting,
  getFleetSetupByName,
};
