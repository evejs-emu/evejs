const protobuf = require("protobufjs");

let cachedRoot = null;

function buildCorpGoalsProtoRoot() {
  if (cachedRoot) {
    return cachedRoot;
  }

  const root = new protobuf.Root();

  root.define("google.protobuf").add(
    new protobuf.Type("Timestamp")
      .add(new protobuf.Field("seconds", 1, "int64"))
      .add(new protobuf.Field("nanos", 2, "int32")),
  );

  root.define("eve_public")
    .add(
      new protobuf.Type("Page")
        .add(new protobuf.Field("size", 1, "uint32"))
        .add(new protobuf.Field("token", 2, "string")),
    )
    .add(
      new protobuf.Type("NextPage").add(new protobuf.Field("token", 1, "string")),
    );

  root.define("eve_public.character").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );

  root.define("eve_public.corporation").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );

  root.define("eve_public.isk").add(
    new protobuf.Type("Currency")
      .add(new protobuf.Field("units", 1, "uint64"))
      .add(new protobuf.Field("nanos", 2, "int32")),
  );

  root.define("eve_public.assetholding.asset").add(
    new protobuf.Type("Identifier").add(new protobuf.Field("uuid", 1, "bytes")),
  );

  root.define("eve_public.goal")
    .add(
      new protobuf.Type("Identifier").add(new protobuf.Field("uuid", 1, "bytes")),
    )
    .add(
      new protobuf.Type("Progress")
        .add(new protobuf.Field("desired", 1, "uint64"))
        .add(new protobuf.Field("current", 2, "uint64")),
    )
    .add(
      new protobuf.Type("InterStellarKredits").add(
        new protobuf.Field("amount", 1, "eve_public.isk.Currency"),
      ),
    )
    .add(
      new protobuf.Type("Capacity")
        .add(new protobuf.Field("original", 1, "uint64"))
        .add(new protobuf.Field("remaining", 2, "uint64")),
    )
    .add(
      new protobuf.Type("Organization")
        .add(new protobuf.OneOf("identifier_and_type", ["corporation", "character"]))
        .add(
          new protobuf.Field(
            "corporation",
            1,
            "eve_public.corporation.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "character",
            2,
            "eve_public.character.Identifier",
          ),
        ),
    )
    .add(
      new protobuf.Type("Payment")
        .add(
          new protobuf.Field(
            "asset",
            1,
            "eve_public.assetholding.asset.Identifier",
          ),
        )
        .add(new protobuf.Field("period", 2, "uint32"))
        .add(new protobuf.Field("benefactor", 5, "eve_public.goal.Organization"))
        .add(new protobuf.Field("capacity", 6, "eve_public.goal.Capacity"))
        .add(new protobuf.Field("unit", 7, "eve_public.goal.InterStellarKredits")),
    )
    .add(
      new protobuf.Type("RewardPool")
        .add(new protobuf.Field("period", 1, "uint32"))
        .add(new protobuf.Field("isk", 2, "eve_public.goal.InterStellarKredits")),
    )
    .add(
      new protobuf.Type("Quantity")
        .add(new protobuf.Field("total", 1, "uint64"))
        .add(new protobuf.Field("redeemed", 2, "uint64")),
    )
    .add(
      new protobuf.Type("Earning").add(
        new protobuf.Field("quantity", 1, "eve_public.goal.Quantity"),
      ),
    )
    .add(
      new protobuf.Type("ContributorSummary")
        .add(
          new protobuf.Field(
            "contributor",
            1,
            "eve_public.character.Identifier",
          ),
        )
        .add(new protobuf.Field("progress", 2, "uint64"))
        .add(new protobuf.Field("goal", 3, "eve_public.goal.Identifier"))
        .add(
          new protobuf.Field("earnings", 4, "eve_public.goal.Earning", "repeated"),
        ),
    )
    .add(
      new protobuf.Type("Attributes")
        .add(new protobuf.Field("created", 1, "google.protobuf.Timestamp"))
        .add(
          new protobuf.Field(
            "user_input_name",
            2,
            "string",
          ),
        )
        .add(
          new protobuf.Field(
            "user_input_description",
            3,
            "string",
          ),
        )
        .add(
          new protobuf.Field(
            "creator",
            4,
            "eve_public.character.Identifier",
          ),
        )
        .add(new protobuf.Field("progress", 5, "eve_public.goal.Progress"))
        .add(new protobuf.Field("state", 6, "uint32"))
        .add(new protobuf.Field("contribution_config", 7, "bytes"))
        .add(new protobuf.OneOf("finish_time", ["not_finished", "finished"]))
        .add(new protobuf.Field("not_finished", 10, "bool"))
        .add(new protobuf.Field("finished", 11, "google.protobuf.Timestamp"))
        .add(new protobuf.Field("career", 12, "uint32"))
        .add(
          new protobuf.Field("payment", 13, "eve_public.goal.Payment", "repeated"),
        )
        .add(new protobuf.OneOf("due_timestamp", ["no_due_timestamp", "due"]))
        .add(new protobuf.Field("no_due_timestamp", 14, "bool"))
        .add(new protobuf.Field("due", 15, "google.protobuf.Timestamp"))
        .add(new protobuf.Field("assigner", 19, "eve_public.goal.Organization"))
        .add(new protobuf.Field("assignee", 20, "eve_public.goal.Organization"))
        .add(new protobuf.OneOf("participation", ["unlimited", "limit"]))
        .add(new protobuf.Field("unlimited", 23, "bool"))
        .add(new protobuf.Field("limit", 24, "uint64"))
        .add(
          new protobuf.OneOf("coverage", [
            "contribution_unlimited",
            "contribution_limit",
          ]),
        )
        .add(new protobuf.Field("contribution_unlimited", 25, "bool"))
        .add(new protobuf.Field("contribution_limit", 26, "uint64"))
        .add(new protobuf.OneOf("multiplier", ["default", "scalar"]))
        .add(new protobuf.Field("default", 27, "bool"))
        .add(new protobuf.Field("scalar", 28, "double")),
    );

  root.define("eve_public.goal.api")
    .add(
      new protobuf.Type("CreateRequest")
        .add(new protobuf.Field("name", 1, "string"))
        .add(new protobuf.Field("description", 2, "string"))
        .add(new protobuf.Field("desired_progress", 3, "uint64"))
        .add(new protobuf.Field("contribution_configuration", 4, "bytes"))
        .add(new protobuf.Field("career", 6, "uint32"))
        .add(
          new protobuf.Field("reward_pools", 8, "eve_public.goal.RewardPool", "repeated"),
        )
        .add(new protobuf.OneOf("expiry", ["no_expiry", "timestamp"]))
        .add(new protobuf.Field("no_expiry", 9, "bool"))
        .add(new protobuf.Field("timestamp", 10, "google.protobuf.Timestamp"))
        .add(new protobuf.OneOf("participation", ["unlimited", "limit"]))
        .add(new protobuf.Field("unlimited", 11, "bool"))
        .add(new protobuf.Field("limit", 12, "uint64"))
        .add(
          new protobuf.OneOf("coverage", [
            "contribution_unlimited",
            "contribution_limit",
          ]),
        )
        .add(new protobuf.Field("contribution_unlimited", 25, "bool"))
        .add(new protobuf.Field("contribution_limit", 26, "uint64"))
        .add(new protobuf.OneOf("multiplier", ["default", "scalar"]))
        .add(new protobuf.Field("default", 27, "bool"))
        .add(new protobuf.Field("scalar", 28, "double")),
    )
    .add(
      new protobuf.Type("CreateResponse").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Identifier"),
      ),
    )
    .add(
      new protobuf.Type("GetRequest").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Identifier"),
      ),
    )
    .add(
      new protobuf.Type("GetResponse").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Attributes"),
      ),
    )
    .add(
      new protobuf.Type("GetAllRequest")
        .add(new protobuf.OneOf("state_filter", ["show_all_states", "show_only_state"]))
        .add(new protobuf.Field("show_all_states", 1, "bool"))
        .add(new protobuf.Field("show_only_state", 2, "uint32")),
    )
    .add(
      new protobuf.Type("GetAllResponse.Goal")
        .add(new protobuf.Field("id", 1, "eve_public.goal.Identifier"))
        .add(new protobuf.Field("goal", 2, "eve_public.goal.Attributes")),
    )
    .add(
      new protobuf.Type("GetAllResponse").add(
        new protobuf.Field("goals", 3, "eve_public.goal.api.GetAllResponse.Goal", "repeated"),
      ),
    )
    .add(
      new protobuf.Type("CloseRequest").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Identifier"),
      ),
    )
    .add(new protobuf.Type("CloseResponse"))
    .add(
      new protobuf.Type("SetCurrentProgressRequest")
        .add(new protobuf.Field("goal", 1, "eve_public.goal.Identifier"))
        .add(new protobuf.Field("current_progress", 2, "uint64"))
        .add(new protobuf.Field("new_progress", 3, "uint64")),
    )
    .add(new protobuf.Type("SetCurrentProgressResponse"))
    .add(
      new protobuf.Type("DeleteRequest").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Identifier"),
      ),
    )
    .add(new protobuf.Type("DeleteResponse"))
    .add(new protobuf.Type("GetCapacityRequest"))
    .add(
      new protobuf.Type("GetCapacityResponse")
        .add(new protobuf.Field("count", 1, "uint32"))
        .add(new protobuf.Field("capacity", 2, "uint32")),
    )
    .add(
      new protobuf.Type("CreatedNotice")
        .add(new protobuf.Field("id", 1, "eve_public.goal.Identifier"))
        .add(new protobuf.Field("goal", 2, "eve_public.goal.Attributes")),
    )
    .add(
      new protobuf.Type("DeletedNotice").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Identifier"),
      ),
    )
    .add(
      new protobuf.Type("ClosedNotice")
        .add(new protobuf.Field("goal", 1, "eve_public.goal.Identifier"))
        .add(
          new protobuf.Field(
            "closer",
            2,
            "eve_public.character.Identifier",
          ),
        ),
    )
    .add(
      new protobuf.Type("CompletedNotice").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Identifier"),
      ),
    )
    .add(
      new protobuf.Type("ProgressedNotice")
        .add(new protobuf.Field("goal", 1, "eve_public.goal.Identifier"))
        .add(new protobuf.Field("current_progress", 2, "uint64")),
    );

  root.define("eve_public.goal.contribution.api").add(
    new protobuf.Type("ContributedNotice")
      .add(new protobuf.Field("timestamp", 1, "google.protobuf.Timestamp"))
      .add(
        new protobuf.Field("contributor", 2, "eve_public.character.Identifier"),
      )
      .add(new protobuf.Field("goal", 3, "eve_public.goal.Identifier"))
      .add(new protobuf.Field("previous_progress", 4, "uint64"))
      .add(new protobuf.Field("current_progress", 5, "uint64")),
  );

  root.define("eve_public.corporationgoal.api")
    .add(new protobuf.Type("GetAllRequest"))
    .add(
      new protobuf.Type("GetAllResponse").add(
        new protobuf.Field("goal_ids", 1, "eve_public.goal.Identifier", "repeated"),
      ),
    )
    .add(
      new protobuf.Type("GetActiveRequest").add(
        new protobuf.Field("page", 1, "eve_public.Page"),
      ),
    )
    .add(
      new protobuf.Type("GetActiveResponse")
        .add(
          new protobuf.Field("goal_ids", 1, "eve_public.goal.Identifier", "repeated"),
        )
        .add(new protobuf.Field("next_page", 2, "eve_public.NextPage")),
    )
    .add(
      new protobuf.Type("Timespan")
        .add(new protobuf.Field("start_time", 1, "google.protobuf.Timestamp"))
        .add(new protobuf.Field("duration", 2, "bytes")),
    )
    .add(
      new protobuf.Type("GetInactiveRequest")
        .add(new protobuf.Field("ended_timespan", 1, "eve_public.corporationgoal.api.Timespan"))
        .add(new protobuf.Field("page", 2, "eve_public.Page")),
    )
    .add(
      new protobuf.Type("GetInactiveResponse")
        .add(
          new protobuf.Field("goal_ids", 1, "eve_public.goal.Identifier", "repeated"),
        )
        .add(new protobuf.Field("next_page", 2, "eve_public.NextPage")),
    )
    .add(
      new protobuf.Type("GetContributorSummariesForGoalRequest")
        .add(new protobuf.Field("goal", 1, "eve_public.goal.Identifier"))
        .add(new protobuf.Field("page", 2, "eve_public.Page")),
    )
    .add(
      new protobuf.Type("GetContributorSummariesForGoalResponse")
        .add(
          new protobuf.Field(
            "summaries",
            1,
            "eve_public.goal.ContributorSummary",
            "repeated",
          ),
        )
        .add(new protobuf.Field("next_page", 2, "eve_public.NextPage")),
    )
    .add(
      new protobuf.Type("GetMyContributorSummaryForGoalRequest").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Identifier"),
      ),
    )
    .add(
      new protobuf.Type("GetMyContributorSummaryForGoalResponse").add(
        new protobuf.Field("summary", 1, "eve_public.goal.ContributorSummary"),
      ),
    )
    .add(
      new protobuf.Type("GetMyContributorSummariesRequest")
        .add(new protobuf.Field("page", 1, "eve_public.Page"))
        .add(
          new protobuf.Field("contributed_timespan", 2, "eve_public.corporationgoal.api.Timespan"),
        ),
    )
    .add(
      new protobuf.Type("GetMyContributorSummariesResponse")
        .add(
          new protobuf.Field(
            "summaries",
            1,
            "eve_public.goal.ContributorSummary",
            "repeated",
          ),
        )
        .add(new protobuf.Field("next_page", 2, "eve_public.NextPage")),
    )
    .add(
      new protobuf.Type("RedeemMyRewardsRequest").add(
        new protobuf.Field("goal_id", 1, "eve_public.goal.Identifier"),
      ),
    )
    .add(new protobuf.Type("RedeemMyRewardsResponse"))
    .add(new protobuf.Type("RedeemAllMyRewardsRequest"))
    .add(new protobuf.Type("RedeemAllMyRewardsResponse"))
    .add(
      new protobuf.Type("GetMineWithRewardsRequest").add(
        new protobuf.Field("page", 1, "eve_public.Page"),
      ),
    )
    .add(
      new protobuf.Type("GetMineWithRewardsResponse")
        .add(
          new protobuf.Field("identifiers", 1, "eve_public.goal.Identifier", "repeated"),
        )
        .add(new protobuf.Field("next_page", 2, "eve_public.NextPage")),
    )
    .add(
      new protobuf.Type("RewardEarnedNotice")
        .add(new protobuf.Field("goal", 1, "eve_public.goal.Identifier"))
        .add(new protobuf.Field("quantity", 2, "uint64")),
    )
    .add(
      new protobuf.Type("RedeemedNotice")
        .add(new protobuf.Field("goal", 1, "eve_public.goal.Identifier"))
        .add(new protobuf.Field("quantity", 2, "uint64")),
    )
    .add(
      new protobuf.Type("ExpiredNotice").add(
        new protobuf.Field("goal", 1, "eve_public.goal.Identifier"),
      ),
    );

  cachedRoot = root;
  return root;
}

module.exports = {
  buildCorpGoalsProtoRoot,
};
