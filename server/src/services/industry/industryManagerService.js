const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  buildJobPayload,
  parseIndustryRequest,
} = require(path.join(__dirname, "./industryPayloads"));
const {
  cancelIndustryJob,
  deliverIndustryJob,
  getJobByID,
  getJobCountsByInstaller,
  installIndustryJob,
  listJobsByOwner,
} = require(path.join(__dirname, "./industryRuntimeState"));

class IndustryManagerService extends BaseService {
  constructor() {
    super("industryManager");
  }

  Handle_GetJob(args) {
    const jobID = args && args.length > 0 ? args[0] : null;
    return buildJobPayload(getJobByID(jobID) || {});
  }

  Handle_GetJobsByOwner(args) {
    const ownerID = args && args.length > 0 ? args[0] : null;
    const includeCompleted = Boolean(args && args.length > 1 ? args[1] : false);
    return buildList(
      listJobsByOwner(ownerID, includeCompleted).map((job) => buildJobPayload(job)),
    );
  }

  Handle_InstallJob(args, session) {
    const request = parseIndustryRequest(args && args.length > 0 ? args[0] : null);
    const result = installIndustryJob(session, request);
    return result && result.data ? result.data.jobID : null;
  }

  Handle_CompleteJob(args, session) {
    const jobID = args && args.length > 0 ? args[0] : null;
    const result = deliverIndustryJob(session, jobID);
    return result && result.data ? buildJobPayload(result.data) : null;
  }

  Handle_CompleteManyJobs(args, session) {
    const jobs = Array.isArray(args && args[0]) ? args[0] : [];
    const delivered = [];
    for (const entry of jobs) {
      const jobID = Array.isArray(entry) ? entry[0] : null;
      const result = deliverIndustryJob(session, jobID);
      if (result && result.data) {
        delivered.push(buildJobPayload(result.data));
      }
    }
    return buildList(delivered);
  }

  Handle_CancelJob(args, session) {
    const jobID = args && args.length > 0 ? args[0] : null;
    const result = cancelIndustryJob(session, jobID);
    return result && result.data ? buildJobPayload(result.data) : null;
  }

  Handle_GetJobCounts(args, session) {
    const installerID = args && args.length > 0
      ? args[0]
      : session && (session.characterID || session.charid);
    return buildDict(
      Object.entries(
        getJobCountsByInstaller(installerID),
      ).map(([activityID, count]) => [Number(activityID) || 0, Number(count) || 0]),
    );
  }
}

module.exports = IndustryManagerService;
