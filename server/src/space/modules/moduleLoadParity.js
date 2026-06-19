// Space attach profiles identify the client transition family. Fitted modules
// and loaded charges are authoritative in dogma GetAllInfo and the active-ship
// inventory response.
const SPACE_ATTACH_HYDRATION_PROFILES = Object.freeze({
  login: Object.freeze({ profileID: "login" }),
  stargate: Object.freeze({ profileID: "stargate" }),
  solar: Object.freeze({ profileID: "solar" }),
  solarWarm: Object.freeze({ profileID: "solarWarm" }),
  transition: Object.freeze({ profileID: "transition" }),
  undock: Object.freeze({ profileID: "undock" }),
  capsule: Object.freeze({ profileID: "capsule" }),
});

function buildSpaceAttachHydrationPlan(profileName = "transition") {
  const baseProfile =
    SPACE_ATTACH_HYDRATION_PROFILES[profileName] ||
    SPACE_ATTACH_HYDRATION_PROFILES.transition;

  return {
    profileID: baseProfile.profileID,
  };
}

module.exports = {
  SPACE_ATTACH_HYDRATION_PROFILES,
  buildSpaceAttachHydrationPlan,
};
