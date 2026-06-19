const path = require("path");

const {
  resolveStationPhysicalRadius,
} = require(path.join(__dirname, "../stationRadius"));
const {
  DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS,
  getEmpireSentryLayout,
} = require("./empireSentryLayout");

function getStationSentryDistanceMeters(station = null) {
  return Math.max(
    DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS,
    resolveStationPhysicalRadius(station, {
      fallbackRadius: DEFAULT_EMPIRE_SENTRY_DISTANCE_METERS,
    }),
  );
}

function getStationSentryLayout(system, station = null) {
  return getEmpireSentryLayout(system, {
    distanceMeters: getStationSentryDistanceMeters(station),
  });
}

module.exports = {
  getStationSentryDistanceMeters,
  getStationSentryLayout,
};
