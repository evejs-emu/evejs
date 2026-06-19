const protobuf = require("protobufjs");

function buildReprocessingGatewayProtoRoot() {
  const root = new protobuf.Root();

  root.define("eve.character").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );

  root.define("eve.station").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );

  root.define("eve.structure").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );

  root.define("eve.industry.reprocess.input_type").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );

  root.define("eve.industry.reprocess.output_type").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint64"),
    ),
  );

  root.define("eve.industry.reprocess.api").add(
    new protobuf.Type("Reprocessed")
      .add(
        new protobuf.Field("character", 1, "eve.character.Identifier"),
      )
      .add(
        new protobuf.Field("station", 2, "eve.station.Identifier"),
      )
      .add(
        new protobuf.Field("structure", 3, "eve.structure.Identifier"),
      )
      .add(
        new protobuf.Field(
          "input_type",
          4,
          "eve.industry.reprocess.input_type.Identifier",
        ),
      )
      .add(new protobuf.Field("quantity", 5, "uint32"))
      .add(
        new protobuf.Field(
          "outputs",
          6,
          "eve.industry.reprocess.api.Reprocessed.Output",
          "repeated",
        ),
      )
      .add(
        new protobuf.Type("Output")
          .add(
            new protobuf.Field(
              "output_type",
              1,
              "eve.industry.reprocess.output_type.Identifier",
            ),
          )
          .add(new protobuf.Field("quantity", 2, "uint32")),
      ),
  );

  return root;
}

module.exports = {
  buildReprocessingGatewayProtoRoot,
};
