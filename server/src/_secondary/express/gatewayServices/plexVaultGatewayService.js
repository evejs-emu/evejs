const crypto = require("crypto");
const path = require("path");

const {
  PLEX_LOG_CATEGORY,
  fileTimeStringToDate,
  getCharacterPlexTransaction,
  getCharacterPlexTransactionStatistics,
  getCharacterPlexTransactions,
} = require(path.join(
  __dirname,
  "../../../services/account/plexVaultLogState",
));

function normalizeProtoNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getActiveCharacterID(requestEnvelope) {
  const identityCharacter =
    requestEnvelope &&
    requestEnvelope.authoritative_context &&
    requestEnvelope.authoritative_context.identity &&
    requestEnvelope.authoritative_context.identity.character
      ? normalizeProtoNumber(
          requestEnvelope.authoritative_context.identity.character.sequential,
        )
      : 0;
  if (identityCharacter) {
    return identityCharacter;
  }

  return requestEnvelope &&
    requestEnvelope.authoritative_context &&
    requestEnvelope.authoritative_context.active_character
    ? normalizeProtoNumber(
        requestEnvelope.authoritative_context.active_character.sequential,
      )
    : 0;
}

function buildEncodedPayload(messageType, payload) {
  return Buffer.from(messageType.encode(messageType.create(payload)).finish());
}

function buildTimestampFromDate(date) {
  const normalizedDate =
    date instanceof Date && !Number.isNaN(date.valueOf()) ? date : new Date(0);
  const timeMs = normalizedDate.getTime();
  return {
    seconds: Math.floor(timeMs / 1000),
    nanos: (timeMs % 1000) * 1000000,
  };
}

function buildTimestampFromFileTime(fileTime) {
  return buildTimestampFromDate(fileTimeStringToDate(fileTime));
}

function buildFormattedMessage(messageID) {
  return {
    identifier: {
      sequential: Math.max(
        0,
        Math.trunc(
          normalizeProtoNumber(messageID) ||
            PLEX_LOG_CATEGORY.UNCATEGORIZED,
        ),
      ),
    },
    parameters: [],
  };
}

function buildCurrencyFromPlexAmount(amount, centsPerPlex) {
  return {
    total_in_cents: Math.trunc(normalizeProtoNumber(amount) * centsPerPlex),
  };
}

function buildCurrencyFromStoredCents(cents, centsPerPlex) {
  return {
    total_in_cents: Math.trunc((normalizeProtoNumber(cents) * centsPerPlex) / 100),
  };
}

function buildInvoiceUUID(transactionID) {
  return crypto
    .createHash("sha256")
    .update(String(transactionID || "0"))
    .digest()
    .subarray(0, 16);
}

function buildInvoiceEntry(transaction) {
  const categoryMessageID = Math.max(
    0,
    Math.trunc(
      normalizeProtoNumber(transaction && transaction.categoryMessageID) ||
        PLEX_LOG_CATEGORY.UNCATEGORIZED,
    ),
  );
  const summaryMessageID = Math.max(
    0,
    Math.trunc(normalizeProtoNumber(transaction && transaction.summaryMessageID)),
  );

  return {
    id: {
      uuid: buildInvoiceUUID(transaction && transaction.transactionID),
    },
    attributes: {
      category: buildFormattedMessage(categoryMessageID),
      summary_message: buildFormattedMessage(
        summaryMessageID || categoryMessageID,
      ),
      no_source: true,
      no_destination: true,
    },
  };
}

function buildTransactionAttributes(transaction, centsPerPlex) {
  return {
    timestamp: buildTimestampFromFileTime(transaction && transaction.transactionDate),
    amount_transferred: buildCurrencyFromPlexAmount(
      transaction && transaction.amount,
      centsPerPlex,
    ),
    resulting_balance: buildCurrencyFromPlexAmount(
      transaction && transaction.balance,
      centsPerPlex,
    ),
  };
}

function createPlexVaultGatewayService({ protoRoot, plexGatewayCentsPerPlex = 100 }) {
  const getAllLoggedForUserResponse = protoRoot.lookupType(
    "eve_public.plex.vault.transaction.api.GetAllLoggedForUserResponse",
  );
  const getLogRequest = protoRoot.lookupType(
    "eve_public.plex.vault.transaction.api.GetLogRequest",
  );
  const getLogResponse = protoRoot.lookupType(
    "eve_public.plex.vault.transaction.api.GetLogResponse",
  );
  const getStatisticsResponse = protoRoot.lookupType(
    "eve_public.plex.vault.transaction.api.GetStatisticsResponse",
  );

  return {
    name: "plex-vault",
    handledRequestTypes: [
      "eve_public.plex.vault.transaction.api.GetAllLoggedForUserRequest",
      "eve_public.plex.vault.transaction.api.GetLogRequest",
      "eve_public.plex.vault.transaction.api.GetStatisticsRequest",
    ],
    handleRequest(requestTypeName, requestEnvelope) {
      const activeCharacterID = getActiveCharacterID(requestEnvelope);

      if (
        requestTypeName ===
        "eve_public.plex.vault.transaction.api.GetAllLoggedForUserRequest"
      ) {
        const transactions = getCharacterPlexTransactions(activeCharacterID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.plex.vault.transaction.api.GetAllLoggedForUserResponse",
          responsePayloadBuffer: buildEncodedPayload(
            getAllLoggedForUserResponse,
            {
              transactions: transactions.map((transaction) => ({
                sequential: normalizeProtoNumber(
                  transaction && transaction.transactionID,
                ),
              })),
            },
          ),
        };
      }

      if (
        requestTypeName === "eve_public.plex.vault.transaction.api.GetLogRequest"
      ) {
        const request = getLogRequest.decode(
          requestEnvelope &&
            requestEnvelope.payload &&
            requestEnvelope.payload.value
            ? requestEnvelope.payload.value
            : Buffer.alloc(0),
        );
        const transactionID = normalizeProtoNumber(
          request && request.identifier && request.identifier.sequential,
        );
        const transaction = getCharacterPlexTransaction(
          activeCharacterID,
          transactionID,
        );

        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName: "eve_public.plex.vault.transaction.api.GetLogResponse",
          responsePayloadBuffer: buildEncodedPayload(
            getLogResponse,
            transaction
              ? {
                  transaction: buildTransactionAttributes(
                    transaction,
                    plexGatewayCentsPerPlex,
                  ),
                  invoice_entry: buildInvoiceEntry(transaction),
                }
              : {
                  unavailable: true,
                },
          ),
        };
      }

      if (
        requestTypeName ===
        "eve_public.plex.vault.transaction.api.GetStatisticsRequest"
      ) {
        const statistics = getCharacterPlexTransactionStatistics(activeCharacterID);
        return {
          statusCode: 200,
          statusMessage: "",
          responseTypeName:
            "eve_public.plex.vault.transaction.api.GetStatisticsResponse",
          responsePayloadBuffer: buildEncodedPayload(
            getStatisticsResponse,
            {
              entries: (statistics && statistics.entries ? statistics.entries : []).map(
                (entry) => ({
                  category: buildFormattedMessage(
                    entry && entry.categoryMessageID,
                  ),
                  incomes: buildCurrencyFromStoredCents(
                    entry && entry.incomesInCents,
                    plexGatewayCentsPerPlex,
                  ),
                  expenses: buildCurrencyFromStoredCents(
                    entry && entry.expensesInCents,
                    plexGatewayCentsPerPlex,
                  ),
                  transactions_count: Math.max(
                    0,
                    Math.trunc(
                      normalizeProtoNumber(
                        entry && entry.transactionsCount,
                      ),
                    ),
                  ),
                }),
              ),
              ...(statistics && statistics.earliestTimestamp
                ? {
                    earliest_transaction: statistics.earliestTimestamp,
                  }
                : {}),
            },
          ),
        };
      }

      return null;
    },
  };
}

module.exports = {
  createPlexVaultGatewayService,
};
