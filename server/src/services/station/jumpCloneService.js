const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildBoundObjectResponse,
  normalizeText,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const jumpCloneRuntime = require(path.join(__dirname, "./jumpCloneRuntime"));

class JumpCloneService extends BaseService {
  constructor() {
    super("jumpCloneSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[JumpCloneSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[JumpCloneSvc] MachoBindObject");
    const response = buildBoundObjectResponse(this, args, session, kwargs);
    const nestedCall = args && args.length > 1 ? args[1] : null;
    const nestedMethod = Array.isArray(nestedCall)
      ? normalizeText(nestedCall[0], "")
      : "";
    if (
      nestedMethod === "ValidateInstallJumpClone" &&
      Array.isArray(response) &&
      response.length >= 2 &&
      response[1] == null
    ) {
      response[1] = [];
    }
    return response;
  }

  Handle_GetCloneState(args, session) {
    log.debug("[JumpCloneSvc] GetCloneState");
    return jumpCloneRuntime.buildCloneStatePayload(session);
  }

  Handle_GetStationCloneState(args, session) {
    log.debug("[JumpCloneSvc] GetStationCloneState");
    return jumpCloneRuntime.buildStationCloneStatePayload(session);
  }

  Handle_GetShipCloneState(args, session) {
    log.debug("[JumpCloneSvc] GetShipCloneState");
    return jumpCloneRuntime.buildShipCloneStatePayload(session);
  }

  Handle_GetNumClonesInPilotsStructure(args, session) {
    log.debug("[JumpCloneSvc] GetNumClonesInPilotsStructure");
    return jumpCloneRuntime.getNumClonesInPilotsStructure(session);
  }

  Handle_GetPriceForClone() {
    log.debug("[JumpCloneSvc] GetPriceForClone");
    return jumpCloneRuntime.getPriceForClone();
  }

  Handle_ValidateInstallJumpClone(args, session) {
    log.debug("[JumpCloneSvc] ValidateInstallJumpClone");
    return jumpCloneRuntime.validateInstallJumpClone(session);
  }

  Handle_InstallCloneInStation(args, session) {
    log.debug("[JumpCloneSvc] InstallCloneInStation");
    return jumpCloneRuntime.installCloneAtCurrentLocation(session);
  }

  Handle_InstallCloneInStructure(args, session) {
    log.debug("[JumpCloneSvc] InstallCloneInStructure");
    return jumpCloneRuntime.installCloneAtCurrentLocation(session);
  }

  Handle_SetJumpCloneName(args, session) {
    log.debug("[JumpCloneSvc] SetJumpCloneName");
    return jumpCloneRuntime.setJumpCloneName(
      session,
      args && args[0],
      args && args[1],
    );
  }

  Handle_DestroyInstalledClone(args, session) {
    log.debug("[JumpCloneSvc] DestroyInstalledClone");
    return jumpCloneRuntime.destroyInstalledClone(session, args && args[0]);
  }

  Handle_CloneJump(args, session) {
    log.debug("[JumpCloneSvc] CloneJump");
    return jumpCloneRuntime.performCloneJump(
      session,
      args && args[0],
      args && args[1],
      args && args[2],
      args && args[3],
    );
  }

  Handle_OfferShipCloneInstallation(args, session) {
    log.debug("[JumpCloneSvc] OfferShipCloneInstallation");
    return jumpCloneRuntime.offerShipCloneInstallation(session, args && args[0]);
  }

  Handle_AcceptShipCloneInstallation(args, session) {
    log.debug("[JumpCloneSvc] AcceptShipCloneInstallation");
    return jumpCloneRuntime.acceptShipCloneInstallation(session);
  }

  Handle_CancelShipCloneInstallation(args, session) {
    log.debug("[JumpCloneSvc] CancelShipCloneInstallation");
    return jumpCloneRuntime.cancelShipCloneInstallation(session);
  }

  Handle_ResetLastCloneJumpTime(args, session) {
    log.debug("[JumpCloneSvc] ResetLastCloneJumpTime");
    return jumpCloneRuntime.resetLastCloneJumpTime(session);
  }
}

module.exports = JumpCloneService;
