/**
 * Access Group Store
 *
 * Simple access group (ownerGroup) system for ACL-based bookmarks.
 * Each group has a creator, members with membership types, and metadata.
 * Groups are stored in the `accessGroups` database table.
 *
 * Membership types (matching ownergroupConst.py):
 *   -1 = MEMBERSHIP_TYPE_NONE
 *    0 = MEMBERSHIP_TYPE_MEMBER
 *    1 = MEMBERSHIP_TYPE_MANAGER
 *    2 = MEMBERSHIP_TYPE_ADMIN
 *    3 = MEMBERSHIP_TYPE_EXCLUDED
 */

const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const database = require(path.join(__dirname, "../../newDatabase"));

const TABLE = "accessGroups";

// Membership type constants
const MEMBERSHIP_TYPE_NONE = -1;
const MEMBERSHIP_TYPE_MEMBER = 0;
const MEMBERSHIP_TYPE_MANAGER = 1;
const MEMBERSHIP_TYPE_ADMIN = 2;
const MEMBERSHIP_TYPE_EXCLUDED = 3;

// -----------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------

function readMeta() {
  const result = database.read(TABLE, "/_meta");
  if (result.success && result.data && typeof result.data === "object") {
    return { ...result.data };
  }
  return { nextGroupID: 1 };
}

function writeMeta(meta) {
  database.write(TABLE, "/_meta", meta);
}

function readGroup(groupID) {
  const result = database.read(TABLE, `/${groupID}`);
  if (result.success && result.data && typeof result.data === "object") {
    return { ...result.data };
  }
  return null;
}

function writeGroup(group) {
  database.write(TABLE, `/${group.groupID}`, group);
}

function deleteGroupFromDB(groupID) {
  database.remove(TABLE, `/${groupID}`);
}

function getAllGroups() {
  const result = database.read(TABLE, "/");
  if (!result.success || !result.data || typeof result.data !== "object") {
    return [];
  }
  return Object.entries(result.data)
    .filter(([key]) => key !== "_meta")
    .map(([, value]) => value)
    .filter((g) => g && typeof g === "object" && g.groupID);
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * Create a new access group.
 * @param {number} creatorID - The character or corp ID that creates the group
 * @param {string} name - Group name
 * @param {string} description - Group description
 * Returns the new group object.
 */
function createGroup(creatorID, name, description) {
  const meta = readMeta();
  const groupID = meta.nextGroupID;
  meta.nextGroupID = groupID + 1;
  writeMeta(meta);

  const group = {
    groupID,
    creatorID: Number(creatorID),
    name: String(name || ""),
    description: String(description || ""),
    // Members stored as array of {memberID, membershipType}
    // Creator is automatically an admin member
    members: [
      { memberID: Number(creatorID), membershipType: MEMBERSHIP_TYPE_ADMIN },
    ],
  };
  writeGroup(group);
  log.info(
    `[AccessGroupStore] Created group ${groupID} "${name}" creator=${creatorID}`,
  );
  return group;
}

/**
 * Get a group by ID. Returns null if not found.
 */
function getGroup(groupID) {
  return readGroup(Number(groupID));
}

/**
 * Get multiple groups by their IDs. Returns array of group objects.
 */
function getGroupsMany(groupIDs) {
  const result = [];
  for (const id of groupIDs) {
    const group = readGroup(Number(id));
    if (group) result.push(group);
  }
  return result;
}

/**
 * Get all groups owned by or containing the given character.
 * Returns array of group objects with the character's membershipType set.
 */
function getMyGroups(charID) {
  const numCharID = Number(charID);
  return getAllGroups()
    .filter((g) => {
      if (g.creatorID === numCharID) return true;
      if (Array.isArray(g.members)) {
        return g.members.some((m) => Number(m.memberID) === numCharID);
      }
      return false;
    })
    .map((g) => {
      // Attach the character's membership type to the group object
      const memberEntry = Array.isArray(g.members)
        ? g.members.find((m) => Number(m.memberID) === numCharID)
        : null;
      return {
        ...g,
        membershipType: memberEntry ? memberEntry.membershipType : MEMBERSHIP_TYPE_NONE,
      };
    });
}

/**
 * Get the members of a group.
 * Returns array of {memberID, membershipType}.
 */
function getMembers(groupID) {
  const group = readGroup(Number(groupID));
  if (!group || !Array.isArray(group.members)) return [];
  return group.members.map((m) => ({
    memberID: Number(m.memberID),
    membershipType: m.membershipType != null ? m.membershipType : MEMBERSHIP_TYPE_MEMBER,
  }));
}

/**
 * Get members for multiple groups.
 * Returns { groupID: [{memberID, membershipType}, ...], ... }
 */
function getMembersForMultipleGroups(groupIDs) {
  const result = {};
  for (const id of groupIDs) {
    result[id] = getMembers(id);
  }
  return result;
}

/**
 * Add members to a group.
 * @param {number} groupID
 * @param {Object} membershipTypeByMemberID - {memberID: membershipType, ...}
 * Returns array of [memberID, reason] for failures.
 */
function addMembers(groupID, membershipTypeByMemberID) {
  const group = readGroup(Number(groupID));
  if (!group) return [[0, "GROUP_NOT_FOUND"]];

  if (!Array.isArray(group.members)) group.members = [];
  const failed = [];

  for (const [memberID, membershipType] of Object.entries(membershipTypeByMemberID)) {
    const numMemberID = Number(memberID);
    const existing = group.members.find((m) => Number(m.memberID) === numMemberID);
    if (existing) {
      // Already a member, skip
      continue;
    }
    group.members.push({
      memberID: numMemberID,
      membershipType: membershipType != null ? Number(membershipType) : MEMBERSHIP_TYPE_MEMBER,
    });
  }

  writeGroup(group);
  log.info(
    `[AccessGroupStore] Added members to group=${groupID}: ${Object.keys(membershipTypeByMemberID).join(",")}`,
  );
  return failed;
}

/**
 * Remove members from a group.
 * @param {number} groupID
 * @param {Array} memberIDs - array of memberIDs to remove
 * Returns array of [memberID, reason] for failures.
 */
function deleteMembers(groupID, memberIDs) {
  const group = readGroup(Number(groupID));
  if (!group) return [[0, "GROUP_NOT_FOUND"]];

  if (!Array.isArray(group.members)) return [];
  const failed = [];
  const removeSet = new Set(memberIDs.map((id) => Number(id)));

  group.members = group.members.filter(
    (m) => !removeSet.has(Number(m.memberID)),
  );

  writeGroup(group);
  log.info(
    `[AccessGroupStore] Removed members from group=${groupID}: ${memberIDs.join(",")}`,
  );
  return failed;
}

/**
 * Update membership types for members.
 * @param {number} groupID
 * @param {Array} memberIDs
 * @param {number} newMembershipType
 * Returns array of [memberID, reason] for failures.
 */
function updateMembershipTypes(groupID, memberIDs, newMembershipType) {
  const group = readGroup(Number(groupID));
  if (!group) return [[0, "GROUP_NOT_FOUND"]];

  if (!Array.isArray(group.members)) return [];
  const failed = [];
  const updateSet = new Set(memberIDs.map((id) => Number(id)));

  for (const m of group.members) {
    if (updateSet.has(Number(m.memberID))) {
      m.membershipType = Number(newMembershipType);
    }
  }

  writeGroup(group);
  return failed;
}

/**
 * Update group name.
 */
function updateName(groupID, newName) {
  const group = readGroup(Number(groupID));
  if (!group) return false;
  group.name = String(newName || group.name);
  writeGroup(group);
  return true;
}

/**
 * Update group description.
 */
function updateDescription(groupID, newDescription) {
  const group = readGroup(Number(groupID));
  if (!group) return false;
  group.description = String(newDescription || "");
  writeGroup(group);
  return true;
}

/**
 * Check if a character is a member of a specific group.
 * Also returns true if the group contains PUBLIC_MEMBER_ID (0) = "everyone".
 */
function isMember(groupID, charID) {
  if (!groupID) return false;
  const group = readGroup(Number(groupID));
  if (!group || !Array.isArray(group.members)) return false;

  // Direct membership check
  if (group.members.some((m) => Number(m.memberID) === Number(charID))) {
    return true;
  }

  // PUBLIC_MEMBER_ID (0) = "everyone" — any character is a member
  // unless their membership type is EXCLUDED
  const publicEntry = group.members.find((m) => Number(m.memberID) === 0);
  if (publicEntry && publicEntry.membershipType !== MEMBERSHIP_TYPE_EXCLUDED) {
    return true;
  }

  return false;
}

/**
 * Remove a group entirely.
 */
function removeGroup(groupID) {
  deleteGroupFromDB(Number(groupID));
  log.info(`[AccessGroupStore] Deleted group=${groupID}`);
}

module.exports = {
  // Constants
  MEMBERSHIP_TYPE_NONE,
  MEMBERSHIP_TYPE_MEMBER,
  MEMBERSHIP_TYPE_MANAGER,
  MEMBERSHIP_TYPE_ADMIN,
  MEMBERSHIP_TYPE_EXCLUDED,
  // CRUD
  createGroup,
  getGroup,
  getGroupsMany,
  getMyGroups,
  getMembers,
  getMembersForMultipleGroups,
  addMembers,
  deleteMembers,
  updateMembershipTypes,
  updateName,
  updateDescription,
  isMember,
  removeGroup,
};
