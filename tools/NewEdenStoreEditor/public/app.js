const state = {
  bootstrap: null,
};

const summaryGrid = document.getElementById("summaryGrid");
const configForm = document.getElementById("configForm");
const authorityEditor = document.getElementById("authorityEditor");
const runtimeEditor = document.getElementById("runtimeEditor");
const statusBar = document.getElementById("statusBar");
const reloadButton = document.getElementById("reloadButton");
const saveAllButton = document.getElementById("saveAllButton");
const saveConfigButton = document.getElementById("saveConfigButton");

function setStatus(message, kind = "info") {
  statusBar.textContent = message;
  statusBar.dataset.kind = kind;
}

function buildSummaryCard(label, value) {
  const article = document.createElement("article");
  article.className = "summary-card";
  article.innerHTML = `
    <p class="summary-label">${label}</p>
    <strong class="summary-value">${value}</strong>
  `;
  return article;
}

function renderSummary(summary) {
  summaryGrid.innerHTML = "";
  const entries = [
    ["Legacy Stores", summary.legacyStores],
    ["Public Offers", summary.publicOffers],
    ["Fast Checkout Offers", summary.fastCheckoutOffers],
    ["Quick Pay Tokens", summary.quickPayTokens],
    ["Runtime Accounts", summary.runtimeAccounts],
    ["Completed Purchases", summary.completedPurchases],
  ];
  for (const [label, value] of entries) {
    summaryGrid.appendChild(buildSummaryCard(label, value));
  }
}

function createConfigControl(entry) {
  const wrapper = document.createElement("label");
  wrapper.className = "config-field";

  const title = document.createElement("span");
  title.className = "config-label";
  title.textContent = entry.key;

  const help = document.createElement("small");
  help.className = "config-help";
  help.textContent = `${entry.source}: ${entry.description.join(" ")}`;

  let input;
  if (entry.valueType === "boolean") {
    input = document.createElement("select");
    input.innerHTML = `
      <option value="true">true</option>
      <option value="false">false</option>
    `;
    input.value = entry.currentValue ? "true" : "false";
  } else if (entry.valueType === "number") {
    input = document.createElement("input");
    input.type = "number";
    input.value = String(entry.currentValue ?? "");
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.value = String(entry.currentValue ?? "");
  }

  input.dataset.key = entry.key;
  input.dataset.valueType = entry.valueType;

  wrapper.appendChild(title);
  wrapper.appendChild(input);
  wrapper.appendChild(help);
  return wrapper;
}

function renderConfig(configEntries) {
  configForm.innerHTML = "";
  for (const entry of configEntries) {
    configForm.appendChild(createConfigControl(entry));
  }
}

function renderEditors(storeSnapshot) {
  authorityEditor.value = JSON.stringify(storeSnapshot.authority, null, 2);
  runtimeEditor.value = JSON.stringify(storeSnapshot.runtime, null, 2);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed for ${url}`);
  }
  return payload;
}

async function reloadBootstrap() {
  setStatus("Reloading store editor...", "info");
  const payload = await fetchJson("/api/bootstrap");
  state.bootstrap = payload;
  renderSummary(payload.summary);
  renderConfig(payload.config.entries);
  renderEditors(payload.store);
  setStatus(`Loaded ${payload.summary.publicOffers} public offers from cache.`, "success");
}

function readConfigValues() {
  const values = {};
  for (const input of configForm.querySelectorAll("[data-key]")) {
    const key = input.dataset.key;
    const valueType = input.dataset.valueType;
    if (valueType === "boolean") {
      values[key] = input.value === "true";
      continue;
    }
    if (valueType === "number") {
      values[key] = Number(input.value || 0);
      continue;
    }
    values[key] = input.value;
  }
  return values;
}

async function saveConfig() {
  setStatus("Saving store config overrides...", "info");
  await fetchJson("/api/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      values: readConfigValues(),
    }),
  });
  await reloadBootstrap();
  setStatus("Store config overrides saved.", "success");
}

async function saveStore() {
  setStatus("Saving store authority JSON...", "info");
  const authority = JSON.parse(authorityEditor.value);
  const runtime = JSON.parse(runtimeEditor.value);
  await fetchJson("/api/store", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authority,
      runtime,
    }),
  });
  await reloadBootstrap();
  setStatus("Store authority JSON saved.", "success");
}

reloadButton.addEventListener("click", () => {
  reloadBootstrap().catch((error) => {
    setStatus(error.message, "error");
  });
});

saveConfigButton.addEventListener("click", (event) => {
  event.preventDefault();
  saveConfig().catch((error) => {
    setStatus(error.message, "error");
  });
});

saveAllButton.addEventListener("click", () => {
  saveStore().catch((error) => {
    setStatus(error.message, "error");
  });
});

reloadBootstrap().catch((error) => {
  setStatus(error.message, "error");
});
