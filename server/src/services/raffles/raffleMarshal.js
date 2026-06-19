const path = require("path");

const {
  buildKeyVal,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { normalizeInteger } = require(path.join(
  __dirname,
  "./raffleHelpers",
));

function buildTicketValue(ticket) {
  return buildKeyVal([
    ["running_id", normalizeInteger(ticket && ticket.runningId, 0)],
    ["raffle_id", normalizeInteger(ticket && ticket.raffleId, 0)],
    ["owner_id", normalizeInteger(ticket && ticket.ownerId, 0)],
    ["number", normalizeInteger(ticket && ticket.number, 0)],
  ]);
}

function buildMetaDataValue(metaData = {}) {
  return {
    type: "dict",
    entries: Object.entries(metaData || {}),
  };
}

function buildRaffleValue(state) {
  return buildKeyVal([
    ["running_id", state.runningId],
    ["raffle_id", state.raffleId],
    ["owner_id", state.ownerId],
    ["location_id", state.locationId],
    ["solar_system_id", state.solarSystemId],
    ["item_id", state.itemId],
    ["type_id", state.typeId],
    ["ticket_count", state.ticketCount],
    ["ticket_price", state.ticketPrice],
    ["restriction_id", state.restrictionId],
    ["creation_time", state.creationTime],
    ["expiration_time", state.expirationTime],
    ["sold_ticket_count", state.soldTickets.length],
    ["sold_tickets", buildList(state.soldTickets.map(buildTicketValue))],
    ["winning_ticket", state.winningTicket ? buildTicketValue(state.winningTicket) : null],
    ["raffle_status", state.raffleStatus],
    ["end_date", state.endDate],
    ["meta_data", buildMetaDataValue(state.metaData)],
  ]);
}

function buildTicketUpdatesValue(raffleId, soldTicketCount) {
  return {
    type: "dict",
    entries: [
      [
        normalizeInteger(raffleId, 0),
        normalizeInteger(soldTicketCount, 0),
      ],
    ],
  };
}

function buildCharacterStatisticsValue(stats = {}) {
  return buildKeyVal([
    ["raffles_participated", normalizeInteger(stats.raffles_participated, 0)],
    ["raffles_won", normalizeInteger(stats.raffles_won, 0)],
    ["finished_delivered", normalizeInteger(stats.finished_delivered, 0)],
    ["finished_undelivered", normalizeInteger(stats.finished_undelivered, 0)],
    ["finished_expired", normalizeInteger(stats.finished_expired, 0)],
    ["created_running", normalizeInteger(stats.created_running, 0)],
  ]);
}

function buildTypeStatisticsValue(stats = {}) {
  return {
    type: "dict",
    entries: [
      ["historic_count", normalizeInteger(stats.historic_count, 0)],
      ["historic_min", normalizeInteger(stats.historic_min, 0)],
      ["historic_max", normalizeInteger(stats.historic_max, 0)],
      ["historic_average", normalizeInteger(stats.historic_average, 0)],
      ["active_count", normalizeInteger(stats.active_count, 0)],
      ["active_min", normalizeInteger(stats.active_min, 0)],
      ["active_max", normalizeInteger(stats.active_max, 0)],
      ["active_average", normalizeInteger(stats.active_average, 0)],
    ],
  };
}

module.exports = {
  buildTicketValue,
  buildRaffleValue,
  buildTicketUpdatesValue,
  buildCharacterStatisticsValue,
  buildTypeStatisticsValue,
};
