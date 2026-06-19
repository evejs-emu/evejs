const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  getSessionCharacterID,
  getSessionClientID,
  normalizeInteger,
} = require(path.join(__dirname, "./raffleHelpers"));

class RaffleSubscriptions {
  constructor() {
    this._ticketSubscribers = new Set();
    this._raffleSubscribers = new Map();
  }

  subscribeToTickets(session) {
    const clientId = getSessionClientID(session);
    if (clientId > 0) {
      this._ticketSubscribers.add(clientId);
    }
  }

  unsubscribeFromTickets(session) {
    const clientId = getSessionClientID(session);
    if (clientId > 0) {
      this._ticketSubscribers.delete(clientId);
    }
  }

  subscribeToRaffle(session, raffleId) {
    const clientId = getSessionClientID(session);
    const normalizedRaffleId = normalizeInteger(raffleId, 0);
    if (clientId <= 0 || normalizedRaffleId <= 0) {
      return;
    }

    if (!this._raffleSubscribers.has(normalizedRaffleId)) {
      this._raffleSubscribers.set(normalizedRaffleId, new Set());
    }
    this._raffleSubscribers.get(normalizedRaffleId).add(clientId);
  }

  unsubscribeFromRaffle(session, raffleId) {
    const clientId = getSessionClientID(session);
    const normalizedRaffleId = normalizeInteger(raffleId, 0);
    const subscribers = this._raffleSubscribers.get(normalizedRaffleId);
    if (!subscribers || clientId <= 0) {
      return;
    }

    subscribers.delete(clientId);
    if (subscribers.size === 0) {
      this._raffleSubscribers.delete(normalizedRaffleId);
    }
  }

  getInterestedSessions(raffleState, options = {}) {
    const recipients = new Map();
    const raffleId = normalizeInteger(raffleState && raffleState.raffleId, 0);
    const involvedCharacterIds = new Set([
      normalizeInteger(raffleState && raffleState.ownerId, 0),
    ]);

    for (const ticket of raffleState && Array.isArray(raffleState.soldTickets)
      ? raffleState.soldTickets
      : []) {
      const ownerId = normalizeInteger(ticket && ticket.ownerId, 0);
      if (ownerId > 0) {
        involvedCharacterIds.add(ownerId);
      }
    }

    const addSession = (session) => {
      if (
        !session ||
        !session.socket ||
        session.socket.destroyed ||
        typeof session.sendNotification !== "function"
      ) {
        return;
      }

      const clientId = getSessionClientID(session);
      if (clientId <= 0) {
        return;
      }

      recipients.set(clientId, session);
    };

    addSession(options.includeSession);

    const raffleSubscribers = this._raffleSubscribers.get(raffleId);
    for (const session of sessionRegistry.getSessions()) {
      const clientId = getSessionClientID(session);
      const characterId = getSessionCharacterID(session);
      if (
        this._ticketSubscribers.has(clientId) ||
        (raffleSubscribers && raffleSubscribers.has(clientId)) ||
        involvedCharacterIds.has(characterId)
      ) {
        addSession(session);
      }
    }

    return [...recipients.values()];
  }
}

module.exports = RaffleSubscriptions;
