/**
 * Subscription Manager Service (subscriptionMgr)
 *
 * Handles subscription/account status queries from the client.
 * Modern EVE clients call this during the login flow.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildFiletimeLong,
  buildKeyVal,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  resolveOmegaLicenseState,
} = require(path.join(__dirname, "../newEdenStore/storeState"));

const CLONE_STATE_ALPHA = 0;
const CLONE_STATE_OMEGA = 1;
const FILETIME_TICKS_PER_DAY = 864000000000n;
const OMEGA_EXPIRY_FILETIME = 157469184000000000n; // 2100-01-01T00:00:00Z

class SubscriptionMgrService extends BaseService {
  constructor() {
    super("subscriptionMgr");
  }

  _readCloneGradeOverride() {
    const raw = process.env.EVE_CLONE_GRADE;
    if (!raw) {
      return null;
    }

    const val = String(raw).trim().toLowerCase();
    if (val === "omega") return CLONE_STATE_OMEGA;
    if (val === "alpha" || val === "trial") return CLONE_STATE_ALPHA;

    const parsed = Number.parseInt(val, 10);
    if (parsed === CLONE_STATE_ALPHA || parsed === CLONE_STATE_OMEGA) {
      return parsed;
    }

    log.warn(
      `[SubscriptionMgr] Unsupported EVE_CLONE_GRADE="${raw}", defaulting to config-driven state`,
    );
    return null;
  }

  _resolveCloneGrade(session) {
    // This client build only cleanly recognizes Alpha (0) and Omega (1).
    const override = this._readCloneGradeOverride();
    if (override !== null) {
      return override;
    }

    const omegaState = resolveOmegaLicenseState(session && session.userid);
    if (omegaState && omegaState.hasLicense) {
      return CLONE_STATE_OMEGA;
    }

    return config.omegaLicenseEnabled === false
      ? CLONE_STATE_ALPHA
      : CLONE_STATE_OMEGA;
  }

  _getSubscriptionState(session) {
    const cloneGrade = this._resolveCloneGrade(session);
    const isSubscribed = cloneGrade === CLONE_STATE_OMEGA;
    const omegaState = resolveOmegaLicenseState(session && session.userid);
    const subscriptionEndTime =
      isSubscribed && omegaState && omegaState.expiryFileTime
        ? BigInt(omegaState.expiryFileTime)
        : isSubscribed
          ? OMEGA_EXPIRY_FILETIME
          : null;
    let subscriptionDaysRemaining = 0;

    if (subscriptionEndTime !== null) {
      const ticksRemaining = subscriptionEndTime - currentFileTime();
      if (ticksRemaining > 0n) {
        subscriptionDaysRemaining = Number(
          (ticksRemaining + FILETIME_TICKS_PER_DAY - 1n) / FILETIME_TICKS_PER_DAY,
        );
      }
    }

    return {
      cloneGrade,
      isSubscribed,
      subscriptionEndTime,
      subscriptionDaysRemaining,
    };
  }

  Handle_GetSubscriptionStatus(args, session) {
    const state = this._getSubscriptionState(session);
    log.debug(
      `[SubscriptionMgr] GetSubscriptionStatus -> subscribed=${state.isSubscribed} daysRemaining=${state.subscriptionDaysRemaining}`,
    );
    return buildKeyVal([
      ["isSubscribed", state.isSubscribed],
      ["subscriptionDaysRemaining", state.subscriptionDaysRemaining],
      [
        "subscriptionEndTime",
        state.subscriptionEndTime !== null
          ? buildFiletimeLong(state.subscriptionEndTime)
          : null,
      ],
    ]);
  }

  Handle_GetSubscriptionInfo(args, session) {
    const state = this._getSubscriptionState(session);
    log.debug(
      `[SubscriptionMgr] GetSubscriptionInfo -> subscribed=${state.isSubscribed} cloneGrade=${state.cloneGrade}`,
    );
    return buildKeyVal([
      ["isSubscribed", state.isSubscribed],
      ["subscriptionDaysRemaining", state.subscriptionDaysRemaining],
      ["cloneGrade", state.cloneGrade],
      [
        "subscriptionEndTime",
        state.subscriptionEndTime !== null
          ? buildFiletimeLong(state.subscriptionEndTime)
          : null,
      ],
    ]);
  }

  Handle_GetSubscriptionTime(args, session) {
    const state = this._getSubscriptionState(session);
    log.debug(
      `[SubscriptionMgr] GetSubscriptionTime -> ${state.subscriptionEndTime !== null ? state.subscriptionEndTime.toString() : "null"}`,
    );
    return state.subscriptionEndTime !== null
      ? buildFiletimeLong(state.subscriptionEndTime)
      : null;
  }

  Handle_GetCloneGrade(args, session) {
    const state = this._getSubscriptionState(session);
    log.debug(`[SubscriptionMgr] GetCloneGrade -> ${state.cloneGrade}`);
    return state.cloneGrade;
  }
}

module.exports = SubscriptionMgrService;
