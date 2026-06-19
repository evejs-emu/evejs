/**
 * EVE Marshal String Table
 *
 * Ported from EVEMarshalStringTable.cpp — a lookup table for commonly used
 * strings in the marshal protocol. The client and server both know this table,
 * so strings can be transmitted as a single-byte index instead of the full text.
 *
 * Indices are 1-based (index 1 = s_mStringTable[0]).
 */

const STRING_TABLE_ERROR = 0;

const stringTable = [
  "*corpid", // 1
  "*locationid", // 2
  "age", // 3
  "Asteroid", // 4
  "authentication", // 5
  "ballID", // 6
  "beyonce", // 7
  "bloodlineID", // 8
  "capacity", // 9
  "categoryID", // 10
  "character", // 11
  "characterID", // 12
  "characterName", // 13
  "characterType", // 14
  "charID", // 15
  "chatx", // 16
  "clientID", // 17
  "config", // 18
  "contraband", // 19
  "corporationDateTime", // 20
  "corporationID", // 21
  "createDateTime", // 22
  "customInfo", // 23
  "description", // 24
  "divisionID", // 25
  "DoDestinyUpdate", // 26
  "dogmaIM", // 27
  "EVE System", // 28
  "flag", // 29
  "foo.SlimItem", // 30
  "gangID", // 31
  "Gemini", // 32
  "gender", // 33
  "graphicID", // 34
  "groupID", // 35
  "header", // 36
  "idName", // 37
  "invbroker", // 38
  "itemID", // 39
  "items", // 40
  "jumps", // 41
  "line", // 42
  "lines", // 43
  "locationID", // 44
  "locationName", // 45
  "macho.CallReq", // 46
  "macho.CallRsp", // 47
  "macho.MachoAddress", // 48
  "macho.Notification", // 49
  "macho.SessionChangeNotification", // 50
  "modules", // 51
  "name", // 52
  "objectCaching", // 53
  "objectCaching.CachedObject", // 54
  "OnChatJoin", // 55
  "OnChatLeave", // 56
  "OnChatSpeak", // 57
  "OnGodmaShipEffect", // 58
  "OnItemChange", // 59
  "OnModuleAttributeChange", // 60
  "OnMultiEvent", // 61
  "orbitID", // 62
  "ownerID", // 63
  "ownerName", // 64
  "quantity", // 65
  "raceID", // 66
  "RowClass", // 67
  "securityStatus", // 68
  "Sentry Gun", // 69
  "sessionchange", // 70
  "singleton", // 71
  "skillEffect", // 72
  "squadronID", // 73
  "typeID", // 74
  "used", // 75
  "userID", // 76
  "util.CachedObject", // 77
  "util.IndexRowset", // 78
  "util.Moniker", // 79
  "util.Row", // 80
  "util.Rowset", // 81
  "*multicastID", // 82
  "AddBalls", // 83
  "AttackHit3", // 84
  "AttackHit3R", // 85
  "AttackHit4R", // 86
  "DoDestinyUpdates", // 87
  "GetLocationsEx", // 88
  "InvalidateCachedObjects", // 89
  "JoinChannel", // 90
  "LSC", // 91
  "LaunchMissile", // 92
  "LeaveChannel", // 93
  "OID+", // 94
  "OID-", // 95
  "OnAggressionChange", // 96
  "OnCharGangChange", // 97
  "OnCharNoLongerInStation", // 98
  "OnCharNowInStation", // 99
  "OnDamageMessage", // 100
  "OnDamageStateChange", // 101
  "OnEffectHit", // 102
  "OnGangDamageStateChange", // 103
  "OnLSC", // 104
  "OnSpecialFX", // 105
  "OnTarget", // 106
  "RemoveBalls", // 107
  "SendMessage", // 108
  "SetMaxSpeed", // 109
  "SetSpeedFraction", // 110
  "TerminalExplosion", // 111
  "address", // 112
  "alert", // 113
  "allianceID", // 114
  "allianceid", // 115
  "bid", // 116
  "bookmark", // 117
  "bounty", // 118
  "channel", // 119
  "charid", // 120
  "constellationid", // 121
  "corpID", // 122
  "corpid", // 123
  "corprole", // 124
  "damage", // 125
  "duration", // 126
  "effects.Laser", // 127
  "gangid", // 128
  "gangrole", // 129
  "hqID", // 130
  "issued", // 131
  "jit", // 132
  "languageID", // 133
  "locationid", // 134
  "machoVersion", // 135
  "marketProxy", // 136
  "minVolume", // 137
  "orderID", // 138
  "price", // 139
  "range", // 140
  "regionID", // 141
  "regionid", // 142
  "role", // 143
  "rolesAtAll", // 144
  "rolesAtBase", // 145
  "rolesAtHQ", // 146
  "rolesAtOther", // 147
  "shipid", // 148
  "sn", // 149
  "solarSystemID", // 150
  "solarsystemid", // 151
  "solarsystemid2", // 152
  "source", // 153
  "splash", // 154
  "stationID", // 155
  "stationid", // 156
  "target", // 157
  "userType", // 158
  "userid", // 159
  "volEntered", // 160
  "volRemaining", // 161
  "weapon", // 162
  "agent.missionTemplatizedContent_BasicKillMission", // 163
  "agent.missionTemplatizedContent_ResearchKillMission", // 164
  "agent.missionTemplatizedContent_StorylineKillMission", // 165
  "agent.missionTemplatizedContent_GenericStorylineKillMission", // 166
  "agent.missionTemplatizedContent_BasicCourierMission", // 167
  "agent.missionTemplatizedContent_ResearchCourierMission", // 168
  "agent.missionTemplatizedContent_StorylineCourierMission", // 169
  "agent.missionTemplatizedContent_GenericStorylineCourierMission", // 170
  "agent.missionTemplatizedContent_BasicTradeMission", // 171
  "agent.missionTemplatizedContent_ResearchTradeMission", // 172
  "agent.missionTemplatizedContent_StorylineTradeMission", // 173
  "agent.missionTemplatizedContent_GenericStorylineTradeMission", // 174
  "agent.offerTemplatizedContent_BasicExchangeOffer", // 175
  "agent.offerTemplatizedContent_BasicExchangeOffer_ContrabandDemand", // 176
  "agent.offerTemplatizedContent_BasicExchangeOffer_Crafting", // 177
  "agent.LoyaltyPoints", // 178
  "agent.ResearchPoints", // 179
  "agent.Credits", // 180
  "agent.Item", // 181
  "agent.Entity", // 182
  "agent.Objective", // 183
  "agent.FetchObjective", // 184
  "agent.EncounterObjective", // 185
  "agent.DungeonObjective", // 186
  "agent.TransportObjective", // 187
  "agent.Reward", // 188
  "agent.TimeBonusReward", // 189
  "agent.MissionReferral", // 190
  "agent.Location", // 191
  "agent.StandardMissionDetails", // 192
  "agent.OfferDetails", // 193
  "agent.ResearchMissionDetails", // 194
  "agent.StorylineMissionDetails", // 195
];

// Build reverse lookup: string → index (1-based)
const stringToIndex = new Map();
for (let i = 0; i < stringTable.length; i++) {
  // Only store first occurrence (some strings appear twice in the C++ source)
  if (!stringToIndex.has(stringTable[i])) {
    stringToIndex.set(stringTable[i], i + 1);
  }
}

/**
 * Look up a string's index in the table.
 * @param {string} str
 * @returns {number} 1-based index, or STRING_TABLE_ERROR (0) if not found
 */
function lookupIndex(str) {
  return stringToIndex.get(str) || STRING_TABLE_ERROR;
}

/**
 * Look up the string at a given 1-based index.
 * @param {number} index - 1-based index
 * @returns {string|null}
 */
function lookupString(index) {
  const idx = index - 1;
  if (idx >= 0 && idx < stringTable.length) {
    return stringTable[idx];
  }
  return null;
}

module.exports = {
  STRING_TABLE_ERROR,
  lookupIndex,
  lookupString,
  stringTable,
};
