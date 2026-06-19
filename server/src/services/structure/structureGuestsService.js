const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { buildDict } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const {
  getStructureGuestEntries,
  normalizePositiveInt,
} = require(path.join(
  __dirname,
  "../_shared/guestLists",
));

function getSessionStructureID(session) {
  return normalizePositiveInt(
    session && (session.structureID || session.structureid),
    0,
  );
}

class StructureGuestsService extends BaseService {
  constructor() {
    super("structureGuests");
  }

  Handle_GetGuests(args, session) {
    const requestedStructureID = normalizePositiveInt(args && args[0], 0);
    const structureID = requestedStructureID || getSessionStructureID(session);

    if (!structureID) {
      return buildDict([]);
    }

    return buildDict(getStructureGuestEntries(structureID));
  }
}

module.exports = StructureGuestsService;
