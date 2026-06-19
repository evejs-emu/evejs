const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));

const TABLE = "marketEscrow";

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeOrderKey(orderId) {
  return String(orderId || "").trim();
}

function ensureTable() {
  const result = database.read(TABLE, "/");
  if (result.success && result.data && typeof result.data === "object") {
    return result.data;
  }

  database.write(TABLE, "/", {});
  return {};
}

function listEscrowRecords() {
  return Object.values(ensureTable())
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => cloneValue(entry));
}

function getEscrowRecord(orderId) {
  const orderKey = normalizeOrderKey(orderId);
  if (!orderKey) {
    return null;
  }

  const result = database.read(TABLE, `/${orderKey}`);
  return result.success && result.data ? cloneValue(result.data) : null;
}

function putEscrowRecord(record) {
  const orderKey = normalizeOrderKey(record && record.orderId);
  if (!orderKey) {
    return {
      success: false,
      errorMsg: "ORDER_ID_REQUIRED",
    };
  }

  return database.write(TABLE, `/${orderKey}`, {
    ...cloneValue(record),
    orderId: orderKey,
  });
}

function removeEscrowRecord(orderId) {
  const orderKey = normalizeOrderKey(orderId);
  if (!orderKey) {
    return {
      success: false,
      errorMsg: "ORDER_ID_REQUIRED",
    };
  }

  return database.remove(TABLE, `/${orderKey}`);
}

module.exports = {
  TABLE,
  listEscrowRecords,
  getEscrowRecord,
  putEscrowRecord,
  removeEscrowRecord,
};
