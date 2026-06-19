mod config;
mod rpc;
mod state;
mod tq_live;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration as StdDuration, Instant};
use std::{io, io::Write};

use anyhow::{Context, Result};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use clap::{Args, Parser, Subcommand};
use config::MarketServerConfig;
use market_common::{
    AdjustSeedStockRequest, CacheRebuildResponse, DEFAULT_MARKET_SERVER_CONFIG_PATH,
    DiagnosticsResponse, FillOrderRequest, FillOrderResponse, HistoryResponse, MarketManifest,
    ModifyOrderRequest, ModifyOrderResponse, OrderBookResponse, OwnerOrderRow, PlaceOrderRequest,
    PlaceOrderResponse, RecordTradeRequest, RecordTradeResponse, SummaryRow,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use state::{MarketRuntime, StartupOverview, StartupProgressSink, StartupProgressUpdate};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(author, version, about = "Standalone EvEJS market daemon")]
struct Cli {
    #[arg(long, default_value = DEFAULT_MARKET_SERVER_CONFIG_PATH)]
    config: PathBuf,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    Serve,
    Doctor,
    Bench(BenchArgs),
}

#[derive(Debug, Args)]
struct BenchArgs {
    #[arg(long, default_value_t = 10000002)]
    region_id: u32,
    #[arg(long, default_value_t = 30000142)]
    solar_system_id: u32,
    #[arg(long, default_value_t = 60003760)]
    station_id: u64,
    #[arg(long, default_value_t = 34)]
    type_id: u32,
    #[arg(long, default_value_t = 25)]
    iterations: usize,
    #[arg(long, default_value_t = 10)]
    distinct_order_books: usize,
}

#[derive(Debug, Serialize)]
struct BenchReport {
    startup_ms: f64,
    region_id: u32,
    solar_system_id: u32,
    station_id: u64,
    sample_type_ids: Vec<u32>,
    region_summary: BenchStats,
    system_summary_cold_ms: f64,
    system_summary_warm: BenchStats,
    station_summary_cold_ms: f64,
    station_summary_warm: BenchStats,
    order_book_cold_distinct: BenchStats,
    order_book_hot: BenchStats,
    history_hot: BenchStats,
}

#[derive(Debug, Serialize)]
struct BenchStats {
    samples: usize,
    min_ms: f64,
    p50_ms: f64,
    p95_ms: f64,
    max_ms: f64,
    avg_ms: f64,
}

#[derive(Debug, Deserialize)]
struct OwnerOrderQuery {
    is_corp: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct RebuildQuery {
    region_id: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ModifyOrderBody {
    new_price: f64,
}

#[derive(Debug, Deserialize)]
struct FillOrderBody {
    fill_quantity: u64,
}

#[derive(Debug, Serialize)]
struct ApiEnvelope<T> {
    ok: bool,
    data: T,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
              "ok": false,
              "error": self.message,
            })),
        )
            .into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let config = MarketServerConfig::load(&cli.config)?;
    init_logging(&config)?;

    match cli.command.unwrap_or(Command::Serve) {
        Command::Serve => serve(config).await,
        Command::Doctor => doctor(config).await,
        Command::Bench(args) => bench(config, args).await,
    }
}

async fn serve(config: MarketServerConfig) -> Result<()> {
    let progress = ConsoleStartupProgress::new();
    let (runtime, startup_overview) =
        MarketRuntime::load_with_progress(config.clone(), Some(progress.sink())).await?;
    progress.finish()?;
    let http_address: SocketAddr = format!("{}:{}", config.network.host, config.network.port)
        .parse()
        .with_context(|| {
            format!(
                "failed to parse listen address {}:{}",
                config.network.host, config.network.port
            )
        })?;

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/manifest", get(manifest))
        .route("/v1/diagnostics", get(diagnostics))
        .route("/v1/summaries/region/{region_id}", get(region_summary))
        .route(
            "/v1/summaries/system/{solar_system_id}",
            get(system_summary),
        )
        .route("/v1/summaries/station/{station_id}", get(station_summary))
        .route("/v1/orders/{region_id}/{type_id}", get(order_book))
        .route("/v1/history/{type_id}", get(history))
        .route("/v1/owners/{owner_id}/orders", get(owner_orders))
        .route("/v1/orders", post(place_order))
        .route("/v1/orders/{order_id}", get(get_order))
        .route("/v1/orders/{order_id}/modify", post(modify_order))
        .route("/v1/orders/{order_id}/fill", post(fill_order))
        .route("/v1/orders/{order_id}/cancel", post(cancel_order))
        .route("/v1/history/trade", post(record_trade))
        .route("/v1/admin/seed-stock/adjust", post(adjust_seed_stock))
        .route("/v1/admin/cache/rebuild", post(rebuild_cache))
        .with_state(runtime.clone());

    print_startup_banner(&runtime, &startup_overview);
    tq_live::spawn_console_controller(runtime.clone());
    info!("market HTTP listening on http://{}", http_address);
    let http_listener = tokio::net::TcpListener::bind(http_address).await?;

    let http_server = async move {
        axum::serve(http_listener, app)
            .await
            .context("market HTTP server exited unexpectedly")
    };

    if config.rpc.enabled {
        let rpc_config = config.rpc.clone();
        tokio::try_join!(http_server, rpc::serve(runtime, rpc_config))?;
        Ok(())
    } else {
        http_server.await
    }
}

async fn doctor(config: MarketServerConfig) -> Result<()> {
    let progress = ConsoleStartupProgress::new();
    let (runtime, _) = MarketRuntime::load_with_progress(config, Some(progress.sink())).await?;
    progress.finish()?;
    let diagnostics = runtime.diagnostics().await?;
    println!("{}", serde_json::to_string_pretty(&diagnostics)?);
    Ok(())
}

async fn bench(config: MarketServerConfig, args: BenchArgs) -> Result<()> {
    let progress = ConsoleStartupProgress::new();
    let started = Instant::now();
    let (runtime, _) = MarketRuntime::load_with_progress(config, Some(progress.sink())).await?;
    progress.finish()?;
    let startup_ms = started.elapsed().as_secs_f64() * 1000.0;

    let region_summary = benchmark_async(args.iterations, || {
        let runtime = runtime.clone();
        async move {
            let _ = runtime.get_region_summary(args.region_id).await?;
            Ok::<(), anyhow::Error>(())
        }
    })
    .await?;

    let system_summary_cold_ms = measure_once_async(|| {
        let runtime = runtime.clone();
        async move {
            let _ = runtime.get_system_summary(args.solar_system_id).await?;
            Ok::<(), anyhow::Error>(())
        }
    })
    .await?;

    let system_summary_warm = benchmark_async(args.iterations, || {
        let runtime = runtime.clone();
        async move {
            let _ = runtime.get_system_summary(args.solar_system_id).await?;
            Ok::<(), anyhow::Error>(())
        }
    })
    .await?;

    let station_summary_cold_ms = measure_once_async(|| {
        let runtime = runtime.clone();
        async move {
            let _ = runtime.get_station_summary(args.station_id).await?;
            Ok::<(), anyhow::Error>(())
        }
    })
    .await?;

    let station_summary_warm = benchmark_async(args.iterations, || {
        let runtime = runtime.clone();
        async move {
            let _ = runtime.get_station_summary(args.station_id).await?;
            Ok::<(), anyhow::Error>(())
        }
    })
    .await?;

    let summary_rows = runtime.get_region_summary(args.region_id).await?;
    let sample_type_ids =
        select_sample_type_ids(&summary_rows, args.type_id, args.distinct_order_books);

    let order_book_cold_distinct = benchmark_async(sample_type_ids.len(), {
        let runtime = runtime.clone();
        let sample_type_ids = sample_type_ids.clone();
        let index = Arc::new(Mutex::new(0usize));
        move || {
            let runtime = runtime.clone();
            let sample_type_ids = sample_type_ids.clone();
            let index = Arc::clone(&index);
            async move {
                let mut guard = index
                    .lock()
                    .map_err(|_| anyhow::anyhow!("benchmark index poisoned"))?;
                let type_id = sample_type_ids[*guard];
                *guard += 1;
                drop(guard);
                let _ = runtime.get_order_book(args.region_id, type_id).await?;
                Ok::<(), anyhow::Error>(())
            }
        }
    })
    .await?;

    let order_book_hot = benchmark_async(args.iterations, || {
        let runtime = runtime.clone();
        async move {
            let _ = runtime.get_order_book(args.region_id, args.type_id).await?;
            Ok::<(), anyhow::Error>(())
        }
    })
    .await?;

    let history_hot = benchmark_async(args.iterations, || {
        let runtime = runtime.clone();
        async move {
            let _ = runtime.get_history(args.type_id).await?;
            Ok::<(), anyhow::Error>(())
        }
    })
    .await?;

    let report = BenchReport {
        startup_ms,
        region_id: args.region_id,
        solar_system_id: args.solar_system_id,
        station_id: args.station_id,
        sample_type_ids,
        region_summary,
        system_summary_cold_ms,
        system_summary_warm,
        station_summary_cold_ms,
        station_summary_warm,
        order_book_cold_distinct,
        order_book_hot,
        history_hot,
    };

    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

async fn measure_once_async<F, Fut>(factory: F) -> Result<f64>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    let started = Instant::now();
    factory().await?;
    Ok(started.elapsed().as_secs_f64() * 1000.0)
}

async fn benchmark_async<F, Fut>(iterations: usize, mut factory: F) -> Result<BenchStats>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    let samples = iterations.max(1);
    let mut timings = Vec::with_capacity(samples);
    for _ in 0..samples {
        timings.push(measure_once_async(|| factory()).await?);
    }
    Ok(build_bench_stats(timings))
}

fn build_bench_stats(mut timings: Vec<f64>) -> BenchStats {
    timings.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let samples = timings.len();
    let sum = timings.iter().copied().sum::<f64>();
    BenchStats {
        samples,
        min_ms: *timings.first().unwrap_or(&0.0),
        p50_ms: percentile(&timings, 0.50),
        p95_ms: percentile(&timings, 0.95),
        max_ms: *timings.last().unwrap_or(&0.0),
        avg_ms: if samples == 0 {
            0.0
        } else {
            sum / samples as f64
        },
    }
}

fn percentile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let index = ((values.len() - 1) as f64 * percentile).round() as usize;
    values[index.min(values.len() - 1)]
}

fn select_sample_type_ids(
    rows: &[SummaryRow],
    preferred_type_id: u32,
    desired_count: usize,
) -> Vec<u32> {
    let desired_count = desired_count.max(1);
    let mut type_ids = Vec::with_capacity(desired_count);
    type_ids.push(preferred_type_id);
    for row in rows {
        if row.best_ask_price.is_none() {
            continue;
        }
        if !type_ids.contains(&row.type_id) {
            type_ids.push(row.type_id);
        }
        if type_ids.len() >= desired_count {
            break;
        }
    }
    type_ids
}

async fn health(
    State(runtime): State<MarketRuntime>,
) -> Result<Json<ApiEnvelope<serde_json::Value>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: json!({
          "status": "ok",
          "started_at": runtime.started_at,
          "schema_version": runtime.manifest.schema_version,
          "database_path": runtime.database_path.to_string_lossy(),
        }),
    }))
}

async fn manifest(
    State(runtime): State<MarketRuntime>,
) -> Result<Json<ApiEnvelope<MarketManifest>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: (*runtime.manifest).clone(),
    }))
}

async fn diagnostics(
    State(runtime): State<MarketRuntime>,
) -> Result<Json<ApiEnvelope<DiagnosticsResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.diagnostics().await?,
    }))
}

async fn region_summary(
    State(runtime): State<MarketRuntime>,
    Path(region_id): Path<u32>,
) -> Result<Json<ApiEnvelope<Vec<SummaryRow>>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.get_region_summary(region_id).await?,
    }))
}

async fn system_summary(
    State(runtime): State<MarketRuntime>,
    Path(solar_system_id): Path<u32>,
) -> Result<Json<ApiEnvelope<Vec<SummaryRow>>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.get_system_summary(solar_system_id).await?,
    }))
}

async fn station_summary(
    State(runtime): State<MarketRuntime>,
    Path(station_id): Path<u64>,
) -> Result<Json<ApiEnvelope<Vec<SummaryRow>>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.get_station_summary(station_id).await?,
    }))
}

async fn order_book(
    State(runtime): State<MarketRuntime>,
    Path((region_id, type_id)): Path<(u32, u32)>,
) -> Result<Json<ApiEnvelope<OrderBookResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.get_order_book(region_id, type_id).await?,
    }))
}

async fn history(
    State(runtime): State<MarketRuntime>,
    Path(type_id): Path<u32>,
) -> Result<Json<ApiEnvelope<HistoryResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.get_history(type_id).await?,
    }))
}

async fn owner_orders(
    State(runtime): State<MarketRuntime>,
    Path(owner_id): Path<u64>,
    Query(query): Query<OwnerOrderQuery>,
) -> Result<Json<ApiEnvelope<Vec<OwnerOrderRow>>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime
            .get_owner_orders(owner_id, query.is_corp.unwrap_or(false))
            .await?,
    }))
}

async fn place_order(
    State(runtime): State<MarketRuntime>,
    Json(request): Json<PlaceOrderRequest>,
) -> Result<Json<ApiEnvelope<PlaceOrderResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.place_order(request).await?,
    }))
}

async fn get_order(
    State(runtime): State<MarketRuntime>,
    Path(order_id): Path<i64>,
) -> Result<Json<ApiEnvelope<OwnerOrderRow>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.get_order(order_id).await?,
    }))
}

async fn modify_order(
    State(runtime): State<MarketRuntime>,
    Path(order_id): Path<i64>,
    Json(body): Json<ModifyOrderBody>,
) -> Result<Json<ApiEnvelope<ModifyOrderResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime
            .modify_order(ModifyOrderRequest {
                order_id,
                new_price: body.new_price,
            })
            .await?,
    }))
}

async fn cancel_order(
    State(runtime): State<MarketRuntime>,
    Path(order_id): Path<i64>,
) -> Result<Json<ApiEnvelope<market_common::CancelOrderResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.cancel_order(order_id).await?,
    }))
}

async fn fill_order(
    State(runtime): State<MarketRuntime>,
    Path(order_id): Path<i64>,
    Json(body): Json<FillOrderBody>,
) -> Result<Json<ApiEnvelope<FillOrderResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime
            .fill_order(FillOrderRequest {
                order_id,
                fill_quantity: body.fill_quantity,
            })
            .await?,
    }))
}

async fn record_trade(
    State(runtime): State<MarketRuntime>,
    Json(request): Json<RecordTradeRequest>,
) -> Result<Json<ApiEnvelope<RecordTradeResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.record_trade(request).await?,
    }))
}

async fn adjust_seed_stock(
    State(runtime): State<MarketRuntime>,
    Json(request): Json<AdjustSeedStockRequest>,
) -> Result<Json<ApiEnvelope<market_common::AdjustSeedStockResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.adjust_seed_stock(request).await?,
    }))
}

async fn rebuild_cache(
    State(runtime): State<MarketRuntime>,
    Query(query): Query<RebuildQuery>,
) -> Result<Json<ApiEnvelope<CacheRebuildResponse>>, ApiError> {
    Ok(Json(ApiEnvelope {
        ok: true,
        data: runtime.rebuild_region_summaries(query.region_id).await?,
    }))
}

fn init_logging(config: &MarketServerConfig) -> Result<()> {
    let filter = EnvFilter::try_new(config.logging.log_level.clone())
        .or_else(|_| EnvFilter::try_new("info"))
        .context("failed to build tracing filter")?;

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
    Ok(())
}

#[derive(Clone)]
struct ConsoleStartupProgress {
    state: Arc<Mutex<ConsoleStartupProgressState>>,
}

struct ConsoleStartupProgressState {
    visible: bool,
    last_render_len: usize,
    last_rendered_at: Option<Instant>,
    last_line: Option<String>,
}

impl ConsoleStartupProgress {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ConsoleStartupProgressState {
                visible: false,
                last_render_len: 0,
                last_rendered_at: None,
                last_line: None,
            })),
        }
    }

    fn sink(&self) -> StartupProgressSink {
        let state = self.state.clone();
        Arc::new(move |update| {
            let _ = render_startup_progress(&state, &update);
        })
    }

    fn finish(&self) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("failed to lock startup progress renderer"))?;
        if state.visible {
            let mut stdout = io::stdout().lock();
            write!(
                stdout,
                "\r{clear}\r",
                clear = " ".repeat(state.last_render_len.max(1))
            )?;
            stdout.flush()?;
            state.visible = false;
            state.last_render_len = 0;
            state.last_rendered_at = None;
            state.last_line = None;
        }
        Ok(())
    }
}

fn render_startup_progress(
    state: &Arc<Mutex<ConsoleStartupProgressState>>,
    update: &StartupProgressUpdate,
) -> io::Result<()> {
    let mut state = match state.lock() {
        Ok(guard) => guard,
        Err(_) => return Ok(()),
    };

    let now = Instant::now();
    let elapsed = format_duration(update.elapsed);
    let eta = update
        .eta
        .map(format_duration)
        .unwrap_or_else(|| "--:--".to_string());
    let line = format!(
        "  [market] {:>5.1}% {:<9} {} | t {} | eta {}",
        update.percent_complete * 100.0,
        update.phase_label,
        update.detail,
        elapsed,
        eta
    );

    if let Some(last_rendered_at) = state.last_rendered_at {
        let should_throttle = now.duration_since(last_rendered_at) < StdDuration::from_millis(120);
        let line_changed = state.last_line.as_deref() != Some(line.as_str());
        if should_throttle && update.percent_complete < 1.0 && !line_changed {
            return Ok(());
        }
    }

    let padding = state
        .last_render_len
        .saturating_sub(line.chars().count())
        .max(0);
    let mut stdout = io::stdout().lock();
    write!(stdout, "\r{}{}", line, " ".repeat(padding))?;
    stdout.flush()?;

    state.visible = true;
    state.last_render_len = line.chars().count();
    state.last_rendered_at = Some(now);
    state.last_line = Some(line);
    Ok(())
}

fn format_duration(duration: StdDuration) -> String {
    let total_seconds = duration.as_secs();
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;

    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

fn print_startup_banner(runtime: &MarketRuntime, startup_overview: &StartupOverview) {
    let build_profile = if cfg!(debug_assertions) {
        "DEBUG"
    } else {
        "RELEASE"
    };
    let rpc_endpoint = if runtime.config.rpc.enabled {
        format!(
            "tcp://{}:{}",
            runtime.config.rpc.host, runtime.config.rpc.port
        )
    } else {
        "disabled".to_string()
    };

    let lines = [
        "Market Server Ready".to_string(),
        format!(
            "Build        : {} v{}",
            build_profile,
            env!("CARGO_PKG_VERSION")
        ),
        format!("Seed Preset  : {}", runtime.manifest.selection_label),
        format!(
            "Universe     : {} region | {} systems | {} stations | {} types",
            format_count(runtime.manifest.region_count),
            format_count(runtime.manifest.solar_system_count),
            format_count(runtime.manifest.station_count),
            format_count(runtime.manifest.market_type_count)
        ),
        format!(
            "Seed Stock   : {} rows | default qty {}",
            format_count(runtime.manifest.seed_row_count),
            format_count(runtime.manifest.default_quantity_per_station_type)
        ),
        format!(
            "Summaries    : {} hot rows across {} region caches",
            format_count(startup_overview.region_summary_rows),
            format_count(startup_overview.region_summary_cache_regions)
        ),
        format!(
            "Orders       : {} total | {} open | {} buys | {} sells | {} closed",
            format_count(startup_overview.total_orders),
            format_count(startup_overview.open_orders),
            format_count(startup_overview.open_buy_orders),
            format_count(startup_overview.open_sell_orders),
            format_count(startup_overview.closed_orders)
        ),
        format!(
            "History      : {} rows | {} order events",
            format_count(startup_overview.price_history_rows),
            format_count(startup_overview.order_event_rows)
        ),
        format!(
            "Caches       : station {} | system {} | order books {}",
            format_count(runtime.config.runtime.station_summary_cache_capacity),
            format_count(runtime.config.runtime.system_summary_cache_capacity),
            format_count(runtime.config.runtime.order_book_cache_capacity)
        ),
        format!(
            "HTTP / RPC   : http://{}:{} | {}",
            runtime.config.network.host, runtime.config.network.port, rpc_endpoint
        ),
        format!("Database     : {}", runtime.database_path.to_string_lossy()),
    ];

    let width = lines.iter().map(|line| line.len()).max().unwrap_or(0);
    let border = format!("+{}+", "-".repeat(width + 2));

    println!();
    println!("{border}");
    for line in lines {
        println!("| {:width$} |", line, width = width);
    }
    println!("{border}");
    println!();
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
