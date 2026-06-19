const path = require("path");

const {
  getAdjustedAveragePrice,
  getCompressedTypeID,
  getCompressionSourceTypeIDs,
  getTypeMaterials,
  hasTypeMaterials,
  isCompressedType,
  isCompressibleType,
  refreshReprocessingStaticData,
} = require(path.join(__dirname, "../reprocessing"));

function refreshMiningStaticData() {
  return refreshReprocessingStaticData();
}

module.exports = {
  getTypeMaterials,
  hasTypeMaterials,
  getCompressedTypeID,
  isCompressibleType,
  getCompressionSourceTypeIDs,
  isCompressedType,
  getAdjustedAveragePrice,
  refreshMiningStaticData,
};
