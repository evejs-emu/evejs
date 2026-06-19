const controllersByEntityID = new Map();
const controllersBySystemID = new Map();
const indexedSystemIDsByController = new WeakMap();

function normalizeEntityID(entityID) {
  return Number(entityID) || 0;
}

function normalizeSystemID(systemID) {
  return Number(systemID) || 0;
}

function getSystemBucket(systemID, options = {}) {
  const normalizedSystemID = normalizeSystemID(systemID);
  if (!controllersBySystemID.has(normalizedSystemID)) {
    if (options.create !== true) {
      return null;
    }
    controllersBySystemID.set(normalizedSystemID, new Map());
  }
  return controllersBySystemID.get(normalizedSystemID) || null;
}

function detachControllerFromIndexedSystem(controller) {
  if (!controller || !Number.isInteger(normalizeEntityID(controller.entityID))) {
    return;
  }

  const indexedSystemID = indexedSystemIDsByController.get(controller);
  if (indexedSystemID === undefined) {
    return;
  }

  const bucket = getSystemBucket(indexedSystemID);
  if (!bucket) {
    indexedSystemIDsByController.delete(controller);
    return;
  }

  bucket.delete(normalizeEntityID(controller.entityID));
  if (bucket.size === 0) {
    controllersBySystemID.delete(indexedSystemID);
  }
  indexedSystemIDsByController.delete(controller);
}

function attachControllerToIndexedSystem(controller, systemID) {
  const bucket = getSystemBucket(systemID, { create: true });
  if (!bucket) {
    return;
  }
  bucket.set(normalizeEntityID(controller.entityID), controller);
  indexedSystemIDsByController.set(controller, normalizeSystemID(systemID));
}

function syncControllerSystemIndex(controller) {
  if (!controller || !Number.isInteger(normalizeEntityID(controller.entityID))) {
    return controller || null;
  }

  const actualSystemID = normalizeSystemID(controller.systemID);
  const indexedSystemID = indexedSystemIDsByController.get(controller);
  if (indexedSystemID === actualSystemID) {
    return controller;
  }

  if (indexedSystemID !== undefined) {
    detachControllerFromIndexedSystem(controller);
  }
  attachControllerToIndexedSystem(controller, actualSystemID);
  return controller;
}

function registerController(controller) {
  if (!controller || !Number.isInteger(normalizeEntityID(controller.entityID))) {
    return null;
  }

  const normalizedController = {
    ...controller,
    entityID: normalizeEntityID(controller.entityID),
    systemID: normalizeSystemID(controller.systemID),
  };
  const existingController = controllersByEntityID.get(normalizedController.entityID) || null;
  if (existingController) {
    detachControllerFromIndexedSystem(existingController);
  }

  controllersByEntityID.set(normalizedController.entityID, normalizedController);
  attachControllerToIndexedSystem(normalizedController, normalizedController.systemID);
  return normalizedController;
}

function getControllerByEntityID(entityID) {
  const controller = controllersByEntityID.get(normalizeEntityID(entityID)) || null;
  return controller ? syncControllerSystemIndex(controller) : null;
}

function unregisterController(entityID) {
  const normalizedEntityID = normalizeEntityID(entityID);
  const existing = controllersByEntityID.get(normalizedEntityID) || null;
  if (!existing) {
    return null;
  }

  detachControllerFromIndexedSystem(existing);
  controllersByEntityID.delete(normalizedEntityID);
  return existing;
}

function listControllersBySystem(systemID) {
  const normalizedSystemID = normalizeSystemID(systemID);
  const bucket = getSystemBucket(normalizedSystemID);
  if (!bucket) {
    return [];
  }

  const controllers = [];
  for (const controller of [...bucket.values()]) {
    syncControllerSystemIndex(controller);
    if (normalizeSystemID(controller.systemID) === normalizedSystemID) {
      controllers.push(controller);
    }
  }

  return controllers.sort((left, right) => left.entityID - right.entityID);
}

function listControllers() {
  const controllers = [];
  for (const controller of controllersByEntityID.values()) {
    controllers.push(syncControllerSystemIndex(controller));
  }

  return controllers.sort(
    (left, right) =>
      normalizeSystemID(left.systemID) - normalizeSystemID(right.systemID) ||
      left.entityID - right.entityID,
  );
}

function clearControllers() {
  controllersByEntityID.clear();
  controllersBySystemID.clear();
}

module.exports = {
  registerController,
  getControllerByEntityID,
  unregisterController,
  listControllersBySystem,
  listControllers,
  clearControllers,
};
