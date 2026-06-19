const express = require("express");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const {
  getEditorSnapshot,
  getStoreConfig,
  saveEditorAuthority,
} = require(path.join(
  repoRoot,
  "server/src/services/newEdenStore/storeState",
));

const app = express();
const publicDir = path.join(__dirname, "public");
const STORE_CONFIG_KEYS = Object.freeze([
  "newEdenStoreEnabled",
  "newEdenStoreFastCheckoutEnabled",
  "newEdenStoreFakeCashPurchasesEnabled",
  "newEdenStoreFakeFastCheckoutResponse",
  "newEdenStoreFakeChinaFunnelEnabled",
  "newEdenStoreFakeBuyPlexOfferUrl",
  "newEdenStoreUseShellExecuteToBuyPlexOffer",
  "newEdenStoreEditorPort",
  "newEdenStoreCentsPerPlex",
  "newEdenStoreDefaultCashTaxRatePoints",
  "newEdenStorePurchaseLogLimit",
]);

function buildStoreConfigPayload() {
  const snapshot = config.getConfigStateSnapshot();
  const definitions = config.getConfigDefinitions().filter((entry) =>
    STORE_CONFIG_KEYS.includes(entry.key),
  );

  return {
    generatedAt: new Date().toISOString(),
    entries: definitions.map((entry) => ({
      key: entry.key,
      label: entry.key,
      valueType: entry.valueType,
      validValues: entry.validValues,
      description: Array.isArray(entry.description)
        ? entry.description
        : [entry.description],
      currentValue: snapshot.resolvedConfig[entry.key],
      source: snapshot.sources[entry.key],
      envVar: entry.envVar || null,
    })),
  };
}

function sanitizeStoreConfigInput(rawValues = {}) {
  const source = rawValues && typeof rawValues === "object" ? rawValues : {};
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => STORE_CONFIG_KEYS.includes(key)),
  );
}

function buildBootstrapPayload() {
  const storeSnapshot = getEditorSnapshot();
  return {
    generatedAt: new Date().toISOString(),
    effectiveStoreConfig: getStoreConfig(),
    config: buildStoreConfigPayload(),
    store: storeSnapshot,
    summary: {
      legacyStores: Object.keys((storeSnapshot.authority && storeSnapshot.authority.stores) || {}).length,
      publicOffers: Object.keys((storeSnapshot.authority && storeSnapshot.authority.publicOffers) || {}).length,
      fastCheckoutOffers:
        (((storeSnapshot.authority || {}).fastCheckout || {}).offers || []).length,
      quickPayTokens: Object.keys(
        ((((storeSnapshot.authority || {}).fastCheckout || {}).tokensByID) || {}),
      ).length,
      runtimeAccounts: Object.keys((storeSnapshot.runtime && storeSnapshot.runtime.accounts) || {}).length,
      completedPurchases: Object.keys(
        (storeSnapshot.runtime && storeSnapshot.runtime.completedPurchases) || {},
      ).length,
    },
  };
}

app.use(express.json({ limit: "8mb" }));
app.use(express.static(publicDir));

app.get("/api/bootstrap", (_req, res) => {
  res.json(buildBootstrapPayload());
});

app.post("/api/store", (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const authority = payload.authority;
    const runtime = payload.runtime;
    const result = saveEditorAuthority(authority, runtime ? { runtime } : {});
    res.json({
      ok: true,
      store: result,
      effectiveStoreConfig: getStoreConfig(),
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/config", (req, res) => {
  try {
    const values = sanitizeStoreConfigInput(
      req.body && typeof req.body === "object" ? req.body.values : {},
    );
    const snapshot = config.saveLocalConfig(values);
    res.json({
      ok: true,
      config: {
        generatedAt: new Date().toISOString(),
        entries: config
          .getConfigDefinitions()
          .filter((entry) => STORE_CONFIG_KEYS.includes(entry.key))
          .map((entry) => ({
            key: entry.key,
            valueType: entry.valueType,
            currentValue: snapshot.resolvedConfig[entry.key],
            source: snapshot.sources[entry.key],
          })),
      },
      effectiveStoreConfig: getStoreConfig(),
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(getStoreConfig().editorPort || 26008) || 26008;
app.listen(port, () => {
  console.log(
    `[NewEdenStoreEditor] listening on http://127.0.0.1:${port}`,
  );
});
