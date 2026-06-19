use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration as StdDuration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use market_common::{
    AdjustSeedStockRequest, AdjustSeedStockResponse, CacheRebuildResponse, DiagnosticsResponse,
    FillOrderRequest, FillOrderResponse, HistoryResponse, HistoryRow, MANIFEST_KEY, MarketManifest,
    MarketOrderEvent, ModifyOrderRequest, ModifyOrderResponse, OrderBookResponse, OrderRow,
    OwnerOrderRow, PlaceOrderRequest, PlaceOrderResponse, RecordTradeRequest, RecordTradeResponse,
    SCHEMA_SQL, SummaryRow, SweepExpiredOrdersResponse, now_rfc3339, seed_buy_order_id,
    seed_sell_order_id, try_decode_seed_buy_order_id,
};
use rusqlite::{Connection, OptionalExtension, params};
use time::OffsetDateTime;
use tokio::sync::RwLock;

use crate::config::MarketServerConfig;

type SummaryCache = Arc<RwLock<HashMap<u32, Arc<Vec<SummaryRow>>>>>;
type StationSummaryCache = Arc<RwLock<HashMap<u64, Arc<Vec<SummaryRow>>>>>;
type OrderBookCache = Arc<RwLock<HashMap<(u32, u32), Arc<OrderBookResponse>>>>;

#[derive(Debug, Clone)]
pub struct StartupOverview {
    pub region_summary_cache_regions: usize,
    pub region_summary_rows: usize,
    pub price_history_rows: u64,
    pub total_orders: u64,
    pub open_orders: u64,
    pub open_buy_orders: u64,
    pub open_sell_orders: u64,
    pub closed_orders: u64,
    pub order_event_rows: u64,
}

pub type StartupProgressSink = Arc<dyn Fn(StartupProgressUpdate) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct StartupProgressUpdate {
    pub phase_label: &'static str,
    pub percent_complete: f64,
    pub detail: String,
    pub elapsed: StdDuration,
    pub eta: Option<StdDuration>,
}

#[derive(Debug, Clone)]
pub struct TqLiveSourceOrder {
    pub order_id: i64,
    pub station_id: u64,
    pub solar_system_id: u32,
    pub constellation_id: u32,
    pub region_id: u32,
    pub type_id: u32,
    pub is_buy_order: bool,
    pub price: f64,
    pub volume_remain: u64,
    pub volume_total: u64,
    pub min_volume: u64,
    pub range_value: String,
    pub issued_at: String,
    pub duration_days: u32,
}

#[derive(Debug, Clone, Default)]
pub struct TqLiveApplyReport {
    pub region_id: u32,
    pub source_orders: u64,
    pub total_orders_changed: u64,
    pub created_buy_orders: u64,
    pub created_sell_orders: u64,
    pub removed_buy_orders: u64,
    pub removed_sell_orders: u64,
    pub price_changed_orders: u64,
    pub volume_changed_orders: u64,
    pub sell_volume_decreased_units: u64,
    pub buy_volume_decreased_units: u64,
    pub seed_sell_rows: u64,
    pub seed_buy_rows: u64,
    pub seed_rows_changed: u64,
    pub affected_types: usize,
    pub affected_stations: usize,
    pub affected_systems: usize,
    pub applied_at: String,
}

#[derive(Debug, Clone, Copy)]
enum StartupStage {
    Schema,
    Manifest,
    Summaries,
    Counts,
    Complete,
}

impl StartupStage {
    fn label(self) -> &'static str {
        match self {
            Self::Schema => "Schema",
            Self::Manifest => "Manifest",
            Self::Summaries => "Summaries",
            Self::Counts => "Counts",
            Self::Complete => "Ready",
        }
    }

    fn weight(self) -> f64 {
        match self {
            Self::Schema => 0.05,
            Self::Manifest => 0.05,
            Self::Summaries => 0.75,
            Self::Counts => 0.15,
            Self::Complete => 0.0,
        }
    }

    fn completed_weight_before(self) -> f64 {
        match self {
            Self::Schema => 0.0,
            Self::Manifest => 0.05,
            Self::Summaries => 0.10,
            Self::Counts => 0.85,
            Self::Complete => 1.0,
        }
    }
}

#[derive(Clone)]
struct StartupProgressTracker {
    sink: Option<StartupProgressSink>,
    started_at: Instant,
}

impl StartupProgressTracker {
    fn new(sink: Option<StartupProgressSink>) -> Self {
        Self {
            sink,
            started_at: Instant::now(),
        }
    }

    fn emit(&self, stage: StartupStage, stage_progress: f64, detail: impl Into<String>) {
        let Some(sink) = &self.sink else {
            return;
        };

        let percent_complete = if matches!(stage, StartupStage::Complete) {
            1.0
        } else {
            (stage.completed_weight_before() + (stage.weight() * stage_progress.clamp(0.0, 1.0)))
                .clamp(0.0, 0.999)
        };
        let elapsed = self.started_at.elapsed();
        let eta = if percent_complete > 0.001 && percent_complete < 1.0 {
            let total_seconds = elapsed.as_secs_f64() / percent_complete;
            Some(StdDuration::from_secs_f64(
                (total_seconds - elapsed.as_secs_f64()).max(0.0),
            ))
        } else {
            None
        };

        sink(StartupProgressUpdate {
            phase_label: stage.label(),
            percent_complete,
            detail: detail.into(),
            elapsed,
            eta,
        });
    }
}

impl ReadConnectionPool {
    fn new(database_path: &Path, config: &MarketServerConfig) -> Result<Self> {
        let connection_count = config.runtime.read_connection_pool_size.max(1);
        let tuning = ReadConnectionTuning {
            cache_size_kib: config.runtime.sqlite_read_cache_size_kib,
            mmap_size_bytes: config
                .runtime
                .sqlite_mmap_size_mb
                .saturating_mul(1024 * 1024),
            statement_cache_capacity: config.runtime.sqlite_statement_cache_capacity,
        };
        let mut connections = Vec::with_capacity(connection_count);
        for _ in 0..connection_count {
            connections.push(open_read_connection(database_path, &tuning)?);
        }

        Ok(Self {
            inner: Arc::new(ReadConnectionPoolInner {
                connections: Mutex::new(connections),
                available: Condvar::new(),
            }),
        })
    }

    fn acquire(&self) -> Result<ReadConnectionLease> {
        let mut guard = self
            .inner
            .connections
            .lock()
            .map_err(|_| anyhow!("read connection pool mutex poisoned"))?;
        loop {
            if let Some(connection) = guard.pop() {
                return Ok(ReadConnectionLease {
                    connection: Some(connection),
                    inner: Arc::clone(&self.inner),
                });
            }
            guard = self
                .inner
                .available
                .wait(guard)
                .map_err(|_| anyhow!("read connection pool wait failed"))?;
        }
    }
}

impl ReadConnectionLease {
    fn connection(&self) -> &Connection {
        self.connection
            .as_ref()
            .expect("read connection lease missing connection")
    }
}

impl Drop for ReadConnectionLease {
    fn drop(&mut self) {
        if let Some(connection) = self.connection.take() {
            if let Ok(mut guard) = self.inner.connections.lock() {
                guard.push(connection);
                self.inner.available.notify_one();
            }
        }
    }
}

#[derive(Clone)]
pub struct MarketRuntime {
    pub config: MarketServerConfig,
    pub database_path: Arc<PathBuf>,
    pub manifest: Arc<MarketManifest>,
    pub started_at: String,
    read_pool: Arc<ReadConnectionPool>,
    pub region_summaries: SummaryCache,
    pub system_seed_summaries: SummaryCache,
    pub system_summaries: SummaryCache,
    pub station_summaries: StationSummaryCache,
    pub order_books: OrderBookCache,
}

#[derive(Debug, Clone)]
struct StationMeta {
    station_id: u64,
    solar_system_id: u32,
    constellation_id: u32,
    region_id: u32,
}

#[derive(Debug, Clone)]
struct ReadConnectionTuning {
    cache_size_kib: i32,
    mmap_size_bytes: u64,
    statement_cache_capacity: usize,
}

#[derive(Debug)]
struct ReadConnectionPool {
    inner: Arc<ReadConnectionPoolInner>,
}

#[derive(Debug)]
struct ReadConnectionPoolInner {
    connections: Mutex<Vec<Connection>>,
    available: Condvar,
}

#[derive(Debug)]
struct ReadConnectionLease {
    connection: Option<Connection>,
    inner: Arc<ReadConnectionPoolInner>,
}

impl MarketRuntime {
    #[allow(dead_code)]
    pub async fn load(config: MarketServerConfig) -> Result<Self> {
        let (runtime, _) = Self::load_with_progress(config, None).await?;
        Ok(runtime)
    }

    pub async fn load_with_progress(
        config: MarketServerConfig,
        progress: Option<StartupProgressSink>,
    ) -> Result<(Self, StartupOverview)> {
        let database_path = config.storage.database_path.clone();
        if !database_path.exists() {
            bail!(
                "market database not found at {}. Run the market seeder first.",
                database_path.to_string_lossy()
            );
        }

        let tracker = StartupProgressTracker::new(progress);
        tracker.emit(StartupStage::Schema, 0.0, "schema");
        ensure_runtime_schema(Arc::new(database_path.clone())).await?;
        tracker.emit(StartupStage::Schema, 1.0, "schema ready");

        tracker.emit(StartupStage::Manifest, 0.0, "manifest");
        let manifest = load_manifest(database_path.clone()).await?;
        tracker.emit(
            StartupStage::Manifest,
            1.0,
            format!(
                "{} | {} reg | {} stn",
                manifest.selection_label,
                format_count(manifest.region_count),
                format_count(manifest.station_count)
            ),
        );

        tracker.emit(StartupStage::Summaries, 0.0, "preload");
        let region_summaries = load_all_region_summaries(
            database_path.clone(),
            manifest.region_count,
            tracker.clone(),
        )
        .await?;
        let system_seed_summaries = if config.runtime.preload_system_seed_summaries {
            load_all_system_seed_summaries(
                database_path.clone(),
                manifest.solar_system_count,
                tracker.clone(),
            )
            .await?
        } else {
            HashMap::new()
        };
        let read_pool = Arc::new(ReadConnectionPool::new(&database_path, &config)?);

        let runtime = Self {
            config,
            database_path: Arc::new(database_path),
            manifest: Arc::new(manifest),
            started_at: now_rfc3339(),
            read_pool,
            region_summaries: Arc::new(RwLock::new(region_summaries)),
            system_seed_summaries: Arc::new(RwLock::new(system_seed_summaries)),
            system_summaries: Arc::new(RwLock::new(HashMap::new())),
            station_summaries: Arc::new(RwLock::new(HashMap::new())),
            order_books: Arc::new(RwLock::new(HashMap::new())),
        };

        tracker.emit(StartupStage::Counts, 0.0, "Counting orders and history");
        let startup_overview = runtime
            .startup_overview_with_progress(tracker.clone())
            .await?;
        tracker.emit(
            StartupStage::Complete,
            1.0,
            format!(
                "{} rows | {} reg",
                format_count(startup_overview.region_summary_rows),
                format_count(startup_overview.region_summary_cache_regions)
            ),
        );

        Ok((runtime, startup_overview))
    }

    pub async fn get_region_summary(&self, region_id: u32) -> Result<Vec<SummaryRow>> {
        if let Some(rows) = self.region_summaries.read().await.get(&region_id).cloned() {
            return Ok((*rows).clone());
        }

        let read_pool = self.read_pool.clone();
        let rows = tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_region_summary_rows_with_connection(lease.connection(), region_id)
        })
        .await
        .context("region summary task join failed")??;

        self.region_summaries
            .write()
            .await
            .insert(region_id, Arc::new(rows.clone()));
        Ok(rows)
    }

    pub async fn get_system_summary(&self, solar_system_id: u32) -> Result<Vec<SummaryRow>> {
        if let Some(rows) = self
            .system_summaries
            .read()
            .await
            .get(&solar_system_id)
            .cloned()
        {
            return Ok((*rows).clone());
        }

        let system_seed_rows = self
            .get_or_load_system_seed_summary_rows(solar_system_id)
            .await?;
        let read_pool = self.read_pool.clone();
        let rows = tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_system_summary_rows_with_seed_base(
                lease.connection(),
                solar_system_id,
                system_seed_rows.as_deref().map(|rows| rows.as_slice()),
            )
        })
        .await
        .context("system summary task join failed")??;

        let mut cache = self.system_summaries.write().await;
        insert_bounded_summary_cache(
            &mut cache,
            solar_system_id,
            Arc::new(rows.clone()),
            self.config.runtime.system_summary_cache_capacity,
        );
        Ok(rows)
    }

    async fn get_or_load_system_seed_summary_rows(
        &self,
        solar_system_id: u32,
    ) -> Result<Option<Arc<Vec<SummaryRow>>>> {
        if let Some(rows) = self
            .system_seed_summaries
            .read()
            .await
            .get(&solar_system_id)
            .cloned()
        {
            return Ok(Some(rows));
        }

        let read_pool = self.read_pool.clone();
        let rows = tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_seed_system_summary_rows_with_connection(lease.connection(), solar_system_id)
        })
        .await
        .context("system seed summary load task join failed")??;

        if rows.is_empty() {
            return Ok(None);
        }

        let rows = Arc::new(rows);
        let mut cache = self.system_seed_summaries.write().await;
        insert_bounded_summary_cache(
            &mut cache,
            solar_system_id,
            Arc::clone(&rows),
            self.config.runtime.system_summary_cache_capacity,
        );
        Ok(Some(rows))
    }

    pub async fn get_station_summary(&self, station_id: u64) -> Result<Vec<SummaryRow>> {
        if let Some(rows) = self
            .station_summaries
            .read()
            .await
            .get(&station_id)
            .cloned()
        {
            return Ok((*rows).clone());
        }

        let read_pool = self.read_pool.clone();
        let rows = tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_summary_rows_for_scope(
                lease.connection(),
                "station_id",
                i64::try_from(station_id).unwrap_or(i64::MAX),
            )
        })
        .await
        .context("station summary task join failed")??;

        let mut cache = self.station_summaries.write().await;
        insert_bounded_station_summary_cache(
            &mut cache,
            station_id,
            Arc::new(rows.clone()),
            self.config.runtime.station_summary_cache_capacity,
        );
        Ok(rows)
    }

    pub async fn get_order_book(&self, region_id: u32, type_id: u32) -> Result<OrderBookResponse> {
        if let Some(response) = self
            .order_books
            .read()
            .await
            .get(&(region_id, type_id))
            .cloned()
        {
            return Ok((*response).clone());
        }

        let read_pool = self.read_pool.clone();
        let response = tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_order_book_rows_with_connection(lease.connection(), region_id, type_id)
        })
        .await
        .context("order book task join failed")??;

        let mut cache = self.order_books.write().await;
        insert_bounded_order_book_cache(
            &mut cache,
            (region_id, type_id),
            Arc::new(response.clone()),
            self.config.runtime.order_book_cache_capacity,
        );
        Ok(response)
    }

    pub async fn get_history(&self, type_id: u32) -> Result<HistoryResponse> {
        let read_pool = self.read_pool.clone();
        tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_history_rows_with_connection(lease.connection(), type_id)
        })
        .await
        .context("history task join failed")?
    }

    pub async fn get_histories(&self, type_ids: Vec<u32>) -> Result<Vec<HistoryResponse>> {
        let read_pool = self.read_pool.clone();
        tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_many_history_rows_with_connection(lease.connection(), type_ids)
        })
        .await
        .context("many histories task join failed")?
    }

    pub async fn get_owner_orders(
        &self,
        owner_id: u64,
        is_corp: bool,
    ) -> Result<Vec<OwnerOrderRow>> {
        let read_pool = self.read_pool.clone();
        tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_owner_orders_with_connection(lease.connection(), owner_id, is_corp)
        })
        .await
        .context("owner orders task join failed")?
    }

    pub async fn get_order(&self, order_id: i64) -> Result<OwnerOrderRow> {
        let read_pool = self.read_pool.clone();
        tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_order_by_id_with_connection(lease.connection(), order_id)
        })
        .await
        .context("order task join failed")?
    }

    pub async fn get_order_events(
        &self,
        after_event_id: i64,
        event_type: Option<String>,
        limit: usize,
    ) -> Result<Vec<MarketOrderEvent>> {
        let read_pool = self.read_pool.clone();
        tokio::task::spawn_blocking(move || {
            let lease = read_pool.acquire()?;
            query_order_events_with_connection(
                lease.connection(),
                after_event_id,
                event_type,
                limit,
            )
        })
        .await
        .context("order events task join failed")?
    }

    pub async fn place_order(&self, request: PlaceOrderRequest) -> Result<PlaceOrderResponse> {
        let database_path = self.database_path.clone();
        let response = tokio::task::spawn_blocking(move || insert_order(&database_path, request))
            .await
            .context("place order task join failed")??;

        self.invalidate_scope_caches(
            response.region_id,
            response.solar_system_id,
            response.station_id,
            response.type_id,
        )
        .await;
        self.refresh_region_summary_row(response.region_id, response.type_id)
            .await?;
        Ok(response)
    }

    pub async fn modify_order(&self, request: ModifyOrderRequest) -> Result<ModifyOrderResponse> {
        let database_path = self.database_path.clone();
        let response =
            tokio::task::spawn_blocking(move || modify_order_in_db(&database_path, request))
                .await
                .context("modify order task join failed")??;

        if response.invalidated {
            self.invalidate_scope_caches(
                response.region_id,
                response.solar_system_id,
                response.station_id,
                response.type_id,
            )
            .await;
            self.refresh_region_summary_row(response.region_id, response.type_id)
                .await?;
        }

        Ok(response)
    }

    pub async fn cancel_order(&self, order_id: i64) -> Result<market_common::CancelOrderResponse> {
        let database_path = self.database_path.clone();
        let response =
            tokio::task::spawn_blocking(move || cancel_order_in_db(&database_path, order_id))
                .await
                .context("cancel order task join failed")??;

        if response.invalidated {
            let order = self.get_order(order_id).await?;
            self.invalidate_scope_caches(
                order.row.region_id,
                order.row.solar_system_id,
                order.row.station_id,
                order.row.type_id,
            )
            .await;
            self.refresh_region_summary_row(order.row.region_id, order.row.type_id)
                .await?;
        }

        Ok(response)
    }

    pub async fn fill_order(&self, request: FillOrderRequest) -> Result<FillOrderResponse> {
        let database_path = self.database_path.clone();
        let response =
            tokio::task::spawn_blocking(move || fill_order_in_db(&database_path, request))
                .await
                .context("fill order task join failed")??;

        if response.invalidated {
            self.invalidate_scope_caches(
                response.region_id,
                response.solar_system_id,
                response.station_id,
                response.type_id,
            )
            .await;
            self.refresh_region_summary_row(response.region_id, response.type_id)
                .await?;
            if response.owner_id == 0 && response.bid {
                self.refresh_system_seed_summary_row(response.solar_system_id, response.type_id)
                    .await?;
            }
        }

        Ok(response)
    }

    pub async fn adjust_seed_stock(
        &self,
        request: AdjustSeedStockRequest,
    ) -> Result<AdjustSeedStockResponse> {
        let database_path = self.database_path.clone();
        let response =
            tokio::task::spawn_blocking(move || adjust_seed_stock_in_db(&database_path, request))
                .await
                .context("adjust seed stock task join failed")??;

        self.invalidate_scope_caches(
            response.region_id,
            response.solar_system_id,
            response.station_id,
            response.type_id,
        )
        .await;
        self.refresh_region_summary_row(response.region_id, response.type_id)
            .await?;
        self.refresh_system_seed_summary_row(response.solar_system_id, response.type_id)
            .await?;
        Ok(response)
    }

    pub async fn record_trade(&self, request: RecordTradeRequest) -> Result<RecordTradeResponse> {
        let database_path = self.database_path.clone();
        tokio::task::spawn_blocking(move || record_trade_in_db(&database_path, request))
            .await
            .context("record trade task join failed")?
    }

    pub async fn apply_tq_live_orders(
        &self,
        region_id: u32,
        orders: Vec<TqLiveSourceOrder>,
    ) -> Result<TqLiveApplyReport> {
        let database_path = self.database_path.clone();
        let report = tokio::task::spawn_blocking(move || {
            apply_tq_live_orders_in_db(&database_path, region_id, orders)
        })
        .await
        .context("TQ live apply task join failed")??;

        self.region_summaries.write().await.remove(&region_id);
        self.order_books
            .write()
            .await
            .retain(|(cached_region_id, _), _| *cached_region_id != region_id);
        self.system_seed_summaries.write().await.clear();
        self.system_summaries.write().await.clear();
        self.station_summaries.write().await.clear();

        Ok(report)
    }

    pub async fn sweep_expired_orders(&self) -> Result<SweepExpiredOrdersResponse> {
        let database_path = self.database_path.clone();
        let expired_orders =
            tokio::task::spawn_blocking(move || expire_due_orders_in_db(&database_path))
                .await
                .context("expire due orders task join failed")??;

        for order in &expired_orders {
            self.invalidate_scope_caches(
                order.row.region_id,
                order.row.solar_system_id,
                order.row.station_id,
                order.row.type_id,
            )
            .await;
        }

        for order in &expired_orders {
            self.refresh_region_summary_row(order.row.region_id, order.row.type_id)
                .await?;
        }

        Ok(SweepExpiredOrdersResponse {
            expired_count: expired_orders.len(),
            swept_at: now_rfc3339(),
        })
    }

    pub async fn rebuild_region_summaries(
        &self,
        region_id: Option<u32>,
    ) -> Result<CacheRebuildResponse> {
        let database_path = self.database_path.clone();
        let response = tokio::task::spawn_blocking(move || {
            rebuild_region_summary_cache(&database_path, region_id)
        })
        .await
        .context("region summary rebuild task join failed")??;

        match region_id {
            Some(region_id) => {
                self.region_summaries.write().await.remove(&region_id);
            }
            None => {
                let reloaded = load_all_region_summaries(
                    (*self.database_path).clone(),
                    self.manifest.region_count,
                    StartupProgressTracker::new(None),
                )
                .await?;
                *self.region_summaries.write().await = reloaded;
            }
        }

        Ok(response)
    }

    pub async fn diagnostics(&self) -> Result<DiagnosticsResponse> {
        let region_cache = self.region_summaries.read().await;
        let region_rows = region_cache.values().map(|rows| rows.len()).sum();

        Ok(DiagnosticsResponse {
            started_at: self.started_at.clone(),
            database_path: self.database_path.to_string_lossy().to_string(),
            host: self.config.network.host.clone(),
            port: self.config.network.port,
            rpc_enabled: self.config.rpc.enabled,
            rpc_host: self.config.rpc.host.clone(),
            rpc_port: self.config.rpc.port,
            region_summary_cache_regions: region_cache.len(),
            region_summary_rows: region_rows,
            system_summary_cache_entries: self.system_summaries.read().await.len(),
            station_summary_cache_entries: self.station_summaries.read().await.len(),
            order_book_cache_entries: self.order_books.read().await.len(),
            manifest: (*self.manifest).clone(),
        })
    }

    #[allow(dead_code)]
    pub async fn startup_overview(&self) -> Result<StartupOverview> {
        self.startup_overview_with_progress(StartupProgressTracker::new(None))
            .await
    }

    async fn startup_overview_with_progress(
        &self,
        tracker: StartupProgressTracker,
    ) -> Result<StartupOverview> {
        let region_cache = self.region_summaries.read().await;
        let region_summary_cache_regions = region_cache.len();
        let region_summary_rows = region_cache.values().map(|rows| rows.len()).sum();
        drop(region_cache);

        let database_path = self.database_path.clone();
        let database_counts =
            tokio::task::spawn_blocking(move || query_startup_counts(&database_path, tracker))
                .await
                .context("startup overview task join failed")??;

        Ok(StartupOverview {
            region_summary_cache_regions,
            region_summary_rows,
            price_history_rows: database_counts.price_history_rows,
            total_orders: database_counts.total_orders,
            open_orders: database_counts.open_orders,
            open_buy_orders: database_counts.open_buy_orders,
            open_sell_orders: database_counts.open_sell_orders,
            closed_orders: database_counts.closed_orders,
            order_event_rows: database_counts.order_event_rows,
        })
    }

    async fn refresh_region_summary_row(&self, region_id: u32, type_id: u32) -> Result<()> {
        let database_path = self.database_path.clone();
        tokio::task::spawn_blocking(move || {
            refresh_single_region_summary_row(&database_path, region_id, type_id)
        })
        .await
        .context("refresh region summary row task join failed")??;
        self.region_summaries.write().await.remove(&region_id);
        Ok(())
    }

    async fn refresh_system_seed_summary_row(
        &self,
        solar_system_id: u32,
        type_id: u32,
    ) -> Result<()> {
        let database_path = self.database_path.clone();
        tokio::task::spawn_blocking(move || {
            refresh_single_system_seed_summary_row(&database_path, solar_system_id, type_id)
        })
        .await
        .context("refresh system seed summary row task join failed")??;
        self.system_seed_summaries
            .write()
            .await
            .remove(&solar_system_id);
        self.system_summaries.write().await.remove(&solar_system_id);
        Ok(())
    }

    async fn invalidate_scope_caches(
        &self,
        region_id: u32,
        solar_system_id: u32,
        station_id: u64,
        type_id: u32,
    ) {
        self.region_summaries.write().await.remove(&region_id);
        self.system_summaries.write().await.remove(&solar_system_id);
        self.station_summaries.write().await.remove(&station_id);
        self.order_books.write().await.remove(&(region_id, type_id));
    }
}

fn insert_bounded_summary_cache(
    cache: &mut HashMap<u32, Arc<Vec<SummaryRow>>>,
    key: u32,
    value: Arc<Vec<SummaryRow>>,
    capacity: usize,
) {
    if capacity > 0 && !cache.contains_key(&key) && cache.len() >= capacity {
        if let Some(evicted_key) = cache.keys().next().copied() {
            cache.remove(&evicted_key);
        }
    }
    cache.insert(key, value);
}

fn insert_bounded_station_summary_cache(
    cache: &mut HashMap<u64, Arc<Vec<SummaryRow>>>,
    key: u64,
    value: Arc<Vec<SummaryRow>>,
    capacity: usize,
) {
    if capacity > 0 && !cache.contains_key(&key) && cache.len() >= capacity {
        if let Some(evicted_key) = cache.keys().next().copied() {
            cache.remove(&evicted_key);
        }
    }
    cache.insert(key, value);
}

fn insert_bounded_order_book_cache(
    cache: &mut HashMap<(u32, u32), Arc<OrderBookResponse>>,
    key: (u32, u32),
    value: Arc<OrderBookResponse>,
    capacity: usize,
) {
    if capacity > 0 && !cache.contains_key(&key) && cache.len() >= capacity {
        if let Some(evicted_key) = cache.keys().next().copied() {
            cache.remove(&evicted_key);
        }
    }
    cache.insert(key, value);
}

fn load_connection(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path).with_context(|| {
        format!(
            "failed to open market database at {}",
            path.to_string_lossy()
        )
    })?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "cache_size", -20_000)?;
    connection.pragma_update(None, "temp_store", "MEMORY")?;
    connection.busy_timeout(StdDuration::from_secs(5))?;
    connection.set_prepared_statement_cache_capacity(128);
    Ok(connection)
}

fn open_read_connection(path: &Path, tuning: &ReadConnectionTuning) -> Result<Connection> {
    let connection = Connection::open(path).with_context(|| {
        format!(
            "failed to open market database at {}",
            path.to_string_lossy()
        )
    })?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "cache_size", -tuning.cache_size_kib)?;
    connection.pragma_update(None, "temp_store", "MEMORY")?;
    connection.pragma_update(None, "query_only", 1)?;
    connection.pragma_update(None, "mmap_size", tuning.mmap_size_bytes)?;
    connection.busy_timeout(StdDuration::from_secs(5))?;
    connection.set_prepared_statement_cache_capacity(tuning.statement_cache_capacity);
    Ok(connection)
}

async fn ensure_runtime_schema(database_path: Arc<PathBuf>) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let connection = load_connection(&database_path)?;
        connection.execute_batch(SCHEMA_SQL)?;

        let mut has_last_state_change_at = false;
        {
            let mut statement = connection.prepare("PRAGMA table_info(market_orders)")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
            for row in rows {
                if row?.as_str() == "last_state_change_at" {
                    has_last_state_change_at = true;
                    break;
                }
            }
        }

        if !has_last_state_change_at {
            connection.execute(
                "ALTER TABLE market_orders ADD COLUMN last_state_change_at TEXT",
                [],
            )?;
        }

        connection.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_seed_stock_station_type_price
               ON seed_stock (station_id, type_id, price);
              CREATE INDEX IF NOT EXISTS idx_market_orders_station_type_bid_state_price
               ON market_orders (station_id, type_id, bid, state, price);
             CREATE INDEX IF NOT EXISTS idx_market_orders_player_expiry
               ON market_orders (state, issued_at, duration_days, order_id)
               WHERE source = 'player';
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
             CREATE INDEX IF NOT EXISTS idx_market_order_events_type_id
               ON market_order_events (event_type, event_id);",
        )?;
        Ok::<(), anyhow::Error>(())
    })
    .await
    .context("runtime schema creation task join failed")?
}

async fn load_manifest(database_path: PathBuf) -> Result<MarketManifest> {
    tokio::task::spawn_blocking(move || {
        let connection = load_connection(&database_path)?;
        let raw = connection
            .query_row(
                "SELECT value FROM manifest WHERE key = ?1",
                params![MANIFEST_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| anyhow!("manifest_json missing from market database"))?;
        let manifest = serde_json::from_str::<MarketManifest>(&raw)?;
        Ok(manifest)
    })
    .await
    .context("manifest load task join failed")?
}

async fn load_all_region_summaries(
    database_path: PathBuf,
    expected_region_count: u32,
    tracker: StartupProgressTracker,
) -> Result<HashMap<u32, Arc<Vec<SummaryRow>>>> {
    tokio::task::spawn_blocking(move || {
        let connection = load_connection(&database_path)?;
        let total_rows =
            connection.query_row("SELECT COUNT(*) FROM region_summaries", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let mut statement = connection.prepare(
            "SELECT region_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
                    best_bid_price, total_bid_quantity, best_bid_station_id
             FROM region_summaries
             ORDER BY region_id, type_id",
        )?;

        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                SummaryRow {
                    type_id: row.get(1)?,
                    best_ask_price: row.get(2)?,
                    total_ask_quantity: row.get::<_, u64>(3)?,
                    best_ask_station_id: row.get(4)?,
                    best_bid_price: row.get(5)?,
                    total_bid_quantity: row.get::<_, u64>(6)?,
                    best_bid_station_id: row.get(7)?,
                },
            ))
        })?;

        let mut grouped: HashMap<u32, Vec<SummaryRow>> = HashMap::new();
        let mut loaded_rows: u64 = 0;
        let mut loaded_regions: u32 = 0;
        let mut current_region_id: Option<u32> = None;

        if total_rows == 0 {
            tracker.emit(StartupStage::Summaries, 1.0, "0 rows");
        }

        for row in rows {
            let (region_id, summary) = row?;
            if current_region_id != Some(region_id) {
                current_region_id = Some(region_id);
                loaded_regions += 1;
            }
            loaded_rows += 1;
            grouped.entry(region_id).or_default().push(summary);

            if total_rows > 0
                && (loaded_rows == 1
                    || loaded_rows == total_rows
                    || loaded_rows % 50_000 == 0
                    || grouped
                        .get(&region_id)
                        .map(|rows| rows.len() == 1)
                        .unwrap_or(false))
            {
                tracker.emit(
                    StartupStage::Summaries,
                    loaded_rows as f64 / total_rows as f64,
                    format!(
                        "rows {}/{} | reg {}/{}",
                        format_count(loaded_rows),
                        format_count(total_rows),
                        format_count(loaded_regions),
                        format_count(expected_region_count)
                    ),
                );
            }
        }

        tracker.emit(
            StartupStage::Summaries,
            1.0,
            format!(
                "rows {} | reg {}",
                format_count(loaded_rows),
                format_count(grouped.len())
            ),
        );

        Ok(grouped
            .into_iter()
            .map(|(region_id, rows)| (region_id, Arc::new(rows)))
            .collect::<HashMap<_, _>>())
    })
    .await
    .context("region summary preload task join failed")?
}

async fn load_all_system_seed_summaries(
    database_path: PathBuf,
    expected_system_count: u32,
    tracker: StartupProgressTracker,
) -> Result<HashMap<u32, Arc<Vec<SummaryRow>>>> {
    tokio::task::spawn_blocking(move || {
        let connection = load_connection(&database_path)?;
        let total_rows = connection.query_row(
            "SELECT COUNT(*) FROM system_seed_summaries",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let mut statement = connection.prepare(
            "SELECT solar_system_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
                    best_bid_price, total_bid_quantity, best_bid_station_id
             FROM system_seed_summaries
             ORDER BY solar_system_id, type_id",
        )?;

        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                SummaryRow {
                    type_id: row.get(1)?,
                    best_ask_price: row.get(2)?,
                    total_ask_quantity: row.get::<_, u64>(3)?,
                    best_ask_station_id: row.get(4)?,
                    best_bid_price: row.get(5)?,
                    total_bid_quantity: row.get::<_, u64>(6)?,
                    best_bid_station_id: row.get(7)?,
                },
            ))
        })?;

        let mut grouped: HashMap<u32, Vec<SummaryRow>> = HashMap::new();
        let mut loaded_rows: u64 = 0;
        let mut loaded_systems: u32 = 0;
        let mut current_system_id: Option<u32> = None;

        for row in rows {
            let (solar_system_id, summary) = row?;
            if current_system_id != Some(solar_system_id) {
                current_system_id = Some(solar_system_id);
                loaded_systems += 1;
            }
            loaded_rows += 1;
            grouped.entry(solar_system_id).or_default().push(summary);

            if total_rows > 0
                && (loaded_rows == total_rows
                    || loaded_rows % 100_000 == 0
                    || grouped
                        .get(&solar_system_id)
                        .map(|rows| rows.len() == 1)
                        .unwrap_or(false))
            {
                tracker.emit(
                    StartupStage::Summaries,
                    loaded_rows as f64 / total_rows as f64,
                    format!(
                        "sys rows {}/{} | sys {}/{}",
                        format_count(loaded_rows),
                        format_count(total_rows),
                        format_count(loaded_systems),
                        format_count(expected_system_count)
                    ),
                );
            }
        }

        Ok(grouped
            .into_iter()
            .map(|(solar_system_id, rows)| (solar_system_id, Arc::new(rows)))
            .collect::<HashMap<_, _>>())
    })
    .await
    .context("system seed summary preload task join failed")?
}

fn query_region_summary_rows_with_connection(
    connection: &Connection,
    region_id: u32,
) -> Result<Vec<SummaryRow>> {
    let mut statement = connection.prepare_cached(
        "SELECT type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
                best_bid_price, total_bid_quantity, best_bid_station_id
         FROM region_summaries
         WHERE region_id = ?1
         ORDER BY type_id",
    )?;
    let rows = statement.query_map(params![region_id], |row| {
        Ok(SummaryRow {
            type_id: row.get(0)?,
            best_ask_price: row.get(1)?,
            total_ask_quantity: row.get::<_, u64>(2)?,
            best_ask_station_id: row.get(3)?,
            best_bid_price: row.get(4)?,
            total_bid_quantity: row.get::<_, u64>(5)?,
            best_bid_station_id: row.get(6)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn query_summary_rows_for_scope(
    connection: &Connection,
    scope_column: &str,
    scope_value: i64,
) -> Result<Vec<SummaryRow>> {
    match scope_column {
        "station_id" => {
            return query_station_summary_rows(connection, u64::try_from(scope_value).unwrap_or(0));
        }
        "solar_system_id" => {
            return query_system_summary_rows(connection, u32::try_from(scope_value).unwrap_or(0));
        }
        _ => {}
    }

    let sells_sql = format!(
        "WITH sells AS (
           SELECT type_id, price, quantity AS quantity_value, station_id
           FROM seed_stock
           WHERE {scope_column} = ?1 AND quantity > 0
           UNION ALL
           SELECT type_id, price, vol_remaining AS quantity_value, station_id
           FROM market_orders
           WHERE {scope_column} = ?1 AND state = 'open' AND bid = 0 AND vol_remaining > 0
         ),
         sell_totals AS (
           SELECT type_id,
                  MIN(price) AS best_ask_price,
                  SUM(quantity_value) AS total_ask_quantity
           FROM sells
           GROUP BY type_id
         )
         SELECT sell_totals.type_id,
                sell_totals.best_ask_price,
                sell_totals.total_ask_quantity,
                MIN(sells.station_id) AS best_ask_station_id
         FROM sell_totals
         JOIN sells
           ON sells.type_id = sell_totals.type_id
          AND sells.price = sell_totals.best_ask_price
         GROUP BY
           sell_totals.type_id,
           sell_totals.best_ask_price,
           sell_totals.total_ask_quantity
         ORDER BY sell_totals.type_id"
    );

    let buys_sql = format!(
        "WITH buys AS (
           SELECT type_id, price, quantity AS quantity_value, station_id
           FROM seed_buy_orders
           WHERE {scope_column} = ?1 AND quantity > 0
           UNION ALL
           SELECT type_id, price, vol_remaining AS quantity_value, station_id
           FROM market_orders
           WHERE {scope_column} = ?1 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
         ),
         buy_totals AS (
           SELECT type_id,
                  MAX(price) AS best_bid_price,
                  SUM(quantity_value) AS total_bid_quantity
           FROM buys
           GROUP BY type_id
         )
         SELECT buy_totals.type_id,
                buy_totals.best_bid_price,
                buy_totals.total_bid_quantity,
                MIN(buys.station_id) AS best_bid_station_id
         FROM buy_totals
         JOIN buys
           ON buys.type_id = buy_totals.type_id
          AND buys.price = buy_totals.best_bid_price
         GROUP BY
           buy_totals.type_id,
           buy_totals.best_bid_price,
           buy_totals.total_bid_quantity"
    );

    let mut result = HashMap::<u32, SummaryRow>::new();

    {
        let mut statement = connection.prepare_cached(&sells_sql)?;
        let rows = statement.query_map(params![scope_value], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, Option<f64>>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, Option<u64>>(3)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_ask_price, total_ask_quantity, best_ask_station_id) = row?;
            result.insert(
                type_id,
                SummaryRow {
                    type_id,
                    best_ask_price,
                    total_ask_quantity,
                    best_ask_station_id,
                    best_bid_price: None,
                    total_bid_quantity: 0,
                    best_bid_station_id: None,
                },
            );
        }
    }

    {
        let mut statement = connection.prepare_cached(&buys_sql)?;
        let rows = statement.query_map(params![scope_value], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, Option<f64>>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, Option<u64>>(3)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_bid_price, total_bid_quantity, best_bid_station_id) = row?;
            let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            });
            entry.best_bid_price = best_bid_price;
            entry.total_bid_quantity = total_bid_quantity;
            entry.best_bid_station_id = best_bid_station_id;
        }
    }

    let mut values = result.into_values().collect::<Vec<_>>();
    values.sort_by_key(|row| row.type_id);
    Ok(values)
}

fn query_station_summary_rows(connection: &Connection, station_id: u64) -> Result<Vec<SummaryRow>> {
    let mut result = HashMap::<u32, SummaryRow>::new();

    {
        let mut statement = connection.prepare_cached(
            "SELECT type_id, price, quantity
             FROM seed_stock
             WHERE station_id = ?1 AND quantity > 0
             ORDER BY type_id",
        )?;
        let rows = statement.query_map(params![station_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })?;

        for row in rows {
            let (type_id, price, quantity) = row?;
            result.insert(
                type_id,
                SummaryRow {
                    type_id,
                    best_ask_price: Some(price),
                    total_ask_quantity: quantity,
                    best_ask_station_id: Some(station_id),
                    best_bid_price: None,
                    total_bid_quantity: 0,
                    best_bid_station_id: None,
                },
            );
        }
    }

    {
        let mut statement = connection.prepare_cached(
            "SELECT type_id, MIN(price) AS best_ask_price, SUM(vol_remaining) AS total_ask_quantity
             FROM market_orders
             WHERE station_id = ?1 AND state = 'open' AND bid = 0 AND source = 'player' AND vol_remaining > 0
             GROUP BY type_id",
        )?;
        let rows = statement.query_map(params![station_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_ask_price, total_ask_quantity) = row?;
            let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            });
            entry.total_ask_quantity += total_ask_quantity;
            if entry
                .best_ask_price
                .is_none_or(|current| best_ask_price < current)
            {
                entry.best_ask_price = Some(best_ask_price);
                entry.best_ask_station_id = Some(station_id);
            }
        }
    }

    {
        let mut statement = connection.prepare_cached(
            "SELECT type_id, MAX(price) AS best_bid_price, SUM(quantity_value) AS total_bid_quantity
             FROM (
               SELECT type_id, price, quantity AS quantity_value
               FROM seed_buy_orders
               WHERE station_id = ?1 AND quantity > 0
               UNION ALL
               SELECT type_id, price, vol_remaining AS quantity_value
               FROM market_orders
               WHERE station_id = ?1 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
             )
             GROUP BY type_id",
        )?;
        let rows = statement.query_map(params![station_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_bid_price, total_bid_quantity) = row?;
            let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            });
            entry.best_bid_price = Some(best_bid_price);
            entry.total_bid_quantity = total_bid_quantity;
            entry.best_bid_station_id = Some(station_id);
        }
    }

    let mut values = result.into_values().collect::<Vec<_>>();
    values.sort_by_key(|row| row.type_id);
    Ok(values)
}

fn query_system_summary_rows(
    connection: &Connection,
    solar_system_id: u32,
) -> Result<Vec<SummaryRow>> {
    let mut result = load_seed_system_summary_rows(connection, solar_system_id)?;
    if result.is_empty() {
        return query_system_summary_rows_fallback(connection, solar_system_id);
    }

    {
        let mut statement = connection.prepare_cached(
            "WITH sell_agg AS (
               SELECT type_id, MIN(price) AS best_ask_price, SUM(vol_remaining) AS total_ask_quantity
               FROM market_orders
               WHERE solar_system_id = ?1 AND state = 'open' AND bid = 0 AND source = 'player' AND vol_remaining > 0
               GROUP BY type_id
             )
             SELECT sell_agg.type_id,
                    sell_agg.best_ask_price,
                    sell_agg.total_ask_quantity,
                    MIN(market_orders.station_id) AS best_ask_station_id
             FROM sell_agg
             JOIN market_orders
               ON market_orders.solar_system_id = ?1
              AND market_orders.type_id = sell_agg.type_id
              AND market_orders.price = sell_agg.best_ask_price
              AND market_orders.state = 'open'
              AND market_orders.bid = 0
              AND market_orders.source = 'player'
              AND market_orders.vol_remaining > 0
             GROUP BY sell_agg.type_id, sell_agg.best_ask_price, sell_agg.total_ask_quantity",
        )?;
        let rows = statement.query_map(params![solar_system_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, u64>(3)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_ask_price, total_ask_quantity, best_ask_station_id) = row?;
            let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            });
            entry.total_ask_quantity += total_ask_quantity;
            if entry
                .best_ask_price
                .is_none_or(|current| best_ask_price < current)
                || (entry.best_ask_price == Some(best_ask_price)
                    && entry
                        .best_ask_station_id
                        .map(|current| best_ask_station_id < current)
                        .unwrap_or(true))
            {
                entry.best_ask_price = Some(best_ask_price);
                entry.best_ask_station_id = Some(best_ask_station_id);
            }
        }
    }

    {
        let mut statement = connection.prepare_cached(
            "WITH buy_agg AS (
               SELECT type_id, MAX(price) AS best_bid_price, SUM(vol_remaining) AS total_bid_quantity
               FROM market_orders
               WHERE solar_system_id = ?1 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
               GROUP BY type_id
             )
             SELECT buy_agg.type_id,
                    buy_agg.best_bid_price,
                    buy_agg.total_bid_quantity,
                    MIN(market_orders.station_id) AS best_bid_station_id
             FROM buy_agg
             JOIN market_orders
               ON market_orders.solar_system_id = ?1
              AND market_orders.type_id = buy_agg.type_id
              AND market_orders.price = buy_agg.best_bid_price
              AND market_orders.state = 'open'
              AND market_orders.bid = 1
              AND market_orders.source = 'player'
              AND market_orders.vol_remaining > 0
             GROUP BY buy_agg.type_id, buy_agg.best_bid_price, buy_agg.total_bid_quantity",
        )?;
        let rows = statement.query_map(params![solar_system_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, u64>(3)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_bid_price, total_bid_quantity, best_bid_station_id) = row?;
            let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            });
            entry.best_bid_price = Some(best_bid_price);
            entry.total_bid_quantity += total_bid_quantity;
            entry.best_bid_station_id = Some(best_bid_station_id);
        }
    }

    let mut values = result.into_values().collect::<Vec<_>>();
    values.sort_by_key(|row| row.type_id);
    Ok(values)
}

fn query_system_summary_rows_with_seed_base(
    connection: &Connection,
    solar_system_id: u32,
    seed_rows: Option<&[SummaryRow]>,
) -> Result<Vec<SummaryRow>> {
    if let Some(seed_rows) = seed_rows {
        let mut result = seed_rows
            .iter()
            .cloned()
            .map(|row| (row.type_id, row))
            .collect::<HashMap<_, _>>();

        {
            let mut statement = connection.prepare_cached(
                "WITH sell_agg AS (
                   SELECT type_id, MIN(price) AS best_ask_price, SUM(vol_remaining) AS total_ask_quantity
                   FROM market_orders
                   WHERE solar_system_id = ?1 AND state = 'open' AND bid = 0 AND source = 'player' AND vol_remaining > 0
                   GROUP BY type_id
                 )
                 SELECT sell_agg.type_id,
                        sell_agg.best_ask_price,
                        sell_agg.total_ask_quantity,
                        MIN(market_orders.station_id) AS best_ask_station_id
                 FROM sell_agg
                 JOIN market_orders
                   ON market_orders.solar_system_id = ?1
                  AND market_orders.type_id = sell_agg.type_id
                  AND market_orders.price = sell_agg.best_ask_price
                  AND market_orders.state = 'open'
                  AND market_orders.bid = 0
                  AND market_orders.source = 'player'
                  AND market_orders.vol_remaining > 0
                 GROUP BY sell_agg.type_id, sell_agg.best_ask_price, sell_agg.total_ask_quantity",
            )?;
            let rows = statement.query_map(params![solar_system_id], |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u64>(3)?,
                ))
            })?;

            for row in rows {
                let (type_id, best_ask_price, total_ask_quantity, best_ask_station_id) = row?;
                let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                    type_id,
                    best_ask_price: None,
                    total_ask_quantity: 0,
                    best_ask_station_id: None,
                    best_bid_price: None,
                    total_bid_quantity: 0,
                    best_bid_station_id: None,
                });
                entry.total_ask_quantity += total_ask_quantity;
                if entry
                    .best_ask_price
                    .is_none_or(|current| best_ask_price < current)
                    || (entry.best_ask_price == Some(best_ask_price)
                        && entry
                            .best_ask_station_id
                            .map(|current| best_ask_station_id < current)
                            .unwrap_or(true))
                {
                    entry.best_ask_price = Some(best_ask_price);
                    entry.best_ask_station_id = Some(best_ask_station_id);
                }
            }
        }

        {
            let mut statement = connection.prepare_cached(
                "WITH buy_agg AS (
                   SELECT type_id, MAX(price) AS best_bid_price, SUM(vol_remaining) AS total_bid_quantity
                   FROM market_orders
                   WHERE solar_system_id = ?1 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
                   GROUP BY type_id
                 )
                 SELECT buy_agg.type_id,
                        buy_agg.best_bid_price,
                        buy_agg.total_bid_quantity,
                        MIN(market_orders.station_id) AS best_bid_station_id
                 FROM buy_agg
                 JOIN market_orders
                   ON market_orders.solar_system_id = ?1
                  AND market_orders.type_id = buy_agg.type_id
                  AND market_orders.price = buy_agg.best_bid_price
                  AND market_orders.state = 'open'
                  AND market_orders.bid = 1
                  AND market_orders.source = 'player'
                  AND market_orders.vol_remaining > 0
                 GROUP BY buy_agg.type_id, buy_agg.best_bid_price, buy_agg.total_bid_quantity",
            )?;
            let rows = statement.query_map(params![solar_system_id], |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u64>(3)?,
                ))
            })?;

            for row in rows {
                let (type_id, best_bid_price, total_bid_quantity, best_bid_station_id) = row?;
                let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                    type_id,
                    best_ask_price: None,
                    total_ask_quantity: 0,
                    best_ask_station_id: None,
                    best_bid_price: None,
                    total_bid_quantity: 0,
                    best_bid_station_id: None,
                });
                entry.best_bid_price = Some(best_bid_price);
                entry.total_bid_quantity += total_bid_quantity;
                entry.best_bid_station_id = Some(best_bid_station_id);
            }
        }

        let mut values = result.into_values().collect::<Vec<_>>();
        values.sort_by_key(|row| row.type_id);
        return Ok(values);
    }

    query_system_summary_rows(connection, solar_system_id)
}

fn query_seed_system_summary_rows_with_connection(
    connection: &Connection,
    solar_system_id: u32,
) -> Result<Vec<SummaryRow>> {
    let mut statement = connection.prepare_cached(
        "SELECT type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
                best_bid_price, total_bid_quantity, best_bid_station_id
         FROM system_seed_summaries
         WHERE solar_system_id = ?1
         ORDER BY type_id",
    )?;
    let rows = statement.query_map(params![solar_system_id], |row| {
        Ok(SummaryRow {
            type_id: row.get(0)?,
            best_ask_price: row.get(1)?,
            total_ask_quantity: row.get::<_, u64>(2)?,
            best_ask_station_id: row.get(3)?,
            best_bid_price: row.get(4)?,
            total_bid_quantity: row.get::<_, u64>(5)?,
            best_bid_station_id: row.get(6)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn load_seed_system_summary_rows(
    connection: &Connection,
    solar_system_id: u32,
) -> Result<HashMap<u32, SummaryRow>> {
    Ok(
        query_seed_system_summary_rows_with_connection(connection, solar_system_id)?
            .into_iter()
            .map(|row| (row.type_id, row))
            .collect::<HashMap<_, _>>(),
    )
}

fn query_system_summary_rows_fallback(
    connection: &Connection,
    solar_system_id: u32,
) -> Result<Vec<SummaryRow>> {
    let mut result = HashMap::<u32, SummaryRow>::new();

    {
        let mut statement = connection.prepare_cached(
            "WITH seed_agg AS (
               SELECT type_id, MIN(price) AS best_ask_price, SUM(quantity) AS total_ask_quantity
               FROM seed_stock
               WHERE solar_system_id = ?1 AND quantity > 0
               GROUP BY type_id
             )
             SELECT seed_agg.type_id,
                    seed_agg.best_ask_price,
                    seed_agg.total_ask_quantity,
                    MIN(seed_stock.station_id) AS best_ask_station_id
             FROM seed_agg
             JOIN seed_stock
               ON seed_stock.solar_system_id = ?1
              AND seed_stock.type_id = seed_agg.type_id
              AND seed_stock.price = seed_agg.best_ask_price
              AND seed_stock.quantity > 0
             GROUP BY seed_agg.type_id, seed_agg.best_ask_price, seed_agg.total_ask_quantity
             ORDER BY seed_agg.type_id",
        )?;
        let rows = statement.query_map(params![solar_system_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, u64>(3)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_ask_price, total_ask_quantity, best_ask_station_id) = row?;
            result.insert(
                type_id,
                SummaryRow {
                    type_id,
                    best_ask_price: Some(best_ask_price),
                    total_ask_quantity,
                    best_ask_station_id: Some(best_ask_station_id),
                    best_bid_price: None,
                    total_bid_quantity: 0,
                    best_bid_station_id: None,
                },
            );
        }
    }

    {
        let mut statement = connection.prepare_cached(
            "WITH sell_agg AS (
               SELECT type_id, MIN(price) AS best_ask_price, SUM(vol_remaining) AS total_ask_quantity
               FROM market_orders
               WHERE solar_system_id = ?1 AND state = 'open' AND bid = 0 AND source = 'player' AND vol_remaining > 0
               GROUP BY type_id
             )
             SELECT sell_agg.type_id,
                    sell_agg.best_ask_price,
                    sell_agg.total_ask_quantity,
                    MIN(market_orders.station_id) AS best_ask_station_id
             FROM sell_agg
             JOIN market_orders
               ON market_orders.solar_system_id = ?1
              AND market_orders.type_id = sell_agg.type_id
              AND market_orders.price = sell_agg.best_ask_price
              AND market_orders.state = 'open'
              AND market_orders.bid = 0
              AND market_orders.source = 'player'
              AND market_orders.vol_remaining > 0
             GROUP BY sell_agg.type_id, sell_agg.best_ask_price, sell_agg.total_ask_quantity",
        )?;
        let rows = statement.query_map(params![solar_system_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, u64>(3)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_ask_price, total_ask_quantity, best_ask_station_id) = row?;
            let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            });
            entry.total_ask_quantity += total_ask_quantity;
            if entry
                .best_ask_price
                .is_none_or(|current| best_ask_price < current)
                || (entry.best_ask_price == Some(best_ask_price)
                    && entry
                        .best_ask_station_id
                        .map(|current| best_ask_station_id < current)
                        .unwrap_or(true))
            {
                entry.best_ask_price = Some(best_ask_price);
                entry.best_ask_station_id = Some(best_ask_station_id);
            }
        }
    }

    {
        let mut statement = connection.prepare_cached(
            "WITH buy_agg AS (
               SELECT type_id, MAX(price) AS best_bid_price, SUM(quantity_value) AS total_bid_quantity
               FROM (
                 SELECT type_id, price, quantity AS quantity_value
                 FROM seed_buy_orders
                 WHERE solar_system_id = ?1 AND quantity > 0
                 UNION ALL
                 SELECT type_id, price, vol_remaining AS quantity_value
                 FROM market_orders
                 WHERE solar_system_id = ?1 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
               )
               GROUP BY type_id
             )
             SELECT buy_agg.type_id,
                    buy_agg.best_bid_price,
                    buy_agg.total_bid_quantity,
                    MIN(buy_rows.station_id) AS best_bid_station_id
             FROM buy_agg
             JOIN (
               SELECT type_id, station_id, price
               FROM seed_buy_orders
               WHERE solar_system_id = ?1 AND quantity > 0
               UNION ALL
               SELECT type_id, station_id, price
               FROM market_orders
               WHERE solar_system_id = ?1 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
             ) AS buy_rows
               ON buy_rows.type_id = buy_agg.type_id
              AND buy_rows.price = buy_agg.best_bid_price
             GROUP BY buy_agg.type_id, buy_agg.best_bid_price, buy_agg.total_bid_quantity",
        )?;
        let rows = statement.query_map(params![solar_system_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, u64>(3)?,
            ))
        })?;

        for row in rows {
            let (type_id, best_bid_price, total_bid_quantity, best_bid_station_id) = row?;
            let entry = result.entry(type_id).or_insert_with(|| SummaryRow {
                type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            });
            entry.best_bid_price = Some(best_bid_price);
            entry.total_bid_quantity = total_bid_quantity;
            entry.best_bid_station_id = Some(best_bid_station_id);
        }
    }

    let mut values = result.into_values().collect::<Vec<_>>();
    values.sort_by_key(|row| row.type_id);
    Ok(values)
}

fn query_order_book_rows_with_connection(
    connection: &Connection,
    region_id: u32,
    type_id: u32,
) -> Result<OrderBookResponse> {
    let mut sells = Vec::new();
    {
        let mut statement = connection.prepare_cached(
            "SELECT station_id, solar_system_id, constellation_id, price, quantity, initial_quantity, updated_at
             FROM seed_stock
             WHERE region_id = ?1 AND type_id = ?2 AND quantity > 0
             ORDER BY price ASC, station_id ASC",
        )?;
        let rows = statement.query_map(params![region_id, type_id], |row| {
            Ok(OrderRow {
                order_id: seed_sell_order_id(row.get::<_, u64>(0)?, type_id),
                price: row.get(3)?,
                vol_remaining: row.get::<_, u64>(4)?,
                type_id,
                range_value: 32_767,
                vol_entered: row.get::<_, u64>(5)?,
                min_volume: 1,
                bid: false,
                issued_at: row.get(6)?,
                duration_days: 3650,
                station_id: row.get(0)?,
                region_id,
                solar_system_id: row.get(1)?,
                constellation_id: row.get(2)?,
                source: "seed".to_string(),
            })
        })?;

        for row in rows {
            sells.push(row?);
        }
    }

    {
        let mut statement = connection.prepare_cached(
            "SELECT order_id, price, vol_remaining, vol_entered, min_volume, range_value, duration_days,
                    station_id, solar_system_id, constellation_id, issued_at, source
             FROM market_orders
             WHERE region_id = ?1 AND type_id = ?2 AND state = 'open' AND bid = 0 AND vol_remaining > 0
             ORDER BY price ASC, station_id ASC, order_id ASC",
        )?;
        let rows = statement.query_map(params![region_id, type_id], |row| {
            Ok(OrderRow {
                order_id: row.get(0)?,
                price: row.get(1)?,
                vol_remaining: row.get::<_, u64>(2)?,
                type_id,
                range_value: row.get(5)?,
                vol_entered: row.get::<_, u64>(3)?,
                min_volume: row.get::<_, u64>(4)?,
                bid: false,
                issued_at: row.get(10)?,
                duration_days: row.get(6)?,
                station_id: row.get(7)?,
                region_id,
                solar_system_id: row.get(8)?,
                constellation_id: row.get(9)?,
                source: row.get(11)?,
            })
        })?;

        for row in rows {
            sells.push(row?);
        }
    }

    sells.sort_by(|left, right| {
        left.price
            .partial_cmp(&right.price)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(left.station_id.cmp(&right.station_id))
            .then(left.order_id.cmp(&right.order_id))
    });

    let mut buys = Vec::new();
    {
        let mut statement = connection.prepare_cached(
            "SELECT station_id, solar_system_id, constellation_id, price, quantity, initial_quantity, updated_at
             FROM seed_buy_orders
             WHERE region_id = ?1 AND type_id = ?2 AND quantity > 0
             ORDER BY price DESC, station_id ASC",
        )?;
        let rows = statement.query_map(params![region_id, type_id], |row| {
            Ok(OrderRow {
                order_id: seed_buy_order_id(row.get::<_, u64>(0)?, type_id),
                price: row.get(3)?,
                vol_remaining: row.get::<_, u64>(4)?,
                type_id,
                range_value: 32_767,
                vol_entered: row.get::<_, u64>(5)?,
                min_volume: 1,
                bid: true,
                issued_at: row.get(6)?,
                duration_days: 3650,
                station_id: row.get(0)?,
                region_id,
                solar_system_id: row.get(1)?,
                constellation_id: row.get(2)?,
                source: "seed".to_string(),
            })
        })?;

        for row in rows {
            buys.push(row?);
        }
    }

    {
        let mut statement = connection.prepare_cached(
            "SELECT order_id, price, vol_remaining, vol_entered, min_volume, range_value, duration_days,
                    station_id, solar_system_id, constellation_id, issued_at, source
             FROM market_orders
             WHERE region_id = ?1 AND type_id = ?2 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
             ORDER BY price DESC, station_id ASC, order_id ASC",
        )?;
        let rows = statement.query_map(params![region_id, type_id], |row| {
            Ok(OrderRow {
                order_id: row.get(0)?,
                price: row.get(1)?,
                vol_remaining: row.get::<_, u64>(2)?,
                type_id,
                range_value: row.get(5)?,
                vol_entered: row.get::<_, u64>(3)?,
                min_volume: row.get::<_, u64>(4)?,
                bid: true,
                issued_at: row.get(10)?,
                duration_days: row.get(6)?,
                station_id: row.get(7)?,
                region_id,
                solar_system_id: row.get(8)?,
                constellation_id: row.get(9)?,
                source: row.get(11)?,
            })
        })?;

        for row in rows {
            buys.push(row?);
        }
    }

    Ok(OrderBookResponse {
        region_id,
        type_id,
        sells,
        buys,
        cached_at: now_rfc3339(),
    })
}

fn query_many_history_rows_with_connection(
    connection: &Connection,
    type_ids: Vec<u32>,
) -> Result<Vec<HistoryResponse>> {
    let mut responses = Vec::with_capacity(type_ids.len());
    for type_id in type_ids {
        responses.push(query_history_rows_with_connection(connection, type_id)?);
    }
    Ok(responses)
}

fn query_history_rows_with_connection(
    connection: &Connection,
    type_id: u32,
) -> Result<HistoryResponse> {
    let mut statement = connection.prepare_cached(
        "SELECT day, low_price, high_price, avg_price, volume, order_count
         FROM price_history
         WHERE type_id = ?1
         ORDER BY day ASC",
    )?;
    let rows = statement.query_map(params![type_id], |row| {
        Ok(HistoryRow {
            day: row.get(0)?,
            low_price: row.get(1)?,
            high_price: row.get(2)?,
            avg_price: row.get(3)?,
            volume: row.get::<_, u64>(4)?,
            order_count: row.get(5)?,
        })
    })?;

    let mut result_rows = Vec::new();
    for row in rows {
        result_rows.push(row?);
    }

    Ok(HistoryResponse {
        type_id,
        rows: result_rows,
    })
}

fn query_owner_orders_with_connection(
    connection: &Connection,
    owner_id: u64,
    is_corp: bool,
) -> Result<Vec<OwnerOrderRow>> {
    let mut statement = connection.prepare_cached(
        "SELECT order_id, owner_id, is_corp, state, source, price, vol_remaining, type_id, range_value,
                vol_entered, min_volume, bid, issued_at, duration_days, station_id, region_id,
                solar_system_id, constellation_id, last_state_change_at
         FROM market_orders
         WHERE owner_id = ?1 AND is_corp = ?2
         ORDER BY updated_at DESC, order_id DESC",
    )?;
    let rows = statement.query_map(
        params![owner_id, if is_corp { 1 } else { 0 }],
        map_owner_order_row,
    )?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn query_order_by_id_with_connection(
    connection: &Connection,
    order_id: i64,
) -> Result<OwnerOrderRow> {
    if let Some((station_id, type_id)) = try_decode_seed_buy_order_id(order_id) {
        if let Some(order) =
            query_seed_buy_order_by_id_with_connection(connection, station_id, type_id)?
        {
            return Ok(order);
        }
    }

    connection
        .query_row(
            "SELECT order_id, owner_id, is_corp, state, source, price, vol_remaining, type_id, range_value,
                    vol_entered, min_volume, bid, issued_at, duration_days, station_id, region_id,
                    solar_system_id, constellation_id, last_state_change_at
             FROM market_orders
             WHERE order_id = ?1",
            params![order_id],
            map_owner_order_row,
        )
        .optional()?
        .ok_or_else(|| anyhow!("order {} not found", order_id))
}

fn query_order_events_with_connection(
    connection: &Connection,
    after_event_id: i64,
    event_type: Option<String>,
    limit: usize,
) -> Result<Vec<MarketOrderEvent>> {
    let limit = limit.max(1).min(1000) as i64;
    let mut result = Vec::new();

    if let Some(event_type) = event_type {
        let mut statement = connection.prepare_cached(
            "SELECT event_id, event_type, occurred_at, order_id, owner_id, is_corp, state, source,
                    price, vol_remaining, type_id, range_value, vol_entered, min_volume, bid,
                    issued_at, duration_days, station_id, region_id, solar_system_id,
                    constellation_id, last_state_change_at
             FROM market_order_events
             WHERE event_id > ?1 AND event_type = ?2
             ORDER BY event_id ASC
             LIMIT ?3",
        )?;
        let rows = statement.query_map(
            params![after_event_id, event_type, limit],
            map_market_order_event,
        )?;
        for row in rows {
            result.push(row?);
        }
    } else {
        let mut statement = connection.prepare_cached(
            "SELECT event_id, event_type, occurred_at, order_id, owner_id, is_corp, state, source,
                    price, vol_remaining, type_id, range_value, vol_entered, min_volume, bid,
                    issued_at, duration_days, station_id, region_id, solar_system_id,
                    constellation_id, last_state_change_at
             FROM market_order_events
             WHERE event_id > ?1
             ORDER BY event_id ASC
             LIMIT ?2",
        )?;
        let rows = statement.query_map(params![after_event_id, limit], map_market_order_event)?;
        for row in rows {
            result.push(row?);
        }
    }

    Ok(result)
}

#[derive(Debug)]
struct StartupCounts {
    price_history_rows: u64,
    total_orders: u64,
    open_orders: u64,
    open_buy_orders: u64,
    open_sell_orders: u64,
    closed_orders: u64,
    order_event_rows: u64,
}

fn query_startup_counts(
    database_path: &Path,
    tracker: StartupProgressTracker,
) -> Result<StartupCounts> {
    let connection = load_connection(database_path)?;
    let total_steps = 3.0;

    tracker.emit(StartupStage::Counts, 0.0, "history");
    let price_history_rows =
        connection.query_row("SELECT COUNT(*) FROM price_history", [], |row| {
            row.get::<_, u64>(0)
        })?;
    tracker.emit(
        StartupStage::Counts,
        1.0 / total_steps,
        format!("hist {}", format_count(price_history_rows)),
    );

    tracker.emit(StartupStage::Counts, 1.0 / total_steps, "orders");
    let (player_total_orders, player_open_orders, player_open_buy_orders, player_open_sell_orders) =
        connection.query_row(
            "SELECT
           COUNT(*) AS total_orders,
           SUM(CASE WHEN state = 'open' THEN 1 ELSE 0 END) AS open_orders,
           SUM(CASE WHEN state = 'open' AND bid = 1 THEN 1 ELSE 0 END) AS open_buy_orders,
           SUM(CASE WHEN state = 'open' AND bid = 0 THEN 1 ELSE 0 END) AS open_sell_orders
         FROM market_orders",
            [],
            |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    row.get::<_, Option<u64>>(1)?.unwrap_or(0),
                    row.get::<_, Option<u64>>(2)?.unwrap_or(0),
                    row.get::<_, Option<u64>>(3)?.unwrap_or(0),
                ))
            },
        )?;
    let (seed_buy_total_orders, seed_buy_open_orders) = connection.query_row(
        "SELECT
           COUNT(*) AS total_orders,
           SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) AS open_orders
         FROM seed_buy_orders",
        [],
        |row| {
            Ok((
                row.get::<_, u64>(0)?,
                row.get::<_, Option<u64>>(1)?.unwrap_or(0),
            ))
        },
    )?;
    let (seed_sell_total_orders, seed_sell_open_orders) = connection.query_row(
        "SELECT
           COUNT(*) AS total_orders,
           SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) AS open_orders
         FROM seed_stock",
        [],
        |row| {
            Ok((
                row.get::<_, u64>(0)?,
                row.get::<_, Option<u64>>(1)?.unwrap_or(0),
            ))
        },
    )?;
    let total_orders = player_total_orders + seed_buy_total_orders + seed_sell_total_orders;
    let open_orders = player_open_orders + seed_buy_open_orders + seed_sell_open_orders;
    let open_buy_orders = player_open_buy_orders + seed_buy_open_orders;
    let open_sell_orders = player_open_sell_orders + seed_sell_open_orders;
    tracker.emit(
        StartupStage::Counts,
        2.0 / total_steps,
        format!(
            "ord {} | open {} | buy {} | sell {}",
            format_count(total_orders),
            format_count(open_orders),
            format_count(open_buy_orders),
            format_count(open_sell_orders)
        ),
    );

    tracker.emit(StartupStage::Counts, 2.0 / total_steps, "events");
    let order_event_rows =
        connection.query_row("SELECT COUNT(*) FROM market_order_events", [], |row| {
            row.get::<_, u64>(0)
        })?;
    tracker.emit(
        StartupStage::Counts,
        1.0,
        format!("evt {}", format_count(order_event_rows)),
    );

    Ok(StartupCounts {
        price_history_rows,
        total_orders,
        open_orders,
        open_buy_orders,
        open_sell_orders,
        closed_orders: total_orders.saturating_sub(open_orders),
        order_event_rows,
    })
}

fn query_seed_buy_order_by_id_with_connection(
    connection: &Connection,
    station_id: u64,
    type_id: u32,
) -> Result<Option<OwnerOrderRow>> {
    connection
        .query_row(
            "SELECT price, quantity, initial_quantity, solar_system_id, constellation_id, region_id, updated_at
             FROM seed_buy_orders
             WHERE station_id = ?1 AND type_id = ?2",
            params![station_id, type_id],
            |row| {
                let vol_remaining = row.get::<_, u64>(1)?;
                let order_id = seed_buy_order_id(station_id, type_id);
                Ok(OwnerOrderRow {
                    order_id,
                    owner_id: 0,
                    is_corp: false,
                    state: if vol_remaining == 0 {
                        "filled".to_string()
                    } else {
                        "open".to_string()
                    },
                    source: "seed".to_string(),
                    last_state_change_at: None,
                    row: OrderRow {
                        order_id,
                        price: row.get(0)?,
                        vol_remaining,
                        type_id,
                        range_value: 32_767,
                        vol_entered: row.get::<_, u64>(2)?,
                        min_volume: 1,
                        bid: true,
                        issued_at: row.get(6)?,
                        duration_days: 3650,
                        station_id,
                        region_id: row.get(5)?,
                        solar_system_id: row.get(3)?,
                        constellation_id: row.get(4)?,
                        source: "seed".to_string(),
                    },
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn format_count<T>(value: T) -> String
where
    T: ToString,
{
    let digits = value.to_string();
    let mut parts = Vec::new();
    let mut end = digits.len();

    while end > 3 {
        parts.push(digits[end - 3..end].to_string());
        end -= 3;
    }
    parts.push(digits[..end].to_string());
    parts.reverse();
    parts.join(",")
}

fn map_owner_order_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OwnerOrderRow> {
    Ok(OwnerOrderRow {
        order_id: row.get(0)?,
        owner_id: row.get(1)?,
        is_corp: row.get::<_, i64>(2)? == 1,
        state: row.get(3)?,
        source: row.get(4)?,
        last_state_change_at: row.get(18)?,
        row: OrderRow {
            order_id: row.get(0)?,
            price: row.get(5)?,
            vol_remaining: row.get::<_, u64>(6)?,
            type_id: row.get(7)?,
            range_value: row.get(8)?,
            vol_entered: row.get::<_, u64>(9)?,
            min_volume: row.get::<_, u64>(10)?,
            bid: row.get::<_, i64>(11)? == 1,
            issued_at: row.get(12)?,
            duration_days: row.get(13)?,
            station_id: row.get(14)?,
            region_id: row.get(15)?,
            solar_system_id: row.get(16)?,
            constellation_id: row.get(17)?,
            source: row.get(4)?,
        },
    })
}

fn map_market_order_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<MarketOrderEvent> {
    Ok(MarketOrderEvent {
        event_id: row.get(0)?,
        event_type: row.get(1)?,
        occurred_at: row.get(2)?,
        order: OwnerOrderRow {
            order_id: row.get(3)?,
            owner_id: row.get(4)?,
            is_corp: row.get::<_, i64>(5)? == 1,
            state: row.get(6)?,
            source: row.get(7)?,
            last_state_change_at: row.get(21)?,
            row: OrderRow {
                order_id: row.get(3)?,
                price: row.get(8)?,
                vol_remaining: row.get::<_, u64>(9)?,
                type_id: row.get(10)?,
                range_value: row.get(11)?,
                vol_entered: row.get::<_, u64>(12)?,
                min_volume: row.get::<_, u64>(13)?,
                bid: row.get::<_, i64>(14)? == 1,
                issued_at: row.get(15)?,
                duration_days: row.get(16)?,
                station_id: row.get(17)?,
                region_id: row.get(18)?,
                solar_system_id: row.get(19)?,
                constellation_id: row.get(20)?,
                source: row.get(7)?,
            },
        },
    })
}

fn lookup_station_meta(connection: &Connection, station_id: u64) -> Result<StationMeta> {
    connection
        .query_row(
            "SELECT station_id, solar_system_id, constellation_id, region_id
             FROM stations
             WHERE station_id = ?1",
            params![station_id],
            |row| {
                Ok(StationMeta {
                    station_id: row.get(0)?,
                    solar_system_id: row.get(1)?,
                    constellation_id: row.get(2)?,
                    region_id: row.get(3)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("station {} does not exist in market database", station_id))
}

fn insert_order(database_path: &Path, request: PlaceOrderRequest) -> Result<PlaceOrderResponse> {
    if request.price <= 0.0 {
        bail!("price must be greater than zero");
    }
    if request.quantity == 0 {
        bail!("quantity must be greater than zero");
    }

    let mut connection = load_connection(database_path)?;
    let station_meta = lookup_station_meta(&connection, request.station_id)?;
    let now = now_rfc3339();
    let source = request.source.unwrap_or_else(|| "player".to_string());
    let wallet_division = request.wallet_division.unwrap_or(1000);
    let min_volume = request.min_volume.unwrap_or(1);
    let duration_days = request.duration_days.unwrap_or(90);
    let range_value = request.range_value.unwrap_or(32_767);
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO market_orders (
           owner_id, is_corp, wallet_division, station_id, solar_system_id, constellation_id, region_id,
           type_id, price, vol_entered, vol_remaining, min_volume, bid, range_value, duration_days,
           escrow, state, source, issued_at, last_state_change_at, updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7,
           ?8, ?9, ?10, ?10, ?11, ?12, ?13, ?14,
           0, 'open', ?15, ?16, NULL, ?16
         )",
        params![
            request.owner_id,
            if request.is_corp { 1 } else { 0 },
            wallet_division,
            station_meta.station_id,
            station_meta.solar_system_id,
            station_meta.constellation_id,
            station_meta.region_id,
            request.type_id,
            request.price,
            request.quantity,
            min_volume,
            if request.bid { 1 } else { 0 },
            range_value,
            duration_days,
            source,
            now,
        ],
    )?;
    let order_id = transaction.last_insert_rowid();
    transaction.commit()?;

    Ok(PlaceOrderResponse {
        order_id,
        region_id: station_meta.region_id,
        solar_system_id: station_meta.solar_system_id,
        station_id: station_meta.station_id,
        type_id: request.type_id,
        cached_regions_invalidated: 1,
    })
}

fn modify_order_in_db(
    database_path: &Path,
    request: ModifyOrderRequest,
) -> Result<ModifyOrderResponse> {
    if request.new_price <= 0.0 {
        bail!("new_price must be greater than zero");
    }

    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    let scope = transaction
        .query_row(
            "SELECT region_id, solar_system_id, station_id, type_id, bid, vol_remaining, state
             FROM market_orders
             WHERE order_id = ?1",
            params![request.order_id],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, i64>(4)? == 1,
                    row.get::<_, u64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?;

    let Some((region_id, solar_system_id, station_id, type_id, bid, vol_remaining, state)) = scope
    else {
        bail!("order {} not found", request.order_id);
    };

    if state != "open" {
        transaction.commit()?;
        return Ok(ModifyOrderResponse {
            order_id: request.order_id,
            region_id,
            solar_system_id,
            station_id,
            type_id,
            bid,
            price: request.new_price,
            vol_remaining,
            state,
            invalidated: false,
        });
    }

    let updated_at = now_rfc3339();
    transaction.execute(
        "UPDATE market_orders
         SET price = ?2, updated_at = ?3
         WHERE order_id = ?1",
        params![request.order_id, request.new_price, updated_at],
    )?;
    transaction.commit()?;

    Ok(ModifyOrderResponse {
        order_id: request.order_id,
        region_id,
        solar_system_id,
        station_id,
        type_id,
        bid,
        price: request.new_price,
        vol_remaining,
        state: "open".to_string(),
        invalidated: true,
    })
}

fn cancel_order_in_db(
    database_path: &Path,
    order_id: i64,
) -> Result<market_common::CancelOrderResponse> {
    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    let scope = transaction
        .query_row(
            "SELECT state FROM market_orders WHERE order_id = ?1",
            params![order_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    let Some(state) = scope else {
        bail!("order {} not found", order_id);
    };

    if state != "open" {
        transaction.commit()?;
        return Ok(market_common::CancelOrderResponse {
            order_id,
            state,
            invalidated: false,
        });
    }

    let now = now_rfc3339();
    transaction.execute(
        "UPDATE market_orders
         SET state = 'cancelled', last_state_change_at = ?2, updated_at = ?2
         WHERE order_id = ?1",
        params![order_id, now],
    )?;
    transaction.commit()?;

    Ok(market_common::CancelOrderResponse {
        order_id,
        state: "cancelled".to_string(),
        invalidated: true,
    })
}

fn fill_order_in_db(database_path: &Path, request: FillOrderRequest) -> Result<FillOrderResponse> {
    if request.fill_quantity == 0 {
        bail!("fill_quantity must be greater than zero");
    }

    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    if let Some((station_id, type_id)) = try_decode_seed_buy_order_id(request.order_id) {
        let scope = transaction
            .query_row(
                "SELECT region_id, solar_system_id, price, quantity
                 FROM seed_buy_orders
                 WHERE station_id = ?1 AND type_id = ?2",
                params![station_id, type_id],
                |row| {
                    Ok((
                        row.get::<_, u32>(0)?,
                        row.get::<_, u32>(1)?,
                        row.get::<_, f64>(2)?,
                        row.get::<_, u64>(3)?,
                    ))
                },
            )
            .optional()?;

        let Some((region_id, solar_system_id, price, vol_remaining)) = scope else {
            bail!("order {} not found", request.order_id);
        };

        if request.fill_quantity > vol_remaining {
            bail!("fill quantity exceeds remaining order volume");
        }

        let next_remaining = vol_remaining - request.fill_quantity;
        transaction.execute(
            "UPDATE seed_buy_orders
             SET quantity = ?3, updated_at = ?4
             WHERE station_id = ?1 AND type_id = ?2",
            params![station_id, type_id, next_remaining, now_rfc3339()],
        )?;
        increment_tq_seed_usage(&transaction, "buy", station_id, type_id, request.fill_quantity)?;
        transaction.commit()?;

        return Ok(FillOrderResponse {
            order_id: request.order_id,
            owner_id: 0,
            is_corp: false,
            region_id,
            solar_system_id,
            station_id,
            type_id,
            bid: true,
            price,
            filled_quantity: request.fill_quantity,
            vol_remaining: next_remaining,
            state: if next_remaining == 0 {
                "filled".to_string()
            } else {
                "open".to_string()
            },
            invalidated: true,
        });
    }

    let scope = transaction
        .query_row(
            "SELECT owner_id, is_corp, region_id, solar_system_id, station_id, type_id, bid, price,
                    vol_remaining, state
             FROM market_orders
             WHERE order_id = ?1",
            params![request.order_id],
            |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    row.get::<_, i64>(1)? == 1,
                    row.get::<_, u32>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, u64>(4)?,
                    row.get::<_, u32>(5)?,
                    row.get::<_, i64>(6)? == 1,
                    row.get::<_, f64>(7)?,
                    row.get::<_, u64>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?;

    let Some((
        owner_id,
        is_corp,
        region_id,
        solar_system_id,
        station_id,
        type_id,
        bid,
        price,
        vol_remaining,
        state,
    )) = scope
    else {
        bail!("order {} not found", request.order_id);
    };

    if state != "open" {
        transaction.commit()?;
        return Ok(FillOrderResponse {
            order_id: request.order_id,
            owner_id,
            is_corp,
            region_id,
            solar_system_id,
            station_id,
            type_id,
            bid,
            price,
            filled_quantity: 0,
            vol_remaining,
            state,
            invalidated: false,
        });
    }

    if request.fill_quantity > vol_remaining {
        bail!("fill quantity exceeds remaining order volume");
    }

    let next_remaining = vol_remaining - request.fill_quantity;
    let next_state = if next_remaining == 0 {
        "filled"
    } else {
        "open"
    };
    let state_change_at = if next_state == "filled" {
        Some(now_rfc3339())
    } else {
        None
    };

    transaction.execute(
        "UPDATE market_orders
         SET vol_remaining = ?2,
             state = ?3,
             last_state_change_at = CASE WHEN ?5 IS NULL THEN last_state_change_at ELSE ?5 END,
             updated_at = ?4
         WHERE order_id = ?1",
        params![
            request.order_id,
            next_remaining,
            next_state,
            now_rfc3339(),
            state_change_at,
        ],
    )?;
    transaction.commit()?;

    Ok(FillOrderResponse {
        order_id: request.order_id,
        owner_id,
        is_corp,
        region_id,
        solar_system_id,
        station_id,
        type_id,
        bid,
        price,
        filled_quantity: request.fill_quantity,
        vol_remaining: next_remaining,
        state: next_state.to_string(),
        invalidated: true,
    })
}

fn expire_due_orders_in_db(database_path: &Path) -> Result<Vec<OwnerOrderRow>> {
    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    let mut expired_orders = Vec::new();
    {
        let mut statement = transaction.prepare(
            "SELECT order_id, owner_id, is_corp, state, source, price, vol_remaining, type_id,
                    range_value, vol_entered, min_volume, bid, issued_at, duration_days,
                    station_id, region_id, solar_system_id, constellation_id, last_state_change_at
             FROM market_orders
             WHERE state = 'open'
               AND source = 'player'
               AND datetime(issued_at, '+' || duration_days || ' days') <= datetime('now')
             ORDER BY order_id ASC",
        )?;
        let rows = statement.query_map([], map_owner_order_row)?;

        for row in rows {
            expired_orders.push(row?);
        }
    }

    if expired_orders.is_empty() {
        transaction.commit()?;
        return Ok(expired_orders);
    }

    let swept_at = now_rfc3339();
    for order in &expired_orders {
        transaction.execute(
            "UPDATE market_orders
             SET state = 'expired', last_state_change_at = ?2, updated_at = ?2
             WHERE order_id = ?1",
            params![order.order_id, swept_at],
        )?;
        transaction.execute(
            "INSERT INTO market_order_events (
               event_type, order_id, owner_id, is_corp, state, source, price, vol_remaining,
               type_id, range_value, vol_entered, min_volume, bid, issued_at, duration_days,
               station_id, region_id, solar_system_id, constellation_id, last_state_change_at,
               occurred_at
             ) VALUES (
               'expired', ?1, ?2, ?3, 'expired', ?4, ?5, ?6,
               ?7, ?8, ?9, ?10, ?11, ?12, ?13,
               ?14, ?15, ?16, ?17, ?18, ?18
             )",
            params![
                order.order_id,
                order.owner_id,
                if order.is_corp { 1 } else { 0 },
                order.source,
                order.row.price,
                order.row.vol_remaining,
                order.row.type_id,
                order.row.range_value,
                order.row.vol_entered,
                order.row.min_volume,
                if order.row.bid { 1 } else { 0 },
                order.row.issued_at,
                order.row.duration_days,
                order.row.station_id,
                order.row.region_id,
                order.row.solar_system_id,
                order.row.constellation_id,
                swept_at,
            ],
        )?;
    }

    transaction.commit()?;

    for order in &mut expired_orders {
        order.state = "expired".to_string();
        order.last_state_change_at = Some(swept_at.clone());
    }

    Ok(expired_orders)
}

fn adjust_seed_stock_in_db(
    database_path: &Path,
    request: AdjustSeedStockRequest,
) -> Result<AdjustSeedStockResponse> {
    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    let current = transaction
        .query_row(
            "SELECT station_id, solar_system_id, region_id, quantity, price
             FROM seed_stock
             WHERE station_id = ?1 AND type_id = ?2",
            params![request.station_id, request.type_id],
            |row| {
                Ok((
                    row.get::<_, u64>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, u32>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, f64>(4)?,
                ))
            },
        )
        .optional()?;

    let Some((station_id, solar_system_id, region_id, current_quantity, current_price)) = current
    else {
        bail!(
            "seed stock not found for station {} type {}",
            request.station_id,
            request.type_id
        );
    };

    let target_quantity = if let Some(new_quantity) = request.new_quantity {
        i64::try_from(new_quantity).unwrap_or(i64::MAX)
    } else {
        current_quantity + request.delta_quantity.unwrap_or(0)
    };
    if target_quantity < 0 {
        bail!("seed stock quantity cannot become negative");
    }

    let target_price = request.new_price.unwrap_or(current_price);
    if target_quantity < current_quantity {
        increment_tq_seed_usage(
            &transaction,
            "sell",
            station_id,
            request.type_id,
            u64::try_from(current_quantity - target_quantity).unwrap_or(0),
        )?;
    }
    transaction.execute(
        "UPDATE seed_stock
         SET quantity = ?3,
             price = ?4,
             updated_at = ?5,
             price_version = price_version + CASE WHEN price <> ?4 THEN 1 ELSE 0 END
         WHERE station_id = ?1 AND type_id = ?2",
        params![
            station_id,
            request.type_id,
            target_quantity,
            target_price,
            now_rfc3339(),
        ],
    )?;
    transaction.commit()?;

    Ok(AdjustSeedStockResponse {
        station_id,
        type_id: request.type_id,
        region_id,
        solar_system_id,
        quantity: u64::try_from(target_quantity).unwrap_or(0),
        price: target_price,
    })
}

fn increment_tq_seed_usage(
    transaction: &rusqlite::Transaction<'_>,
    side: &str,
    station_id: u64,
    type_id: u32,
    quantity: u64,
) -> Result<()> {
    if quantity == 0 {
        return Ok(());
    }
    transaction.execute(
        "INSERT INTO tq_seed_local_usage (
           side, station_id, type_id, consumed_quantity, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(side, station_id, type_id) DO UPDATE SET
           consumed_quantity = consumed_quantity + excluded.consumed_quantity,
           updated_at = excluded.updated_at",
        params![
            side,
            station_id,
            type_id,
            i64::try_from(quantity).unwrap_or(i64::MAX),
            now_rfc3339(),
        ],
    )?;
    Ok(())
}

fn record_trade_in_db(
    database_path: &Path,
    request: RecordTradeRequest,
) -> Result<RecordTradeResponse> {
    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    let day = current_trade_day();

    let existing = transaction
        .query_row(
            "SELECT low_price, high_price, avg_price, volume, order_count
             FROM price_history
             WHERE type_id = ?1 AND day = ?2",
            params![request.type_id, day],
            |row| {
                Ok((
                    row.get::<_, f64>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, u64>(3)?,
                    row.get::<_, u32>(4)?,
                ))
            },
        )
        .optional()?;

    match existing {
        Some((low_price, high_price, avg_price, volume, order_count)) => {
            let next_volume = volume + request.quantity;
            let weighted_total =
                avg_price * volume as f64 + request.price * request.quantity as f64;
            let next_avg = if next_volume == 0 {
                request.price
            } else {
                weighted_total / next_volume as f64
            };
            transaction.execute(
                "UPDATE price_history
                 SET low_price = ?3,
                     high_price = ?4,
                     avg_price = ?5,
                     volume = ?6,
                     order_count = ?7
                 WHERE type_id = ?1 AND day = ?2",
                params![
                    request.type_id,
                    day,
                    low_price.min(request.price),
                    high_price.max(request.price),
                    next_avg,
                    next_volume,
                    order_count + 1,
                ],
            )?;
        }
        None => {
            transaction.execute(
                "INSERT INTO price_history (
                   type_id, day, low_price, high_price, avg_price, volume, order_count
                 ) VALUES (?1, ?2, ?3, ?3, ?3, ?4, 1)",
                params![request.type_id, day, request.price, request.quantity],
            )?;
        }
    }

    transaction.commit()?;

    Ok(RecordTradeResponse {
        type_id: request.type_id,
        day,
        price: request.price,
        quantity: request.quantity,
    })
}

#[derive(Debug, Clone)]
struct MirrorOrderSnapshot {
    is_buy_order: bool,
    station_id: u64,
    solar_system_id: u32,
    type_id: u32,
    price: f64,
    volume_remain: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct SeedRowSnapshot {
    price: f64,
    quantity: u64,
    initial_quantity: u64,
}

#[derive(Debug, Clone)]
struct TqSeedAggregate {
    station_id: u64,
    solar_system_id: u32,
    constellation_id: u32,
    region_id: u32,
    type_id: u32,
    price_cents: i64,
    quantity: u64,
}

impl TqSeedAggregate {
    fn new(order: &TqLiveSourceOrder) -> Self {
        Self {
            station_id: order.station_id,
            solar_system_id: order.solar_system_id,
            constellation_id: order.constellation_id,
            region_id: order.region_id,
            type_id: order.type_id,
            price_cents: price_to_cents(order.price),
            quantity: order.volume_remain,
        }
    }

    fn absorb_sell_order(&mut self, order: &TqLiveSourceOrder) {
        let price_cents = price_to_cents(order.price);
        if price_cents < self.price_cents {
            self.price_cents = price_cents;
            self.quantity = order.volume_remain;
        } else if price_cents == self.price_cents {
            self.quantity = self.quantity.saturating_add(order.volume_remain);
        }
    }

    fn absorb_buy_order(&mut self, order: &TqLiveSourceOrder) {
        let price_cents = price_to_cents(order.price);
        if price_cents > self.price_cents {
            self.price_cents = price_cents;
            self.quantity = order.volume_remain;
        } else if price_cents == self.price_cents {
            self.quantity = self.quantity.saturating_add(order.volume_remain);
        }
    }

    fn price(&self) -> f64 {
        self.price_cents as f64 / 100.0
    }
}

fn apply_tq_live_orders_in_db(
    database_path: &Path,
    region_id: u32,
    orders: Vec<TqLiveSourceOrder>,
) -> Result<TqLiveApplyReport> {
    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    let applied_at = now_rfc3339();

    bootstrap_tq_seed_usage(&transaction, &applied_at)?;

    let old_orders = load_tq_mirror_orders_for_region(&transaction, region_id)?;
    let old_sell_seed_rows = load_seed_rows_for_region(&transaction, "seed_stock", region_id)?;
    let old_buy_seed_rows = load_seed_rows_for_region(&transaction, "seed_buy_orders", region_id)?;

    let mut new_orders = HashMap::<i64, MirrorOrderSnapshot>::new();
    let mut sell_liquidity = BTreeMap::<(u64, u32), TqSeedAggregate>::new();
    let mut buy_liquidity = BTreeMap::<(u64, u32), TqSeedAggregate>::new();
    let mut affected_types = HashSet::<u32>::new();
    let mut affected_stations = HashSet::<u64>::new();
    let mut affected_systems = HashSet::<u32>::new();

    for order in &orders {
        let key = (order.station_id, order.type_id);
        if order.is_buy_order {
            buy_liquidity
                .entry(key)
                .and_modify(|entry| entry.absorb_buy_order(order))
                .or_insert_with(|| TqSeedAggregate::new(order));
        } else {
            sell_liquidity
                .entry(key)
                .and_modify(|entry| entry.absorb_sell_order(order))
                .or_insert_with(|| TqSeedAggregate::new(order));
        }
        affected_types.insert(order.type_id);
        affected_stations.insert(order.station_id);
        affected_systems.insert(order.solar_system_id);
        new_orders.insert(
            order.order_id,
            MirrorOrderSnapshot {
                is_buy_order: order.is_buy_order,
                station_id: order.station_id,
                solar_system_id: order.solar_system_id,
                type_id: order.type_id,
                price: order.price,
                volume_remain: order.volume_remain,
            },
        );
    }

    for old in old_orders.values() {
        affected_types.insert(old.type_id);
        affected_stations.insert(old.station_id);
        affected_systems.insert(old.solar_system_id);
    }

    let mut report = TqLiveApplyReport {
        region_id,
        source_orders: orders.len() as u64,
        seed_sell_rows: sell_liquidity.len() as u64,
        seed_buy_rows: buy_liquidity.len() as u64,
        affected_types: affected_types.len(),
        affected_stations: affected_stations.len(),
        affected_systems: affected_systems.len(),
        applied_at: applied_at.clone(),
        ..TqLiveApplyReport::default()
    };

    for (order_id, new_order) in &new_orders {
        match old_orders.get(order_id) {
            None if new_order.is_buy_order => report.created_buy_orders += 1,
            None => report.created_sell_orders += 1,
            Some(old_order) => {
                let price_changed = (old_order.price - new_order.price).abs() > 0.0001;
                let volume_changed = old_order.volume_remain != new_order.volume_remain;
                if price_changed {
                    report.price_changed_orders += 1;
                }
                if volume_changed {
                    report.volume_changed_orders += 1;
                    if old_order.volume_remain > new_order.volume_remain {
                        let delta = old_order.volume_remain - new_order.volume_remain;
                        if new_order.is_buy_order {
                            report.buy_volume_decreased_units =
                                report.buy_volume_decreased_units.saturating_add(delta);
                        } else {
                            report.sell_volume_decreased_units =
                                report.sell_volume_decreased_units.saturating_add(delta);
                        }
                    }
                }
            }
        }
    }

    for (order_id, old_order) in &old_orders {
        if new_orders.contains_key(order_id) {
            continue;
        }
        if old_order.is_buy_order {
            report.removed_buy_orders += 1;
            report.buy_volume_decreased_units = report
                .buy_volume_decreased_units
                .saturating_add(old_order.volume_remain);
        } else {
            report.removed_sell_orders += 1;
            report.sell_volume_decreased_units = report
                .sell_volume_decreased_units
                .saturating_add(old_order.volume_remain);
        }
    }

    let new_sell_seed_rows =
        build_effective_seed_row_snapshot(&transaction, "sell", &sell_liquidity)?;
    let new_buy_seed_rows =
        build_effective_seed_row_snapshot(&transaction, "buy", &buy_liquidity)?;
    report.seed_rows_changed =
        count_seed_row_changes(&old_sell_seed_rows, &new_sell_seed_rows)
            + count_seed_row_changes(&old_buy_seed_rows, &new_buy_seed_rows);
    report.total_orders_changed = report.created_buy_orders
        + report.created_sell_orders
        + report.removed_buy_orders
        + report.removed_sell_orders
        + new_orders
            .iter()
            .filter(|(order_id, new_order)| {
                old_orders.get(order_id).is_some_and(|old_order| {
                    (old_order.price - new_order.price).abs() > 0.0001
                        || old_order.volume_remain != new_order.volume_remain
                })
            })
            .count() as u64;

    transaction.execute(
        "DELETE FROM tq_mirror_orders WHERE region_id = ?1",
        params![region_id],
    )?;
    {
        let mut statement = transaction.prepare(
            "INSERT INTO tq_mirror_orders (
               order_id, region_id, station_id, solar_system_id, constellation_id, type_id,
               is_buy_order, price, volume_remain, volume_total, min_volume, range_value,
               issued_at, duration_days, seen_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;
        for order in &orders {
            statement.execute(params![
                order.order_id,
                order.region_id,
                order.station_id,
                order.solar_system_id,
                order.constellation_id,
                order.type_id,
                if order.is_buy_order { 1 } else { 0 },
                order.price,
                order.volume_remain,
                order.volume_total,
                order.min_volume,
                order.range_value,
                order.issued_at,
                order.duration_days,
                applied_at,
            ])?;
        }
    }

    transaction.execute("DELETE FROM seed_stock WHERE region_id = ?1", params![region_id])?;
    transaction.execute(
        "DELETE FROM seed_buy_orders WHERE region_id = ?1",
        params![region_id],
    )?;
    insert_tq_seed_aggregates(&transaction, "seed_stock", "sell", &sell_liquidity, &applied_at)?;
    insert_tq_seed_aggregates(
        &transaction,
        "seed_buy_orders",
        "buy",
        &buy_liquidity,
        &applied_at,
    )?;

    transaction.execute(
        "DELETE FROM region_summaries WHERE region_id = ?1",
        params![region_id],
    )?;
    rebuild_single_region_summary(&transaction, region_id)?;
    transaction.execute(
        "DELETE FROM system_seed_summaries
         WHERE solar_system_id IN (
           SELECT solar_system_id FROM solar_systems WHERE region_id = ?1
         )",
        params![region_id],
    )?;
    transaction.execute(
        "INSERT OR REPLACE INTO tq_live_state (key, value) VALUES (?1, ?2)",
        params![format!("region:{region_id}:last_applied_at"), applied_at],
    )?;
    transaction.commit()?;

    Ok(report)
}

fn bootstrap_tq_seed_usage(
    transaction: &rusqlite::Transaction<'_>,
    updated_at: &str,
) -> Result<()> {
    transaction.execute(
        "INSERT OR IGNORE INTO tq_seed_local_usage (
           side, station_id, type_id, consumed_quantity, updated_at
         )
         SELECT 'sell', station_id, type_id, initial_quantity - quantity, ?1
         FROM seed_stock
         WHERE initial_quantity > quantity",
        params![updated_at],
    )?;
    transaction.execute(
        "INSERT OR IGNORE INTO tq_seed_local_usage (
           side, station_id, type_id, consumed_quantity, updated_at
         )
         SELECT 'buy', station_id, type_id, initial_quantity - quantity, ?1
         FROM seed_buy_orders
         WHERE initial_quantity > quantity",
        params![updated_at],
    )?;
    Ok(())
}

fn load_tq_mirror_orders_for_region(
    connection: &Connection,
    region_id: u32,
) -> Result<HashMap<i64, MirrorOrderSnapshot>> {
    let mut statement = connection.prepare(
        "SELECT order_id, is_buy_order, station_id, solar_system_id, type_id, price, volume_remain
         FROM tq_mirror_orders
         WHERE region_id = ?1",
    )?;
    let rows = statement.query_map(params![region_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            MirrorOrderSnapshot {
                is_buy_order: row.get::<_, i64>(1)? == 1,
                station_id: row.get(2)?,
                solar_system_id: row.get(3)?,
                type_id: row.get(4)?,
                price: row.get(5)?,
                volume_remain: row.get(6)?,
            },
        ))
    })?;

    let mut result = HashMap::new();
    for row in rows {
        let (order_id, order) = row?;
        result.insert(order_id, order);
    }
    Ok(result)
}

fn load_seed_rows_for_region(
    connection: &Connection,
    table_name: &str,
    region_id: u32,
) -> Result<HashMap<(u64, u32), SeedRowSnapshot>> {
    let sql = format!(
        "SELECT station_id, type_id, price, quantity, initial_quantity
         FROM {table_name}
         WHERE region_id = ?1"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params![region_id], |row| {
        Ok((
            (row.get::<_, u64>(0)?, row.get::<_, u32>(1)?),
            SeedRowSnapshot {
                price: row.get(2)?,
                quantity: row.get(3)?,
                initial_quantity: row.get(4)?,
            },
        ))
    })?;

    let mut result = HashMap::new();
    for row in rows {
        let (key, value) = row?;
        result.insert(key, value);
    }
    Ok(result)
}

fn build_effective_seed_row_snapshot(
    connection: &Connection,
    side: &str,
    liquidity: &BTreeMap<(u64, u32), TqSeedAggregate>,
) -> Result<HashMap<(u64, u32), SeedRowSnapshot>> {
    let mut result = HashMap::new();
    for (key, row) in liquidity {
        let consumed_quantity = get_tq_seed_consumed_quantity(connection, side, key.0, key.1)?;
        let quantity = row.quantity.saturating_sub(consumed_quantity);
        result.insert(
            *key,
            SeedRowSnapshot {
                price: row.price(),
                quantity,
                initial_quantity: row.quantity,
            },
        );
    }
    Ok(result)
}

fn count_seed_row_changes(
    old_rows: &HashMap<(u64, u32), SeedRowSnapshot>,
    new_rows: &HashMap<(u64, u32), SeedRowSnapshot>,
) -> u64 {
    let mut changed = 0u64;
    for (key, new_row) in new_rows {
        match old_rows.get(key) {
            Some(old_row) if old_row == new_row => {}
            _ => changed += 1,
        }
    }
    for key in old_rows.keys() {
        if !new_rows.contains_key(key) {
            changed += 1;
        }
    }
    changed
}

fn insert_tq_seed_aggregates(
    transaction: &rusqlite::Transaction<'_>,
    table_name: &str,
    side: &str,
    liquidity: &BTreeMap<(u64, u32), TqSeedAggregate>,
    updated_at: &str,
) -> Result<()> {
    let sql = format!(
        "INSERT INTO {table_name} (
           station_id, solar_system_id, constellation_id, region_id,
           type_id, price, quantity, initial_quantity, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
    );
    let mut statement = transaction.prepare(&sql)?;
    for row in liquidity.values() {
        let consumed_quantity =
            get_tq_seed_consumed_quantity(transaction, side, row.station_id, row.type_id)?;
        let effective_quantity = row.quantity.saturating_sub(consumed_quantity);
        statement.execute(params![
            row.station_id,
            row.solar_system_id,
            row.constellation_id,
            row.region_id,
            row.type_id,
            row.price(),
            i64::try_from(effective_quantity).unwrap_or(i64::MAX),
            i64::try_from(row.quantity).unwrap_or(i64::MAX),
            updated_at,
        ])?;
    }
    Ok(())
}

fn get_tq_seed_consumed_quantity(
    connection: &Connection,
    side: &str,
    station_id: u64,
    type_id: u32,
) -> Result<u64> {
    Ok(connection
        .query_row(
            "SELECT consumed_quantity
             FROM tq_seed_local_usage
             WHERE side = ?1 AND station_id = ?2 AND type_id = ?3",
            params![side, station_id, type_id],
            |row| row.get::<_, u64>(0),
        )
        .optional()?
        .unwrap_or(0))
}

fn price_to_cents(price: f64) -> i64 {
    if !price.is_finite() || price <= 0.0 {
        return 0;
    }
    (price * 100.0).round().clamp(0.0, i64::MAX as f64) as i64
}

fn rebuild_region_summary_cache(
    database_path: &Path,
    region_id: Option<u32>,
) -> Result<CacheRebuildResponse> {
    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    let rebuilt_rows = match region_id {
        Some(region_id) => rebuild_single_region_summary(&transaction, region_id)?,
        None => {
            let region_ids = {
                let mut statement = transaction.prepare(
                    "SELECT DISTINCT region_id
                     FROM stations
                     ORDER BY region_id ASC",
                )?;
                let rows = statement.query_map([], |row| row.get::<_, u32>(0))?;
                let mut ids = Vec::new();
                for row in rows {
                    ids.push(row?);
                }
                ids
            };

            let mut total = 0usize;
            for region_id in region_ids {
                total += rebuild_single_region_summary(&transaction, region_id)?;
            }
            total
        }
    };
    transaction.commit()?;

    Ok(CacheRebuildResponse {
        region_id,
        rebuilt_rows,
        rebuilt_at: now_rfc3339(),
    })
}

fn rebuild_single_region_summary(connection: &Connection, region_id: u32) -> Result<usize> {
    connection.execute(
        "DELETE FROM region_summaries WHERE region_id = ?1",
        params![region_id],
    )?;

    let rows = compute_summary_rows_for_region(connection, region_id)?;
    let rebuilt_rows = rows.len();
    for row in rows {
        insert_region_summary_row(connection, region_id, &row)?;
    }

    Ok(rebuilt_rows)
}

fn refresh_single_region_summary_row(
    database_path: &Path,
    region_id: u32,
    type_id: u32,
) -> Result<()> {
    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "DELETE FROM region_summaries WHERE region_id = ?1 AND type_id = ?2",
        params![region_id, type_id],
    )?;

    if let Some(row) = compute_single_summary_row_for_region(&transaction, region_id, type_id)? {
        insert_region_summary_row(&transaction, region_id, &row)?;
    }

    transaction.commit()?;
    Ok(())
}

fn refresh_single_system_seed_summary_row(
    database_path: &Path,
    solar_system_id: u32,
    type_id: u32,
) -> Result<()> {
    let mut connection = load_connection(database_path)?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "DELETE FROM system_seed_summaries WHERE solar_system_id = ?1 AND type_id = ?2",
        params![solar_system_id, type_id],
    )?;

    if let Some(row) =
        compute_single_system_seed_summary_row(&transaction, solar_system_id, type_id)?
    {
        insert_system_seed_summary_row(&transaction, solar_system_id, &row)?;
    }

    transaction.commit()?;
    Ok(())
}

fn compute_summary_rows_for_region(
    connection: &Connection,
    region_id: u32,
) -> Result<Vec<SummaryRow>> {
    query_summary_rows_for_scope(connection, "region_id", i64::from(region_id))
}

fn compute_single_system_seed_summary_row(
    connection: &Connection,
    solar_system_id: u32,
    type_id: u32,
) -> Result<Option<SummaryRow>> {
    let sells = connection
        .query_row(
            "WITH sell_totals AS (
               SELECT type_id, MIN(price) AS best_ask_price, SUM(quantity) AS total_ask_quantity
               FROM seed_stock
               WHERE solar_system_id = ?1 AND type_id = ?2 AND quantity > 0
               GROUP BY type_id
             )
             SELECT sell_totals.type_id,
                    sell_totals.best_ask_price,
                    sell_totals.total_ask_quantity,
                    MIN(seed_stock.station_id) AS best_ask_station_id
             FROM sell_totals
             JOIN seed_stock
               ON seed_stock.solar_system_id = ?1
              AND seed_stock.type_id = sell_totals.type_id
              AND seed_stock.price = sell_totals.best_ask_price
              AND seed_stock.quantity > 0
             GROUP BY sell_totals.type_id, sell_totals.best_ask_price, sell_totals.total_ask_quantity",
            params![solar_system_id, type_id],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, Option<f64>>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, Option<u64>>(3)?,
                ))
            },
        )
        .optional()?;

    let buys = connection
        .query_row(
            "WITH buy_totals AS (
               SELECT type_id, MAX(price) AS best_bid_price, SUM(quantity) AS total_bid_quantity
               FROM seed_buy_orders
               WHERE solar_system_id = ?1 AND type_id = ?2 AND quantity > 0
               GROUP BY type_id
             )
             SELECT buy_totals.type_id,
                    buy_totals.best_bid_price,
                    buy_totals.total_bid_quantity,
                    MIN(seed_buy_orders.station_id) AS best_bid_station_id
             FROM buy_totals
             JOIN seed_buy_orders
               ON seed_buy_orders.solar_system_id = ?1
              AND seed_buy_orders.type_id = buy_totals.type_id
              AND seed_buy_orders.price = buy_totals.best_bid_price
              AND seed_buy_orders.quantity > 0
             GROUP BY buy_totals.type_id, buy_totals.best_bid_price, buy_totals.total_bid_quantity",
            params![solar_system_id, type_id],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, Option<f64>>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, Option<u64>>(3)?,
                ))
            },
        )
        .optional()?;

    match (sells, buys) {
        (None, None) => Ok(None),
        (Some((sell_type_id, best_ask_price, total_ask_quantity, best_ask_station_id)), None) => {
            Ok(Some(SummaryRow {
                type_id: sell_type_id,
                best_ask_price,
                total_ask_quantity,
                best_ask_station_id,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            }))
        }
        (None, Some((buy_type_id, best_bid_price, total_bid_quantity, best_bid_station_id))) => {
            Ok(Some(SummaryRow {
                type_id: buy_type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price,
                total_bid_quantity,
                best_bid_station_id,
            }))
        }
        (
            Some((sell_type_id, best_ask_price, total_ask_quantity, best_ask_station_id)),
            Some((_, best_bid_price, total_bid_quantity, best_bid_station_id)),
        ) => Ok(Some(SummaryRow {
            type_id: sell_type_id,
            best_ask_price,
            total_ask_quantity,
            best_ask_station_id,
            best_bid_price,
            total_bid_quantity,
            best_bid_station_id,
        })),
    }
}

fn compute_single_summary_row_for_region(
    connection: &Connection,
    region_id: u32,
    type_id: u32,
) -> Result<Option<SummaryRow>> {
    let sells = connection
        .query_row(
            "WITH sells AS (
               SELECT type_id, price, quantity AS quantity_value, station_id
               FROM seed_stock
               WHERE region_id = ?1 AND type_id = ?2 AND quantity > 0
               UNION ALL
               SELECT type_id, price, vol_remaining AS quantity_value, station_id
               FROM market_orders
               WHERE region_id = ?1 AND type_id = ?2 AND state = 'open' AND bid = 0 AND vol_remaining > 0
             ),
             sell_totals AS (
               SELECT type_id, MIN(price) AS best_ask_price, SUM(quantity_value) AS total_ask_quantity
               FROM sells
               GROUP BY type_id
             )
             SELECT sell_totals.type_id,
                    sell_totals.best_ask_price,
                    sell_totals.total_ask_quantity,
                    MIN(sells.station_id) AS best_ask_station_id
             FROM sell_totals
             JOIN sells
               ON sells.type_id = sell_totals.type_id
              AND sells.price = sell_totals.best_ask_price
             GROUP BY sell_totals.type_id, sell_totals.best_ask_price, sell_totals.total_ask_quantity",
            params![region_id, type_id],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, Option<f64>>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, Option<u64>>(3)?,
                ))
            },
        )
        .optional()?;

    let buys = connection
        .query_row(
            "WITH buys AS (
               SELECT type_id, price, quantity AS quantity_value, station_id
               FROM seed_buy_orders
               WHERE region_id = ?1 AND type_id = ?2 AND quantity > 0
               UNION ALL
               SELECT type_id, price, vol_remaining AS quantity_value, station_id
               FROM market_orders
               WHERE region_id = ?1 AND type_id = ?2 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
             ),
             buy_totals AS (
               SELECT type_id, MAX(price) AS best_bid_price, SUM(quantity_value) AS total_bid_quantity
               FROM buys
               GROUP BY type_id
             )
             SELECT buy_totals.type_id,
                    buy_totals.best_bid_price,
                    buy_totals.total_bid_quantity,
                    MIN(buys.station_id) AS best_bid_station_id
             FROM buy_totals
             JOIN buys
               ON buys.type_id = buy_totals.type_id
              AND buys.price = buy_totals.best_bid_price
             GROUP BY buy_totals.type_id, buy_totals.best_bid_price, buy_totals.total_bid_quantity",
            params![region_id, type_id],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, Option<f64>>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, Option<u64>>(3)?,
                ))
            },
        )
        .optional()?;

    match (sells, buys) {
        (None, None) => Ok(None),
        (Some((sell_type_id, best_ask_price, total_ask_quantity, best_ask_station_id)), None) => {
            Ok(Some(SummaryRow {
                type_id: sell_type_id,
                best_ask_price,
                total_ask_quantity,
                best_ask_station_id,
                best_bid_price: None,
                total_bid_quantity: 0,
                best_bid_station_id: None,
            }))
        }
        (None, Some((buy_type_id, best_bid_price, total_bid_quantity, best_bid_station_id))) => {
            Ok(Some(SummaryRow {
                type_id: buy_type_id,
                best_ask_price: None,
                total_ask_quantity: 0,
                best_ask_station_id: None,
                best_bid_price,
                total_bid_quantity,
                best_bid_station_id,
            }))
        }
        (
            Some((sell_type_id, best_ask_price, total_ask_quantity, best_ask_station_id)),
            Some((_, best_bid_price, total_bid_quantity, best_bid_station_id)),
        ) => Ok(Some(SummaryRow {
            type_id: sell_type_id,
            best_ask_price,
            total_ask_quantity,
            best_ask_station_id,
            best_bid_price,
            total_bid_quantity,
            best_bid_station_id,
        })),
    }
}

fn insert_region_summary_row(
    connection: &Connection,
    region_id: u32,
    row: &SummaryRow,
) -> Result<()> {
    connection.execute(
        "INSERT INTO region_summaries (
           region_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
           best_bid_price, total_bid_quantity, best_bid_station_id, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            region_id,
            row.type_id,
            row.best_ask_price,
            row.total_ask_quantity,
            row.best_ask_station_id,
            row.best_bid_price,
            row.total_bid_quantity,
            row.best_bid_station_id,
            now_rfc3339(),
        ],
    )?;
    Ok(())
}

fn insert_system_seed_summary_row(
    connection: &Connection,
    solar_system_id: u32,
    row: &SummaryRow,
) -> Result<()> {
    connection.execute(
        "INSERT INTO system_seed_summaries (
           solar_system_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
           best_bid_price, total_bid_quantity, best_bid_station_id, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            solar_system_id,
            row.type_id,
            row.best_ask_price,
            row.total_ask_quantity,
            row.best_ask_station_id,
            row.best_bid_price,
            row.total_bid_quantity,
            row.best_bid_station_id,
            now_rfc3339(),
        ],
    )?;
    Ok(())
}

fn current_trade_day() -> String {
    OffsetDateTime::now_utc().date().to_string()
}
