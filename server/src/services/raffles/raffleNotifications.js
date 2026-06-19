const path = require("path");

const {
  buildTicketUpdatesValue,
} = require(path.join(__dirname, "./raffleMarshal"));

function notifyTicketsUpdated(sessions, raffleId, soldTicketCount) {
  const payload = buildTicketUpdatesValue(raffleId, soldTicketCount);
  for (const session of sessions) {
    session.sendNotification("OnTicketsUpdatedServer", "clientID", [payload]);
  }
}

function notifyRaffleUpdated(sessions, raffleId, raffleData) {
  for (const session of sessions) {
    session.sendNotification("OnRaffleUpdatedServer", "clientID", [
      raffleId,
      raffleData,
    ]);
  }
}

function notifyRaffleFinished(sessions, raffleId, winningTicket) {
  for (const session of sessions) {
    session.sendNotification("OnRaffleFinishedServer", "clientID", [
      raffleId,
      winningTicket,
    ]);
  }
}

function notifyRaffleCreated(sessions, raffleId, raffleData) {
  for (const session of sessions) {
    session.sendNotification("OnRaffleCreatedServer", "clientID", [
      raffleId,
      raffleData,
    ]);
  }
}

function notifyRaffleCreationFailed(sessions, raffleId, creationError) {
  for (const session of sessions) {
    session.sendNotification("OnRaffleCreationFailedServer", "clientID", [
      raffleId,
      creationError,
    ]);
  }
}

module.exports = {
  notifyTicketsUpdated,
  notifyRaffleUpdated,
  notifyRaffleFinished,
  notifyRaffleCreated,
  notifyRaffleCreationFailed,
};
