/**
 * Population Cap Service
 *
 * Handles population cap / load balancing during character selection.
 * The client creates a Moniker('populationCap', (charID, groupCharacter))
 * and calls GetCharacterLoadSlot(charID) to determine if the character's
 * solar system is congested and needs an alternative.
 *
 * MachoResolveObject resolves the moniker to this node.
 * GetCharacterLoadSlot returns a dict of {solarSystemID: slotKey}.
 * If only one entry, the client proceeds directly.
 * If multiple entries, the client prompts for an alternative system.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));

// Static counter for generating unique bound object IDs

class PopulationCapService extends BaseService {
  constructor() {
    super("populationCap");
  }

  /**
   * MachoResolveObject — resolves the moniker to this node.
   * Returns the nodeID so the client knows where to send subsequent calls.
   */
  Handle_MachoResolveObject(args, session, kwargs) {
    log.debug("[PopulationCap] MachoResolveObject called");
    const config = require(path.join(__dirname, "../../config"));
    return config.proxyNodeId;
  }

  /**
   * MachoBindObject — creates a bound-object reference and optionally
   * dispatches a nested method call included in the same request.
   *
   * Client sends: MachoBindObject(bindParams, call)
   *   - bindParams: the moniker parameters (e.g. charID, groupCharacter)
   *   - call:       None, or (method_name, argsTuple, argsDict) to invoke on the bound object
   *
   * Must return a 2-tuple:
   *   [0] = SubStruct(SubStream( OID )) where OID = ("N=nodeID:boundID", timestamp)
   *   [1] = result of nested call, or None
   */
  Handle_MachoBindObject(args, session, kwargs) {
    const config = require(path.join(__dirname, "../../config"));
    const bindParams = args && args.length > 0 ? args[0] : null;
    const nestedCall = args && args.length > 1 ? args[1] : null;

    log.debug(
      `[PopulationCap] MachoBindObject args.length=${args ? args.length : 0} bindParams=${JSON.stringify(bindParams, (k, v) => (typeof v === "bigint" ? v.toString() : v))} nestedCall=${JSON.stringify(nestedCall, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))} kwargs=${JSON.stringify(kwargs, (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? v.toString("utf8") : v))}`,
    );

    // Generate a unique bound object ID
    const boundId = config.getNextBoundId();
    const idString = `N=${config.proxyNodeId}:${boundId}`;
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    // OID = (idString, timestamp)
    const oid = [idString, now];

    // Handle optional nested call
    let callResult = null;
    if (nestedCall && Array.isArray(nestedCall) && nestedCall.length >= 1) {
      const methodName =
        typeof nestedCall[0] === "string"
          ? nestedCall[0]
          : Buffer.isBuffer(nestedCall[0])
            ? nestedCall[0].toString("utf8")
            : String(nestedCall[0]);
      const callArgs = nestedCall.length > 1 ? nestedCall[1] : [];
      const callKwargs = nestedCall.length > 2 ? nestedCall[2] : null;

      log.debug(`[PopulationCap] MachoBindObject nested call: ${methodName}`);
      callResult = this.callMethod(
        methodName,
        Array.isArray(callArgs) ? callArgs : [callArgs],
        session,
        callKwargs,
      );
    }

    // Return 2-tuple: [SubStruct(SubStream(OID)), callResult]
    return [
      {
        type: "substruct",
        value: { type: "substream", value: oid },
      },
      callResult != null ? callResult : null,
    ];
  }

  /**
   * GetCharacterLoadSlot — returns available solar system slots for the character.
   *
   * Client code (characterSelection.py line 701):
   *   locations = populationCap.GetCharacterLoadSlot(charID)
   *   if len(locations) > 1:
   *       # ask user to pick alternative system
   *   else:
   *       # proceed normally
   *
   * Return a single-entry dict {solarSystemID: slotKey} so the client
   * proceeds without prompting for alternatives (system is not congested).
   */
  Handle_GetCharacterLoadSlot(args, session, kwargs) {
    const charId = args && args.length > 0 ? args[0] : 0;
    log.debug(`[PopulationCap] GetCharacterLoadSlot(${charId})`);

    // Return single entry — character's current system is fine, no congestion
    const solarSystemID = (session && session.solarsystemid) || 30000142;

    return {
      type: "dict",
      entries: [[solarSystemID, 0]],
    };
  }
}

module.exports = PopulationCapService;
