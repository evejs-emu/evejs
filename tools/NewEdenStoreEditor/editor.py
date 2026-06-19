import base64
import json
import math
import subprocess
import sys
import tkinter as tk
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import colorchooser, messagebox, ttk
from tkinter.scrolledtext import ScrolledText

REPO_ROOT = Path(__file__).resolve().parents[2]
AUTHORITY_PATH = REPO_ROOT / "server/src/newDatabase/data/newEdenStore/data.json"
RUNTIME_PATH = REPO_ROOT / "server/src/newDatabase/data/newEdenStoreRuntime/data.json"
LOCAL_CONFIG_PATH = REPO_ROOT / "evejs.config.local.json"
SEED_SCRIPT_PATH = Path(__file__).resolve().parent / "build_seed_authority.js"
CLIENT_RES_INDEX_PATH = REPO_ROOT / "client/EVE/tq/resfileindex.txt"
CLIENT_RES_FILES_ROOT = REPO_ROOT / "client/EVE/ResFiles"

STORE_CONFIG_KEYS = [
    "newEdenStoreEnabled",
    "newEdenStoreFastCheckoutEnabled",
    "newEdenStoreFakeCashPurchasesEnabled",
    "newEdenStoreFakeFastCheckoutResponse",
    "newEdenStoreFakeChinaFunnelEnabled",
    "newEdenStoreFakeBuyPlexOfferUrl",
    "newEdenStoreUseShellExecuteToBuyPlexOffer",
    "newEdenStoreEditorPort",
    "newEdenStoreCentsPerPlex",
    "newEdenStoreDefaultCashTaxRatePoints",
    "newEdenStorePurchaseLogLimit",
]

DEFAULT_STORE_CONFIG = {
    "newEdenStoreEnabled": True,
    "newEdenStoreFastCheckoutEnabled": True,
    "newEdenStoreFakeCashPurchasesEnabled": True,
    "newEdenStoreFakeFastCheckoutResponse": "OK",
    "newEdenStoreFakeChinaFunnelEnabled": False,
    "newEdenStoreFakeBuyPlexOfferUrl": "",
    "newEdenStoreUseShellExecuteToBuyPlexOffer": True,
    "newEdenStoreEditorPort": 26008,
    "newEdenStoreCentsPerPlex": 100,
    "newEdenStoreDefaultCashTaxRatePoints": 0,
    "newEdenStorePurchaseLogLimit": 500,
}

SCOPE_LABELS = {
    "all": "All offers",
    "legacy": "Legacy store",
    "public": "Public checkout",
    "fast": "Fast checkout",
}

SCOPE_COLORS = {
    "legacy": "#4fb3ff",
    "public": "#f7bc4d",
    "fast": "#59d098",
}

REWARD_CHOICES = [
    ("Give an item", "item"),
    ("Give PLEX", "grant_plex"),
    ("Give Omega time", "omega"),
    ("Give extra training", "mct"),
    ("Give free skill points", "skill_points"),
    ("Give a bundle", "bundle"),
]

FRIENDLY_CONFIG = {
    "newEdenStoreEnabled": ("Store window enabled", "Turn the New Eden Store on or off."),
    "newEdenStoreFastCheckoutEnabled": (
        "Fast checkout enabled",
        "Allow the in-game Buy PLEX popup.",
    ),
    "newEdenStoreFakeCashPurchasesEnabled": (
        "Fake real-money purchases",
        "When players click a cash purchase, grant it locally without charging anything.",
    ),
    "newEdenStoreFakeFastCheckoutResponse": (
        "Fast checkout success text",
        "Text the client expects after a fake fast checkout purchase.",
    ),
    "newEdenStoreFakeChinaFunnelEnabled": (
        "China payment funnel mode",
        "Only enable this if you are testing the China-specific checkout path.",
    ),
    "newEdenStoreFakeBuyPlexOfferUrl": (
        "External Buy PLEX URL",
        "Optional page the client opens for web checkout tests.",
    ),
    "newEdenStoreUseShellExecuteToBuyPlexOffer": (
        "Use shell execute for web checkout",
        "Open external Buy PLEX links the same way the client expects.",
    ),
    "newEdenStoreEditorPort": (
        "Legacy web editor port",
        "Only used by the optional browser editor.",
    ),
    "newEdenStoreCentsPerPlex": (
        "PLEX cents conversion",
        "How many stored cents equal 1 PLEX in the fake vault checkout logic.",
    ),
    "newEdenStoreDefaultCashTaxRatePoints": (
        "Cash tax points",
        "Basis points applied to fake cash receipts. 100 means 1 percent.",
    ),
    "newEdenStorePurchaseLogLimit": (
        "Purchase log size",
        "How many finished purchases to keep in cache.",
    ),
}

OFFER_TEMPLATES = [
    {
        "key": "plex_pack",
        "label": "Plex Pack",
        "icon": "⚡",
        "scope": "fast",
        "caption": "A fast Buy PLEX style card.",
    },
    {
        "key": "omega_time",
        "label": "Omega Time",
        "icon": "👑",
        "scope": "public",
        "caption": "A simple subscription-style offer.",
    },
    {
        "key": "starter_bundle",
        "label": "Starter Bundle",
        "icon": "🎁",
        "scope": "public",
        "caption": "Multiple gifts in one easy starter pack.",
    },
    {
        "key": "skill_pack",
        "label": "Skill Pack",
        "icon": "🧠",
        "scope": "legacy",
        "caption": "Skill points or training rewards.",
    },
    {
        "key": "skin_sale",
        "label": "Skin Sale",
        "icon": "🎨",
        "scope": "legacy",
        "caption": "A cosmetic item or themed sale card.",
    },
]

VISUAL_THEMES = [
    ("Nebula Blue", "#4fb3ff", "#10233e"),
    ("Golden Hour", "#f7bc4d", "#3a2410"),
    ("Emerald Pulse", "#59d098", "#103428"),
    ("Imperial Red", "#e86b73", "#3b151c"),
    ("Void Violet", "#9b7cff", "#23163c"),
]


def strip_json_comments(raw_text):
    result = []
    in_string = False
    escape = False
    in_line_comment = False
    in_block_comment = False
    index = 0

    while index < len(raw_text):
        char = raw_text[index]
        next_char = raw_text[index + 1] if index + 1 < len(raw_text) else ""

        if in_line_comment:
            if char == "\n":
                in_line_comment = False
                result.append(char)
            index += 1
            continue

        if in_block_comment:
            if char == "*" and next_char == "/":
                in_block_comment = False
                index += 2
            else:
                index += 1
            continue

        if in_string:
            result.append(char)
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            index += 1
            continue

        if char == '"':
            in_string = True
            result.append(char)
            index += 1
            continue

        if char == "/" and next_char == "/":
            in_line_comment = True
            index += 2
            continue

        if char == "/" and next_char == "*":
            in_block_comment = True
            index += 2
            continue

        result.append(char)
        index += 1

    return "".join(result)


def read_json(path_obj, fallback):
    if not path_obj.exists():
        return json.loads(json.dumps(fallback))
    with path_obj.open("r", encoding="utf-8") as handle:
        raw_text = handle.read()
    stripped_text = strip_json_comments(raw_text).strip()
    if not stripped_text:
        return json.loads(json.dumps(fallback))
    return json.loads(stripped_text)


def write_json(path_obj, payload):
    path_obj.parent.mkdir(parents=True, exist_ok=True)
    with path_obj.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def deep_clone(value):
    return json.loads(json.dumps(value))


def parse_csv(value):
    return [entry.strip() for entry in str(value or "").split(",") if entry.strip()]


def parse_int(value, fallback=0):
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return fallback


def parse_float(value, fallback=0.0):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return fallback


def as_bool_string(value):
    return "true" if bool(value) else "false"


def parse_hex_color(value, fallback):
    text = str(value or "").strip()
    if len(text) == 7 and text.startswith("#"):
        try:
            int(text[1:], 16)
            return text.lower()
        except ValueError:
            return fallback
    return fallback


def blend_color(start_hex, end_hex, ratio):
    ratio = max(0.0, min(1.0, float(ratio)))

    def unpack(hex_value):
        return int(hex_value[1:3], 16), int(hex_value[3:5], 16), int(hex_value[5:7], 16)

    start_r, start_g, start_b = unpack(start_hex)
    end_r, end_g, end_b = unpack(end_hex)
    red = round(start_r + (end_r - start_r) * ratio)
    green = round(start_g + (end_g - start_g) * ratio)
    blue = round(start_b + (end_b - start_b) * ratio)
    return f"#{red:02x}{green:02x}{blue:02x}"


def slugify(value):
    cleaned = []
    for char in str(value or "").strip().lower():
        if char.isalnum():
            cleaned.append(char)
        elif cleaned and cleaned[-1] != "-":
            cleaned.append("-")
    return "".join(cleaned).strip("-") or "offer"


def create_offer_signature_text(offer):
    fulfillment = offer.get("fulfillment") if isinstance(offer, dict) else None
    if not isinstance(fulfillment, dict):
        return "No reward attached yet"
    kind = str(fulfillment.get("kind") or "unknown")
    if kind == "omega":
        return f"{fulfillment.get('durationDays', 0)} days Omega"
    if kind == "mct":
        return f"{fulfillment.get('slotCount', 1)} training slot(s) for {fulfillment.get('durationDays', 0)} days"
    if kind == "grant_plex":
        return f"{fulfillment.get('plexAmount', 0)} PLEX"
    if kind == "item":
        return f"{fulfillment.get('quantity', 1)} x type {fulfillment.get('typeID', 0)}"
    if kind == "skill_points":
        return f"{fulfillment.get('points', 0)} free skill points"
    if kind == "bundle":
        grants = fulfillment.get("grants") if isinstance(fulfillment.get("grants"), list) else []
        return f"Bundle with {len(grants)} gift(s)"
    return kind


def format_offer_price(scope, offer):
    if scope == "legacy":
        pricing = (offer.get("offerPricings") or [{}])[0]
        return f"{pricing.get('price', 0)} {pricing.get('currency', 'PLX')}"
    if scope == "public":
        if offer.get("currencyCode"):
            return f"{((offer.get('currencyAmountInCents') or 0) / 100):.2f} {offer.get('currencyCode')}"
        return f"{((offer.get('plexPriceInCents') or 0) / 100):.2f} PLX"
    if scope == "fast":
        return f"{offer.get('price', 0)} {offer.get('currency', 'USD')}"
    return ""


def get_legacy_store(authority):
    stores = authority.setdefault("stores", {})
    return stores.setdefault(
        "4",
        {
            "storeID": 4,
            "name": "New Eden Store",
            "categories": [],
            "products": [],
            "offers": [],
        },
    )


def get_legacy_offers(authority):
    return get_legacy_store(authority).setdefault("offers", [])


def get_public_offers(authority):
    return authority.setdefault("publicOffers", {})


def get_fast_offers(authority):
    fast_checkout = authority.setdefault("fastCheckout", {})
    return fast_checkout.setdefault("offers", [])


def collect_known_tags(authority):
    tags = set()
    for offer in get_legacy_offers(authority):
        tags.update(offer.get("tags") or [])
    for offer in get_public_offers(authority).values():
        tags.update(offer.get("tags") or [])
    for offer in get_fast_offers(authority):
        tags.update(offer.get("tags") or [])
    return sorted(tag for tag in tags if tag)


def collect_known_categories(authority):
    categories = []
    seen = set()
    for entry in ((get_legacy_store(authority).get("categories") or [])):
        category_id = parse_int(entry.get("id"), 0)
        if category_id <= 0 or category_id in seen:
            continue
        seen.add(category_id)
        categories.append(
            {
                "id": category_id,
                "name": str(entry.get("name") or f"Category {category_id}"),
                "tags": list(entry.get("tags") or []),
            }
        )
    return categories


def next_numeric_id(existing_values, start_value):
    numeric_values = [parse_int(value, 0) for value in existing_values]
    numeric_values = [value for value in numeric_values if value > 0]
    if not numeric_values:
        return start_value
    return max(numeric_values) + 1


def next_store_offer_id(authority, scope):
    existing = set()
    for offer in get_legacy_offers(authority):
        existing.add(str(offer.get("storeOfferID") or ""))
    for offer_id in get_public_offers(authority):
        existing.add(str(offer_id))
    for offer in get_fast_offers(authority):
        existing.add(str(offer.get("storeOfferID") or ""))

    prefix = {
        "legacy": "legacy_offer",
        "public": "public_offer",
        "fast": "fast_offer",
    }.get(scope, "offer")
    suffix = 1
    while True:
        candidate = f"{prefix}_{suffix:03d}"
        if candidate not in existing:
            return candidate
        suffix += 1


def build_default_preview(scope, name, description):
    accent = SCOPE_COLORS.get(scope, "#5aa9ff")
    secondary = blend_color(accent, "#0d1422", 0.75)
    badge = {
        "legacy": "STORE",
        "public": "CHECKOUT",
        "fast": "PLEX",
    }.get(scope, "OFFER")
    return {
        "imageMode": "generated",
        "accent": accent,
        "secondary": secondary,
        "foreground": "#f5f8ff",
        "badge": badge,
        "title": name,
        "subtitle": description,
    }


def build_default_offer(authority, scope):
    store_offer_id = next_store_offer_id(authority, scope)
    description = "Describe what the player gets here."
    name = {
        "legacy": "New legacy offer",
        "public": "New public offer",
        "fast": "New fast checkout offer",
    }[scope]
    preview = build_default_preview(scope, name, description)
    if scope == "legacy":
        legacy_offer_id = next_numeric_id(
            [offer.get("id") for offer in get_legacy_offers(authority)],
            9300000,
        )
        product_id = next_numeric_id(
            [
                product.get("id")
                for offer in get_legacy_offers(authority)
                for product in (offer.get("products") or [])
            ],
            9500000,
        )
        return {
            "id": legacy_offer_id,
            "storeOfferID": store_offer_id,
            "name": name,
            "description": description,
            "href": f"/store/4/offers/{slugify(store_offer_id)}",
            "offerPricings": [{"currency": "PLX", "price": 0, "basePrice": 0}],
            "imageUrl": None,
            "products": [{"id": product_id, "typeId": 34, "quantity": 1, "productName": name, "imageUrl": None}],
            "categories": [{"id": 9000008}],
            "label": None,
            "thirdpartyinfo": None,
            "canPurchase": True,
            "singlePurchase": False,
            "tags": ["featured"],
            "preview": preview,
            "fulfillment": {"kind": "item", "typeID": 34, "quantity": 1},
        }
    if scope == "public":
        return {
            "storeOfferID": store_offer_id,
            "name": name,
            "description": description,
            "tags": ["featured"],
            "plexPriceInCents": 0,
            "currencyCode": None,
            "currencyAmountInCents": None,
            "preview": preview,
            "fulfillment": {"kind": "item", "typeID": 34, "quantity": 1},
            "source": {"kind": "seeded-local", "observedAt": "2026-03-26", "url": ""},
        }
    fast_offer_id = next_numeric_id(
        [offer.get("id") for offer in get_fast_offers(authority)],
        430000,
    )
    return {
        "id": fast_offer_id,
        "storeOfferID": store_offer_id,
        "name": name,
        "price": 1,
        "currency": "USD",
        "quantity": 100,
        "baseQuantity": 100,
        "tags": ["plex"],
        "label": None,
        "preview": preview,
        "imageUrl": None,
    }


def build_offer_from_template(authority, template_key):
    template_scope = next(
        (entry["scope"] for entry in OFFER_TEMPLATES if entry["key"] == template_key),
        "legacy",
    )
    offer = build_default_offer(authority, template_scope)

    if template_key == "plex_pack":
        offer["name"] = "500 PLEX Pack"
        offer["price"] = 19.99
        offer["currency"] = "USD"
        offer["quantity"] = 500
        offer["baseQuantity"] = 500
        offer["tags"] = ["plex", "featured", "popular"]
        offer["preview"] = build_default_preview("fast", offer["name"], "A clean fast-checkout PLEX card.")
        offer["preview"]["badge"] = "PLEX"
        offer["preview"]["accent"] = "#59d098"
        offer["preview"]["secondary"] = "#123728"
        return offer, "fast"

    if template_key == "omega_time":
        offer["name"] = "30 Days of Omega"
        offer["description"] = "Upgrade the pilot with Omega clone state for 30 days."
        offer["currencyCode"] = "USD"
        offer["currencyAmountInCents"] = 1999
        offer["plexPriceInCents"] = None
        offer["tags"] = ["featured", "omega", "gametime"]
        offer["fulfillment"] = {"kind": "omega", "durationDays": 30}
        offer["preview"] = build_default_preview("public", offer["name"], offer["description"])
        offer["preview"]["badge"] = "OMEGA"
        offer["preview"]["accent"] = "#f7bc4d"
        offer["preview"]["secondary"] = "#38240d"
        return offer, "public"

    if template_key == "starter_bundle":
        offer["name"] = "Academy Starter Bundle"
        offer["description"] = "A friendly bundle with PLEX, skill points, and a starter ship reward."
        offer["currencyCode"] = "USD"
        offer["currencyAmountInCents"] = 999
        offer["plexPriceInCents"] = None
        offer["tags"] = ["featured", "popular", "starter"]
        offer["fulfillment"] = {
            "kind": "bundle",
            "grants": [
                {"kind": "grant_plex", "plexAmount": 110},
                {"kind": "skill_points", "points": 250000},
                {"kind": "item", "typeID": 587, "quantity": 1},
            ],
        }
        offer["preview"] = build_default_preview("public", offer["name"], offer["description"])
        offer["preview"]["badge"] = "BUNDLE"
        offer["preview"]["accent"] = "#e86b73"
        offer["preview"]["secondary"] = "#37151d"
        return offer, "public"

    if template_key == "skill_pack":
        offer["name"] = "Training Burst Pack"
        offer["description"] = "A simple training-focused card for quick progression."
        offer["offerPricings"] = [{"currency": "PLX", "price": 275, "basePrice": 275}]
        offer["tags"] = ["featured", "skills"]
        offer["fulfillment"] = {"kind": "skill_points", "points": 500000}
        offer["preview"] = build_default_preview("legacy", offer["name"], offer["description"])
        offer["preview"]["badge"] = "SKILLS"
        offer["preview"]["accent"] = "#9b7cff"
        offer["preview"]["secondary"] = "#23163c"
        return offer, "legacy"

    if template_key == "skin_sale":
        offer["name"] = "Featured SKIN Offer"
        offer["description"] = "A bright cosmetic card for an event or hero SKIN sale."
        offer["offerPricings"] = [{"currency": "PLX", "price": 120, "basePrice": 120}]
        offer["tags"] = ["featured", "skins"]
        offer["preview"] = build_default_preview("legacy", offer["name"], offer["description"])
        offer["preview"]["badge"] = "SKIN"
        offer["preview"]["accent"] = "#4fb3ff"
        offer["preview"]["secondary"] = "#112846"
        return offer, "legacy"

    return offer, template_scope


class BundleGrantRow:
    def __init__(self, parent, on_remove, on_change):
        self.parent = parent
        self.on_remove = on_remove
        self.on_change = on_change
        self.frame = tk.Frame(parent, bg="#101726", highlightthickness=1, highlightbackground="#22304a")
        self.kind_var = tk.StringVar(value="grant_plex")
        self.primary_var = tk.StringVar(value="")
        self.secondary_var = tk.StringVar(value="")

        top = tk.Frame(self.frame, bg="#101726")
        top.pack(fill="x", padx=10, pady=(8, 4))
        tk.Label(top, text="Gift block", bg="#101726", fg="#f3f7ff", font=("Segoe UI Semibold", 10)).pack(side="left")
        self.kind_box = ttk.Combobox(
            top,
            state="readonly",
            values=[label for label, key in REWARD_CHOICES if key != "bundle"],
            width=22,
        )
        self.kind_box.pack(side="left", padx=(10, 8))
        self.kind_box.bind("<<ComboboxSelected>>", self._on_kind_changed)
        tk.Button(
            top,
            text="Remove",
            command=self._remove_self,
            bg="#2a1c22",
            fg="#ffdbe4",
            activebackground="#3a2530",
            activeforeground="#ffffff",
            relief="flat",
            padx=10,
            pady=5,
            cursor="hand2",
        ).pack(side="right")

        self.fields_frame = tk.Frame(self.frame, bg="#101726")
        self.fields_frame.pack(fill="x", padx=10, pady=(0, 10))
        self._set_kind("grant_plex")

    def pack(self, **kwargs):
        self.frame.pack(**kwargs)

    def destroy(self):
        self.frame.destroy()

    def _remove_self(self):
        self.on_remove(self)

    def _clear_fields(self):
        for child in self.fields_frame.winfo_children():
            child.destroy()

    def _build_labeled_entry(self, parent, label_text, variable, width=14):
        wrap = tk.Frame(parent, bg="#101726")
        wrap.pack(side="left", padx=(0, 10))
        tk.Label(wrap, text=label_text, bg="#101726", fg="#8fa3c8", font=("Segoe UI", 9)).pack(anchor="w")
        entry = ttk.Entry(wrap, textvariable=variable, width=width)
        entry.pack(anchor="w", pady=(2, 0))
        entry.bind("<KeyRelease>", lambda _event: self.on_change())

    def _on_kind_changed(self, _event=None):
        selected_label = self.kind_box.get()
        for label, key in REWARD_CHOICES:
            if label == selected_label:
                self._set_kind(key)
                self.on_change()
                return

    def _set_kind(self, kind):
        self.kind_var.set(kind)
        selected_label = next(label for label, key in REWARD_CHOICES if key == kind)
        self.kind_box.set(selected_label)
        self._clear_fields()
        if kind == "item":
            self._build_labeled_entry(self.fields_frame, "Type ID", self.primary_var)
            self._build_labeled_entry(self.fields_frame, "Quantity", self.secondary_var)
        elif kind == "grant_plex":
            self._build_labeled_entry(self.fields_frame, "PLEX amount", self.primary_var)
        elif kind == "omega":
            self._build_labeled_entry(self.fields_frame, "Days", self.primary_var)
        elif kind == "mct":
            self._build_labeled_entry(self.fields_frame, "Days", self.primary_var)
            self._build_labeled_entry(self.fields_frame, "Slots", self.secondary_var)
        elif kind == "skill_points":
            self._build_labeled_entry(self.fields_frame, "Skill points", self.primary_var)

    def load(self, payload):
        kind = str((payload or {}).get("kind") or "grant_plex")
        if kind == "bundle":
            kind = "grant_plex"
        self.primary_var.set("")
        self.secondary_var.set("")
        self._set_kind(kind)
        if kind == "item":
            self.primary_var.set(str((payload or {}).get("typeID") or 0))
            self.secondary_var.set(str((payload or {}).get("quantity") or 1))
        elif kind == "grant_plex":
            self.primary_var.set(str((payload or {}).get("plexAmount") or 0))
        elif kind == "omega":
            self.primary_var.set(str((payload or {}).get("durationDays") or 0))
        elif kind == "mct":
            self.primary_var.set(str((payload or {}).get("durationDays") or 0))
            self.secondary_var.set(str((payload or {}).get("slotCount") or 1))
        elif kind == "skill_points":
            self.primary_var.set(str((payload or {}).get("points") or 0))

    def to_payload(self):
        kind = self.kind_var.get()
        if kind == "item":
            return {"kind": "item", "typeID": max(0, parse_int(self.primary_var.get(), 0)), "quantity": max(1, parse_int(self.secondary_var.get(), 1))}
        if kind == "grant_plex":
            return {"kind": "grant_plex", "plexAmount": max(0, parse_int(self.primary_var.get(), 0))}
        if kind == "omega":
            return {"kind": "omega", "durationDays": max(0, parse_int(self.primary_var.get(), 0))}
        if kind == "mct":
            return {"kind": "mct", "durationDays": max(0, parse_int(self.primary_var.get(), 0)), "slotCount": max(1, parse_int(self.secondary_var.get(), 1))}
        if kind == "skill_points":
            return {"kind": "skill_points", "points": max(0, parse_int(self.primary_var.get(), 0))}
        return {"kind": kind}


class StoreEditorApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("EVE.js New Eden Store Studio")
        self.geometry("1750x1080")
        self.minsize(1480, 900)
        self.configure(bg="#08101b")

        self.authority = {}
        self.runtime = {}
        self.local_config = {}

        self.current_meta = None
        self.visible_items = []
        self.card_views = []
        self.bundle_rows = []
        self.known_tags = []
        self.known_categories = []
        self.scope_filter_buttons = {}
        self.preview_image = None
        self.preview_art_image = None
        self.image_cache = {}
        self.resource_path_index = None
        self.drag_context = None

        self.filter_scope_var = tk.StringVar(value="all")
        self.search_var = tk.StringVar(value="")
        self.status_var = tk.StringVar(value="Loading store editor...")

        self.scope_readout_var = tk.StringVar(value="")
        self.internal_id_var = tk.StringVar(value="")
        self.store_offer_id_var = tk.StringVar(value="")
        self.name_var = tk.StringVar(value="")
        self.price_var = tk.StringVar(value="")
        self.currency_var = tk.StringVar(value="PLX")
        self.fast_quantity_var = tk.StringVar(value="")
        self.fast_base_quantity_var = tk.StringVar(value="")
        self.image_url_var = tk.StringVar(value="")
        self.source_url_var = tk.StringVar(value="")
        self.badge_var = tk.StringVar(value="")
        self.accent_var = tk.StringVar(value="#4fb3ff")
        self.secondary_var = tk.StringVar(value="#10233e")
        self.custom_tags_var = tk.StringVar(value="")
        self.reward_kind_display_var = tk.StringVar(value=REWARD_CHOICES[0][0])

        self.reward_item_type_var = tk.StringVar(value="34")
        self.reward_item_quantity_var = tk.StringVar(value="1")
        self.reward_plex_var = tk.StringVar(value="0")
        self.reward_days_var = tk.StringVar(value="30")
        self.reward_slot_count_var = tk.StringVar(value="1")
        self.reward_skill_points_var = tk.StringVar(value="0")

        self.tag_vars = {}
        self.category_vars = {}
        self.config_vars = {}

        self._configure_style()
        self._build_ui()
        self._bind_live_preview_watchers()
        self.reload_from_disk()

    def _configure_style(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", background="#08101b", foreground="#eef5ff")
        style.configure("TFrame", background="#08101b")
        style.configure("TLabel", background="#08101b", foreground="#eef5ff")
        style.configure("TLabelframe", background="#08101b", foreground="#ffffff")
        style.configure("TLabelframe.Label", background="#08101b", foreground="#ffffff", font=("Segoe UI Semibold", 10))
        style.configure("TNotebook", background="#08101b")
        style.configure("TNotebook.Tab", background="#121b2b", foreground="#d8e5ff", padding=(14, 8))
        style.map("TNotebook.Tab", background=[("selected", "#24324a")], foreground=[("selected", "#ffffff")])
        style.configure("TButton", padding=8)
        style.configure("TEntry", fieldbackground="#101726", foreground="#f5f8ff", bordercolor="#26344f")
        style.configure("TCombobox", fieldbackground="#101726", foreground="#f5f8ff")

    def _build_ui(self):
        header = tk.Frame(self, bg="#08101b")
        header.pack(fill="x", padx=18, pady=(16, 10))
        left = tk.Frame(header, bg="#08101b")
        left.pack(side="left", fill="x", expand=True)
        tk.Label(left, text="New Eden Store Studio", bg="#08101b", fg="#ffffff", font=("Segoe UI Semibold", 22)).pack(anchor="w")
        tk.Label(left, text="Pick a card, change friendly fields, and save. No JSON knowledge required.", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 10)).pack(anchor="w", pady=(4, 0))

        right = tk.Frame(header, bg="#08101b")
        right.pack(side="right")
        self._make_action_button(right, "↻ Reload", self.reload_from_disk, "#1b2b42").pack(side="left", padx=(8, 0))
        self._make_action_button(right, "✦ Reseed Catalog", self.reseed_catalog, "#21324f").pack(side="left", padx=(8, 0))
        self._make_action_button(right, "✓ Save Everything", self.save_all_json, "#26496a").pack(side="left", padx=(8, 0))

        summary = tk.Frame(self, bg="#08101b")
        summary.pack(fill="x", padx=18, pady=(0, 12))
        self.summary_cards = []
        for _ in range(5):
            card = tk.Frame(summary, bg="#101726", highlightthickness=1, highlightbackground="#1d2940")
            card.pack(side="left", fill="x", expand=True, padx=(0, 10))
            value = tk.Label(card, text="0", bg="#101726", fg="#ffffff", font=("Segoe UI Semibold", 18))
            value.pack(anchor="w", padx=14, pady=(12, 2))
            label = tk.Label(card, text="", bg="#101726", fg="#8ea3c7", font=("Segoe UI", 10))
            label.pack(anchor="w", padx=14, pady=(0, 12))
            self.summary_cards.append((value, label))

        notebook = ttk.Notebook(self)
        notebook.pack(fill="both", expand=True, padx=18, pady=(0, 10))

        visual_tab = tk.Frame(notebook, bg="#08101b")
        settings_tab = tk.Frame(notebook, bg="#08101b")
        advanced_tab = tk.Frame(notebook, bg="#08101b")
        notebook.add(visual_tab, text="Visual Editor")
        notebook.add(settings_tab, text="Store Settings")
        notebook.add(advanced_tab, text="Advanced JSON")

        main_split = tk.PanedWindow(visual_tab, orient="horizontal", sashwidth=8, bg="#08101b")
        main_split.pack(fill="both", expand=True)

        browser_panel = tk.Frame(main_split, bg="#0d1524")
        builder_panel = tk.Frame(main_split, bg="#08101b")
        main_split.add(browser_panel, minsize=430)
        main_split.add(builder_panel, minsize=980)

        self._build_browser_panel(browser_panel)
        self._build_builder_panel(builder_panel)
        self._build_settings_tab(settings_tab)
        self._build_advanced_tab(advanced_tab)

        tk.Label(self, textvariable=self.status_var, bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 10)).pack(fill="x", padx=18, pady=(0, 14))

    def _build_browser_panel(self, parent):
        parent.pack_propagate(False)
        header = tk.Frame(parent, bg="#0d1524")
        header.pack(fill="x", padx=12, pady=12)
        tk.Label(header, text="Offer Browser", bg="#0d1524", fg="#ffffff", font=("Segoe UI Semibold", 16)).pack(anchor="w")
        tk.Label(header, text="These cards are your storefront. Click one to edit it, or drag to change its shelf order.", bg="#0d1524", fg="#8ea3c7", font=("Segoe UI", 9), justify="left", wraplength=360).pack(anchor="w", pady=(4, 0))

        scope_bar = tk.Frame(parent, bg="#0d1524")
        scope_bar.pack(fill="x", padx=12, pady=(0, 10))
        for scope in ("all", "legacy", "public", "fast"):
            button = tk.Button(scope_bar, text=SCOPE_LABELS[scope], command=lambda selected=scope: self.set_scope_filter(selected), relief="flat", bd=0, padx=12, pady=8, cursor="hand2", font=("Segoe UI Semibold", 9))
            button.pack(side="left", padx=(0, 8))
            self.scope_filter_buttons[scope] = button
        self._refresh_scope_filter_buttons()

        search_wrap = tk.Frame(parent, bg="#0d1524")
        search_wrap.pack(fill="x", padx=12)
        tk.Label(search_wrap, text="Find an offer", bg="#0d1524", fg="#9fb2d1", font=("Segoe UI", 9)).pack(anchor="w")
        search_entry = ttk.Entry(search_wrap, textvariable=self.search_var)
        search_entry.pack(fill="x", pady=(4, 0))
        search_entry.bind("<KeyRelease>", lambda _event: self.rebuild_offer_cards())

        quick_actions = tk.Frame(parent, bg="#0d1524")
        quick_actions.pack(fill="x", padx=12, pady=12)
        self._make_action_button(quick_actions, "+ New Legacy", lambda: self.create_new_offer("legacy"), "#254164").pack(side="left", padx=(0, 8))
        self._make_action_button(quick_actions, "+ New Public", lambda: self.create_new_offer("public"), "#5a4621").pack(side="left", padx=(0, 8))
        self._make_action_button(quick_actions, "+ New Fast", lambda: self.create_new_offer("fast"), "#1f4c3a").pack(side="left")

        secondary_actions = tk.Frame(parent, bg="#0d1524")
        secondary_actions.pack(fill="x", padx=12, pady=(0, 12))
        self._make_action_button(secondary_actions, "⎘ Duplicate", self.duplicate_selected_offer, "#1a2740", small=True).pack(side="left", padx=(0, 8))
        self._make_action_button(secondary_actions, "✕ Delete", self.delete_selected_offer, "#43202b", small=True).pack(side="left")

        template_frame = tk.Frame(parent, bg="#0d1524")
        template_frame.pack(fill="x", padx=12, pady=(0, 12))
        tk.Label(template_frame, text="Quick starters", bg="#0d1524", fg="#ffffff", font=("Segoe UI Semibold", 10)).pack(anchor="w")
        tk.Label(template_frame, text="Tap one to create a polished starter card instead of building from a blank offer.", bg="#0d1524", fg="#8ea3c7", font=("Segoe UI", 9), wraplength=360, justify="left").pack(anchor="w", pady=(4, 8))
        for template in OFFER_TEMPLATES:
            button_text = f"{template['icon']} {template['label']}"
            self._make_action_button(
                template_frame,
                button_text,
                lambda selected=template["key"]: self.create_offer_from_template(selected),
                "#162235",
                small=True,
            ).pack(side="left", padx=(0, 8), pady=(0, 8))

        cards_shell = tk.Frame(parent, bg="#0d1524")
        cards_shell.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self.browser_canvas = tk.Canvas(cards_shell, bg="#0d1524", highlightthickness=0)
        browser_scroll = ttk.Scrollbar(cards_shell, orient="vertical", command=self.browser_canvas.yview)
        self.browser_canvas.configure(yscrollcommand=browser_scroll.set)
        browser_scroll.pack(side="right", fill="y")
        self.browser_canvas.pack(side="left", fill="both", expand=True)
        self.browser_inner = tk.Frame(self.browser_canvas, bg="#0d1524")
        self.browser_canvas.create_window((0, 0), window=self.browser_inner, anchor="nw")
        self.browser_inner.bind("<Configure>", lambda _event: self.browser_canvas.configure(scrollregion=self.browser_canvas.bbox("all")))
        self.browser_canvas.bind("<Configure>", lambda event: self.browser_canvas.itemconfigure(1, width=event.width))

    def _build_builder_panel(self, parent):
        top_actions = tk.Frame(parent, bg="#08101b")
        top_actions.pack(fill="x", padx=12, pady=(12, 8))
        tk.Label(top_actions, text="Offer Builder", bg="#08101b", fg="#ffffff", font=("Segoe UI Semibold", 16)).pack(side="left")
        self._make_action_button(top_actions, "✓ Save Offer", self.save_selected_offer, "#2d5d86").pack(side="right", padx=(8, 0))
        self._make_action_button(top_actions, "↗ Open Source Link", self.open_source_page, "#1b2b42", small=True).pack(side="right")

        shell = tk.Frame(parent, bg="#08101b")
        shell.pack(fill="both", expand=True, padx=12, pady=(0, 10))
        self.builder_canvas = tk.Canvas(shell, bg="#08101b", highlightthickness=0)
        builder_scroll = ttk.Scrollbar(shell, orient="vertical", command=self.builder_canvas.yview)
        self.builder_canvas.configure(yscrollcommand=builder_scroll.set)
        builder_scroll.pack(side="right", fill="y")
        self.builder_canvas.pack(side="left", fill="both", expand=True)
        self.builder_inner = tk.Frame(self.builder_canvas, bg="#08101b")
        self.builder_canvas.create_window((0, 0), window=self.builder_inner, anchor="nw")
        self.builder_inner.bind("<Configure>", lambda _event: self.builder_canvas.configure(scrollregion=self.builder_canvas.bbox("all")))
        self.builder_canvas.bind("<Configure>", lambda event: self.builder_canvas.itemconfigure(1, width=event.width))

        banner = tk.Frame(self.builder_inner, bg="#0f1828", highlightthickness=1, highlightbackground="#21314d")
        banner.pack(fill="x", pady=(0, 12))
        tk.Label(banner, text="Simple editing mode", bg="#0f1828", fg="#ffffff", font=("Segoe UI Semibold", 13)).pack(anchor="w", padx=14, pady=(12, 2))
        tk.Label(banner, text="You are editing the same real cached store data, just through big friendly controls instead of raw payloads.", bg="#0f1828", fg="#8ea3c7", font=("Segoe UI", 10), wraplength=980, justify="left").pack(anchor="w", padx=14, pady=(0, 12))

        self._build_basics_section(self.builder_inner)
        self._build_rewards_section(self.builder_inner)
        self._build_tags_categories_section(self.builder_inner)
        self._build_visual_section(self.builder_inner)
        self._build_preview_section(self.builder_inner)

    def _build_basics_section(self, parent):
        section = ttk.LabelFrame(parent, text="Basics")
        section.pack(fill="x", pady=(0, 12))
        wrap = tk.Frame(section, bg="#08101b")
        wrap.pack(fill="x", padx=12, pady=12)

        top = tk.Frame(wrap, bg="#08101b")
        top.pack(fill="x")
        self._labeled_readonly(top, "Family", self.scope_readout_var).pack(side="left", fill="x", expand=True, padx=(0, 10))
        self._labeled_readonly(top, "Internal ID", self.internal_id_var).pack(side="left", fill="x", expand=True, padx=(0, 10))
        self._labeled_entry(top, "Store Offer ID", self.store_offer_id_var).pack(side="left", fill="x", expand=True)

        middle = tk.Frame(wrap, bg="#08101b")
        middle.pack(fill="x", pady=(10, 0))
        self._labeled_entry(middle, "Offer name", self.name_var).pack(side="left", fill="x", expand=True, padx=(0, 10))
        self._labeled_entry(middle, "Price", self.price_var, width=12).pack(side="left", padx=(0, 10))
        self._labeled_combobox(middle, "Currency", self.currency_var, ["PLX", "USD", "EUR", "GBP", "JPY", "CNY"]).pack(side="left", padx=(0, 10))

        self.fast_fields_wrap = tk.Frame(wrap, bg="#08101b")
        self.fast_quantity_group = self._labeled_entry(self.fast_fields_wrap, "PLEX in pack", self.fast_quantity_var, width=12)
        self.fast_quantity_group.pack(side="left", padx=(0, 10))
        self.fast_base_quantity_group = self._labeled_entry(self.fast_fields_wrap, "Base amount", self.fast_base_quantity_var, width=12)
        self.fast_base_quantity_group.pack(side="left")

        tk.Label(wrap, text="Short description", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w", pady=(12, 4))
        self.description_text = tk.Text(wrap, height=4, wrap="word", bg="#101726", fg="#f5f8ff", insertbackground="#ffffff", relief="flat", padx=10, pady=8, font=("Segoe UI", 10))
        self.description_text.pack(fill="x")

    def _build_rewards_section(self, parent):
        section = ttk.LabelFrame(parent, text="What the player gets")
        section.pack(fill="x", pady=(0, 12))
        wrap = tk.Frame(section, bg="#08101b")
        wrap.pack(fill="x", padx=12, pady=12)

        tk.Label(wrap, text="Choose the reward in simple language. Bundles can have multiple gift blocks.", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w")

        top = tk.Frame(wrap, bg="#08101b")
        top.pack(fill="x", pady=(10, 0))
        self.reward_kind_box = ttk.Combobox(top, state="readonly", values=[label for label, _ in REWARD_CHOICES], textvariable=self.reward_kind_display_var, width=30)
        self.reward_kind_box.pack(side="left")
        self.reward_kind_box.bind("<<ComboboxSelected>>", lambda _event: self.refresh_reward_editor())
        self._make_action_button(top, "Add gift block", self.add_bundle_row, "#1b2b42", small=True).pack(side="right")

        self.single_reward_frame = tk.Frame(wrap, bg="#08101b")
        self.single_reward_fields = tk.Frame(self.single_reward_frame, bg="#08101b")
        self.single_reward_fields.pack(fill="x")

        self.bundle_holder = tk.Frame(wrap, bg="#08101b")
        self.bundle_hint = tk.Label(self.bundle_holder, text="Each gift block is one thing the player receives.", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9))
        self.bundle_hint.pack(anchor="w", pady=(0, 8))
        self.bundle_rows_frame = tk.Frame(self.bundle_holder, bg="#08101b")
        self.bundle_rows_frame.pack(fill="x")

    def _build_tags_categories_section(self, parent):
        section = ttk.LabelFrame(parent, text="Store placement")
        section.pack(fill="x", pady=(0, 12))
        wrap = tk.Frame(section, bg="#08101b")
        wrap.pack(fill="x", padx=12, pady=12)

        tk.Label(wrap, text="Click tags and categories instead of typing comma-separated lists.", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w")
        tk.Label(wrap, text="Tags", bg="#08101b", fg="#ffffff", font=("Segoe UI Semibold", 10)).pack(anchor="w", pady=(10, 4))
        self.tags_wrap = tk.Frame(wrap, bg="#08101b")
        self.tags_wrap.pack(fill="x")
        self.custom_tags_group = self._labeled_entry(wrap, "Extra tags (optional)", self.custom_tags_var)
        self.custom_tags_group.pack(fill="x", pady=(10, 0))

        tk.Label(wrap, text="Legacy categories", bg="#08101b", fg="#ffffff", font=("Segoe UI Semibold", 10)).pack(anchor="w", pady=(14, 4))
        self.categories_wrap = tk.Frame(wrap, bg="#08101b")
        self.categories_wrap.pack(fill="x")

    def _build_visual_section(self, parent):
        section = ttk.LabelFrame(parent, text="Look and feel")
        section.pack(fill="x", pady=(0, 12))
        wrap = tk.Frame(section, bg="#08101b")
        wrap.pack(fill="x", padx=12, pady=12)

        tk.Label(wrap, text="Give the offer a mood. You can type colors manually or tap a visual theme.", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w")

        top = tk.Frame(wrap, bg="#08101b")
        top.pack(fill="x", pady=(10, 0))
        self._labeled_entry(top, "Badge text", self.badge_var).pack(side="left", fill="x", expand=True, padx=(0, 10))
        self._labeled_entry(top, "Image URL (optional)", self.image_url_var).pack(side="left", fill="x", expand=True, padx=(0, 10))
        self._labeled_entry(top, "Source link", self.source_url_var).pack(side="left", fill="x", expand=True)

        bottom = tk.Frame(wrap, bg="#08101b")
        bottom.pack(fill="x", pady=(12, 0))
        self._build_color_picker(bottom, "Accent color", self.accent_var).pack(side="left", padx=(0, 16))
        self._build_color_picker(bottom, "Shadow color", self.secondary_var).pack(side="left")

        theme_row = tk.Frame(wrap, bg="#08101b")
        theme_row.pack(fill="x", pady=(12, 0))
        tk.Label(theme_row, text="Quick themes", bg="#08101b", fg="#ffffff", font=("Segoe UI Semibold", 10)).pack(anchor="w")
        chips = tk.Frame(theme_row, bg="#08101b")
        chips.pack(anchor="w", pady=(8, 0))
        for name, accent, secondary in VISUAL_THEMES:
            button = tk.Button(
                chips,
                text=name,
                command=lambda a=accent, s=secondary: self.apply_visual_theme(a, s),
                bg=blend_color(accent, "#111827", 0.65),
                fg="#ffffff",
                activebackground=accent,
                activeforeground="#ffffff",
                relief="flat",
                bd=0,
                padx=10,
                pady=6,
                cursor="hand2",
                font=("Segoe UI Semibold", 9),
            )
            button.pack(side="left", padx=(0, 8))

    def _build_preview_section(self, parent):
        section = ttk.LabelFrame(parent, text="Live preview")
        section.pack(fill="both", expand=True, pady=(0, 12))
        wrap = tk.Frame(section, bg="#08101b")
        wrap.pack(fill="both", expand=True, padx=12, pady=12)
        tk.Label(wrap, text="This preview is intentionally visual, so someone non-technical can see what the offer feels like before saving.", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9), wraplength=980, justify="left").pack(anchor="w")
        self.preview_canvas = tk.Canvas(wrap, bg="#09111d", height=400, highlightthickness=0)
        self.preview_canvas.pack(fill="both", expand=True, pady=(10, 0))

    def _build_settings_tab(self, parent):
        header = tk.Frame(parent, bg="#08101b")
        header.pack(fill="x", padx=14, pady=(14, 10))
        tk.Label(header, text="Store Settings", bg="#08101b", fg="#ffffff", font=("Segoe UI Semibold", 16)).pack(anchor="w")
        tk.Label(header, text="These are the plain-language switches behind the store services.", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 10)).pack(anchor="w", pady=(4, 0))

        self.settings_canvas = tk.Canvas(parent, bg="#08101b", highlightthickness=0)
        settings_scroll = ttk.Scrollbar(parent, orient="vertical", command=self.settings_canvas.yview)
        self.settings_canvas.configure(yscrollcommand=settings_scroll.set)
        settings_scroll.pack(side="right", fill="y", pady=(0, 10))
        self.settings_canvas.pack(side="left", fill="both", expand=True, padx=14, pady=(0, 10))

        self.settings_inner = tk.Frame(self.settings_canvas, bg="#08101b")
        self.settings_canvas.create_window((0, 0), window=self.settings_inner, anchor="nw")
        self.settings_inner.bind("<Configure>", lambda _event: self.settings_canvas.configure(scrollregion=self.settings_canvas.bbox("all")))
        self.settings_canvas.bind("<Configure>", lambda event: self.settings_canvas.itemconfigure(1, width=event.width))

        for key in STORE_CONFIG_KEYS:
            title, subtitle = FRIENDLY_CONFIG.get(key, (key, ""))
            default_value = DEFAULT_STORE_CONFIG[key]
            self.config_vars[key] = tk.BooleanVar(value=default_value) if isinstance(default_value, bool) else tk.StringVar(value=str(default_value))
            card = tk.Frame(self.settings_inner, bg="#101726", highlightthickness=1, highlightbackground="#1d2940")
            card.pack(fill="x", pady=(0, 10))
            inner = tk.Frame(card, bg="#101726")
            inner.pack(fill="x", padx=14, pady=14)
            tk.Label(inner, text=title, bg="#101726", fg="#ffffff", font=("Segoe UI Semibold", 12)).pack(anchor="w")
            tk.Label(inner, text=subtitle, bg="#101726", fg="#8ea3c7", font=("Segoe UI", 9), wraplength=1000, justify="left").pack(anchor="w", pady=(4, 10))
            variable = self.config_vars[key]
            if isinstance(default_value, bool):
                tk.Checkbutton(inner, text="Enabled", variable=variable, bg="#101726", fg="#eef5ff", activebackground="#101726", activeforeground="#ffffff", selectcolor="#1d2940", font=("Segoe UI Semibold", 10)).pack(anchor="w")
            else:
                ttk.Entry(inner, textvariable=variable, width=48).pack(anchor="w")

        footer = tk.Frame(self.settings_inner, bg="#08101b")
        footer.pack(fill="x", pady=(4, 0))
        self._make_action_button(footer, "Save Settings", self.save_config, "#2d5d86").pack(side="right")

    def _build_advanced_tab(self, parent):
        header = tk.Frame(parent, bg="#08101b")
        header.pack(fill="x", padx=14, pady=(14, 10))
        tk.Label(header, text="Advanced JSON", bg="#08101b", fg="#ffffff", font=("Segoe UI Semibold", 16)).pack(anchor="w")
        tk.Label(header, text="Only use this when the visual editor does not cover an edge case. The main workflow is the Visual Editor tab.", bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 10), wraplength=1200, justify="left").pack(anchor="w", pady=(4, 0))

        toolbar = tk.Frame(parent, bg="#08101b")
        toolbar.pack(fill="x", padx=14, pady=(0, 8))
        self._make_action_button(toolbar, "Save Advanced JSON", self.save_raw_json, "#2d5d86").pack(side="right")
        self._make_action_button(toolbar, "Reload JSON", self.reload_from_disk, "#1b2b42", small=True).pack(side="right", padx=(0, 8))

        split = tk.PanedWindow(parent, orient="horizontal", sashwidth=8, bg="#08101b")
        split.pack(fill="both", expand=True, padx=14, pady=(0, 12))
        authority_frame = ttk.LabelFrame(split, text="Authority JSON")
        runtime_frame = ttk.LabelFrame(split, text="Runtime JSON")
        selected_frame = ttk.LabelFrame(split, text="Selected offer JSON")
        split.add(authority_frame, minsize=480)
        split.add(runtime_frame, minsize=420)
        split.add(selected_frame, minsize=360)

        self.authority_text = ScrolledText(authority_frame, wrap="none", bg="#101726", fg="#f5f8ff", insertbackground="#ffffff", relief="flat")
        self.authority_text.pack(fill="both", expand=True, padx=8, pady=8)
        self.runtime_text = ScrolledText(runtime_frame, wrap="none", bg="#101726", fg="#f5f8ff", insertbackground="#ffffff", relief="flat")
        self.runtime_text.pack(fill="both", expand=True, padx=8, pady=8)
        self.selected_offer_text = ScrolledText(selected_frame, wrap="none", bg="#101726", fg="#f5f8ff", insertbackground="#ffffff", relief="flat")
        self.selected_offer_text.pack(fill="both", expand=True, padx=8, pady=8)

    def _make_action_button(self, parent, text, command, color, small=False):
        return tk.Button(parent, text=text, command=command, bg=color, fg="#ffffff", activebackground=blend_color(color, "#ffffff", 0.12), activeforeground="#ffffff", relief="flat", bd=0, padx=12 if not small else 10, pady=8 if not small else 6, cursor="hand2", font=("Segoe UI Semibold", 9))

    def _labeled_entry(self, parent, label_text, variable, width=None):
        group = tk.Frame(parent, bg="#08101b")
        tk.Label(group, text=label_text, bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w")
        entry = ttk.Entry(group, textvariable=variable, width=width)
        entry.pack(fill="x", pady=(4, 0))
        entry.bind("<KeyRelease>", lambda _event: self.refresh_preview_from_form())
        return group

    def _labeled_readonly(self, parent, label_text, variable):
        group = tk.Frame(parent, bg="#08101b")
        tk.Label(group, text=label_text, bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w")
        ttk.Entry(group, textvariable=variable, state="readonly").pack(fill="x", pady=(4, 0))
        return group

    def _labeled_combobox(self, parent, label_text, variable, values):
        group = tk.Frame(parent, bg="#08101b")
        tk.Label(group, text=label_text, bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w")
        box = ttk.Combobox(group, state="readonly", values=values, textvariable=variable, width=12)
        box.pack(fill="x", pady=(4, 0))
        box.bind("<<ComboboxSelected>>", lambda _event: self.refresh_preview_from_form())
        return group

    def _build_color_picker(self, parent, label_text, variable):
        group = tk.Frame(parent, bg="#08101b")
        tk.Label(group, text=label_text, bg="#08101b", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w")
        row = tk.Frame(group, bg="#08101b")
        row.pack(anchor="w", pady=(4, 0))
        swatch = tk.Label(row, width=4, bg=parse_hex_color(variable.get(), "#4fb3ff"), relief="flat", bd=0)
        swatch.pack(side="left")
        ttk.Entry(row, textvariable=variable, width=12).pack(side="left", padx=(8, 8))
        self._make_action_button(row, "Pick", lambda v=variable, s=swatch: self.choose_color(v, s), "#1b2b42", small=True).pack(side="left")
        variable.trace_add("write", lambda *_args, v=variable, s=swatch: self._update_color_swatch(v, s))
        return group

    def _update_color_swatch(self, variable, swatch):
        swatch.configure(bg=parse_hex_color(variable.get(), "#4fb3ff"))
        self.refresh_preview_from_form()

    def choose_color(self, variable, swatch):
        selected = colorchooser.askcolor(color=variable.get(), parent=self)[1]
        if selected:
            variable.set(selected)
            swatch.configure(bg=selected)

    def apply_visual_theme(self, accent, secondary):
        self.accent_var.set(accent)
        self.secondary_var.set(secondary)
        self.set_status("Applied a visual theme to the current offer draft.")

    def get_resource_path_index(self):
        if self.resource_path_index is not None:
            return self.resource_path_index

        index = {}
        if CLIENT_RES_INDEX_PATH.exists():
            with CLIENT_RES_INDEX_PATH.open("r", encoding="utf-8", errors="ignore") as handle:
                for line in handle:
                    parts = line.strip().split(",", 2)
                    if len(parts) < 2:
                        continue
                    resource_path = parts[0].strip()
                    hashed_path = parts[1].strip()
                    if not resource_path or not hashed_path:
                        continue
                    index[resource_path.lower()] = hashed_path

        self.resource_path_index = index
        return self.resource_path_index

    def resolve_local_image_source(self, source_text):
        normalized = str(source_text or "").strip()
        if not normalized:
            return None

        lowered = normalized.lower()
        if lowered.startswith("res:/"):
            hashed_path = self.get_resource_path_index().get(lowered)
            if not hashed_path:
                return None
            candidate = CLIENT_RES_FILES_ROOT / Path(hashed_path.replace("/", "\\"))
            return candidate if candidate.exists() else None

        source_path = Path(normalized)
        if not source_path.is_absolute():
            source_path = (REPO_ROOT / source_path).resolve()
        return source_path if source_path.exists() else None

    def load_preview_image(self, source_text, target_width, target_height):
        source_text = str(source_text or "").strip()
        if not source_text:
            return None
        cache_key = (source_text, target_width, target_height)
        if cache_key in self.image_cache:
            return self.image_cache[cache_key]
        try:
            if source_text.startswith(("http://", "https://")):
                with urllib.request.urlopen(source_text, timeout=3) as response:
                    payload = response.read()
                image = tk.PhotoImage(data=base64.b64encode(payload).decode("ascii"))
            else:
                source_path = self.resolve_local_image_source(source_text)
                if not source_path:
                    self.image_cache[cache_key] = None
                    return None
                image = tk.PhotoImage(file=str(source_path))

            width = max(1, image.width())
            height = max(1, image.height())
            scale = max(width / max(1, target_width), height / max(1, target_height), 1)
            sample = max(1, math.ceil(scale))
            if sample > 1:
                image = image.subsample(sample, sample)
            self.image_cache[cache_key] = image
            return image
        except Exception:
            self.image_cache[cache_key] = None
            return None

    def _bind_live_preview_watchers(self):
        watched = [
            self.name_var,
            self.price_var,
            self.currency_var,
            self.fast_quantity_var,
            self.fast_base_quantity_var,
            self.badge_var,
            self.accent_var,
            self.secondary_var,
            self.image_url_var,
            self.source_url_var,
            self.store_offer_id_var,
            self.custom_tags_var,
            self.reward_kind_display_var,
            self.reward_item_type_var,
            self.reward_item_quantity_var,
            self.reward_plex_var,
            self.reward_days_var,
            self.reward_slot_count_var,
            self.reward_skill_points_var,
        ]
        for variable in watched:
            variable.trace_add("write", lambda *_args: self.refresh_preview_from_form())
        self.description_text.bind("<KeyRelease>", lambda _event: self.refresh_preview_from_form())

    def set_status(self, message):
        self.status_var.set(message)

    def set_scope_filter(self, scope):
        self.filter_scope_var.set(scope)
        self._refresh_scope_filter_buttons()
        self.rebuild_offer_cards()

    def _refresh_scope_filter_buttons(self):
        active_scope = self.filter_scope_var.get()
        for scope, button in self.scope_filter_buttons.items():
            if scope == active_scope:
                button.configure(bg=SCOPE_COLORS.get(scope, "#31527b"), fg="#ffffff", activebackground=SCOPE_COLORS.get(scope, "#31527b"))
            else:
                button.configure(bg="#182437", fg="#cfe1ff", activebackground="#22344f")

    def reload_from_disk(self):
        try:
            self.authority = read_json(AUTHORITY_PATH, {})
            self.runtime = read_json(RUNTIME_PATH, {})
            self.local_config = read_json(LOCAL_CONFIG_PATH, {})
            self.known_tags = collect_known_tags(self.authority)
            self.known_categories = collect_known_categories(self.authority)
            self._update_summary_cards()
            self._refresh_toggle_chips()
            self._load_config_vars()
            self._sync_advanced_json_text()
            self.rebuild_offer_cards(keep_selection=True)
            self.set_status("Loaded authority, runtime cache, and store settings.")
        except Exception as error:  # noqa: BLE001
            messagebox.showerror("Store Editor", str(error))
            self.set_status(f"Failed to load editor state: {error}")

    def _load_config_vars(self):
        for key in STORE_CONFIG_KEYS:
            value = self.local_config.get(key, DEFAULT_STORE_CONFIG[key])
            variable = self.config_vars[key]
            if isinstance(variable, tk.BooleanVar):
                variable.set(bool(value))
            else:
                variable.set("" if value is None else str(value))

    def _sync_advanced_json_text(self):
        self.authority_text.delete("1.0", "end")
        self.authority_text.insert("1.0", json.dumps(self.authority, indent=2))
        self.runtime_text.delete("1.0", "end")
        self.runtime_text.insert("1.0", json.dumps(self.runtime, indent=2))

    def _update_summary_cards(self):
        values = [
            (len(get_legacy_offers(self.authority)), "Legacy offers"),
            (len(get_public_offers(self.authority)), "Public offers"),
            (len(get_fast_offers(self.authority)), "Fast checkout offers"),
            (len((self.runtime.get("accounts") or {})), "Runtime accounts"),
            (len((self.runtime.get("completedPurchases") or {})), "Completed purchases"),
        ]
        for (value_label, text_label), (value, label) in zip(self.summary_cards, values):
            value_label.configure(text=str(value))
            text_label.configure(text=label)

    def _refresh_toggle_chips(self):
        for child in self.tags_wrap.winfo_children():
            child.destroy()
        for child in self.categories_wrap.winfo_children():
            child.destroy()
        self.tag_vars = {}
        self.category_vars = {}
        for tag in self.known_tags:
            variable = tk.BooleanVar(value=False)
            self.tag_vars[tag] = variable
            self._make_chip(self.tags_wrap, tag, variable).pack(side="left", padx=(0, 8), pady=(0, 8))
        for category in self.known_categories:
            variable = tk.BooleanVar(value=False)
            self.category_vars[category["id"]] = variable
            self._make_chip(self.categories_wrap, category["name"], variable).pack(side="left", padx=(0, 8), pady=(0, 8))

    def _make_chip(self, parent, text, variable):
        return tk.Checkbutton(parent, text=text, variable=variable, indicatoron=False, bg="#101726", fg="#dce7ff", activebackground="#24354f", activeforeground="#ffffff", selectcolor="#31527b", relief="flat", bd=0, padx=10, pady=6, cursor="hand2", font=("Segoe UI", 9), command=self.refresh_preview_from_form)

    def build_visible_items(self):
        active_scope = self.filter_scope_var.get()
        filter_text = self.search_var.get().strip().lower()
        items = []

        def maybe_add(scope, offer, actual_index=None, stable_key=None):
            title = str(offer.get("name") or "Unnamed offer")
            offer_id = str(offer.get("storeOfferID") or stable_key or "")
            haystack = f"{title} {offer_id} {' '.join(offer.get('tags') or [])}".lower()
            if filter_text and filter_text not in haystack:
                return
            items.append({"scope": scope, "stable_key": stable_key, "actual_index": actual_index, "offer": offer})

        if active_scope in ("all", "legacy"):
            for index, offer in enumerate(get_legacy_offers(self.authority)):
                maybe_add("legacy", offer, actual_index=index, stable_key=parse_int(offer.get("id"), 0))
        if active_scope in ("all", "public"):
            for index, (store_offer_id, offer) in enumerate(get_public_offers(self.authority).items()):
                maybe_add("public", offer, actual_index=index, stable_key=str(store_offer_id))
        if active_scope in ("all", "fast"):
            for index, offer in enumerate(get_fast_offers(self.authority)):
                maybe_add("fast", offer, actual_index=index, stable_key=parse_int(offer.get("id"), 0))
        return items

    def rebuild_offer_cards(self, keep_selection=False):
        previous_meta = self.current_meta if keep_selection else None
        self.visible_items = self.build_visible_items()
        self.card_views = []
        self.drag_context = None
        for child in self.browser_inner.winfo_children():
            child.destroy()

        if not self.visible_items:
            empty = tk.Frame(self.browser_inner, bg="#101726", highlightthickness=1, highlightbackground="#1d2940")
            empty.pack(fill="x", pady=(0, 10))
            tk.Label(empty, text="No offers match this view.", bg="#101726", fg="#ffffff", font=("Segoe UI Semibold", 11)).pack(anchor="w", padx=14, pady=(12, 4))
            tk.Label(empty, text="Try clearing the search box or choose a different family filter.", bg="#101726", fg="#8ea3c7", font=("Segoe UI", 9)).pack(anchor="w", padx=14, pady=(0, 12))
            self.clear_editor()
            return

        for item in self.visible_items:
            card = self._create_offer_card(self.browser_inner, item)
            card.pack(fill="x", pady=(0, 10))
            self.card_views.append({"frame": card, "item": item})

        selection_seed = previous_meta if previous_meta and self.find_offer_record(previous_meta)[0] else {"scope": self.visible_items[0]["scope"], "stable_key": self.visible_items[0]["stable_key"]}
        self.select_offer(selection_seed)

    def _create_offer_card(self, parent, item):
        scope = item["scope"]
        offer = item["offer"]
        accent = parse_hex_color((offer.get("preview") or {}).get("accent"), SCOPE_COLORS.get(scope, "#4fb3ff"))
        card = tk.Frame(parent, bg="#101726", highlightthickness=1, highlightbackground="#1f2c45", cursor="hand2")
        tk.Frame(card, bg=accent, width=8).pack(side="left", fill="y")
        content = tk.Frame(card, bg="#101726")
        content.pack(side="left", fill="both", expand=True, padx=12, pady=10)

        icon_canvas = tk.Canvas(content, width=42, height=42, bg="#101726", highlightthickness=0)
        icon_canvas.pack(side="left", padx=(0, 12))
        card_image = self.load_preview_image(offer.get("imageUrl"), 38, 38)
        if card_image:
            icon_canvas.image = card_image
            icon_canvas.create_rectangle(2, 2, 40, 40, fill="#0f1828", outline="")
            icon_canvas.create_image(21, 21, image=card_image)
        else:
            icon_canvas.create_oval(3, 3, 39, 39, fill=accent, outline="")
            icon_canvas.create_text(21, 21, text=scope[:1].upper(), fill="#ffffff", font=("Segoe UI Semibold", 13))

        text_wrap = tk.Frame(content, bg="#101726")
        text_wrap.pack(side="left", fill="x", expand=True)
        top = tk.Frame(text_wrap, bg="#101726")
        top.pack(fill="x")
        tk.Label(top, text=str(offer.get("name") or "Unnamed offer"), bg="#101726", fg="#ffffff", font=("Segoe UI Semibold", 11)).pack(side="left", anchor="w")
        tk.Label(top, text=SCOPE_LABELS[scope], bg=blend_color(accent, "#101726", 0.65), fg="#ffffff", font=("Segoe UI", 8), padx=8, pady=3).pack(side="right")
        tk.Label(text_wrap, text=f"{str(offer.get('storeOfferID') or item['stable_key'])}  |  {format_offer_price(scope, offer)}", bg="#101726", fg="#9fb2d1", font=("Segoe UI", 9)).pack(anchor="w", pady=(4, 2))
        tk.Label(text_wrap, text=create_offer_signature_text(offer), bg="#101726", fg="#dce7ff", font=("Segoe UI", 9)).pack(anchor="w")
        tags = offer.get("tags") or []
        if tags:
            tk.Label(text_wrap, text="  ".join(f"#{tag}" for tag in tags[:3]), bg="#101726", fg=accent, font=("Segoe UI Semibold", 8)).pack(anchor="w", pady=(4, 0))

        drag_handle = tk.Label(content, text="↕ Drag", bg="#182437", fg="#dce7ff", font=("Segoe UI Semibold", 8), padx=8, pady=6, cursor="fleur")
        drag_handle.pack(side="right", padx=(10, 0))

        def select_only(_event=None, meta_scope=scope, key=item["stable_key"]):
            self.select_offer({"scope": meta_scope, "stable_key": key})

        def start_drag(event, meta_scope=scope, key=item["stable_key"]):
            self.select_offer({"scope": meta_scope, "stable_key": key})
            self.begin_drag(event, {"scope": meta_scope, "stable_key": key})

        for widget in (card, content, text_wrap, top, icon_canvas):
            widget.bind("<Button-1>", select_only)
        drag_handle.bind("<Button-1>", start_drag)
        drag_handle.bind("<B1-Motion>", self.handle_drag_motion)
        drag_handle.bind("<ButtonRelease-1>", self.finish_drag)
        return card

    def begin_drag(self, _event, meta):
        if self.filter_scope_var.get() not in ("legacy", "public", "fast"):
            self.set_status("To drag cards, first choose one family instead of All offers.")
            return
        if self.search_var.get().strip():
            self.set_status("To drag cards, clear the search box first so the order is unfiltered.")
            return
        for index, item in enumerate(self.visible_items):
            if item["scope"] == meta["scope"] and item["stable_key"] == meta["stable_key"]:
                self.drag_context = {"meta": meta, "from_index": index, "insert_index": index}
                self._refresh_card_selection_styles()
                return

    def handle_drag_motion(self, event):
        if not self.drag_context:
            return
        pointer_y = event.widget.winfo_pointery()
        insert_index = len(self.card_views)
        for index, view in enumerate(self.card_views):
            top = view["frame"].winfo_rooty()
            middle = top + (view["frame"].winfo_height() / 2)
            if pointer_y < middle:
                insert_index = index
                break
        self.drag_context["insert_index"] = insert_index
        self._refresh_card_selection_styles()

    def finish_drag(self, _event=None):
        if not self.drag_context:
            return
        from_index = self.drag_context["from_index"]
        insert_index = self.drag_context["insert_index"]
        self.drag_context = None
        if insert_index > from_index:
            insert_index -= 1
        if insert_index == from_index or insert_index < 0:
            self._refresh_card_selection_styles()
            return
        self.reorder_scope_item(self.filter_scope_var.get(), from_index, insert_index)
        self.persist_authority_only()
        self.rebuild_offer_cards(keep_selection=True)
        self.set_status("Reordered offer cards.")

    def reorder_scope_item(self, scope, from_index, to_index):
        if scope == "legacy":
            offers = get_legacy_offers(self.authority)
            moved = offers.pop(from_index)
            offers.insert(to_index, moved)
            return
        if scope == "fast":
            offers = get_fast_offers(self.authority)
            moved = offers.pop(from_index)
            offers.insert(to_index, moved)
            return
        if scope == "public":
            items = list(get_public_offers(self.authority).items())
            moved = items.pop(from_index)
            items.insert(to_index, moved)
            self.authority["publicOffers"] = {key: value for key, value in items}

    def _refresh_card_selection_styles(self):
        active_meta = self.current_meta
        drag_meta = self.drag_context["meta"] if self.drag_context else None
        insert_index = self.drag_context["insert_index"] if self.drag_context else None
        for index, view in enumerate(self.card_views):
            frame = view["frame"]
            item = view["item"]
            is_selected = active_meta and item["scope"] == active_meta["scope"] and item["stable_key"] == active_meta["stable_key"]
            is_dragged = drag_meta and item["scope"] == drag_meta["scope"] and item["stable_key"] == drag_meta["stable_key"]
            frame.configure(highlightbackground="#31527b" if is_selected else "#1f2c45")
            frame.configure(bg="#172335" if is_dragged else "#101726")
            if insert_index is not None and index == insert_index:
                frame.configure(highlightbackground="#f7bc4d")

    def find_offer_record(self, meta):
        if not meta:
            return None, None
        scope = meta["scope"]
        stable_key = meta["stable_key"]
        if scope == "legacy":
            for index, offer in enumerate(get_legacy_offers(self.authority)):
                if parse_int(offer.get("id"), 0) == parse_int(stable_key, 0):
                    return offer, index
        elif scope == "public":
            offers = get_public_offers(self.authority)
            if stable_key in offers:
                keys = list(offers.keys())
                return offers[stable_key], keys.index(stable_key)
        elif scope == "fast":
            for index, offer in enumerate(get_fast_offers(self.authority)):
                if parse_int(offer.get("id"), 0) == parse_int(stable_key, 0):
                    return offer, index
        return None, None

    def select_offer(self, meta):
        offer, _index = self.find_offer_record(meta)
        if not offer:
            return
        self.current_meta = meta
        self._refresh_card_selection_styles()
        self.load_offer_into_form(meta, offer)

    def clear_editor(self):
        self.current_meta = None
        self.scope_readout_var.set("")
        self.internal_id_var.set("")
        self.store_offer_id_var.set("")
        self.name_var.set("")
        self.price_var.set("")
        self.currency_var.set("PLX")
        self.fast_quantity_var.set("")
        self.fast_base_quantity_var.set("")
        self.image_url_var.set("")
        self.source_url_var.set("")
        self.badge_var.set("")
        self.accent_var.set("#4fb3ff")
        self.secondary_var.set("#10233e")
        self.custom_tags_var.set("")
        self.description_text.delete("1.0", "end")
        self.selected_offer_text.delete("1.0", "end")
        self.clear_bundle_rows()
        self.refresh_reward_editor()
        self.preview_canvas.delete("all")

    def load_offer_into_form(self, meta, offer):
        scope = meta["scope"]
        self.scope_readout_var.set(SCOPE_LABELS[scope])
        self.internal_id_var.set(str(offer.get("id") or "dictionary entry"))
        self.store_offer_id_var.set(str(offer.get("storeOfferID") or ""))
        self.name_var.set(str(offer.get("name") or ""))
        self.image_url_var.set(str(offer.get("imageUrl") or ""))
        self.source_url_var.set(str(((offer.get("source") or {}).get("url")) or ""))
        preview = offer.get("preview") if isinstance(offer.get("preview"), dict) else {}
        self.badge_var.set(str(preview.get("badge") or ""))
        self.accent_var.set(parse_hex_color(preview.get("accent"), SCOPE_COLORS.get(scope, "#4fb3ff")))
        self.secondary_var.set(parse_hex_color(preview.get("secondary"), "#10233e"))
        self.description_text.delete("1.0", "end")
        self.description_text.insert("1.0", str(offer.get("description") or ""))

        if scope == "legacy":
            pricing = (offer.get("offerPricings") or [{}])[0]
            self.price_var.set(str(pricing.get("price", 0)))
            self.currency_var.set(str(pricing.get("currency") or "PLX"))
            self.fast_quantity_var.set("")
            self.fast_base_quantity_var.set("")
        elif scope == "public":
            if offer.get("currencyCode"):
                self.price_var.set(f"{((offer.get('currencyAmountInCents') or 0) / 100):.2f}")
                self.currency_var.set(str(offer.get("currencyCode") or "USD"))
            else:
                self.price_var.set(f"{((offer.get('plexPriceInCents') or 0) / 100):.2f}")
                self.currency_var.set("PLX")
            self.fast_quantity_var.set("")
            self.fast_base_quantity_var.set("")
        else:
            self.price_var.set(str(offer.get("price", 0)))
            self.currency_var.set(str(offer.get("currency") or "USD"))
            self.fast_quantity_var.set(str(offer.get("quantity", 0)))
            self.fast_base_quantity_var.set(str(offer.get("baseQuantity", 0)))

        self._set_tag_selection(offer.get("tags") or [])
        self._set_category_selection(offer.get("categories") or [])
        self.load_fulfillment(offer.get("fulfillment") or {"kind": "item", "typeID": 34, "quantity": 1})
        self._toggle_scope_specific_fields(scope)
        self.selected_offer_text.delete("1.0", "end")
        self.selected_offer_text.insert("1.0", json.dumps(offer, indent=2))
        self.refresh_preview_from_form()

    def _toggle_scope_specific_fields(self, scope):
        if scope == "fast":
            self.fast_fields_wrap.pack(fill="x", pady=(10, 0))
        else:
            self.fast_fields_wrap.pack_forget()

    def _set_tag_selection(self, tags):
        tags = set(str(tag) for tag in tags)
        for tag, variable in self.tag_vars.items():
            variable.set(tag in tags)
        extras = [tag for tag in sorted(tags) if tag not in self.tag_vars]
        self.custom_tags_var.set(", ".join(extras))

    def _set_category_selection(self, categories):
        category_ids = set()
        for category in categories:
            if isinstance(category, dict):
                category_ids.add(parse_int(category.get("id"), 0))
            else:
                category_ids.add(parse_int(category, 0))
        for category_id, variable in self.category_vars.items():
            variable.set(category_id in category_ids)

    def _reward_kind_from_display(self):
        selected_label = self.reward_kind_display_var.get()
        for label, key in REWARD_CHOICES:
            if label == selected_label:
                return key
        return "item"

    def load_fulfillment(self, fulfillment):
        kind = str((fulfillment or {}).get("kind") or "item")
        self.reward_kind_display_var.set(next((label for label, key in REWARD_CHOICES if key == kind), REWARD_CHOICES[0][0]))
        self.clear_bundle_rows()
        self.reward_item_type_var.set(str((fulfillment or {}).get("typeID") or 34))
        self.reward_item_quantity_var.set(str((fulfillment or {}).get("quantity") or 1))
        self.reward_plex_var.set(str((fulfillment or {}).get("plexAmount") or 0))
        self.reward_days_var.set(str((fulfillment or {}).get("durationDays") or 30))
        self.reward_slot_count_var.set(str((fulfillment or {}).get("slotCount") or 1))
        self.reward_skill_points_var.set(str((fulfillment or {}).get("points") or 0))
        if kind == "bundle":
            grants = fulfillment.get("grants") if isinstance(fulfillment.get("grants"), list) else []
            for grant in (grants or [{"kind": "grant_plex", "plexAmount": 0}]):
                self.add_bundle_row(grant)
        self.refresh_reward_editor()

    def refresh_reward_editor(self):
        kind = self._reward_kind_from_display()
        for child in self.single_reward_fields.winfo_children():
            child.destroy()
        if kind == "bundle":
            self.single_reward_frame.pack_forget()
            self.bundle_holder.pack(fill="x", pady=(10, 0))
            if not self.bundle_rows:
                self.add_bundle_row()
            self.refresh_preview_from_form()
            return
        self.bundle_holder.pack_forget()
        self.single_reward_frame.pack(fill="x", pady=(10, 0))
        if kind == "item":
            self._labeled_entry(self.single_reward_fields, "Type ID", self.reward_item_type_var).pack(side="left", padx=(0, 10))
            self._labeled_entry(self.single_reward_fields, "Quantity", self.reward_item_quantity_var, width=12).pack(side="left")
        elif kind == "grant_plex":
            self._labeled_entry(self.single_reward_fields, "PLEX amount", self.reward_plex_var, width=14).pack(side="left")
        elif kind == "omega":
            self._labeled_entry(self.single_reward_fields, "Days", self.reward_days_var, width=12).pack(side="left")
        elif kind == "mct":
            self._labeled_entry(self.single_reward_fields, "Days", self.reward_days_var, width=12).pack(side="left", padx=(0, 10))
            self._labeled_entry(self.single_reward_fields, "Slots", self.reward_slot_count_var, width=12).pack(side="left")
        elif kind == "skill_points":
            self._labeled_entry(self.single_reward_fields, "Skill points", self.reward_skill_points_var, width=16).pack(side="left")
        self.refresh_preview_from_form()

    def add_bundle_row(self, payload=None):
        row = BundleGrantRow(self.bundle_rows_frame, self.remove_bundle_row, self.refresh_preview_from_form)
        row.pack(fill="x", pady=(0, 8))
        if payload:
            row.load(payload)
        self.bundle_rows.append(row)
        self.refresh_preview_from_form()

    def remove_bundle_row(self, row):
        if row in self.bundle_rows:
            self.bundle_rows.remove(row)
            row.destroy()
        if not self.bundle_rows and self._reward_kind_from_display() == "bundle":
            self.add_bundle_row()
        self.refresh_preview_from_form()

    def clear_bundle_rows(self):
        for row in list(self.bundle_rows):
            row.destroy()
        self.bundle_rows = []

    def build_fulfillment_from_form(self):
        kind = self._reward_kind_from_display()
        if kind == "item":
            return {"kind": "item", "typeID": max(0, parse_int(self.reward_item_type_var.get(), 0)), "quantity": max(1, parse_int(self.reward_item_quantity_var.get(), 1))}
        if kind == "grant_plex":
            return {"kind": "grant_plex", "plexAmount": max(0, parse_int(self.reward_plex_var.get(), 0))}
        if kind == "omega":
            return {"kind": "omega", "durationDays": max(0, parse_int(self.reward_days_var.get(), 0))}
        if kind == "mct":
            return {"kind": "mct", "durationDays": max(0, parse_int(self.reward_days_var.get(), 0)), "slotCount": max(1, parse_int(self.reward_slot_count_var.get(), 1))}
        if kind == "skill_points":
            return {"kind": "skill_points", "points": max(0, parse_int(self.reward_skill_points_var.get(), 0))}
        if kind == "bundle":
            return {"kind": "bundle", "grants": [row.to_payload() for row in self.bundle_rows]}
        return {"kind": kind}

    def _collect_selected_tags(self):
        tags = [tag for tag, variable in self.tag_vars.items() if variable.get()]
        tags.extend(parse_csv(self.custom_tags_var.get()))
        deduped = []
        seen = set()
        for tag in tags:
            normalized = str(tag).strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                deduped.append(normalized)
        return deduped

    def _collect_selected_categories(self):
        return [{"id": category_id} for category_id, variable in self.category_vars.items() if variable.get()]

    def _build_preview_payload_from_form(self, scope):
        name = self.name_var.get().strip() or "Unnamed offer"
        description = self.description_text.get("1.0", "end").strip() or "No description yet."
        preview = build_default_preview(scope, name, description)
        preview["badge"] = self.badge_var.get().strip() or preview["badge"]
        preview["accent"] = parse_hex_color(self.accent_var.get(), preview["accent"])
        preview["secondary"] = parse_hex_color(self.secondary_var.get(), preview["secondary"])
        preview["title"] = name
        preview["subtitle"] = description
        return preview

    def save_selected_offer(self):
        if not self.current_meta:
            messagebox.showinfo("Store Editor", "Pick an offer card first.")
            return
        offer, index = self.find_offer_record(self.current_meta)
        if not offer:
            messagebox.showerror("Save Offer", "The selected offer could not be found.")
            return
        try:
            scope = self.current_meta["scope"]
            name = self.name_var.get().strip() or "Unnamed offer"
            store_offer_id = self.store_offer_id_var.get().strip() or str(offer.get("storeOfferID") or "")
            description = self.description_text.get("1.0", "end").strip()
            tags = self._collect_selected_tags()
            preview = self._build_preview_payload_from_form(scope)
            fulfillment = self.build_fulfillment_from_form()
            image_url = self.image_url_var.get().strip() or None

            if scope == "legacy":
                pricing = (offer.get("offerPricings") or [{}])[0]
                price_value = max(0, parse_int(self.price_var.get(), 0))
                pricing["price"] = price_value
                pricing["basePrice"] = price_value
                pricing["currency"] = self.currency_var.get().strip().upper() or "PLX"
                offer["offerPricings"] = [pricing]
                offer["name"] = name
                offer["storeOfferID"] = store_offer_id
                offer["description"] = description
                offer["href"] = f"/store/4/offers/{slugify(store_offer_id)}"
                offer["imageUrl"] = image_url
                offer["tags"] = tags
                offer["preview"] = preview
                offer["fulfillment"] = fulfillment
                offer["categories"] = self._collect_selected_categories()
                offer["canPurchase"] = True
                offer["singlePurchase"] = bool(offer.get("singlePurchase"))
                products = offer.setdefault("products", [])
                if not products:
                    products.append({"id": 9500000, "typeId": 0, "quantity": 1, "productName": name, "imageUrl": image_url})
                product = products[0]
                product["productName"] = name
                product["imageUrl"] = image_url
                if fulfillment.get("kind") == "item":
                    product["typeId"] = max(0, parse_int(fulfillment.get("typeID"), 0))
                    product["quantity"] = max(1, parse_int(fulfillment.get("quantity"), 1))
                else:
                    product["typeId"] = 0
                    product["quantity"] = 1
                existing_public = get_public_offers(self.authority).get(store_offer_id)
                if isinstance(existing_public, dict):
                    existing_public["name"] = name
                    existing_public["description"] = description
                    existing_public["tags"] = deep_clone(tags)
                    existing_public["preview"] = deep_clone(preview)
                    existing_public["fulfillment"] = deep_clone(fulfillment)

            elif scope == "public":
                public_offers = get_public_offers(self.authority)
                current_key = self.current_meta["stable_key"]
                if store_offer_id != current_key:
                    public_offers[store_offer_id] = public_offers.pop(current_key)
                    self.current_meta["stable_key"] = store_offer_id
                    offer = public_offers[store_offer_id]
                offer["storeOfferID"] = store_offer_id
                offer["name"] = name
                offer["description"] = description
                offer["tags"] = tags
                offer["preview"] = preview
                offer["fulfillment"] = fulfillment
                offer["source"] = {"kind": "seeded-local", "observedAt": "2026-03-26", "url": self.source_url_var.get().strip()}
                currency = self.currency_var.get().strip().upper() or "PLX"
                amount_in_cents = max(0, round(parse_float(self.price_var.get(), 0) * 100))
                if currency == "PLX":
                    offer["currencyCode"] = None
                    offer["currencyAmountInCents"] = None
                    offer["plexPriceInCents"] = amount_in_cents
                else:
                    offer["currencyCode"] = currency
                    offer["currencyAmountInCents"] = amount_in_cents
                    offer["plexPriceInCents"] = None

            elif scope == "fast":
                offer["name"] = name
                offer["storeOfferID"] = store_offer_id
                offer["price"] = round(parse_float(self.price_var.get(), 0), 2)
                offer["currency"] = self.currency_var.get().strip().upper() or "USD"
                offer["quantity"] = max(0, parse_int(self.fast_quantity_var.get(), 0))
                offer["baseQuantity"] = max(0, parse_int(self.fast_base_quantity_var.get(), offer["quantity"]))
                offer["tags"] = tags
                offer["preview"] = preview
                offer["imageUrl"] = image_url

            self.persist_authority_only()
            self._sync_advanced_json_text()
            self._update_summary_cards()
            self.rebuild_offer_cards(keep_selection=True)
            self.set_status(f"Saved {SCOPE_LABELS[scope].lower()} offer '{name}'.")
        except Exception as error:  # noqa: BLE001
            messagebox.showerror("Save Offer", str(error))
            self.set_status(f"Failed to save the selected offer: {error}")

    def create_new_offer(self, scope):
        offer = build_default_offer(self.authority, scope)
        if scope == "legacy":
            get_legacy_offers(self.authority).append(offer)
            meta = {"scope": "legacy", "stable_key": parse_int(offer.get("id"), 0)}
        elif scope == "public":
            get_public_offers(self.authority)[offer["storeOfferID"]] = offer
            meta = {"scope": "public", "stable_key": str(offer["storeOfferID"])}
        else:
            get_fast_offers(self.authority).append(offer)
            meta = {"scope": "fast", "stable_key": parse_int(offer.get("id"), 0)}
        self.persist_authority_only()
        self.set_scope_filter(scope)
        self.rebuild_offer_cards()
        self.select_offer(meta)
        self.set_status(f"Created a new {SCOPE_LABELS[scope].lower()} offer.")

    def create_offer_from_template(self, template_key):
        offer, scope = build_offer_from_template(self.authority, template_key)
        if scope == "legacy":
            get_legacy_offers(self.authority).append(offer)
            meta = {"scope": "legacy", "stable_key": parse_int(offer.get("id"), 0)}
        elif scope == "public":
            get_public_offers(self.authority)[offer["storeOfferID"]] = offer
            meta = {"scope": "public", "stable_key": str(offer["storeOfferID"])}
        else:
            get_fast_offers(self.authority).append(offer)
            meta = {"scope": "fast", "stable_key": parse_int(offer.get("id"), 0)}
        self.persist_authority_only()
        self.set_scope_filter(scope)
        self.rebuild_offer_cards()
        self.select_offer(meta)
        template_label = next((entry["label"] for entry in OFFER_TEMPLATES if entry["key"] == template_key), "offer")
        self.set_status(f"Created a new {template_label} starter offer.")

    def duplicate_selected_offer(self):
        if not self.current_meta:
            messagebox.showinfo("Store Editor", "Pick an offer card first.")
            return
        offer, _index = self.find_offer_record(self.current_meta)
        if not offer:
            return
        scope = self.current_meta["scope"]
        cloned = deep_clone(offer)
        cloned["name"] = f"{cloned.get('name', 'Offer')} copy"
        cloned["storeOfferID"] = next_store_offer_id(self.authority, scope)
        if scope == "legacy":
            cloned["id"] = next_numeric_id([entry.get("id") for entry in get_legacy_offers(self.authority)], 9300000)
            for product in cloned.get("products") or []:
                product["id"] = next_numeric_id([item.get("id") for legacy in get_legacy_offers(self.authority) for item in (legacy.get("products") or [])], 9500000)
            get_legacy_offers(self.authority).append(cloned)
            meta = {"scope": "legacy", "stable_key": parse_int(cloned.get("id"), 0)}
        elif scope == "public":
            get_public_offers(self.authority)[cloned["storeOfferID"]] = cloned
            meta = {"scope": "public", "stable_key": str(cloned["storeOfferID"])}
        else:
            cloned["id"] = next_numeric_id([entry.get("id") for entry in get_fast_offers(self.authority)], 430000)
            get_fast_offers(self.authority).append(cloned)
            meta = {"scope": "fast", "stable_key": parse_int(cloned.get("id"), 0)}
        self.persist_authority_only()
        self.rebuild_offer_cards()
        self.select_offer(meta)
        self.set_status("Duplicated the selected offer.")

    def delete_selected_offer(self):
        if not self.current_meta:
            messagebox.showinfo("Store Editor", "Pick an offer card first.")
            return
        offer, index = self.find_offer_record(self.current_meta)
        if not offer:
            return
        name = str(offer.get("name") or "Unnamed offer")
        if not messagebox.askyesno("Delete Offer", f"Delete '{name}'?"):
            return
        scope = self.current_meta["scope"]
        if scope == "legacy":
            get_legacy_offers(self.authority).pop(index)
        elif scope == "public":
            get_public_offers(self.authority).pop(self.current_meta["stable_key"], None)
        elif scope == "fast":
            get_fast_offers(self.authority).pop(index)
        self.current_meta = None
        self.persist_authority_only()
        self.rebuild_offer_cards()
        self.set_status(f"Deleted '{name}'.")

    def persist_authority_only(self):
        write_json(AUTHORITY_PATH, self.authority)

    def save_raw_json(self):
        try:
            self.authority = json.loads(self.authority_text.get("1.0", "end"))
            self.runtime = json.loads(self.runtime_text.get("1.0", "end"))
            write_json(AUTHORITY_PATH, self.authority)
            write_json(RUNTIME_PATH, self.runtime)
            self.reload_from_disk()
            self.set_status("Saved advanced JSON.")
        except Exception as error:  # noqa: BLE001
            messagebox.showerror("Advanced JSON", str(error))
            self.set_status(f"Failed to save advanced JSON: {error}")

    def save_all_json(self):
        self.persist_authority_only()
        write_json(RUNTIME_PATH, self.runtime)
        self._sync_advanced_json_text()
        self.set_status("Saved authority and runtime JSON.")

    def save_config(self):
        try:
            payload = read_json(LOCAL_CONFIG_PATH, {})
            for key in STORE_CONFIG_KEYS:
                default_value = DEFAULT_STORE_CONFIG[key]
                variable = self.config_vars[key]
                if isinstance(default_value, bool):
                    payload[key] = bool(variable.get())
                elif isinstance(default_value, int):
                    payload[key] = parse_int(variable.get(), default_value)
                else:
                    payload[key] = str(variable.get()).strip()
            write_json(LOCAL_CONFIG_PATH, payload)
            self.local_config = payload
            self.set_status("Saved store settings.")
        except Exception as error:  # noqa: BLE001
            messagebox.showerror("Store Settings", str(error))
            self.set_status(f"Failed to save store settings: {error}")

    def reseed_catalog(self):
        try:
            completed = subprocess.run(["node", str(SEED_SCRIPT_PATH)], cwd=str(REPO_ROOT), capture_output=True, text=True, check=True)
            self.reload_from_disk()
            self.set_status(completed.stdout.strip() or "Reseeded the store catalog.")
        except Exception as error:  # noqa: BLE001
            messagebox.showerror("Reseed Catalog", str(error))
            self.set_status(f"Failed to reseed the store catalog: {error}")

    def open_source_page(self):
        if not self.current_meta:
            return
        offer, _index = self.find_offer_record(self.current_meta)
        if not offer:
            return
        source_url = str(((offer.get("source") or {}).get("url")) or self.source_url_var.get().strip())
        if source_url:
            webbrowser.open(source_url)

    def refresh_preview_from_form(self):
        scope = self.current_meta["scope"] if self.current_meta else self.filter_scope_var.get()
        if scope == "all":
            scope = "legacy"
        preview = self._build_preview_payload_from_form(scope)
        name = self.name_var.get().strip() or "Unnamed offer"
        description = self.description_text.get("1.0", "end").strip() or "No description yet."
        accent = parse_hex_color(preview.get("accent"), SCOPE_COLORS.get(scope, "#4fb3ff"))
        secondary = parse_hex_color(preview.get("secondary"), "#10233e")
        foreground = parse_hex_color(preview.get("foreground"), "#f5f8ff")
        badge = preview.get("badge") or "OFFER"
        mock_offer = {"fulfillment": self.build_fulfillment_from_form(), "tags": self._collect_selected_tags()}
        price_text = self.price_var.get().strip() or "0"
        currency = self.currency_var.get().strip() or "PLX"
        reward_line = create_offer_signature_text(mock_offer)
        store_offer_id = self.store_offer_id_var.get().strip() or "offer_id"
        image_source = self.image_url_var.get().strip()

        self.preview_canvas.delete("all")
        width = max(self.preview_canvas.winfo_width(), 960)
        height = max(self.preview_canvas.winfo_height(), 400)
        self.preview_image = tk.PhotoImage(width=width, height=height)
        for stripe in range(40):
            ratio = stripe / 39 if 39 else 0
            color = blend_color(secondary, accent, min(1.0, ratio * 0.85))
            top = int(height * stripe / 40)
            bottom = int(height * (stripe + 1) / 40)
            self.preview_image.put(color, to=(0, top, width, bottom))
        self.preview_canvas.create_image(0, 0, anchor="nw", image=self.preview_image)
        self.preview_canvas.create_rectangle(30, 30, width - 30, height - 30, fill="#08101b", outline="")
        self.preview_canvas.create_rectangle(58, 58, width * 0.44, height - 58, fill="#0f1828", outline="")
        art_left = 78
        art_top = 80
        art_right = 220
        art_bottom = 200
        self.preview_canvas.create_rectangle(art_left, art_top, art_right, art_bottom, fill=blend_color(accent, "#08101b", 0.35), outline="")
        self.preview_art_image = self.load_preview_image(image_source, art_right - art_left - 8, art_bottom - art_top - 8)
        if self.preview_art_image:
            self.preview_canvas.create_image(
                (art_left + art_right) / 2,
                (art_top + art_bottom) / 2,
                image=self.preview_art_image,
            )
        else:
            self.preview_canvas.create_text((art_left + art_right) / 2, art_top + 28, text=badge[:2].upper(), fill="#ffffff", font=("Segoe UI Semibold", 20))
            self.preview_canvas.create_text((art_left + art_right) / 2, art_top + 66, text="Preview art", fill="#dce7ff", font=("Segoe UI Semibold", 12))
            self.preview_canvas.create_text((art_left + art_right) / 2, art_top + 92, text="Image URL or local file path", fill="#9fb2d1", font=("Segoe UI", 9))
        self.preview_canvas.create_text(172, 84, anchor="nw", fill="#8ea3c7", font=("Segoe UI", 10), text=SCOPE_LABELS.get(scope, "Offer").upper())
        self.preview_canvas.create_text(78, 224, anchor="nw", fill="#ffffff", font=("Segoe UI Semibold", 24), width=(width * 0.44) - 120, text=name)
        self.preview_canvas.create_text(78, 290, anchor="nw", fill=foreground, font=("Segoe UI", 11), width=(width * 0.44) - 120, text=description)
        self.preview_canvas.create_text(78, height - 128, anchor="nw", fill="#f7bc4d", font=("Segoe UI Semibold", 22), text=f"{price_text} {currency}".strip())
        self.preview_canvas.create_text(78, height - 92, anchor="nw", fill="#9fb2d1", font=("Segoe UI", 10), width=(width * 0.44) - 120, text=reward_line)
        detail_left = int(width * 0.50)
        self.preview_canvas.create_rectangle(detail_left, 72, width - 72, height - 72, fill="#101726", outline=accent, width=2)
        self.preview_canvas.create_text(detail_left + 24, 98, anchor="nw", fill="#8ea3c7", font=("Segoe UI", 10), text="What the player sees")
        self.preview_canvas.create_text(detail_left + 24, 132, anchor="nw", fill="#ffffff", font=("Segoe UI Semibold", 20), width=width - detail_left - 110, text=name)
        self.preview_canvas.create_text(detail_left + 24, 198, anchor="nw", fill="#dce7ff", font=("Segoe UI", 11), width=width - detail_left - 110, text=description)
        self.preview_canvas.create_rectangle(detail_left + 24, 282, width - 96, 324, fill=blend_color(accent, "#ffffff", 0.25), outline="")
        self.preview_canvas.create_text(detail_left + 40, 303, anchor="w", fill="#08101b", font=("Segoe UI Semibold", 11), text=f"Reward: {reward_line}")
        self.preview_canvas.create_text(detail_left + 24, 350, anchor="nw", fill="#9fb2d1", font=("Segoe UI", 10), width=width - detail_left - 110, text=f"Tags: {', '.join(mock_offer['tags']) or 'none'}")
        self.preview_canvas.create_text(detail_left + 24, 382, anchor="nw", fill="#9fb2d1", font=("Segoe UI", 10), width=width - detail_left - 110, text=f"Image source: {image_source or 'generated preview art'}")
        self.preview_canvas.create_text(detail_left + 24, height - 108, anchor="nw", fill="#8ea3c7", font=("Consolas", 10), text=f"Store Offer ID: {store_offer_id}")
        self.preview_canvas.create_text(detail_left + 24, height - 80, anchor="nw", fill="#8ea3c7", font=("Consolas", 10), text=f"Image URL: {self.image_url_var.get().strip() or 'generated card art'}")


def main():
    app = StoreEditorApp()
    app.mainloop()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
