use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

mod string_i64 {
  use serde::de::Error as _;
  use serde::{Deserialize, Deserializer, Serializer};

  pub fn serialize<S>(value: &i64, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    serializer.serialize_str(&value.to_string())
  }

  pub fn deserialize<'de, D>(deserializer: D) -> Result<i64, D::Error>
  where
    D: Deserializer<'de>,
  {
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
      serde_json::Value::String(text) => text
        .parse::<i64>()
        .map_err(|error| D::Error::custom(format!("invalid i64 string: {error}"))),
      serde_json::Value::Number(number) => number
        .as_i64()
        .ok_or_else(|| D::Error::custom("invalid i64 number")),
      _ => Err(D::Error::custom("expected string or number for i64 value")),
    }
  }
}

pub const MARKET_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_MARKET_SERVER_PORT: u16 = 40110;
pub const DEFAULT_MARKET_SERVER_HOST: &str = "127.0.0.1";
pub const DEFAULT_MARKET_SERVER_CONFIG_PATH: &str = "config/market-server.local.toml";
pub const DEFAULT_MARKET_SEED_CONFIG_PATH: &str = "config/market-seed.local.toml";
pub const MANIFEST_KEY: &str = "manifest_json";
pub const DEFAULT_PRICE_FLOOR: f64 = 100.0;
const SEED_SELL_ORDER_ID_BASE: i64 = 2_000_000_000_000_000_000;
const SEED_BUY_ORDER_ID_BASE: i64 = 4_000_000_000_000_000_000;

pub const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS manifest (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS regions (
  region_id INTEGER PRIMARY KEY,
  region_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS solar_systems (
  solar_system_id INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL,
  constellation_id INTEGER NOT NULL,
  solar_system_name TEXT NOT NULL,
  security REAL NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS stations (
  station_id INTEGER PRIMARY KEY,
  solar_system_id INTEGER NOT NULL,
  constellation_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  station_name TEXT NOT NULL,
  security REAL NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS market_types (
  type_id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  market_group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  base_price REAL,
  volume REAL,
  portion_size INTEGER NOT NULL,
  published INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS seed_stock (
  station_id INTEGER NOT NULL,
  solar_system_id INTEGER NOT NULL,
  constellation_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  initial_quantity INTEGER NOT NULL,
  price_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (station_id, type_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS seed_buy_orders (
  station_id INTEGER NOT NULL,
  solar_system_id INTEGER NOT NULL,
  constellation_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  initial_quantity INTEGER NOT NULL,
  price_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (station_id, type_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tq_mirror_orders (
  order_id INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL,
  station_id INTEGER NOT NULL,
  solar_system_id INTEGER NOT NULL,
  constellation_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  is_buy_order INTEGER NOT NULL,
  price REAL NOT NULL,
  volume_remain INTEGER NOT NULL,
  volume_total INTEGER NOT NULL,
  min_volume INTEGER NOT NULL DEFAULT 1,
  range_value TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tq_seed_local_usage (
  side TEXT NOT NULL,
  station_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  consumed_quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (side, station_id, type_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tq_live_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS market_orders (
  order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  is_corp INTEGER NOT NULL DEFAULT 0,
  wallet_division INTEGER NOT NULL DEFAULT 1000,
  station_id INTEGER NOT NULL,
  solar_system_id INTEGER NOT NULL,
  constellation_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  price REAL NOT NULL,
  vol_entered INTEGER NOT NULL,
  vol_remaining INTEGER NOT NULL,
  min_volume INTEGER NOT NULL DEFAULT 1,
  bid INTEGER NOT NULL,
  range_value INTEGER NOT NULL DEFAULT 32767,
  duration_days INTEGER NOT NULL DEFAULT 90,
  escrow REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'player',
  issued_at TEXT NOT NULL,
  last_state_change_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_order_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  order_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  is_corp INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  source TEXT NOT NULL,
  price REAL NOT NULL,
  vol_remaining INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  range_value INTEGER NOT NULL,
  vol_entered INTEGER NOT NULL,
  min_volume INTEGER NOT NULL DEFAULT 1,
  bid INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  duration_days INTEGER NOT NULL DEFAULT 90,
  station_id INTEGER NOT NULL,
  region_id INTEGER NOT NULL,
  solar_system_id INTEGER NOT NULL,
  constellation_id INTEGER NOT NULL,
  last_state_change_at TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS region_summaries (
  region_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  best_ask_price REAL,
  total_ask_quantity INTEGER NOT NULL DEFAULT 0,
  best_ask_station_id INTEGER,
  best_bid_price REAL,
  total_bid_quantity INTEGER NOT NULL DEFAULT 0,
  best_bid_station_id INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region_id, type_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS system_seed_summaries (
  solar_system_id INTEGER NOT NULL,
  type_id INTEGER NOT NULL,
  best_ask_price REAL,
  total_ask_quantity INTEGER NOT NULL DEFAULT 0,
  best_ask_station_id INTEGER,
  best_bid_price REAL,
  total_bid_quantity INTEGER NOT NULL DEFAULT 0,
  best_bid_station_id INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (solar_system_id, type_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS price_history (
  type_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  low_price REAL NOT NULL,
  high_price REAL NOT NULL,
  avg_price REAL NOT NULL,
  volume INTEGER NOT NULL,
  order_count INTEGER NOT NULL,
  PRIMARY KEY (type_id, day)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_seed_stock_region_type_price
  ON seed_stock (region_id, type_id, price, station_id);

CREATE INDEX IF NOT EXISTS idx_seed_stock_system_type_price
  ON seed_stock (solar_system_id, type_id, price, station_id);

CREATE INDEX IF NOT EXISTS idx_seed_stock_station_type_price
  ON seed_stock (station_id, type_id, price);

CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_region_type_price
  ON seed_buy_orders (region_id, type_id, price DESC, station_id);

CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_system_type_price
  ON seed_buy_orders (solar_system_id, type_id, price DESC, station_id);

CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_station_type_price
  ON seed_buy_orders (station_id, type_id, price DESC);

CREATE INDEX IF NOT EXISTS idx_tq_mirror_orders_region_type
  ON tq_mirror_orders (region_id, type_id, is_buy_order, price);

CREATE INDEX IF NOT EXISTS idx_tq_mirror_orders_station_type
  ON tq_mirror_orders (station_id, type_id, is_buy_order);

CREATE INDEX IF NOT EXISTS idx_market_orders_region_type_bid_state_price
  ON market_orders (region_id, type_id, bid, state, price, station_id);

CREATE INDEX IF NOT EXISTS idx_market_orders_system_type_bid_state_price
  ON market_orders (solar_system_id, type_id, bid, state, price, station_id);

CREATE INDEX IF NOT EXISTS idx_market_orders_station_type_bid_state_price
  ON market_orders (station_id, type_id, bid, state, price);

CREATE INDEX IF NOT EXISTS idx_market_orders_owner_state
  ON market_orders (owner_id, is_corp, state, updated_at);

CREATE INDEX IF NOT EXISTS idx_market_orders_player_owner_updated
  ON market_orders (owner_id, is_corp, updated_at DESC, order_id DESC)
  WHERE source = 'player';

CREATE INDEX IF NOT EXISTS idx_market_orders_player_expiry
  ON market_orders (state, issued_at, duration_days, order_id)
  WHERE source = 'player';

CREATE INDEX IF NOT EXISTS idx_market_order_events_type_id
  ON market_order_events (event_type, event_id);
"#;

pub const RUNTIME_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS idx_seed_stock_region_type_price
  ON seed_stock (region_id, type_id, price, station_id);

CREATE INDEX IF NOT EXISTS idx_seed_stock_system_type_price
  ON seed_stock (solar_system_id, type_id, price, station_id);

CREATE INDEX IF NOT EXISTS idx_seed_stock_station_type_price
  ON seed_stock (station_id, type_id, price);

CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_region_type_price
  ON seed_buy_orders (region_id, type_id, price DESC, station_id);

CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_system_type_price
  ON seed_buy_orders (solar_system_id, type_id, price DESC, station_id);

CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_station_type_price
  ON seed_buy_orders (station_id, type_id, price DESC);

CREATE INDEX IF NOT EXISTS idx_tq_mirror_orders_region_type
  ON tq_mirror_orders (region_id, type_id, is_buy_order, price);

CREATE INDEX IF NOT EXISTS idx_tq_mirror_orders_station_type
  ON tq_mirror_orders (station_id, type_id, is_buy_order);

CREATE INDEX IF NOT EXISTS idx_market_orders_region_type_bid_state_price
  ON market_orders (region_id, type_id, bid, state, price, station_id);

CREATE INDEX IF NOT EXISTS idx_market_orders_system_type_bid_state_price
  ON market_orders (solar_system_id, type_id, bid, state, price, station_id);

CREATE INDEX IF NOT EXISTS idx_market_orders_station_type_bid_state_price
  ON market_orders (station_id, type_id, bid, state, price);

CREATE INDEX IF NOT EXISTS idx_market_orders_owner_state
  ON market_orders (owner_id, is_corp, state, updated_at);

CREATE INDEX IF NOT EXISTS idx_market_orders_player_owner_updated
  ON market_orders (owner_id, is_corp, updated_at DESC, order_id DESC)
  WHERE source = 'player';

CREATE INDEX IF NOT EXISTS idx_market_orders_player_expiry
  ON market_orders (state, issued_at, duration_days, order_id)
  WHERE source = 'player';

CREATE INDEX IF NOT EXISTS idx_market_order_events_type_id
  ON market_order_events (event_type, event_id);
"#;

pub const RUNTIME_INDEX_DROP_SQL: &str = r#"
DROP INDEX IF EXISTS idx_seed_stock_region_type_price;
DROP INDEX IF EXISTS idx_seed_stock_system_type_price;
DROP INDEX IF EXISTS idx_seed_stock_station_type_price;
DROP INDEX IF EXISTS idx_seed_buy_orders_region_type_price;
DROP INDEX IF EXISTS idx_seed_buy_orders_system_type_price;
DROP INDEX IF EXISTS idx_seed_buy_orders_station_type_price;
DROP INDEX IF EXISTS idx_tq_mirror_orders_region_type;
DROP INDEX IF EXISTS idx_tq_mirror_orders_station_type;
DROP INDEX IF EXISTS idx_market_orders_region_type_bid_state_price;
DROP INDEX IF EXISTS idx_market_orders_system_type_bid_state_price;
DROP INDEX IF EXISTS idx_market_orders_station_type_bid_state_price;
DROP INDEX IF EXISTS idx_market_orders_owner_state;
DROP INDEX IF EXISTS idx_market_orders_player_owner_updated;
DROP INDEX IF EXISTS idx_market_orders_player_expiry;
DROP INDEX IF EXISTS idx_market_order_events_type_id;
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketManifest {
  pub schema_version: u32,
  pub generated_at: String,
  pub static_data_dir: String,
  pub database_path: String,
  #[serde(default)]
  pub selection_mode: String,
  #[serde(default)]
  pub selection_label: String,
  #[serde(default)]
  pub selected_solar_system_ids: Vec<u32>,
  #[serde(default)]
  pub selected_solar_system_names: Vec<String>,
  pub region_count: u32,
  pub solar_system_count: u32,
  pub station_count: u32,
  pub market_type_count: u32,
  pub seed_row_count: u64,
  pub default_quantity_per_station_type: u32,
  pub seed_buy_orders_enabled: bool,
  pub history_days_seeded: u32,
  pub seed_markup_percent: f64,
  pub station_jitter_percent: f64,
  pub region_jitter_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryRow {
  pub type_id: u32,
  pub best_ask_price: Option<f64>,
  pub total_ask_quantity: u64,
  pub best_ask_station_id: Option<u64>,
  pub best_bid_price: Option<f64>,
  pub total_bid_quantity: u64,
  pub best_bid_station_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRow {
  #[serde(with = "string_i64")]
  pub order_id: i64,
  pub price: f64,
  pub vol_remaining: u64,
  pub type_id: u32,
  pub range_value: i32,
  pub vol_entered: u64,
  pub min_volume: u64,
  pub bid: bool,
  pub issued_at: String,
  pub duration_days: u32,
  pub station_id: u64,
  pub region_id: u32,
  pub solar_system_id: u32,
  pub constellation_id: u32,
  pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookResponse {
  pub region_id: u32,
  pub type_id: u32,
  pub sells: Vec<OrderRow>,
  pub buys: Vec<OrderRow>,
  pub cached_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryRow {
  pub day: String,
  pub low_price: f64,
  pub high_price: f64,
  pub avg_price: f64,
  pub volume: u64,
  pub order_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryResponse {
  pub type_id: u32,
  pub rows: Vec<HistoryRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerOrderRow {
  #[serde(with = "string_i64")]
  pub order_id: i64,
  pub owner_id: u64,
  pub is_corp: bool,
  pub state: String,
  pub source: String,
  pub last_state_change_at: Option<String>,
  pub row: OrderRow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketOrderEvent {
  #[serde(with = "string_i64")]
  pub event_id: i64,
  pub event_type: String,
  pub occurred_at: String,
  pub order: OwnerOrderRow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsResponse {
  pub started_at: String,
  pub database_path: String,
  pub host: String,
  pub port: u16,
  pub rpc_enabled: bool,
  pub rpc_host: String,
  pub rpc_port: u16,
  pub region_summary_cache_regions: usize,
  pub region_summary_rows: usize,
  pub system_summary_cache_entries: usize,
  pub station_summary_cache_entries: usize,
  pub order_book_cache_entries: usize,
  pub manifest: MarketManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOrderRequest {
  pub owner_id: u64,
  pub is_corp: bool,
  pub wallet_division: Option<u32>,
  pub station_id: u64,
  pub type_id: u32,
  pub price: f64,
  pub quantity: u64,
  pub min_volume: Option<u64>,
  pub duration_days: Option<u32>,
  pub range_value: Option<i32>,
  pub bid: bool,
  pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOrderResponse {
  #[serde(with = "string_i64")]
  pub order_id: i64,
  pub region_id: u32,
  pub solar_system_id: u32,
  pub station_id: u64,
  pub type_id: u32,
  pub cached_regions_invalidated: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifyOrderRequest {
  #[serde(with = "string_i64")]
  pub order_id: i64,
  pub new_price: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifyOrderResponse {
  #[serde(with = "string_i64")]
  pub order_id: i64,
  pub region_id: u32,
  pub solar_system_id: u32,
  pub station_id: u64,
  pub type_id: u32,
  pub bid: bool,
  pub price: f64,
  pub vol_remaining: u64,
  pub state: String,
  pub invalidated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelOrderResponse {
  #[serde(with = "string_i64")]
  pub order_id: i64,
  pub state: String,
  pub invalidated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillOrderRequest {
  #[serde(with = "string_i64")]
  pub order_id: i64,
  pub fill_quantity: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillOrderResponse {
  #[serde(with = "string_i64")]
  pub order_id: i64,
  pub owner_id: u64,
  pub is_corp: bool,
  pub region_id: u32,
  pub solar_system_id: u32,
  pub station_id: u64,
  pub type_id: u32,
  pub bid: bool,
  pub price: f64,
  pub filled_quantity: u64,
  pub vol_remaining: u64,
  pub state: String,
  pub invalidated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustSeedStockRequest {
  pub station_id: u64,
  pub type_id: u32,
  pub delta_quantity: Option<i64>,
  pub new_quantity: Option<u64>,
  pub new_price: Option<f64>,
  pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjustSeedStockResponse {
  pub station_id: u64,
  pub type_id: u32,
  pub region_id: u32,
  pub solar_system_id: u32,
  pub quantity: u64,
  pub price: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheRebuildResponse {
  pub region_id: Option<u32>,
  pub rebuilt_rows: usize,
  pub rebuilt_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordTradeRequest {
  pub type_id: u32,
  pub price: f64,
  pub quantity: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordTradeResponse {
  pub type_id: u32,
  pub day: String,
  pub price: f64,
  pub quantity: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SweepExpiredOrdersResponse {
  pub expired_count: usize,
  pub swept_at: String,
}

pub fn now_rfc3339() -> String {
  OffsetDateTime::now_utc()
    .format(&Rfc3339)
    .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub fn round_isk(value: f64) -> f64 {
  (value * 100.0).round() / 100.0
}

pub fn fallback_base_price(type_id: u32) -> f64 {
  let base = 10_000.0 + f64::from(type_id % 250) * 250.0;
  round_isk(base.max(DEFAULT_PRICE_FLOOR))
}

pub fn seed_sell_order_id(station_id: u64, type_id: u32) -> i64 {
  let encoded = (((station_id as i128) << 32) | i128::from(type_id)) as i64;
  SEED_SELL_ORDER_ID_BASE + encoded
}

pub fn seed_buy_order_id(station_id: u64, type_id: u32) -> i64 {
  let encoded = (((station_id as i128) << 32) | i128::from(type_id)) as i64;
  SEED_BUY_ORDER_ID_BASE + encoded
}

pub fn try_decode_seed_buy_order_id(order_id: i64) -> Option<(u64, u32)> {
  if order_id < SEED_BUY_ORDER_ID_BASE {
    return None;
  }

  let encoded = u64::try_from(order_id - SEED_BUY_ORDER_ID_BASE).ok()?;
  Some((encoded >> 32, encoded as u32))
}

#[cfg(test)]
mod tests {
  use super::{seed_buy_order_id, seed_sell_order_id, try_decode_seed_buy_order_id};

  #[test]
  fn seed_order_ids_are_positive_and_distinct() {
    let sell_id = seed_sell_order_id(60_015_169, 263);
    let buy_id = seed_buy_order_id(60_015_169, 263);

    assert!(sell_id > 0);
    assert!(buy_id > 0);
    assert_ne!(sell_id, buy_id);
  }

  #[test]
  fn seed_buy_order_ids_decode_to_station_and_type() {
    let order_id = seed_buy_order_id(60_015_169, 263);
    let decoded = try_decode_seed_buy_order_id(order_id);

    assert_eq!(decoded, Some((60_015_169, 263)));
    assert_eq!(try_decode_seed_buy_order_id(12345), None);
  }
}
