/**
 * Base Service
 *
 * All game services extend this. Provides method dispatch and
 * a standard interface for the service manager.
 */

const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));

function normalizeMethodName(method) {
  if (typeof method === "string") {
    return method;
  }
  if (Buffer.isBuffer(method)) {
    return method.toString("utf8");
  }
  if (
    method &&
    typeof method === "object" &&
    typeof method.value === "string"
  ) {
    return method.value;
  }
  if (method === null || method === undefined) {
    return "";
  }
  return String(method);
}

class BaseService {
  constructor(name) {
    this._name = name;
  }

  get name() {
    return this._name;
  }

  /**
   * Called by the packet dispatcher to invoke a method on this service.
   * Override this to add custom dispatch logic, or just define methods
   * in your subclass and this will find them automatically.
   *
   * @param {string} method - Method name from the call request
  * @param {Array} args - Arguments from the call request
  * @param {object} session - Client session
  * @returns {*} Result to send back to the client
  */
  callMethod(method, args, session, kwargs) {
    const normalizedMethod = normalizeMethodName(method);
    // Try to find a handler method named Handle_<method> or just <method>
    const handlerName = `Handle_${normalizedMethod}`;
    if (typeof this[handlerName] === "function") {
      return this[handlerName](args, session, kwargs);
    }
    if (typeof this[normalizedMethod] === "function") {
      return this[normalizedMethod](args, session, kwargs);
    }

    log.warn(`[${this._name}] Unhandled method: ${normalizedMethod}`);
    return null;
  }
}

module.exports = BaseService;
