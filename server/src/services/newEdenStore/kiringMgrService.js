const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const {
  toMarshalValue,
} = require(path.join(__dirname, "./storeMarshal"));

const DEFAULT_KIRING_AID = 1;
const ANTI_ADDICTION_PASS_CODE = 201;

function buildUrl(baseUrl, relativePath) {
  try {
    return new URL(relativePath, String(baseUrl || "http://127.0.0.1:26002/")).toString();
  } catch (error) {
    return `http://127.0.0.1:26002/${String(relativePath || "").replace(/^\/+/, "")}`;
  }
}

function buildKiringConfiguration() {
  const redirectBaseUrl =
    typeof config.microservicesRedirectUrl === "string" &&
    config.microservicesRedirectUrl.trim() !== ""
      ? config.microservicesRedirectUrl.trim()
      : "http://127.0.0.1:26002/";

  return {
    mode: 1,
    client_id: "evejs-local-kiring",
    endpoints: {
      mpay: buildUrl(redirectBaseUrl, "/kiring/mpay/"),
      billing: buildUrl(redirectBaseUrl, "/kiring/billing/"),
      redirect_uri: buildUrl(redirectBaseUrl, "/kiring/redirect/"),
    },
    channels: {
      login: "evejs_local",
      pay: "evejs_local",
      app: "evejs_local",
    },
  };
}

function buildEncodedAccount(deviceID = "evejs-local-device", token = "evejs-local-token") {
  const payload = {
    odi: String(deviceID || "evejs-local-device"),
    s: String(token || "evejs-local-token"),
  };
  return `${DEFAULT_KIRING_AID}-${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}`;
}

class KiringMgrService extends BaseService {
  constructor() {
    super("kiringMgr");
  }

  Handle_GetKiringConfiguration() {
    return toMarshalValue(buildKiringConfiguration());
  }

  Handle_PerformKiringServerSideAuthenticationFromCode(args) {
    const deviceID = String(args && args[1] ? args[1] : "evejs-local-device");
    const token = "evejs-local-token";
    return [
      DEFAULT_KIRING_AID,
      "evejs-local-user",
      token,
      buildEncodedAccount(deviceID, token),
      "EVE.JS Local",
    ];
  }

  Handle_GetSAuthAid() {
    return DEFAULT_KIRING_AID;
  }

  Handle_GetAntiAddictionCode() {
    return ANTI_ADDICTION_PASS_CODE;
  }

  Handle_PlaceKiringOrder() {
    return `evejs-kiring-${Date.now()}`;
  }

  Handle_ActivateRedeemingCode() {
    return true;
  }
}

module.exports = KiringMgrService;
