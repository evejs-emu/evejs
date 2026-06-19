const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDbRowset,
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  VOTECASE_STATUS_ALL,
  VOTECASE_STATUS_CLOSED,
  VOTECASE_STATUS_OPEN,
  activateSanctionedAction,
  canRunForCEO,
  canViewVotes,
  castVote,
  createVoteCase,
  getVoteCase,
  listSanctionedActions,
  listVoteCaseOptions,
  listVoteCasesByCorporation,
  listVotesByVoteCase,
} = require(path.join(__dirname, "./voteRuntimeState"));

const VOTE_CASE_HEADER = [
  "voteCaseID",
  "corporationID",
  "voteType",
  "voteCaseText",
  "description",
  "startDateTime",
  "endDateTime",
  "createdByCharacterID",
];
const VOTE_CASE_DBROW_COLUMNS = [
  ["voteCaseID", 0x03],
  ["corporationID", 0x03],
  ["voteType", 0x03],
  ["voteCaseText", 0x82],
  ["description", 0x82],
  ["startDateTime", 0x40],
  ["endDateTime", 0x40],
  ["createdByCharacterID", 0x03],
];
const MAX_CLOSED_VOTES_FETCHED = 20;
const VOTE_OPTION_HEADER = [
  "optionID",
  "optionText",
  "parameter",
  "parameter1",
  "parameter2",
  "votesFor",
];
const VOTE_HEADER = ["voteCaseID", "characterID", "optionID", "castDateTime", "voteWeight"];

function resolveCorporationID(args, session) {
  return (
    (args && args.length > 0 && Number(args[0])) ||
    (session && (session.corporationID || session.corpid)) ||
    0
  );
}

function buildVoteCaseRowset(voteCases = []) {
  return buildDbRowset(
    VOTE_CASE_DBROW_COLUMNS,
    voteCases.map((voteCase) =>
      [
        Number(voteCase.voteCaseID || 0),
        Number(voteCase.corporationID || 0),
        Number(voteCase.voteType || 0),
        voteCase.voteCaseText || "",
        voteCase.description || "",
        buildFiletimeLong(voteCase.startDateTime || 0),
        buildFiletimeLong(voteCase.endDateTime || 0),
        Number(voteCase.createdByCharacterID || 0),
      ],
    ),
  );
}

function buildVoteOptions(options = []) {
  return buildList(
    options.map((option) =>
      buildKeyVal([
        ["optionID", Number(option.optionID || 0)],
        ["optionText", option.optionText || ""],
        ["parameter", Number(option.parameter || 0)],
        ["parameter1", Number(option.parameter1 || 0)],
        ["parameter2", Number(option.parameter2 || 0)],
        ["votesFor", Number(option.votesFor || 0)],
      ]),
    ),
  );
}

function buildVotes(votes = []) {
  return buildList(
    votes.map((vote) =>
      buildKeyVal([
        ["voteCaseID", Number(vote.voteCaseID || 0)],
        ["characterID", Number(vote.characterID || 0)],
        ["optionID", Number(vote.optionID || 0)],
        ["castDateTime", buildFiletimeLong(vote.castDateTime || 0)],
        ["voteWeight", Number(vote.voteWeight || 0)],
      ]),
    ),
  );
}

function buildSanctionedAction(action) {
  return buildKeyVal([
    ["voteCaseID", Number(action.voteCaseID || 0)],
    ["voteType", Number(action.voteType || 0)],
    ["optionID", Number(action.optionID || 0)],
    ["parameter", Number(action.parameter || 0)],
    ["parameter1", Number(action.parameter1 || 0)],
    ["parameter2", Number(action.parameter2 || 0)],
    ["expires", buildFiletimeLong(action.expires || 0)],
    ["actedUpon", Number(action.actedUpon || 0)],
    ["inEffect", Number(action.inEffect || 0)],
    [
      "timeActedUpon",
      action.timeActedUpon ? buildFiletimeLong(action.timeActedUpon) : null,
    ],
    [
      "timeRescended",
      action.timeRescended ? buildFiletimeLong(action.timeRescended) : null,
    ],
  ]);
}

class VoteManagerService extends BaseService {
  constructor() {
    super("voteManager");
  }

  Handle_GetVoteCasesByCorporation(args, session) {
    const corporationID = resolveCorporationID(args, session);
    const requestedStatus =
      args && args.length > 1 ? Number(args[1]) || VOTECASE_STATUS_ALL : VOTECASE_STATUS_ALL;
    const allVoteCases = listVoteCasesByCorporation(corporationID);
    const nowFiletime = currentFileTime();
    const openVoteCases = allVoteCases.filter(
      (voteCase) => BigInt(String(voteCase.endDateTime || "0")) > nowFiletime,
    );
    const closedVoteCases = allVoteCases.filter(
      (voteCase) => !openVoteCases.some((openVoteCase) => openVoteCase.voteCaseID === voteCase.voteCaseID),
    ).slice(0, MAX_CLOSED_VOTES_FETCHED);

    const byStatus = buildDict([
      [VOTECASE_STATUS_OPEN, buildVoteCaseRowset(openVoteCases)],
      [VOTECASE_STATUS_CLOSED, buildVoteCaseRowset(closedVoteCases)],
    ]);
    if (requestedStatus === VOTECASE_STATUS_OPEN) {
      return buildDict([[VOTECASE_STATUS_OPEN, buildVoteCaseRowset(openVoteCases)]]);
    }
    if (requestedStatus === VOTECASE_STATUS_CLOSED) {
      return buildDict([[VOTECASE_STATUS_CLOSED, buildVoteCaseRowset(closedVoteCases)]]);
    }
    return byStatus;
  }

  Handle_GetVoteCase(args, session) {
    const corporationID = resolveCorporationID(args, session);
    const voteCaseID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const voteCase = getVoteCase(corporationID, voteCaseID);
    if (!voteCase) {
      return null;
    }
    return buildKeyVal([
      ["voteCaseID", Number(voteCase.voteCaseID || 0)],
      ["corporationID", Number(voteCase.corporationID || 0)],
      ["voteType", Number(voteCase.voteType || 0)],
      ["voteCaseText", voteCase.voteCaseText || ""],
      ["description", voteCase.description || ""],
      ["startDateTime", buildFiletimeLong(voteCase.startDateTime || 0)],
      ["endDateTime", buildFiletimeLong(voteCase.endDateTime || 0)],
      ["createdByCharacterID", Number(voteCase.createdByCharacterID || 0)],
    ]);
  }

  Handle_GetVoteCaseOptions(args, session) {
    const corporationID = resolveCorporationID(args, session);
    const voteCaseID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    return buildVoteOptions(listVoteCaseOptions(corporationID, voteCaseID));
  }

  Handle_GetVotes(args, session) {
    const voteCaseID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const corporationID =
      resolveCorporationID(
        [session && (session.corporationID || session.corpid)],
        session,
      ) || 0;
    const characterID =
      (session && (session.characterID || session.charid)) || 0;
    return buildVotes(
      listVotesByVoteCase(corporationID, voteCaseID).filter(
        (vote) => Number(vote.characterID) === Number(characterID),
      ),
    );
  }

  Handle_CanViewVotes(args, session) {
    const corporationID = resolveCorporationID(args, session);
    return canViewVotes(corporationID, session);
  }

  Handle_CanVote(args, session) {
    const corporationID = resolveCorporationID(args, session);
    return canViewVotes(corporationID, session);
  }

  Handle_CanRunForCEO(args, session) {
    const corporationID = resolveCorporationID([], session);
    return canRunForCEO(corporationID, session);
  }

  Handle_InsertVoteCase(args, session) {
    const characterID = (session && (session.characterID || session.charid)) || 0;
    const corporationID = resolveCorporationID([], session);
    const voteCaseText = args && args.length > 0 ? args[0] : "";
    const description = args && args.length > 1 ? args[1] : "";
    const voteType = args && args.length > 2 ? args[2] : 4;
    const options = args && args.length > 3 ? args[3] : [];
    const duration = args && args.length > 4 ? args[4] : 1;
    const voteCase = createVoteCase(
      corporationID,
      characterID,
      voteCaseText,
      description,
      voteType,
      Array.isArray(options) ? options : [],
      duration,
    );
    return voteCase ? Number(voteCase.voteCaseID || 0) : null;
  }

  Handle_InsertVote(args, session) {
    const corporationID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const voteCaseID = args && args.length > 1 ? Number(args[1]) || 0 : 0;
    const optionID = args && args.length > 2 ? Number(args[2]) || 0 : 0;
    return castVote(corporationID, voteCaseID, session, optionID).success ? null : null;
  }

  Handle_GetCorpSanctionedActions(args, session) {
    const corporationID = resolveCorporationID([], session);
    return buildDict(
      listSanctionedActions(corporationID).map((action) => [
        Number(action.voteCaseID || 0),
        buildSanctionedAction(action),
      ]),
    );
  }

  Handle_ActivateSanctionedAction(args, session) {
    const voteCaseID = args && args.length > 0 ? Number(args[0]) || 0 : 0;
    const corporationID = resolveCorporationID([], session);
    activateSanctionedAction(corporationID, voteCaseID);
    return null;
  }

  Handle_ActOnSanctionedAction(args, session) {
    return this.Handle_ActivateSanctionedAction(args, session);
  }
}

module.exports = VoteManagerService;
