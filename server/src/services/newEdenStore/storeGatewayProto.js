const protobuf = require("protobufjs");

function buildNewEdenStoreGatewayProtoRoot() {
  const root = new protobuf.Root();

  root.define("google.protobuf").add(
    new protobuf.Type("Timestamp")
      .add(new protobuf.Field("seconds", 1, "int64"))
      .add(new protobuf.Field("nanos", 2, "int32")),
  );

  root.define("eve_public.payment")
    .add(
      new protobuf.Type("Identifier").add(
        new protobuf.Field("sequential", 1, "uint32"),
      ),
    )
    .add(
      new protobuf.Enum("Method", {
        PM_UNSPECIFIED: 0,
        PM_CREDIT_CARD: 1,
        PM_DEBIT_CARD: 2,
        PM_STEAM_WALLET: 3,
        PM_PAYPAL: 4,
        PM_DIRECT_DEBIT: 5,
        PM_WEB_MONEY: 6,
        PM_PAYSAFECARD: 7,
        PM_YANDEX: 8,
        PM_SOFORT: 9,
        PM_IDEAL: 10,
        PM_TOKEN: 11,
        PM_ALIPAY: 101,
        PM_ALIPAY_QR: 102,
        PM_WECHAT: 103,
        PM_GIFT: 201,
        PM_CODE_REDEMPTION: 202,
        PM_IN_GAME_CURRENCY: 203,
        PM_RECRUITMENT_AWARD: 204,
        PM_MEET_AND_GREET: 205,
        PM_SURVEY_REWARD: 206,
        PM_STEAM: 301,
        PM_AMAZON: 302,
        PM_TWITCH: 305,
        PM_EPICSTORE: 306,
        PM_REWARD: 307,
      }),
    );

  root.define("eve_public.payment.token")
    .add(
      new protobuf.Type("Identifier").add(
        new protobuf.Field("sequential", 1, "uint32"),
      ),
    )
    .add(
      new protobuf.Type("Attributes")
        .add(
          new protobuf.Field(
            "credit_card",
            4,
            "eve_public.payment.token.Attributes.CreditCard",
          ),
        )
        .add(
          new protobuf.Field(
            "paypal",
            5,
            "eve_public.payment.token.Attributes.PayPal",
          ),
        )
        .add(
          new protobuf.Type("CreditCard")
            .add(new protobuf.Field("alias", 1, "string"))
            .add(new protobuf.Field("expiry", 2, "string")),
        )
        .add(
          new protobuf.Type("PayPal").add(
            new protobuf.Field("agreement_id", 1, "string"),
          ),
        ),
    );

  root.define("eve_public.payment.token.api")
    .add(
      new protobuf.Type("GetRequest").add(
        new protobuf.Field(
          "token",
          1,
          "eve_public.payment.token.Identifier",
        ),
      ),
    )
    .add(
      new protobuf.Type("GetResponse").add(
        new protobuf.Field(
          "token",
          1,
          "eve_public.payment.token.Attributes",
        ),
      ),
    )
    .add(new protobuf.Type("GetQuickPayRequest"))
    .add(
      new protobuf.Type("GetQuickPayResponse").add(
        new protobuf.Field(
          "tokens",
          1,
          "eve_public.payment.token.Identifier",
          "repeated",
        ),
      ),
    )
    .add(new protobuf.Type("DisableAllRequest"))
    .add(new protobuf.Type("DisableAllResponse"));

  root.define("eve_public.store.offer").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("store_offer", 1, "string"),
    ),
  );

  root.define("eve_public.character").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );
  root.define("eve_public.user").add(
    new protobuf.Type("Identifier").add(
      new protobuf.Field("sequential", 1, "uint32"),
    ),
  );
  root.define("eve_public").add(
    new protobuf.Type("IPAddress")
      .add(new protobuf.Field("ipv4", 1, "string"))
      .add(new protobuf.Field("ipv6", 2, "string")),
  );

  root.define("eve_public.payment.purchase")
    .add(
      new protobuf.Type("Cost")
        .add(new protobuf.Field("catalog_amount_in_cents", 1, "uint32"))
        .add(new protobuf.Field("tax_amount_in_cents", 2, "uint32"))
        .add(new protobuf.Field("total_amount_in_cents", 3, "uint32"))
        .add(new protobuf.Field("tax_rate_points", 4, "uint32"))
        .add(new protobuf.Field("currency", 5, "string")),
    )
    .add(
      new protobuf.Type("Order")
        .add(
          new protobuf.Field(
            "offer",
            1,
            "eve_public.store.offer.Identifier",
          ),
        )
        .add(new protobuf.Field("quantity", 2, "uint32"))
        .add(
          new protobuf.Field(
            "cost",
            3,
            "eve_public.payment.purchase.Cost",
          ),
        ),
    )
    .add(
      new protobuf.Type("Receipt")
        .add(
          new protobuf.Field(
            "order",
            1,
            "eve_public.payment.purchase.Order",
          ),
        )
        .add(
          new protobuf.Field(
            "payment_identifier",
            2,
            "eve_public.payment.Identifier",
          ),
        )
        .add(
          new protobuf.Field(
            "payment_method",
            3,
            "eve_public.payment.Method",
          ),
        )
        .add(new protobuf.Field("description", 4, "string"))
        .add(
          new protobuf.Field(
            "items",
            5,
            "eve_public.payment.purchase.Receipt.Item",
            "repeated",
          ),
        )
        .add(
          new protobuf.Type("Item")
            .add(new protobuf.Field("name", 1, "string"))
            .add(new protobuf.Field("quantity", 2, "uint32")),
        ),
    );

  root.define("eve_public.payment.purchase.api")
    .add(
      new protobuf.Type("TokenRequest")
        .add(
          new protobuf.Field(
            "order",
            1,
            "eve_public.payment.purchase.Order",
          ),
        )
        .add(
          new protobuf.Field(
            "token",
            2,
            "eve_public.payment.token.Identifier",
          ),
        )
        .add(
          new protobuf.Field("ip_address", 3, "eve_public.IPAddress"),
        ),
    )
    .add(
      new protobuf.Type("TokenResponse").add(
        new protobuf.Field(
          "receipt",
          1,
          "eve_public.payment.purchase.Receipt",
        ),
      ),
    )
    .add(
      new protobuf.Type("CostRequest")
        .add(new protobuf.Field("catalog_amount_in_cents", 1, "uint32"))
        .add(new protobuf.Field("currency", 2, "string"))
        .add(
          new protobuf.Field(
            "token",
            3,
            "eve_public.payment.token.Identifier",
          ),
        ),
    )
    .add(
      new protobuf.Type("CostResponse").add(
        new protobuf.Field(
          "cost",
          1,
          "eve_public.payment.purchase.Cost",
        ),
      ),
    );

  root.define("eve_public.plex").add(
    new protobuf.Type("Currency").add(
      new protobuf.Field("total_in_cents", 1, "uint64"),
    ),
  );

  root.define("eve_public.plex.vault.api")
    .add(
      new protobuf.Type("PurchaseRequest")
        .add(
          new protobuf.Field(
            "offer",
            1,
            "eve_public.store.offer.Identifier",
          ),
        )
        .add(new protobuf.Field("quantity", 2, "uint32"))
        .add(
          new protobuf.Field(
            "gift",
            3,
            "eve_public.plex.vault.api.PurchaseRequest.Gift",
          ),
        )
        .add(new protobuf.Field("not_gift", 4, "bool"))
        .add(
          new protobuf.Type("Gift")
            .add(
              new protobuf.Field("user", 1, "eve_public.user.Identifier"),
            )
            .add(new protobuf.Field("no_character", 2, "bool"))
            .add(
              new protobuf.Field(
                "character",
                3,
                "eve_public.character.Identifier",
              ),
            )
            .add(new protobuf.Field("message", 4, "string")),
        ),
    )
    .add(new protobuf.Type("PurchaseResponse"));

  return root;
}

module.exports = {
  buildNewEdenStoreGatewayProtoRoot,
};
