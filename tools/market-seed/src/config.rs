use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use market_common::DEFAULT_PRICE_FLOOR;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketSeedConfig {
    #[serde(default)]
    pub input: InputConfig,
    #[serde(default)]
    pub output: OutputConfig,
    #[serde(default)]
    pub seed: SeedConfig,
    #[serde(default)]
    pub build: BuildConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputConfig {
    #[serde(default = "default_static_data_dir")]
    pub static_data_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputConfig {
    #[serde(default = "default_database_path")]
    pub database_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedConfig {
    #[serde(default = "default_quantity")]
    pub default_quantity_per_station_type: u32,
    #[serde(default = "default_seed_markup_percent")]
    pub seed_markup_percent: f64,
    #[serde(default = "default_station_jitter_percent")]
    pub station_jitter_percent: f64,
    #[serde(default = "default_region_jitter_percent")]
    pub region_jitter_percent: f64,
    #[serde(default = "default_price_floor")]
    pub price_floor: f64,
    #[serde(default = "default_fallback_base_price")]
    pub fallback_base_price: f64,
    #[serde(default = "default_fallback_type_modulus")]
    pub fallback_type_modulus: u32,
    #[serde(default = "default_fallback_type_step")]
    pub fallback_type_step: f64,
    #[serde(default = "default_seed_buy_orders_enabled")]
    pub seed_buy_orders_enabled: bool,
    #[serde(default = "default_seed_buy_discount_percent")]
    pub seed_buy_discount_percent: f64,
    #[serde(default = "default_history_days")]
    pub history_days_seeded: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildConfig {
    #[serde(default = "default_sqlite_cache_size_kib")]
    pub sqlite_cache_size_kib: i32,
    #[serde(default = "default_sqlite_page_size_bytes")]
    pub sqlite_page_size_bytes: u32,
    #[serde(default = "default_sqlite_worker_threads")]
    pub sqlite_worker_threads: usize,
    #[serde(default = "default_parallelism")]
    pub parallelism: usize,
}

impl Default for MarketSeedConfig {
    fn default() -> Self {
        Self {
            input: InputConfig::default(),
            output: OutputConfig::default(),
            seed: SeedConfig::default(),
            build: BuildConfig::default(),
        }
    }
}

impl Default for InputConfig {
    fn default() -> Self {
        Self {
            static_data_dir: default_static_data_dir(),
        }
    }
}

impl Default for OutputConfig {
    fn default() -> Self {
        Self {
            database_path: default_database_path(),
        }
    }
}

impl Default for SeedConfig {
    fn default() -> Self {
        Self {
            default_quantity_per_station_type: default_quantity(),
            seed_markup_percent: default_seed_markup_percent(),
            station_jitter_percent: default_station_jitter_percent(),
            region_jitter_percent: default_region_jitter_percent(),
            price_floor: default_price_floor(),
            fallback_base_price: default_fallback_base_price(),
            fallback_type_modulus: default_fallback_type_modulus(),
            fallback_type_step: default_fallback_type_step(),
            seed_buy_orders_enabled: default_seed_buy_orders_enabled(),
            seed_buy_discount_percent: default_seed_buy_discount_percent(),
            history_days_seeded: default_history_days(),
        }
    }
}

impl Default for BuildConfig {
    fn default() -> Self {
        Self {
            sqlite_cache_size_kib: default_sqlite_cache_size_kib(),
            sqlite_page_size_bytes: default_sqlite_page_size_bytes(),
            sqlite_worker_threads: default_sqlite_worker_threads(),
            parallelism: default_parallelism(),
        }
    }
}

impl MarketSeedConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path).with_context(|| {
            format!(
                "failed to read market seed config at {}",
                path.to_string_lossy()
            )
        })?;
        let config = toml::from_str::<Self>(&raw).with_context(|| {
            format!(
                "failed to parse market seed config at {}",
                path.to_string_lossy()
            )
        })?;
        Ok(config)
    }
}

fn default_static_data_dir() -> PathBuf {
    PathBuf::from("../../server/src/newDatabase/data")
}

fn default_database_path() -> PathBuf {
    PathBuf::from("../../externalservices/market-server/data/generated/market.sqlite")
}

fn default_quantity() -> u32 {
    5_000
}

fn default_seed_markup_percent() -> f64 {
    8.0
}

fn default_station_jitter_percent() -> f64 {
    1.5
}

fn default_region_jitter_percent() -> f64 {
    2.0
}

fn default_price_floor() -> f64 {
    DEFAULT_PRICE_FLOOR
}

fn default_fallback_base_price() -> f64 {
    10_000.0
}

fn default_fallback_type_modulus() -> u32 {
    250
}

fn default_fallback_type_step() -> f64 {
    250.0
}

fn default_seed_buy_orders_enabled() -> bool {
    false
}

fn default_seed_buy_discount_percent() -> f64 {
    8.0
}

fn default_history_days() -> u32 {
    30
}

fn default_sqlite_cache_size_kib() -> i32 {
    262_144
}

fn default_sqlite_page_size_bytes() -> u32 {
    32 * 1024
}

fn default_sqlite_worker_threads() -> usize {
    std::thread::available_parallelism()
        .map(|value| value.get().clamp(4, 24))
        .unwrap_or(8)
}

fn default_parallelism() -> usize {
    std::thread::available_parallelism()
        .map(|value| value.get().clamp(4, 24))
        .unwrap_or(8)
}
