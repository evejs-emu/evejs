const protobuf = require("protobufjs");

function buildEvermarksGatewayProtoRoot() {
  const root = new protobuf.Root();

  root.define("eve_public.character").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );

  root.define("eve_public.shiptype").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );

  root.define("eve_public.entitlement.character.ship.corplogo")
    .add(
      new protobuf.Type("Identifier")
        .add(
          new protobuf.Field(
            "character",
            1,
            "eve_public.character.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "ship_type",
            2,
            "eve_public.shiptype.Identifier",
          ),
        ),
    )
    .add(
      new protobuf.Type("GrantedNotice").add(
        new protobuf.Field(
          "entitlement",
          1,
          "eve_public.entitlement.character.ship.corplogo.Identifier",
        ),
      ),
    )
    .add(
      new protobuf.Type("RevokedNotice")
        .add(
          new protobuf.Field(
            "revoker",
            1,
            "eve_public.character.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "entitlement",
            2,
            "eve_public.entitlement.character.ship.corplogo.Identifier",
          ),
        ),
    );

  root.define("eve_public.entitlement.character.ship.alliancelogo")
    .add(
      new protobuf.Type("Identifier")
        .add(
          new protobuf.Field(
            "character",
            1,
            "eve_public.character.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "ship_type",
            2,
            "eve_public.shiptype.Identifier",
          ),
        ),
    )
    .add(
      new protobuf.Type("GrantedNotice").add(
        new protobuf.Field(
          "entitlement",
          1,
          "eve_public.entitlement.character.ship.alliancelogo.Identifier",
        ),
      ),
    )
    .add(
      new protobuf.Type("RevokedNotice")
        .add(
          new protobuf.Field(
            "revoker",
            1,
            "eve_public.character.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "entitlement",
            2,
            "eve_public.entitlement.character.ship.alliancelogo.Identifier",
          ),
        ),
    );

  root.define("eve_public.entitlement.character")
    .add(new protobuf.Type("GetAllRequest"))
    .add(
      new protobuf.Type("GetAllResponse")
        .add(
          new protobuf.Field(
            "entitlements",
            1,
            "eve_public.entitlement.character.GetAllResponse.Entitlement",
            "repeated",
          ),
        )
        .add(
          new protobuf.Type("Entitlement")
            .add(
              new protobuf.Field(
                "corporation_logo",
                1,
                "eve_public.entitlement.character.ship.corplogo.Identifier",
              ),
            )
            .add(
              new protobuf.Field(
                "alliance_logo",
                2,
                "eve_public.entitlement.character.ship.alliancelogo.Identifier",
              ),
            ),
        ),
    );

  root.define("eve_public.entitlement.character.ship.admin.corplogo")
    .add(
      new protobuf.Type("GrantRequest").add(
        new protobuf.Field(
          "entitlement",
          1,
          "eve_public.entitlement.character.ship.corplogo.Identifier",
        ),
      ),
    )
    .add(new protobuf.Type("GrantResponse"))
    .add(
      new protobuf.Type("RevokeRequest").add(
        new protobuf.Field(
          "entitlement",
          1,
          "eve_public.entitlement.character.ship.corplogo.Identifier",
        ),
      ),
    )
    .add(new protobuf.Type("RevokeResponse"));

  root.define("eve_public.entitlement.character.ship.admin.alliancelogo")
    .add(
      new protobuf.Type("GrantRequest").add(
        new protobuf.Field(
          "entitlement",
          1,
          "eve_public.entitlement.character.ship.alliancelogo.Identifier",
        ),
      ),
    )
    .add(new protobuf.Type("GrantResponse"))
    .add(
      new protobuf.Type("RevokeRequest").add(
        new protobuf.Field(
          "entitlement",
          1,
          "eve_public.entitlement.character.ship.alliancelogo.Identifier",
        ),
      ),
    )
    .add(new protobuf.Type("RevokeResponse"));

  return root;
}

module.exports = {
  buildEvermarksGatewayProtoRoot,
};
