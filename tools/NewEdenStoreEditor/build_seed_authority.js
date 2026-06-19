const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const authorityPath = path.join(
  repoRoot,
  "server/src/newDatabase/data/newEdenStore/data.json",
);
const itemTypesPath = path.join(
  repoRoot,
  "server/src/newDatabase/data/itemTypes/data.json",
);
const itemIconsPath = path.join(
  repoRoot,
  "server/src/newDatabase/data/itemIcons/data.json",
);

const OMEGA_IMAGE_URL = "res:/UI/Texture/classes/PlexVault/UpgradeOmega.png";
const MCT_IMAGE_URL = "res:/UI/Texture/Icons/multiple_training.png";
const GENERIC_SHIP_IMAGE_URL =
  "res:/UI/Texture/Classes/Skills/skillGroups/spaceshipCmd.png";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return readJson(filePath);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPreview(theme, title, subtitle) {
  return {
    imageMode: "generated",
    accent: theme.accent,
    secondary: theme.secondary,
    foreground: theme.foreground,
    badge: theme.badge,
    title,
    subtitle,
  };
}

function buildSeedAuthority() {
  const existingAuthority = readJson(authorityPath);
  const itemTypes = readJson(itemTypesPath).types || [];
  const itemIcons = readJsonIfExists(itemIconsPath, {});
  const iconsByID = itemIcons.iconsByID || {};
  const itemTypesByName = new Map(
    itemTypes.map((entry) => [String((entry && entry.name) || ""), entry]),
  );
  const itemTypesByID = new Map(
    itemTypes
      .filter((entry) => Number.isInteger(Number(entry && entry.typeID)))
      .map((entry) => [Number(entry.typeID), entry]),
  );

  function requireType(typeName) {
    const match = itemTypesByName.get(typeName);
    if (!match) {
      throw new Error(`Missing required type in itemTypes cache: ${typeName}`);
    }
    return {
      typeID: Number(match.typeID),
      name: String(match.name),
      iconID: match.iconID == null ? null : Number(match.iconID),
      groupID: match.groupID == null ? null : Number(match.groupID),
      categoryID: match.categoryID == null ? null : Number(match.categoryID),
    };
  }

  const typeRefs = {
    plex: requireType("PLEX"),
    resculpt: requireType("Pilot's Body Resculpt Certificate"),
    skillExtractor: requireType("Skill Extractor"),
    dailyAlphaInjector: requireType("Daily Alpha Injector"),
    explorerCareerCrate: requireType("Explorer Career Crate"),
    historicSoeSkinsCrate: requireType("Historic SOE SKINs Crate"),
    historicGallenteSkinsCrate: requireType("Historic Gallente SKINs Crate"),
    frostlineExplorationSuit: requireType("Men's & Women's Frostline Exploration Suit"),
    mensAscendBoots: requireType("Men's 'Ascend' Boots (white/gold)"),
    womensAvenueShirt: requireType("Women's 'Avenue' Shirt (black)"),
    sunesis: requireType("Sunesis"),
    drake: requireType("Drake"),
    sunesisSkin: requireType("Sunesis Capsuleer Day XXI SKIN"),
    pacifierSkin: requireType("Pacifier Aurora Universalis SKIN"),
    advancedBoost: requireType("Advanced 'Boost' Cerebral Accelerator"),
    standardBoost: requireType("Standard 'Boost' Cerebral Accelerator"),
    expertBoost: requireType("Expert 'Boost' Cerebral Accelerator"),
    geniusBoost: requireType("Genius 'Boost' Cerebral Accelerator"),
    basicGlamourex: requireType("Basic Glamourex Booster"),
    agencySupportDrop: requireType("Agency Support Drop"),
  };

  function resolveTypeImageUrl(typeID) {
    const match = itemTypesByID.get(Number(typeID));
    if (!match) {
      return null;
    }

    const iconID = Number.isInteger(Number(match.iconID))
      ? Number(match.iconID)
      : null;
    if (iconID !== null) {
      const iconFile = iconsByID[String(iconID)];
      if (typeof iconFile === "string" && iconFile.trim() !== "") {
        return iconFile.trim();
      }
    }

    if (Number(match.categoryID) === 6) {
      return GENERIC_SHIP_IMAGE_URL;
    }

    return null;
  }

  function resolveImageUrlFromFulfillment(fulfillment) {
    if (!fulfillment || typeof fulfillment !== "object") {
      return null;
    }

    const kind = String(fulfillment.kind || "").trim();
    if (kind === "item") {
      return resolveTypeImageUrl(fulfillment.typeID);
    }
    if (kind === "grant_plex") {
      return resolveTypeImageUrl(typeRefs.plex.typeID);
    }
    if (kind === "omega") {
      return OMEGA_IMAGE_URL;
    }
    if (kind === "mct") {
      return MCT_IMAGE_URL;
    }
    if (kind === "skill_points") {
      return resolveTypeImageUrl(typeRefs.skillExtractor.typeID);
    }
    if (kind === "bundle") {
      const grants = Array.isArray(fulfillment.grants) ? fulfillment.grants : [];
      for (const grantKind of ["item", "grant_plex", "omega", "mct", "skill_points"]) {
        const grant = grants.find(
          (entry) => entry && String(entry.kind || "").trim() === grantKind,
        );
        const resolved = resolveImageUrlFromFulfillment(grant);
        if (resolved) {
          return resolved;
        }
      }
    }

    return null;
  }

  const themes = {
    omega: { accent: "#f7bc4d", secondary: "#5d3a00", foreground: "#fff8ec", badge: "OMEGA" },
    plex: { accent: "#f0992d", secondary: "#533217", foreground: "#fff7ed", badge: "PLEX" },
    service: { accent: "#4ec6ff", secondary: "#15374c", foreground: "#f1fbff", badge: "SERVICE" },
    skill: { accent: "#b468ff", secondary: "#3b1f54", foreground: "#faf5ff", badge: "SKILL" },
    skins: { accent: "#4ef2c8", secondary: "#123f38", foreground: "#effffb", badge: "SKIN" },
    apparel: { accent: "#ff6c6c", secondary: "#4b1c24", foreground: "#fff4f4", badge: "APPAREL" },
    ships: { accent: "#81a8ff", secondary: "#1e325b", foreground: "#f2f7ff", badge: "HULL" },
    pack: { accent: "#66f28d", secondary: "#173f22", foreground: "#f2fff5", badge: "PACK" },
  };

  const categories = [
    { id: 9000000, name: "Featured", href: "/store/4/categories/featured", parent: null, tags: ["featured"] },
    { id: 9000001, name: "Omega", href: "/store/4/categories/omega", parent: { id: 9000000 }, tags: ["omega", "gametime"] },
    { id: 9000002, name: "PLEX", href: "/store/4/categories/plex", parent: { id: 9000000 }, tags: ["plex"] },
    { id: 9000003, name: "Account Services", href: "/store/4/categories/account-services", parent: { id: 9000000 }, tags: ["service"] },
    { id: 9000004, name: "Skill Management", href: "/store/4/categories/skill-management", parent: { id: 9000000 }, tags: ["skills"] },
    { id: 9000005, name: "Ship SKINs", href: "/store/4/categories/ship-skins", parent: { id: 9000000 }, tags: ["skins"] },
    { id: 9000006, name: "Apparel", href: "/store/4/categories/apparel", parent: { id: 9000000 }, tags: ["apparel"] },
    { id: 9000007, name: "Ships", href: "/store/4/categories/ships", parent: { id: 9000000 }, tags: ["ships"] },
    { id: 9000008, name: "Packs", href: "/store/4/categories/packs", parent: { id: 9000000 }, tags: ["packs"] },
  ];

  let nextProductID = 9100001;
  let nextLegacyOfferID = 9200001;
  let nextFastCheckoutID = 400100;

  const legacyProducts = [];
  const legacyOffers = [];
  const publicOffers = {};
  const fastCheckoutOffers = [];

  function createProduct(name, href) {
    const product = { id: nextProductID, name, href };
    nextProductID += 1;
    legacyProducts.push(product);
    return product;
  }

  function registerPublicOffer(definition) {
    publicOffers[definition.storeOfferID] = definition;
    return definition;
  }

  function createLegacyOffer(definition) {
    const {
      storeOfferID,
      name,
      description,
      price,
      categoryID,
      fulfillment,
      imageUrl = null,
      label = null,
      tags = [],
      preview = null,
    } = definition;
    const resolvedImageUrl = imageUrl || resolveImageUrlFromFulfillment(fulfillment);
    const product = createProduct(name, `/store/4/products/${slugify(storeOfferID)}`);
    const offer = {
      id: nextLegacyOfferID,
      storeOfferID,
      name,
      description,
      href: `/store/4/offers/${slugify(storeOfferID)}`,
      offerPricings: [{ currency: "PLX", price, basePrice: price }],
      imageUrl: resolvedImageUrl,
      products: [{
        id: product.id,
        typeId: Number(fulfillment.typeID || 0),
        quantity: Number(fulfillment.quantity || 1),
        productName: name,
        imageUrl: resolvedImageUrl,
      }],
      categories: [{ id: categoryID }],
      label,
      thirdpartyinfo: null,
      canPurchase: true,
      singlePurchase: false,
      tags,
      preview,
      fulfillment,
    };
    nextLegacyOfferID += 1;
    legacyOffers.push(offer);
    registerPublicOffer({
      storeOfferID,
      name,
      description,
      tags,
      imageUrl: resolvedImageUrl,
      plexPriceInCents: price * 100,
      currencyCode: null,
      currencyAmountInCents: null,
      preview,
      fulfillment,
      source: {
        kind: "seeded-local",
        observedAt: "2026-03-26",
        url: "https://support.eveonline.com/hc/en-us/categories/200554022-Account-Subscription",
      },
    });
    return offer;
  }

  function createLegacyItemOffer(definition) {
    const { storeOfferID, typeRef, description, price, categoryID, label = null, tags = [], previewTheme } = definition;
    return createLegacyOffer({
      storeOfferID,
      name: typeRef.name,
      description,
      price,
      categoryID,
      label,
      tags,
      preview: buildPreview(previewTheme, typeRef.name, description),
      fulfillment: { kind: "item", typeID: typeRef.typeID, quantity: 1 },
    });
  }

  function createCashOffer(definition) {
    const {
      storeOfferID,
      name,
      description,
      usdCents,
      tags = [],
      previewTheme,
      fulfillment,
      fastCheckoutQuantity = null,
      label = null,
      sourceUrl,
    } = definition;
    const preview = buildPreview(previewTheme, name, description);
    const resolvedImageUrl =
      definition.imageUrl || resolveImageUrlFromFulfillment(fulfillment);
    registerPublicOffer({
      storeOfferID,
      name,
      description,
      tags,
      label,
      imageUrl: resolvedImageUrl,
      plexPriceInCents: null,
      currencyCode: "USD",
      currencyAmountInCents: usdCents,
      preview,
      fulfillment,
      source: {
        kind: "official-store",
        observedAt: "2026-03-26",
        url: sourceUrl || "https://store.eveonline.com/",
      },
    });
    if (Number.isInteger(fastCheckoutQuantity) && fastCheckoutQuantity > 0) {
      fastCheckoutOffers.push({
        id: nextFastCheckoutID,
        storeOfferID,
        name,
        price: Number((usdCents / 100).toFixed(2)),
        currency: "USD",
        quantity: fastCheckoutQuantity,
        baseQuantity: 100,
        tags,
        label,
        preview,
        imageUrl: resolvedImageUrl,
      });
      nextFastCheckoutID += fastCheckoutQuantity >= 1000 ? fastCheckoutQuantity : 100;
    }
  }

  createLegacyOffer({
    storeOfferID: "omega_30_days",
    name: "Omega Clone State",
    description: "Activate Omega clone state access for 30 days.",
    price: 500,
    categoryID: 9000001,
    tags: ["omega", "gametime"],
    preview: buildPreview(themes.omega, "Omega Clone State", "30 days of Omega access"),
    imageUrl: "res:/UI/Texture/classes/PlexVault/UpgradeOmega.png",
    fulfillment: { kind: "omega", durationDays: 30 },
  });

  createLegacyOffer({
    storeOfferID: "mct_slot_30_days",
    name: "Multiple Character Training",
    description: "Unlock an additional training slot for 30 days.",
    price: 485,
    categoryID: 9000003,
    tags: ["service", "mct"],
    preview: buildPreview(themes.service, "Multiple Character Training", "30 days of training time"),
    imageUrl: "res:/UI/Texture/Icons/multiple_training.png",
    fulfillment: { kind: "mct", durationDays: 30, slotCount: 1 },
  });

  createLegacyItemOffer({
    storeOfferID: "pilot_resculpt_certificate",
    typeRef: typeRefs.resculpt,
    description: "Change your capsuleer appearance with a body resculpt certificate.",
    price: 100,
    categoryID: 9000003,
    tags: ["service", "appearance"],
    previewTheme: themes.service,
  });

  createLegacyItemOffer({
    storeOfferID: "skill_extractor_single",
    typeRef: typeRefs.skillExtractor,
    description: "Extract 500,000 skill points from an eligible character.",
    price: 70,
    categoryID: 9000004,
    tags: ["skills", "extractor"],
    previewTheme: themes.skill,
  });

  createLegacyItemOffer({
    storeOfferID: "daily_alpha_injector_single",
    typeRef: typeRefs.dailyAlphaInjector,
    description: "Add 50,000 skill points for an Alpha clone character.",
    price: 15,
    categoryID: 9000004,
    tags: ["skills", "alpha"],
    previewTheme: themes.skill,
  });

  createLegacyItemOffer({
    storeOfferID: "historic_soe_skins_crate",
    typeRef: typeRefs.historicSoeSkinsCrate,
    description: "Grant a historic Sisters of EVE themed SKIN crate.",
    price: 110,
    categoryID: 9000005,
    tags: ["skins", "crate"],
    previewTheme: themes.skins,
  });

  createLegacyItemOffer({
    storeOfferID: "historic_gallente_skins_crate",
    typeRef: typeRefs.historicGallenteSkinsCrate,
    description: "Grant a historic Gallente themed SKIN crate.",
    price: 110,
    categoryID: 9000005,
    tags: ["skins", "crate"],
    previewTheme: themes.skins,
  });

  createLegacyItemOffer({
    storeOfferID: "sunesis_capsuleer_day_xxi_skin",
    typeRef: typeRefs.sunesisSkin,
    description: "Redeem a limited Sunesis SKIN.",
    price: 55,
    categoryID: 9000005,
    tags: ["skins"],
    previewTheme: themes.skins,
  });

  createLegacyItemOffer({
    storeOfferID: "pacifier_aurora_universalis_skin",
    typeRef: typeRefs.pacifierSkin,
    description: "Redeem a Pacifier Aurora Universalis SKIN.",
    price: 65,
    categoryID: 9000005,
    tags: ["skins"],
    previewTheme: themes.skins,
  });

  createLegacyItemOffer({
    storeOfferID: "frostline_exploration_suit",
    typeRef: typeRefs.frostlineExplorationSuit,
    description: "Add a Frostline Exploration Suit to your apparel collection.",
    price: 65,
    categoryID: 9000006,
    tags: ["apparel"],
    previewTheme: themes.apparel,
  });

  createLegacyItemOffer({
    storeOfferID: "mens_ascend_boots_white_gold",
    typeRef: typeRefs.mensAscendBoots,
    description: "Add a high-contrast pair of Ascend boots.",
    price: 30,
    categoryID: 9000006,
    tags: ["apparel"],
    previewTheme: themes.apparel,
  });

  createLegacyItemOffer({
    storeOfferID: "womens_avenue_shirt_black",
    typeRef: typeRefs.womensAvenueShirt,
    description: "Add a black Avenue shirt to your apparel collection.",
    price: 30,
    categoryID: 9000006,
    tags: ["apparel"],
    previewTheme: themes.apparel,
  });

  createLegacyItemOffer({
    storeOfferID: "sunesis_hull",
    typeRef: typeRefs.sunesis,
    description: "Deliver a Sunesis hull to the active character.",
    price: 95,
    categoryID: 9000007,
    tags: ["ship", "hull"],
    previewTheme: themes.ships,
  });

  createLegacyItemOffer({
    storeOfferID: "drake_hull",
    typeRef: typeRefs.drake,
    description: "Deliver a Drake hull to the active character.",
    price: 1200,
    categoryID: 9000007,
    tags: ["ship", "hull"],
    previewTheme: themes.ships,
  });

  createLegacyItemOffer({
    storeOfferID: "explorer_career_crate",
    typeRef: typeRefs.explorerCareerCrate,
    description: "Deliver an Explorer Career Crate to the active character.",
    price: 120,
    categoryID: 9000008,
    tags: ["pack", "career"],
    previewTheme: themes.pack,
  });

  const omegaStoreSource = "https://store.eveonline.com/";

  createCashOffer({
    storeOfferID: "cash_omega_30_days",
    name: "1 Month Omega + Bonus items",
    description: "30 days Omega, 100,000 free skill points, Advanced 'Boost' Cerebral Accelerator, and Basic Glamourex Booster.",
    usdCents: 2000,
    tags: ["omega", "pack", "featured"],
    previewTheme: themes.omega,
    sourceUrl: omegaStoreSource,
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "omega", durationDays: 30 },
        { kind: "skill_points", points: 100000 },
        { kind: "item", typeID: typeRefs.advancedBoost.typeID, quantity: 1 },
        { kind: "item", typeID: typeRefs.basicGlamourex.typeID, quantity: 1 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_omega_90_days",
    name: "3 Months Omega",
    description: "90 days of Omega clone state.",
    usdCents: 4800,
    tags: ["omega"],
    previewTheme: themes.omega,
    sourceUrl: omegaStoreSource,
    fulfillment: { kind: "omega", durationDays: 90 },
  });

  createCashOffer({
    storeOfferID: "cash_omega_180_days",
    name: "6 Months Omega",
    description: "180 days of Omega clone state.",
    usdCents: 8400,
    tags: ["omega"],
    previewTheme: themes.omega,
    sourceUrl: omegaStoreSource,
    fulfillment: { kind: "omega", durationDays: 180 },
  });

  createCashOffer({
    storeOfferID: "cash_omega_365_days",
    name: "12 Months Omega",
    description: "365 days of Omega clone state.",
    usdCents: 14400,
    tags: ["omega"],
    previewTheme: themes.omega,
    sourceUrl: omegaStoreSource,
    fulfillment: { kind: "omega", durationDays: 365 },
  });

  createCashOffer({
    storeOfferID: "cash_omega_730_days",
    name: "24 Months Omega",
    description: "730 days of Omega clone state.",
    usdCents: 26400,
    tags: ["omega"],
    previewTheme: themes.omega,
    sourceUrl: omegaStoreSource,
    fulfillment: { kind: "omega", durationDays: 730 },
  });

  createCashOffer({
    storeOfferID: "cash_plex_100_usd",
    name: "100 PLEX",
    description: "Add 100 PLEX to the character vault.",
    usdCents: 500,
    tags: ["plex"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 100,
    fulfillment: { kind: "grant_plex", plexAmount: 100 },
  });

  createCashOffer({
    storeOfferID: "cash_plex_200_usd",
    name: "200 PLEX",
    description: "Add 200 PLEX to the character vault.",
    usdCents: 1000,
    tags: ["plex"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 200,
    fulfillment: { kind: "grant_plex", plexAmount: 200 },
  });

  createCashOffer({
    storeOfferID: "cash_plex_500_usd",
    name: "500 PLEX",
    description: "Add 500 PLEX to the character vault.",
    usdCents: 2500,
    tags: ["plex", "popular"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 500,
    label: "Popular",
    fulfillment: { kind: "grant_plex", plexAmount: 500 },
  });

  createCashOffer({
    storeOfferID: "cash_plex_1000_gallente",
    name: "1,000 PLEX + 1 Historic Gallente SKINs Crate",
    description: "1,000 PLEX plus one Historic Gallente SKINs Crate.",
    usdCents: 4500,
    tags: ["plex", "skins", "bundle"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 1000,
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "grant_plex", plexAmount: 1000 },
        { kind: "item", typeID: typeRefs.historicGallenteSkinsCrate.typeID, quantity: 1 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_plex_1500_gallente",
    name: "1,500 PLEX + 2 Historic Gallente SKINs Crates",
    description: "1,500 PLEX plus two Historic Gallente SKINs Crates.",
    usdCents: 6500,
    tags: ["plex", "skins", "bundle"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 1500,
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "grant_plex", plexAmount: 1500 },
        { kind: "item", typeID: typeRefs.historicGallenteSkinsCrate.typeID, quantity: 2 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_plex_3000_gallente",
    name: "3,000 PLEX + 3 Historic Gallente SKINs Crates",
    description: "3,000 PLEX plus three Historic Gallente SKINs Crates.",
    usdCents: 12500,
    tags: ["plex", "skins", "bundle"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 3000,
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "grant_plex", plexAmount: 3000 },
        { kind: "item", typeID: typeRefs.historicGallenteSkinsCrate.typeID, quantity: 3 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_plex_6000_gallente",
    name: "6,000 PLEX + 4 Historic Gallente SKINs Crates",
    description: "6,000 PLEX plus four Historic Gallente SKINs Crates.",
    usdCents: 24000,
    tags: ["plex", "skins", "bundle"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 6000,
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "grant_plex", plexAmount: 6000 },
        { kind: "item", typeID: typeRefs.historicGallenteSkinsCrate.typeID, quantity: 4 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_plex_12000_gallente",
    name: "12,000 PLEX + 5 Historic Gallente SKINs Crates",
    description: "12,000 PLEX plus five Historic Gallente SKINs Crates.",
    usdCents: 42000,
    tags: ["plex", "skins", "bundle"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 12000,
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "grant_plex", plexAmount: 12000 },
        { kind: "item", typeID: typeRefs.historicGallenteSkinsCrate.typeID, quantity: 5 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_plex_20000_gallente",
    name: "20,000 PLEX + 6 Historic Gallente SKINs Crates",
    description: "20,000 PLEX plus six Historic Gallente SKINs Crates.",
    usdCents: 65000,
    tags: ["plex", "skins", "bundle"],
    previewTheme: themes.plex,
    sourceUrl: "https://store.eveonline.com/fr/product/6-000-plex/verm-7980",
    fastCheckoutQuantity: 20000,
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "grant_plex", plexAmount: 20000 },
        { kind: "item", typeID: typeRefs.historicGallenteSkinsCrate.typeID, quantity: 6 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_mct_1",
    name: "1 MCT Certificate",
    description: "30 days of additional training time.",
    usdCents: 1000,
    tags: ["mct"],
    previewTheme: themes.service,
    sourceUrl: omegaStoreSource,
    fulfillment: { kind: "mct", durationDays: 30, slotCount: 1 },
  });

  createCashOffer({
    storeOfferID: "cash_mct_2",
    name: "2 MCT Certificates",
    description: "2 x 30 days of additional training time.",
    usdCents: 1800,
    tags: ["mct"],
    previewTheme: themes.service,
    sourceUrl: omegaStoreSource,
    fulfillment: { kind: "mct", durationDays: 30, slotCount: 2 },
  });

  createCashOffer({
    storeOfferID: "cash_mct_3",
    name: "3 MCT Certificates",
    description: "3 x 30 days of additional training time.",
    usdCents: 2400,
    tags: ["mct"],
    previewTheme: themes.service,
    sourceUrl: omegaStoreSource,
    fulfillment: { kind: "mct", durationDays: 30, slotCount: 3 },
  });

  createCashOffer({
    storeOfferID: "cash_mct_6",
    name: "6 MCT Certificates",
    description: "6 x 30 days of additional training time.",
    usdCents: 4200,
    tags: ["mct"],
    previewTheme: themes.service,
    sourceUrl: omegaStoreSource,
    fulfillment: { kind: "mct", durationDays: 30, slotCount: 6 },
  });

  createCashOffer({
    storeOfferID: "cash_daily_alpha_10",
    name: "10 Daily Alpha Injectors",
    description: "10 Daily Alpha Injectors for Alpha clone skill progression.",
    usdCents: 700,
    tags: ["skills", "alpha"],
    previewTheme: themes.skill,
    sourceUrl: "https://store.eveonline.com/product/alpha-combo/verm-7990",
    fulfillment: { kind: "item", typeID: typeRefs.dailyAlphaInjector.typeID, quantity: 10 },
  });

  createCashOffer({
    storeOfferID: "cash_alpha_combo",
    name: "Alpha Combo",
    description: "100 PLEX plus 5 Daily Alpha Injectors.",
    usdCents: 900,
    tags: ["skills", "plex", "bundle"],
    previewTheme: themes.skill,
    sourceUrl: "https://store.eveonline.com/product/alpha-combo/verm-7990",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "grant_plex", plexAmount: 100 },
        { kind: "item", typeID: typeRefs.dailyAlphaInjector.typeID, quantity: 5 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_weekend_fleet_pack",
    name: "Weekend Fleet Pack",
    description: "3 days Omega access and 50 PLEX.",
    usdCents: 375,
    tags: ["omega", "plex", "pack"],
    previewTheme: themes.pack,
    sourceUrl: "https://store.eveonline.com/product/1m-omega-2-skin-shattered-paradigm/verm-8202",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "omega", durationDays: 3 },
        { kind: "grant_plex", plexAmount: 50 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_apprentice_bundle",
    name: "Apprentice Bundle",
    description: "250,000 free skill points and one Genius 'Boost' Cerebral Accelerator.",
    usdCents: 799,
    tags: ["skills", "pack"],
    previewTheme: themes.skill,
    sourceUrl: "https://store.eveonline.com/en/product/apprentice-bundle/verm-7459",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "skill_points", points: 250000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 1 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_undock_boost_bundle",
    name: "Undock Boost Bundle",
    description: "648,000 free skill points and one Genius 'Boost' Cerebral Accelerator.",
    usdCents: 1600,
    tags: ["skills", "pack"],
    previewTheme: themes.skill,
    sourceUrl: "https://store.eveonline.com/de/product/afterburn-boost-bundle/verm-8049",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "skill_points", points: 648000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 1 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_afterburn_boost_bundle",
    name: "Afterburn Boost Bundle",
    description: "1,032,000 free skill points and one Genius 'Boost' Cerebral Accelerator.",
    usdCents: 4800,
    tags: ["skills", "pack"],
    previewTheme: themes.skill,
    sourceUrl: "https://store.eveonline.com/de/product/afterburn-boost-bundle/verm-8049",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "skill_points", points: 1032000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 1 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_warp_boost_bundle",
    name: "Warp Boost Bundle",
    description: "1,944,000 free skill points and one Genius 'Boost' Cerebral Accelerator.",
    usdCents: 9600,
    tags: ["skills", "pack"],
    previewTheme: themes.skill,
    sourceUrl: "https://store.eveonline.com/de/product/afterburn-boost-bundle/verm-8049",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "skill_points", points: 1944000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 1 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_jump_boost_bundle",
    name: "Jump Boost Bundle",
    description: "3,888,000 free skill points and two Genius 'Boost' Cerebral Accelerators.",
    usdCents: 19200,
    tags: ["skills", "pack"],
    previewTheme: themes.skill,
    sourceUrl: "https://store.eveonline.com/product/2026-level-5-mastery-pack/verm-8428",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "skill_points", points: 3888000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 2 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_level_2_mastery_pack",
    name: "Level 2 Mastery Pack",
    description: "30 days Omega, 100 PLEX, and the Apprentice Bundle.",
    usdCents: 1000,
    tags: ["omega", "plex", "skills", "pack"],
    previewTheme: themes.pack,
    sourceUrl: "https://store.eveonline.com/en/product/level-2-mastery-pack-special/verm-8420",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "omega", durationDays: 30 },
        { kind: "grant_plex", plexAmount: 100 },
        { kind: "skill_points", points: 250000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 1 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_level_3_mastery_pack",
    name: "Level 3 Mastery Pack",
    description: "60 days Omega, 500 PLEX, the Undock Boost Bundle, and one Genius 'Boost' Cerebral Accelerator.",
    usdCents: 5000,
    tags: ["omega", "plex", "skills", "pack"],
    previewTheme: themes.pack,
    sourceUrl: "https://store.eveonline.com/product/2026-level-3-mastery-pack/verm-8426",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "omega", durationDays: 60 },
        { kind: "grant_plex", plexAmount: 500 },
        { kind: "skill_points", points: 648000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 2 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_level_4_mastery_pack",
    name: "Level 4 Mastery Pack",
    description: "90 days Omega, 1,000 PLEX, the Afterburn Boost Bundle, two MCT certificates, and two Skill Extractors.",
    usdCents: 10000,
    tags: ["omega", "plex", "skills", "pack", "mct"],
    previewTheme: themes.pack,
    sourceUrl: "https://store.eveonline.com/product/2026-level-5-mastery-pack/verm-8428",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "omega", durationDays: 90 },
        { kind: "grant_plex", plexAmount: 1000 },
        { kind: "skill_points", points: 1032000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 1 },
        { kind: "mct", durationDays: 30, slotCount: 2 },
        { kind: "item", typeID: typeRefs.skillExtractor.typeID, quantity: 2 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_level_5_mastery_pack",
    name: "Level 5 Mastery Pack",
    description: "180 days Omega, 3,000 PLEX, the Warp Boost Bundle, six MCT certificates, and twenty Skill Extractors.",
    usdCents: 25000,
    tags: ["omega", "plex", "skills", "pack", "mct"],
    previewTheme: themes.pack,
    sourceUrl: "https://store.eveonline.com/product/2026-level-5-mastery-pack/verm-8428",
    fulfillment: {
      kind: "bundle",
      grants: [
        { kind: "omega", durationDays: 180 },
        { kind: "grant_plex", plexAmount: 3000 },
        { kind: "skill_points", points: 1944000 },
        { kind: "item", typeID: typeRefs.geniusBoost.typeID, quantity: 1 },
        { kind: "mct", durationDays: 30, slotCount: 6 },
        { kind: "item", typeID: typeRefs.skillExtractor.typeID, quantity: 20 },
      ],
    },
  });

  createCashOffer({
    storeOfferID: "cash_skill_extractor_50",
    name: "50x Skill Extractors",
    description: "Fifty Skill Extractors delivered to the active character.",
    usdCents: 16500,
    tags: ["skills", "extractor"],
    previewTheme: themes.skill,
    sourceUrl: "https://store.eveonline.com/ko/product/50x-skill-extractors/verm-6866",
    fulfillment: { kind: "item", typeID: typeRefs.skillExtractor.typeID, quantity: 50 },
  });

  return {
    meta: {
      version: 2,
      description: "Cache-backed New Eden Store authority for classic store RPC, fast checkout, and local payment parity.",
      updatedAt: new Date().toISOString(),
      seedProfile: "official-observed-2026-03-26",
    },
    config: {
      ...existingAuthority.config,
      enabled: true,
      fastCheckoutEnabled: true,
      fakeCashPurchasesEnabled: true,
      fakeFastCheckoutResponse: "OK",
      fakeChinaFunnelEnabled: false,
      fakeBuyPlexOfferUrl: "",
      useShellExecuteToBuyPlexOffer: true,
      centsPerPlex: 100,
      defaultCashTaxRatePoints: 0,
      editorPort:
        existingAuthority.config && existingAuthority.config.editorPort
          ? existingAuthority.config.editorPort
          : 26008,
    },
    stores: {
      "4": {
        storeID: 4,
        name: "New Eden Store",
        categories,
        products: legacyProducts,
        offers: legacyOffers,
      },
    },
    publicOffers,
    fastCheckout: {
      offers: fastCheckoutOffers,
      tokensByID:
        existingAuthority.fastCheckout && existingAuthority.fastCheckout.tokensByID
          ? existingAuthority.fastCheckout.tokensByID
          : {
              "9000001": {
                tokenID: 9000001,
                creditCard: { alias: "************4242", expiry: "0529" },
              },
            },
    },
  };
}

function main() {
  const nextAuthority = buildSeedAuthority();
  fs.writeFileSync(authorityPath, `${JSON.stringify(nextAuthority, null, 2)}\n`);
  const summary = {
    publicOfferCount: Object.keys(nextAuthority.publicOffers || {}).length,
    legacyOfferCount:
      ((((nextAuthority.stores || {})["4"] || {}).offers) || []).length,
    fastCheckoutOfferCount:
      (((nextAuthority.fastCheckout || {}).offers) || []).length,
    outputPath: authorityPath,
  };
  process.stdout.write(
    `Seeded New Eden Store authority with ${summary.publicOfferCount} public offers, ` +
      `${summary.legacyOfferCount} legacy offers, and ` +
      `${summary.fastCheckoutOfferCount} fast checkout offers.\n`,
  );
  process.stdout.write(`SUMMARY ${JSON.stringify(summary)}\n`);
  return summary;
}

if (require.main === module) {
  main();
}

module.exports = {
  buildSeedAuthority,
  main,
};
