const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");

const CorpMgrService = require(path.join(
  repoRoot,
  "server/src/services/corporation/corpmgrService",
));
const OfficeManagerService = require(path.join(
  repoRoot,
  "server/src/services/corporation/officeManagerService",
));
const {
  resolveFriendlyFireLegalAtTime,
  scheduleAggressionSettingsChange,
} = require(path.join(
  repoRoot,
  "server/src/services/corporation/aggressionSettingsState",
));

function dictEntriesToMap(dictPayload) {
  assert.equal(dictPayload && dictPayload.type, "dict");
  return new Map(dictPayload.entries);
}

test("corpmgr returns CCP AggressionSettings objects and NPC corps stay friendly-fire disabled", () => {
  const service = new CorpMgrService();

  const playerPayload = service.Handle_GetAggressionSettings([98000000]);
  assert.equal(
    playerPayload && playerPayload.name,
    "crimewatch.corp_aggression.settings.AggressionSettings",
  );
  const playerState = dictEntriesToMap(playerPayload.args);
  assert.equal(playerState.has("_enableAfter"), true);
  assert.equal(playerState.has("_disableAfter"), true);

  const npcPayload = service.Handle_GetAggressionSettings([1000125]);
  assert.equal(
    npcPayload && npcPayload.name,
    "crimewatch.corp_aggression.settings.AggressionSettings",
  );
  const npcState = dictEntriesToMap(npcPayload.args);
  assert.equal(npcState.get("_enableAfter"), null);
  assert.equal(npcState.get("_disableAfter").type, "long");
  assert.equal(
    resolveFriendlyFireLegalAtTime(
      {
        enableAfter: null,
        disableAfter: String(npcState.get("_disableAfter").value),
      },
      { isNpcCorporation: true },
    ),
    false,
  );
});

test("friendly-fire changes preserve the current state until the pending switch time", () => {
  const nowFiletime = 133700000000000000n;
  const currentSettings = {
    enableAfter: "0",
    disableAfter: null,
  };

  const scheduledDisable = scheduleAggressionSettingsChange(
    currentSettings,
    false,
    { nowFiletime },
  );

  assert.equal(
    resolveFriendlyFireLegalAtTime(scheduledDisable, { nowFiletime }),
    true,
  );
  assert.equal(
    resolveFriendlyFireLegalAtTime(scheduledDisable, {
      nowFiletime: BigInt(scheduledDisable.disableAfter) + 1n,
    }),
    false,
  );
});

test("officeManager office rows expose stationTypeID for corp home and office menus", () => {
  const service = new OfficeManagerService();
  const result = service.Handle_GetMyCorporationsOffices([], { corpid: 1000044 });
  const args = dictEntriesToMap(result.args);
  const header = args.get("header").items;
  const lines = args.get("lines").items;

  assert.equal(header.includes("stationTypeID"), true);
  for (const row of lines) {
    assert.equal(row.items.length, header.length);
  }
});
