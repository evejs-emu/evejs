function tokenizeArgumentText(argumentText) {
  return String(argumentText || "")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isPositiveIntegerToken(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function parseAmountAndQuery(argumentText, options = {}) {
  const defaultAmount = Math.max(1, Math.trunc(Number(options.defaultAmount) || 1));
  const tokens = tokenizeArgumentText(argumentText);
  if (tokens.length === 0) {
    return {
      success: true,
      amount: defaultAmount,
      query: "",
    };
  }

  let amount = defaultAmount;
  let queryTokens = [...tokens];
  if (tokens.length >= 1 && isPositiveIntegerToken(tokens[0])) {
    amount = Math.max(1, Math.trunc(Number(tokens[0]) || defaultAmount));
    queryTokens = tokens.slice(1);
  } else if (tokens.length >= 2 && isPositiveIntegerToken(tokens[tokens.length - 1])) {
    amount = Math.max(1, Math.trunc(Number(tokens[tokens.length - 1]) || defaultAmount));
    queryTokens = tokens.slice(0, -1);
  }

  return {
    success: true,
    amount,
    query: queryTokens.join(" ").trim(),
  };
}

function parseActionAndQuery(argumentText, options = {}) {
  const allowedActions = new Set(
    (Array.isArray(options.allowedActions) ? options.allowedActions : [])
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const defaultAction = String(options.defaultAction || "").trim().toLowerCase() || null;
  const defaultQuery = String(options.defaultQuery || "").trim();
  const tokens = tokenizeArgumentText(argumentText);
  if (tokens.length === 0) {
    return {
      success: true,
      action: defaultAction,
      query: defaultQuery,
    };
  }

  let action = defaultAction;
  if (allowedActions.has(tokens[0].toLowerCase())) {
    action = tokens.shift().toLowerCase();
  }
  if (tokens.length > 0 && allowedActions.has(tokens[tokens.length - 1].toLowerCase())) {
    action = tokens.pop().toLowerCase();
  }

  return {
    success: true,
    action,
    query: tokens.join(" ").trim() || defaultQuery,
  };
}

function parseQueryAndTarget(argumentText, options = {}) {
  const defaultQuery = String(options.defaultQuery || "").trim() || "all";
  const tokens = tokenizeArgumentText(argumentText);
  if (tokens.length <= 0) {
    return {
      success: false,
      errorMsg: "TARGET_REQUIRED",
    };
  }

  const targetToken = tokens.pop();
  return {
    success: true,
    query: tokens.join(" ").trim() || defaultQuery,
    targetToken,
  };
}

function parseActionQueryAndTarget(argumentText, options = {}) {
  const allowedActions = new Set(
    (Array.isArray(options.allowedActions) ? options.allowedActions : [])
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const defaultAction = String(options.defaultAction || "").trim().toLowerCase() || null;
  const defaultQuery = String(options.defaultQuery || "").trim() || "all";
  const tokens = tokenizeArgumentText(argumentText);
  if (tokens.length === 0) {
    return {
      success: true,
      action: defaultAction,
      query: defaultQuery,
      targetToken: null,
    };
  }

  let action = defaultAction;
  if (allowedActions.has(tokens[0].toLowerCase())) {
    action = tokens.shift().toLowerCase();
  }
  if (tokens.length > 0 && allowedActions.has(tokens[tokens.length - 1].toLowerCase())) {
    action = tokens.pop().toLowerCase();
  }

  let targetToken = null;
  if (tokens.length > 1) {
    targetToken = tokens.pop();
  }

  return {
    success: true,
    action,
    query: tokens.join(" ").trim() || defaultQuery,
    targetToken,
  };
}

function isTargetToken(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "me" ||
    normalized === "self" ||
    normalized === "ship" ||
    isPositiveIntegerToken(normalized);
}

function parseQueryAndOptionalTarget(argumentText, options = {}) {
  const defaultQuery = String(options.defaultQuery || "").trim();
  const tokens = tokenizeArgumentText(argumentText);
  if (tokens.length <= 0) {
    return {
      success: true,
      query: defaultQuery,
      targetToken: null,
    };
  }

  let targetToken = null;
  if (tokens.length > 1 && isTargetToken(tokens[tokens.length - 1])) {
    targetToken = tokens.pop();
  }

  return {
    success: true,
    query: tokens.join(" ").trim() || defaultQuery,
    targetToken,
  };
}

module.exports = {
  tokenizeArgumentText,
  parseAmountAndQuery,
  parseActionAndQuery,
  parseQueryAndTarget,
  parseActionQueryAndTarget,
  parseQueryAndOptionalTarget,
};
