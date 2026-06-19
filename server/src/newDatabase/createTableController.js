const fs = require("fs");
const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));

function ensureFile(dbFile) {
  if (!fs.existsSync(dbFile)) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.writeFileSync(dbFile, JSON.stringify({}, null, 2));
  }
}

function getSegments(pathKey) {
  return String(pathKey || "/").split("/").filter(Boolean);
}

function createTableController(tableDir) {
  const dbFile = path.join(tableDir, "data.json");

  function read(pathKey = "/") {
    try {
      ensureFile(dbFile);

      const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
      const segments = getSegments(pathKey);

      if (segments.length === 0) {
        return {
          success: true,
          errorMsg: null,
          data: db,
        };
      }

      let current = db;
      for (const segment of segments) {
        if (
          current === null ||
          typeof current !== "object" ||
          !(segment in current)
        ) {
          return {
            success: false,
            errorMsg: "ENTRY_NOT_FOUND",
            data: null,
          };
        }
        current = current[segment];
      }

      return {
        success: true,
        errorMsg: null,
        data: current,
      };
    } catch (error) {
      log.error("[DATABASE READ ERROR]", error);
      return {
        success: false,
        errorMsg: "READ_ERROR",
        data: null,
      };
    }
  }

  function write(pathKey = "/", data) {
    try {
      ensureFile(dbFile);

      const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
      const segments = getSegments(pathKey);

      if (segments.length === 0) {
        fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
        return {
          success: true,
          errorMsg: null,
        };
      }

      let current = db;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (
          !(segment in current) ||
          current[segment] === null ||
          typeof current[segment] !== "object"
        ) {
          current[segment] = {};
        }
        current = current[segment];
      }

      current[segments[segments.length - 1]] = data;
      fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

      return {
        success: true,
        errorMsg: null,
      };
    } catch (error) {
      log.error("[DATABASE WRITE ERROR]", error);
      return {
        success: false,
        errorMsg: "WRITE_ERROR",
      };
    }
  }

  function remove(pathKey = "/") {
    try {
      ensureFile(dbFile);

      const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
      const segments = getSegments(pathKey);

      if (segments.length === 0) {
        return {
          success: false,
          errorMsg: "INVALID_PATH",
        };
      }

      let current = db;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (
          current === null ||
          typeof current !== "object" ||
          !(segment in current)
        ) {
          return {
            success: false,
            errorMsg: "ENTRY_NOT_FOUND",
          };
        }
        current = current[segment];
      }

      const finalKey = segments[segments.length - 1];
      if (
        current === null ||
        typeof current !== "object" ||
        !(finalKey in current)
      ) {
        return {
          success: false,
          errorMsg: "ENTRY_NOT_FOUND",
        };
      }

      delete current[finalKey];
      fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

      return {
        success: true,
        errorMsg: null,
      };
    } catch (error) {
      log.error("[DATABASE DELETE ERROR]", error);
      return {
        success: false,
        errorMsg: "DELETE_ERROR",
      };
    }
  }

  return {
    read,
    write,
    remove,
  };
}

module.exports = createTableController;
