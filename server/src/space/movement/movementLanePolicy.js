const {
  MOVEMENT_MICHELLE_CONTRACT,
  ...michelleContract
} = require("./movementMichelleContract");
const {
  MOVEMENT_DELIVERY_POLICY,
  ...deliveryPolicy
} = require("./movementDeliveryPolicy");

// Compatibility surface only.
// Use `movementMichelleContract.js` for true CCP/Michelle timing primitives.
// Use `movementDeliveryPolicy.js` for the server-side delivery/restamp layer.
module.exports = {
  MOVEMENT_MICHELLE_CONTRACT,
  MOVEMENT_DELIVERY_POLICY,
  ...michelleContract,
  ...deliveryPolicy,
};
