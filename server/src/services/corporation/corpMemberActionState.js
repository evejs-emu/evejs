const path = require("path");

const {
  adjustCharacterBalance,
} = require(path.join(__dirname, "../account/walletState"));
const {
  extractList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  CORPORATION_WALLET_KEY_START,
  adjustCorporationWalletDivisionBalance,
  getCorporationWalletBalance,
  normalizeCorporationWalletKey,
} = require(path.join(__dirname, "./corpWalletState"));
const {
  getCorporationMember,
  getCorporationRuntime,
  normalizeInteger,
  normalizePositiveInteger,
  normalizeText,
  syncMemberStateToCharacterRecord,
  toRoleMaskBigInt,
  updateCorporationRuntime,
} = require(path.join(__dirname, "./corporationRuntimeState"));

const CTV_ADD = 1;
const CTV_REMOVE = 2;
const CTV_SET = 3;
const CTV_GIVE = 4;
const CTPG_CASH = 6;
const CTPG_SHARES = 7;

const ROLE_MASK_PROPERTIES = new Set([
  "roles",
  "rolesAtHQ",
  "rolesAtBase",
  "rolesAtOther",
  "grantableRoles",
  "grantableRolesAtHQ",
  "grantableRolesAtBase",
  "grantableRolesAtOther",
]);

function normalizeActionProperty(rawProperty) {
  if (
    typeof rawProperty === "number" ||
    typeof rawProperty === "bigint" ||
    (rawProperty &&
      typeof rawProperty === "object" &&
      (rawProperty.type === "int" || rawProperty.type === "long"))
  ) {
    return normalizeInteger(rawProperty, 0);
  }
  return normalizeText(rawProperty, "");
}

function normalizeActionRow(rawAction) {
  const values = extractList(rawAction);
  if (values.length < 3) {
    return null;
  }
  return {
    verb: normalizeInteger(values[0], 0),
    property: normalizeActionProperty(values[1]),
    value: values[2],
  };
}

function normalizeTargetIDs(rawTargetIDs, corporationID) {
  const uniqueTargetIDs = [];
  const seenTargetIDs = new Set();
  for (const rawTargetID of extractList(rawTargetIDs)) {
    const targetID = normalizePositiveInteger(rawTargetID, null);
    if (!targetID || seenTargetIDs.has(targetID)) {
      continue;
    }
    if (!getCorporationMember(corporationID, targetID)) {
      continue;
    }
    seenTargetIDs.add(targetID);
    uniqueTargetIDs.push(targetID);
  }
  return uniqueTargetIDs;
}

function applyMaskAction(currentValue, verb, value) {
  const currentMask = toRoleMaskBigInt(currentValue, 0n);
  const actionMask = toRoleMaskBigInt(value, 0n);
  if (verb === CTV_ADD) {
    return currentMask | actionMask;
  }
  if (verb === CTV_REMOVE) {
    return currentMask & ~actionMask;
  }
  if (verb === CTV_SET) {
    return actionMask;
  }
  return currentMask;
}

function applyIntegerMaskAction(currentValue, verb, value) {
  const currentMask = normalizeInteger(currentValue, 0);
  const actionMask = normalizeInteger(value, 0);
  if (verb === CTV_ADD) {
    return currentMask | actionMask;
  }
  if (verb === CTV_REMOVE) {
    return currentMask & ~actionMask;
  }
  if (verb === CTV_SET) {
    return actionMask;
  }
  return currentMask;
}

function resolveSourceWalletKey(session, corporationID) {
  const sessionAccountKey = normalizePositiveInteger(
    session && (session.corpAccountKey || session.corpaccountkey),
    null,
  );
  if (sessionAccountKey) {
    return normalizeCorporationWalletKey(sessionAccountKey);
  }
  const actingCharacterID = normalizePositiveInteger(
    session && (session.characterID || session.charid),
    null,
  );
  const actingMember = actingCharacterID
    ? getCorporationMember(corporationID, actingCharacterID)
    : null;
  return normalizeCorporationWalletKey(
    actingMember && actingMember.accountKey
      ? actingMember.accountKey
      : CORPORATION_WALLET_KEY_START,
  );
}

function preflightActionGrants(corporationID, targetIDs, actions, walletKey) {
  let totalCashRequired = 0;
  let totalSharesRequired = 0;
  for (const action of actions) {
    if (!action || action.verb !== CTV_GIVE) {
      continue;
    }
    if (action.property === CTPG_CASH) {
      const amount = Math.max(0, normalizeInteger(action.value, 0));
      totalCashRequired += amount * targetIDs.length;
      continue;
    }
    if (action.property === CTPG_SHARES) {
      const shares = Math.max(0, normalizeInteger(action.value, 0));
      totalSharesRequired += shares * targetIDs.length;
    }
  }

  if (totalCashRequired > 0) {
    const walletBalance = getCorporationWalletBalance(corporationID, walletKey);
    if (walletBalance + 0.0001 < totalCashRequired) {
      return {
        success: false,
        errorMsg: "INSUFFICIENT_FUNDS",
      };
    }
  }

  if (totalSharesRequired > 0) {
    const runtime = getCorporationRuntime(corporationID) || {};
    const availableShares = normalizeInteger(
      runtime.shares && runtime.shares[String(corporationID)],
      0,
    );
    if (availableShares < totalSharesRequired) {
      return {
        success: false,
        errorMsg: "INSUFFICIENT_SHARES",
      };
    }
  }

  return {
    success: true,
  };
}

function applyAdministrativeMemberChanges(corporationID, targetIDs, actions) {
  const touchedMembers = new Set();
  updateCorporationRuntime(corporationID, (runtime) => {
    runtime.members =
      runtime.members && typeof runtime.members === "object" ? runtime.members : {};
    runtime.shares =
      runtime.shares && typeof runtime.shares === "object" ? runtime.shares : {};

    for (const targetID of targetIDs) {
      const member = runtime.members[String(targetID)];
      if (!member) {
        continue;
      }
      for (const action of actions) {
        if (!action || action.verb === CTV_GIVE) {
          continue;
        }
        if (ROLE_MASK_PROPERTIES.has(action.property)) {
          member[action.property] = applyMaskAction(
            member[action.property],
            action.verb,
            action.value,
          ).toString();
          touchedMembers.add(targetID);
          continue;
        }
        if (action.property === "titleMask") {
          member.titleMask = applyIntegerMaskAction(
            member.titleMask,
            action.verb,
            action.value,
          );
          touchedMembers.add(targetID);
          continue;
        }
        if (action.property === "baseID" && action.verb === CTV_SET) {
          member.baseID = normalizePositiveInteger(action.value, null);
          touchedMembers.add(targetID);
        }
      }
    }

    for (const action of actions) {
      if (!action || action.verb !== CTV_GIVE || action.property !== CTPG_SHARES) {
        continue;
      }
      const sharesPerTarget = Math.max(0, normalizeInteger(action.value, 0));
      if (sharesPerTarget <= 0) {
        continue;
      }
      for (const targetID of targetIDs) {
        runtime.shares[String(corporationID)] =
          normalizeInteger(runtime.shares[String(corporationID)], 0) - sharesPerTarget;
        runtime.shares[String(targetID)] =
          normalizeInteger(runtime.shares[String(targetID)], 0) + sharesPerTarget;
      }
    }

    return runtime;
  });

  for (const targetID of touchedMembers) {
    syncMemberStateToCharacterRecord(corporationID, targetID);
  }
}

function applyCashGrants(corporationID, targetIDs, actions, walletKey) {
  for (const action of actions) {
    if (!action || action.verb !== CTV_GIVE || action.property !== CTPG_CASH) {
      continue;
    }
    const amount = Math.max(0, normalizeInteger(action.value, 0));
    if (amount <= 0) {
      continue;
    }
    for (const targetID of targetIDs) {
      const debitResult = adjustCorporationWalletDivisionBalance(
        corporationID,
        walletKey,
        -amount,
        {
          entryTypeID: 10,
          ownerID1: corporationID,
          ownerID2: targetID,
          description: `Corporation member grant to ${targetID}`,
        },
      );
      if (!debitResult.success) {
        return debitResult;
      }
      adjustCharacterBalance(targetID, amount, {
        entryTypeID: 10,
        ownerID1: corporationID,
        ownerID2: targetID,
        description: `Corporation member grant from ${corporationID}`,
      });
    }
  }
  return {
    success: true,
  };
}

function executeCorporationMemberActions(corporationID, rawTargetIDs, rawActions, session) {
  const targetIDs = normalizeTargetIDs(rawTargetIDs, corporationID);
  if (targetIDs.length === 0) {
    return {
      success: true,
      data: {
        targetIDs: [],
      },
    };
  }

  const actions = extractList(rawActions)
    .map((action) => normalizeActionRow(action))
    .filter(Boolean);
  if (actions.length === 0) {
    return {
      success: true,
      data: {
        targetIDs,
      },
    };
  }

  const walletKey = resolveSourceWalletKey(session, corporationID);
  const preflight = preflightActionGrants(
    corporationID,
    targetIDs,
    actions,
    walletKey,
  );
  if (!preflight.success) {
    return preflight;
  }

  applyAdministrativeMemberChanges(corporationID, targetIDs, actions);

  const cashGrantResult = applyCashGrants(
    corporationID,
    targetIDs,
    actions,
    walletKey,
  );
  if (!cashGrantResult.success) {
    return cashGrantResult;
  }

  return {
    success: true,
    data: {
      corporationID,
      targetIDs,
      walletKey,
    },
  };
}

module.exports = {
  CTPG_CASH,
  CTPG_SHARES,
  CTV_ADD,
  CTV_GIVE,
  CTV_REMOVE,
  CTV_SET,
  executeCorporationMemberActions,
};
