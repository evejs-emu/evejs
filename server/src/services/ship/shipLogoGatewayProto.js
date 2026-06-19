const protobuf = require("protobufjs");

function buildShipLogoGatewayProtoRoot() {
  const root = new protobuf.Root();

  root.define("eve_public.ship").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );

  root.define("eve_public.cosmetic.ship.logo")
    .add(
      new protobuf.Type("Identifier")
        .add(
          new protobuf.Field("ship", 1, "eve_public.ship.Identifier"),
        )
        .add(new protobuf.Field("index", 2, "int32")),
    )
    .add(new protobuf.Type("Alliance"))
    .add(new protobuf.Type("Corporation"))
    .add(
      new protobuf.Type("Attributes")
        .add(
          new protobuf.OneOf("logo_type", ["alliance", "corporation"]),
        )
        .add(
          new protobuf.Field(
            "alliance",
            1,
            "eve_public.cosmetic.ship.logo.Alliance",
          ),
        )
        .add(
          new protobuf.Field(
            "corporation",
            2,
            "eve_public.cosmetic.ship.logo.Corporation",
          ),
        ),
    )
    .add(
      new protobuf.Type("ClearRequest").add(
        new protobuf.Field(
          "logo",
          1,
          "eve_public.cosmetic.ship.logo.Identifier",
        ),
      ),
    )
    .add(new protobuf.Type("ClearResponse"))
    .add(
      new protobuf.Type("DisplayRequest")
        .add(
          new protobuf.Field(
            "id",
            1,
            "eve_public.cosmetic.ship.logo.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "attr",
            2,
            "eve_public.cosmetic.ship.logo.Attributes",
          ),
        ),
    )
    .add(new protobuf.Type("DisplayResponse"));

  return root;
}

module.exports = {
  buildShipLogoGatewayProtoRoot,
};
