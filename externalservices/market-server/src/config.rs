use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use market_common::{DEFAULT_MARKET_SERVER_HOST, DEFAULT_MARKET_SERVER_PORT};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketServerConfig {
    #[serde(default)]
    pub network: NetworkConfig,
    #[serde(default)]
    pub rpc: RpcConfig,
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default)]
    pub runtime: RuntimeConfig,
    #[serde(default)]
    pub tq_live: TqLiveConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcConfig {
    #[serde(default = "default_rpc_enabled")]
    pub enabled: bool,
    #[serde(default = "default_rpc_host")]
    pub host: String,
    #[serde(default = "default_rpc_port")]
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_database_path")]
    pub database_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    #[serde(default = "default_cache_station_summaries")]
    pub cache_station_summaries: bool,
    #[serde(default = "default_cache_system_summaries")]
    pub cache_system_summaries: bool,
    #[serde(default = "default_preload_system_seed_summaries")]
    pub preload_system_seed_summaries: bool,
    #[serde(default = "default_station_cache_capacity")]
    pub station_summary_cache_capacity: usize,
    #[serde(default = "default_system_cache_capacity")]
    pub system_summary_cache_capacity: usize,
    #[serde(default = "default_order_book_cache_capacity")]
    pub order_book_cache_capacity: usize,
    #[serde(default = "default_read_connection_pool_size")]
    pub read_connection_pool_size: usize,
    #[serde(default = "default_sqlite_read_cache_size_kib")]
    pub sqlite_read_cache_size_kib: i32,
    #[serde(default = "default_sqlite_mmap_size_mb")]
    pub sqlite_mmap_size_mb: u64,
    #[serde(default = "default_sqlite_statement_cache_capacity")]
    pub sqlite_statement_cache_capacity: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TqLiveConfig {
    #[serde(default = "default_tq_update_interval_seconds")]
    pub update_interval_seconds: u64,
    #[serde(default = "default_tq_source_base_url")]
    pub source_base_url: String,
    #[serde(default = "default_tq_user_agent")]
    pub user_agent: String,
    #[serde(default = "default_tq_request_concurrency")]
    pub request_concurrency: usize,
    #[serde(default = "default_tq_request_timeout_seconds")]
    pub request_timeout_seconds: u64,
    #[serde(default = "default_tq_region_pause_millis")]
    pub region_pause_millis: u64,
    #[serde(default)]
    pub region_ids: Vec<u32>,
    #[serde(default)]
    pub max_pages_per_region: Option<u32>,
    #[serde(default = "default_tq_dashboard_enabled")]
    pub dashboard_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

impl Default for MarketServerConfig {
    fn default() -> Self {
        Self {
            network: NetworkConfig::default(),
            rpc: RpcConfig::default(),
            storage: StorageConfig::default(),
            runtime: RuntimeConfig::default(),
            tq_live: TqLiveConfig::default(),
            logging: LoggingConfig::default(),
        }
    }
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            database_path: default_database_path(),
        }
    }
}

impl Default for RpcConfig {
    fn default() -> Self {
        Self {
            enabled: default_rpc_enabled(),
            host: default_rpc_host(),
            port: default_rpc_port(),
        }
    }
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            cache_station_summaries: default_cache_station_summaries(),
            cache_system_summaries: default_cache_system_summaries(),
            preload_system_seed_summaries: default_preload_system_seed_summaries(),
            station_summary_cache_capacity: default_station_cache_capacity(),
            system_summary_cache_capacity: default_system_cache_capacity(),
            order_book_cache_capacity: default_order_book_cache_capacity(),
            read_connection_pool_size: default_read_connection_pool_size(),
            sqlite_read_cache_size_kib: default_sqlite_read_cache_size_kib(),
            sqlite_mmap_size_mb: default_sqlite_mmap_size_mb(),
            sqlite_statement_cache_capacity: default_sqlite_statement_cache_capacity(),
        }
    }
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            log_level: default_log_level(),
        }
    }
}

impl Default for TqLiveConfig {
    fn default() -> Self {
        Self {
            update_interval_seconds: default_tq_update_interval_seconds(),
            source_base_url: default_tq_source_base_url(),
            user_agent: default_tq_user_agent(),
            request_concurrency: default_tq_request_concurrency(),
            request_timeout_seconds: default_tq_request_timeout_seconds(),
            region_pause_millis: default_tq_region_pause_millis(),
            region_ids: Vec::new(),
            max_pages_per_region: None,
            dashboard_enabled: default_tq_dashboard_enabled(),
        }
    }
}

impl MarketServerConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path).with_context(|| {
            format!(
                "failed to read market server config at {}",
                path.to_string_lossy()
            )
        })?;
        let config = toml::from_str::<Self>(&raw).with_context(|| {
            format!(
                "failed to parse market server config at {}",
                path.to_string_lossy()
            )
        })?;
        Ok(config)
    }
}

fn default_host() -> String {
    DEFAULT_MARKET_SERVER_HOST.to_string()
}

fn default_port() -> u16 {
    DEFAULT_MARKET_SERVER_PORT
}

fn default_database_path() -> PathBuf {
    PathBuf::from("data/generated/market.sqlite")
}

fn default_rpc_enabled() -> bool {
    true
}

fn default_rpc_host() -> String {
    "127.0.0.1".to_string()
}

fn default_rpc_port() -> u16 {
    40111
}

fn default_cache_station_summaries() -> bool {
    true
}

fn default_cache_system_summaries() -> bool {
    true
}

fn default_preload_system_seed_summaries() -> bool {
    false
}

fn default_station_cache_capacity() -> usize {
    256
}

fn default_system_cache_capacity() -> usize {
    256
}

fn default_order_book_cache_capacity() -> usize {
    2_048
}

fn default_read_connection_pool_size() -> usize {
    std::thread::available_parallelism()
        .map(|value| value.get().clamp(4, 12))
        .unwrap_or(8)
}

fn default_sqlite_read_cache_size_kib() -> i32 {
    131_072
}

fn default_sqlite_mmap_size_mb() -> u64 {
    16_384
}

fn default_sqlite_statement_cache_capacity() -> usize {
    512
}

fn default_tq_update_interval_seconds() -> u64 {
    300
}

fn default_tq_source_base_url() -> String {
    "https://esi.evetech.net/latest".to_string()
}

fn default_tq_user_agent() -> String {
    "PublicEveJS-TQLiveMarket/0.1 (local-private-server; contact: local-admin)".to_string()
}

fn default_tq_request_concurrency() -> usize {
    8
}

fn default_tq_request_timeout_seconds() -> u64 {
    45
}

fn default_tq_region_pause_millis() -> u64 {
    100
}

fn default_tq_dashboard_enabled() -> bool {
    true
}

fn default_log_level() -> String {
    "info".to_string()
}
