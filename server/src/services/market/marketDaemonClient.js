const net = require("net");
const path = require("path");

const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return Math.trunc(numericValue);
  }
  return fallback;
}

class MarketDaemonClient {
  constructor(options = {}) {
    this.host = String(options.host || config.marketDaemonHost || "127.0.0.1");
    this.port = normalizePositiveInteger(
      options.port || config.marketDaemonPort,
      40111,
    );
    this.connectTimeoutMs = normalizePositiveInteger(
      options.connectTimeoutMs || config.marketDaemonConnectTimeoutMs,
      1500,
    );
    this.requestTimeoutMs = normalizePositiveInteger(
      options.requestTimeoutMs || config.marketDaemonRequestTimeoutMs,
      15000,
    );
    this.retryDelayMs = normalizePositiveInteger(
      options.retryDelayMs || config.marketDaemonRetryDelayMs,
      2000,
    );

    this._socket = null;
    this._buffer = "";
    this._connected = false;
    this._connectingPromise = null;
    this._pendingRequests = new Map();
    this._nextRequestId = 1;
    this._backgroundReconnectEnabled = false;
    this._reconnectTimer = null;
    this._lastConnectFailureLogAt = 0;
  }

  getStatus() {
    return {
      host: this.host,
      port: this.port,
      connected: this._connected && this._isSocketUsable(),
      connecting: Boolean(this._connectingPromise),
      pendingRequests: this._pendingRequests.size,
    };
  }

  startBackgroundConnect() {
    this._backgroundReconnectEnabled = true;
    this._scheduleReconnect(0);
  }

  async startupCheck() {
    await this.call("StartupCheck", {});
    return null;
  }

  async call(method, params = {}) {
    await this.ensureConnected();
    return this._sendRequest(method, params);
  }

  async ensureConnected() {
    if (this._isSocketUsable()) {
      return;
    }

    if (this._connectingPromise) {
      return this._connectingPromise;
    }

    this._connectingPromise = new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port,
      });

      let settled = false;
      let timeoutHandle = null;

      const cleanup = () => {
        socket.removeListener("connect", handleConnect);
        socket.removeListener("error", handleError);
        socket.removeListener("close", handleCloseBeforeConnect);
        socket.removeListener("timeout", handleTimeout);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const finishReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        try {
          socket.destroy();
        } catch (destroyError) {
          // ignore
        }
        this._logConnectFailure(error);
        reject(error);
      };

      const handleConnect = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        socket.setNoDelay(true);
        socket.setEncoding("utf8");
        this._buffer = "";
        this._socket = socket;
        this._connected = true;
        this._attachSocket(socket);
        log.info(
          `[MarketDaemonClient] Connected to market daemon RPC at ${this.host}:${this.port}`,
        );
        resolve();
      };

      const handleError = (error) => {
        finishReject(error);
      };

      const handleCloseBeforeConnect = () => {
        finishReject(new Error("market daemon RPC socket closed before connect"));
      };

      const handleTimeout = () => {
        finishReject(
          new Error(
            `market daemon RPC connect timeout after ${this.connectTimeoutMs} ms`,
          ),
        );
      };

      socket.once("connect", handleConnect);
      socket.once("error", handleError);
      socket.once("close", handleCloseBeforeConnect);
      socket.once("timeout", handleTimeout);
      socket.setTimeout(this.connectTimeoutMs);

      timeoutHandle = setTimeout(() => {
        handleTimeout();
      }, this.connectTimeoutMs + 50);
    }).finally(() => {
      this._connectingPromise = null;
      if (this._backgroundReconnectEnabled && !this._isSocketUsable()) {
        this._scheduleReconnect(this.retryDelayMs);
      }
    });

    return this._connectingPromise;
  }

  _isSocketUsable() {
    return Boolean(
      this._connected &&
        this._socket &&
        !this._socket.destroyed &&
        this._socket.writable,
    );
  }

  _attachSocket(socket) {
    socket.on("data", (chunk) => {
      this._buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let newlineIndex = this._buffer.indexOf("\n");

      while (newlineIndex >= 0) {
        const line = this._buffer.slice(0, newlineIndex).trim();
        this._buffer = this._buffer.slice(newlineIndex + 1);
        if (line) {
          this._handleResponseLine(line);
        }
        newlineIndex = this._buffer.indexOf("\n");
      }
    });

    socket.on("error", (error) => {
      log.warn(`[MarketDaemonClient] RPC socket error: ${error.message}`);
    });

    socket.on("close", () => {
      if (this._socket === socket) {
        this._socket = null;
      }
      const wasConnected = this._connected;
      this._connected = false;
      this._buffer = "";
      this._failPendingRequests(
        new Error("market daemon RPC connection closed"),
      );
      if (wasConnected) {
        log.warn("[MarketDaemonClient] Market daemon RPC connection closed");
      }
      if (this._backgroundReconnectEnabled) {
        this._scheduleReconnect(this.retryDelayMs);
      }
    });
  }

  _handleResponseLine(line) {
    let response = null;
    try {
      response = JSON.parse(line);
    } catch (error) {
      log.warn(
        `[MarketDaemonClient] Failed to parse RPC response line: ${error.message}`,
      );
      return;
    }

    const requestId = String(
      response && Object.prototype.hasOwnProperty.call(response, "id")
        ? response.id
        : "",
    );
    const pendingRequest = this._pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    this._pendingRequests.delete(requestId);
    clearTimeout(pendingRequest.timeoutHandle);

    if (response.ok === false) {
      pendingRequest.reject(
        new Error(response.error || "market daemon RPC request failed"),
      );
      return;
    }

    pendingRequest.resolve(
      Object.prototype.hasOwnProperty.call(response, "result")
        ? response.result
        : null,
    );
  }

  _sendRequest(method, params) {
    if (!this._isSocketUsable()) {
      return Promise.reject(new Error("market daemon RPC connection is not ready"));
    }

    const requestId = String(this._nextRequestId++);
    const payload = JSON.stringify({
      id: requestId,
      method,
      params,
    });

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        reject(
          new Error(
            `market daemon RPC request timed out after ${this.requestTimeoutMs} ms`,
          ),
        );
      }, this.requestTimeoutMs);

      this._pendingRequests.set(requestId, {
        resolve,
        reject,
        timeoutHandle,
      });

      this._socket.write(`${payload}\n`, "utf8", (error) => {
        if (!error) {
          return;
        }

        const pendingRequest = this._pendingRequests.get(requestId);
        if (!pendingRequest) {
          return;
        }

        clearTimeout(timeoutHandle);
        this._pendingRequests.delete(requestId);
        reject(error);
      });
    });
  }

  _failPendingRequests(error) {
    for (const [requestId, pendingRequest] of this._pendingRequests.entries()) {
      clearTimeout(pendingRequest.timeoutHandle);
      pendingRequest.reject(error);
      this._pendingRequests.delete(requestId);
    }
  }

  _scheduleReconnect(delayMs) {
    if (!this._backgroundReconnectEnabled) {
      return;
    }
    if (this._reconnectTimer || this._isSocketUsable() || this._connectingPromise) {
      return;
    }

    const delay = Math.max(0, Number(delayMs) || 0);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.ensureConnected().catch(() => {
        this._scheduleReconnect(this.retryDelayMs);
      });
    }, delay);
  }

  _logConnectFailure(error) {
    const now = Date.now();
    if (now - this._lastConnectFailureLogAt < 10_000) {
      return;
    }
    this._lastConnectFailureLogAt = now;
    log.warn(
      `[MarketDaemonClient] Unable to reach market daemon RPC at ${this.host}:${this.port}: ${error.message}`,
    );
  }
}

const marketDaemonClient = new MarketDaemonClient();

module.exports = {
  MarketDaemonClient,
  marketDaemonClient,
};
