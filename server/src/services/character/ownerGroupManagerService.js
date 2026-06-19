const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  normalizeNumber,
  normalizeText,
  buildKeyVal,
  extractDictEntries,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const accessGroupStore = require(path.join(__dirname, "./accessGroupStore"));
const {
  buildBookmarkText,
} = require(path.join(__dirname, "../bookmark/bookmarkPayloads"));

/**
 * Owner Group Manager Service
 *
 * Access-group (ownerGroups) system used by the ACL bookmarks UI.
 * Method names match the client's expectations from accessGroupsController.py:
 *   Create, Delete, GetMyGroups, GetMembers, GetMembersForMultipleGroups,
 *   GetGroupsMany, GetGroup, AddMembers, DeleteMembers,
 *   UpdateMembershipTypes, UpdateName, UpdateDescription
 */

/**
 * Build a group KeyVal matching client expectations:
 *   groupID, creatorID, name, description, membershipType
 */
function buildGroupKeyVal(group) {
  // Compute admins list from members
  const admins = Array.isArray(group.members)
    ? group.members
        .filter((m) => m.membershipType === accessGroupStore.MEMBERSHIP_TYPE_ADMIN)
        .map((m) => m.memberID)
    : [];

  return buildKeyVal([
    ["groupID", group.groupID],
    ["creatorID", group.creatorID],
    ["name", buildBookmarkText(group.name, 100, "")],
    ["description", buildBookmarkText(group.description, 3900, "")],
    ["membershipType", group.membershipType != null ? group.membershipType : -1],
    ["admins", { type: "list", items: admins }],
  ]);
}

/**
 * Build a member KeyVal matching client expectations:
 *   memberID, membershipType
 */
function buildMemberKeyVal(member) {
  return buildKeyVal([
    ["memberID", member.memberID],
    ["membershipType", member.membershipType != null ? member.membershipType : 0],
  ]);
}

class OwnerGroupManagerService extends BaseService {
  constructor() {
    super("ownerGroupManager");
  }

  Handle_GetMyGroups(args, session) {
    const charID = session && session.characterID;
    log.debug(`[OwnerGroupManager] GetMyGroups char=${charID}`);

    const groups = accessGroupStore.getMyGroups(charID);
    return { type: "list", items: groups.map(buildGroupKeyVal) };
  }

  Handle_GetGroup(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    log.debug(`[OwnerGroupManager] GetGroup char=${charID} group=${groupID}`);

    const group = accessGroupStore.getGroup(groupID);
    if (!group) return null;

    // Compute membership type for the requesting character
    const members = Array.isArray(group.members) ? group.members : [];
    const memberEntry = members.find((m) => Number(m.memberID) === Number(charID));
    group.membershipType = memberEntry ? memberEntry.membershipType : -1;

    return buildGroupKeyVal(group);
  }

  Handle_GetMembers(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    log.debug(`[OwnerGroupManager] GetMembers char=${charID} group=${groupID}`);

    const members = accessGroupStore.getMembers(groupID);
    return { type: "list", items: members.map(buildMemberKeyVal) };
  }

  Handle_GetMembersForMultipleGroups(args, session) {
    const charID = session && session.characterID;
    const groupIDs = args && Array.isArray(args[0]) ? args[0] : [];
    log.debug(
      `[OwnerGroupManager] GetMembersForMultipleGroups char=${charID} groups=${JSON.stringify(groupIDs)}`,
    );

    const result = accessGroupStore.getMembersForMultipleGroups(groupIDs);
    const entries = Object.entries(result).map(([gid, members]) => [
      Number(gid),
      { type: "list", items: members.map(buildMemberKeyVal) },
    ]);
    return { type: "dict", entries };
  }

  Handle_GetGroupsMany(args, session) {
    const charID = session && session.characterID;
    const groupIDs = args && Array.isArray(args[0]) ? args[0] : [];
    log.debug(
      `[OwnerGroupManager] GetGroupsMany char=${charID} groups=${JSON.stringify(groupIDs)}`,
    );

    const groups = accessGroupStore.getGroupsMany(groupIDs);
    // Attach membershipType for requesting character
    const result = groups.map((g) => {
      const memberEntry = Array.isArray(g.members)
        ? g.members.find((m) => Number(m.memberID) === Number(charID))
        : null;
      return {
        ...g,
        membershipType: memberEntry ? memberEntry.membershipType : -1,
      };
    });

    return { type: "list", items: result.map(buildGroupKeyVal) };
  }

  Handle_GetPublicGroupInfo(args, session) {
    return this.Handle_GetGroup(args, session);
  }

  Handle_SearchGroups(args, session) {
    return this.Handle_GetMyGroups(args, session);
  }

  Handle_GetMyGroupsAndMembers(args, session) {
    const charID = session && session.characterID;
    const groups = accessGroupStore.getMyGroups(charID);
    const groupIDs = groups.map((group) => group.groupID);
    const membersByGroupID = this.Handle_GetMembersForMultipleGroups([groupIDs], session);
    return {
      groups: { type: "list", items: groups.map(buildGroupKeyVal) },
      membersByGroupID,
    };
  }

  Handle_GetMyGroupsToUseForBookmarks(args, session) {
    return this.Handle_GetMyGroups(args, session);
  }

  // Client calls: remoteSvc.Create(name, description)
  Handle_Create(args, session) {
    const charID = session && session.characterID;
    const name = normalizeText(args && args[0], "New Group");
    const description = normalizeText(args && args[1], "");
    log.info(`[OwnerGroupManager] Create char=${charID} name="${name}"`);

    const group = accessGroupStore.createGroup(charID, name, description);
    return buildGroupKeyVal({
      ...group,
      membershipType: accessGroupStore.MEMBERSHIP_TYPE_ADMIN,
    });
  }

  // Client calls: remoteSvc.Delete(groupID)
  Handle_Delete(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    log.info(`[OwnerGroupManager] Delete char=${charID} group=${groupID}`);

    accessGroupStore.removeGroup(groupID);
    return null;
  }

  Handle_CreateGroup(args, session) {
    return this.Handle_Create(args, session);
  }

  Handle_DeleteGroup(args, session) {
    this.Handle_Delete(args, session);
    return true;
  }

  // Client calls: remoteSvc.UpdateName(groupID, newName)
  Handle_UpdateName(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    const newName = normalizeText(args && args[1], "");
    log.info(`[OwnerGroupManager] UpdateName char=${charID} group=${groupID} name="${newName}"`);

    accessGroupStore.updateName(groupID, newName);
    return null;
  }

  // Client calls: remoteSvc.UpdateDescription(groupID, newDesc)
  Handle_UpdateDescription(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    const newDesc = normalizeText(args && args[1], "");
    log.info(`[OwnerGroupManager] UpdateDescription char=${charID} group=${groupID}`);

    accessGroupStore.updateDescription(groupID, newDesc);
    return null;
  }

  // Client calls: remoteSvc.AddMembers(groupID, {memberID: membershipType, ...})
  // Returns list of [memberID, reason] failures
  Handle_AddMembers(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    // args[1] is a dict {memberID: membershipType}
    const raw = args && args[1];
    const membershipDict = {};

    if (raw && typeof raw === "object") {
      if (raw.type === "dict" && Array.isArray(raw.entries)) {
        for (const [key, val] of raw.entries) {
          membershipDict[Number(key)] = Number(val);
        }
      } else if (Array.isArray(raw)) {
        // fallback: array of [memberID, membershipType]
        for (const entry of raw) {
          if (Array.isArray(entry) && entry.length >= 2) {
            membershipDict[Number(entry[0])] = Number(entry[1]);
          }
        }
      } else {
        // Plain JS object
        for (const [key, val] of Object.entries(raw)) {
          membershipDict[Number(key)] = Number(val);
        }
      }
    }

    log.info(
      `[OwnerGroupManager] AddMembers char=${charID} group=${groupID} members=${JSON.stringify(membershipDict)}`,
    );

    const failed = accessGroupStore.addMembers(groupID, membershipDict);
    return { type: "list", items: failed };
  }

  // Client calls: remoteSvc.DeleteMembers(groupID, memberIDsList)
  // Returns list of [memberID, reason] failures
  Handle_DeleteMembers(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    const memberIDs = args && Array.isArray(args[1]) ? args[1].map(Number) : [];
    log.info(
      `[OwnerGroupManager] DeleteMembers char=${charID} group=${groupID} members=${JSON.stringify(memberIDs)}`,
    );

    const failed = accessGroupStore.deleteMembers(groupID, memberIDs);
    return { type: "list", items: failed };
  }

  Handle_RemoveMembers(args, session) {
    return this.Handle_DeleteMembers(args, session);
  }

  // Client calls: remoteSvc.UpdateMembershipTypes(groupID, memberIDs, membershipType)
  // Returns list of [memberID, reason] failures
  Handle_UpdateMembershipTypes(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    const memberIDs = args && Array.isArray(args[1]) ? args[1].map(Number) : [];
    const membershipType = normalizeNumber(args && args[2], 0);
    log.info(
      `[OwnerGroupManager] UpdateMembershipTypes char=${charID} group=${groupID} members=${JSON.stringify(memberIDs)} type=${membershipType}`,
    );

    const failed = accessGroupStore.updateMembershipTypes(groupID, memberIDs, membershipType);
    return { type: "list", items: failed };
  }

  Handle_UpdateMemberships(args) {
    return Array.isArray(args && args[0]) ? args[0] : [];
  }

  // Client calls: remoteSvc.GetGroupLogs(groupID)
  Handle_GetGroupLogs(args, session) {
    const charID = session && session.characterID;
    const groupID = normalizeNumber(args && args[0], 0);
    log.debug(`[OwnerGroupManager] GetGroupLogs char=${charID} group=${groupID}`);
    return { type: "list", items: [] };
  }
}

module.exports = OwnerGroupManagerService;
