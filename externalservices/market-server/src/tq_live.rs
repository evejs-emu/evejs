use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration as StdDuration, Instant};

use anyhow::{Context, Result, anyhow};
use futures_util::stream::{FuturesUnordered, StreamExt};
use reqwest::Client;
use rusqlite::Connection;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{Semaphore, mpsc};
use tokio::time::{MissedTickBehavior, interval};
use tracing::{info, warn};

use crate::config::TqLiveConfig;
use crate::state::{MarketRuntime, TqLiveApplyReport, TqLiveSourceOrder};

#[derive(Debug)]
enum ConsoleCommand {
    On,
    Off,
    Now,
    Status,
    Help,
}

#[derive(Debug, Clone)]
struct StationMeta {
    solar_system_id: u32,
    constellation_id: u32,
    region_id: u32,
}

#[derive(Debug, Clone)]
struct TqLiveIndex {
    stations: Arc<HashMap<u64, StationMeta>>,
    market_type_ids: Arc<HashSet<u32>>,
    region_ids: Arc<Vec<u32>>,
}

#[derive(Debug, Deserialize)]
struct EsiMarketOrder {
    duration: u32,
    is_buy_order: bool,
    issued: String,
    location_id: u64,
    #[serde(default)]
    min_volume: u64,
    order_id: i64,
    price: f64,
    #[serde(default)]
    range: String,
    type_id: u32,
    volume_remain: u64,
    volume_total: u64,
}

#[derive(Debug)]
struct EsiPage {
    x_pages: u32,
    orders: Vec<EsiMarketOrder>,
}

#[derive(Debug, Default)]
struct RegionFetchReport {
    region_id: u32,
    pages_fetched: u64,
    source_orders: u64,
    station_orders: u64,
    structure_orders_dropped: u64,
    unknown_type_orders_dropped: u64,
    zero_quantity_orders_dropped: u64,
    invalid_price_orders_dropped: u64,
}

#[derive(Debug, Default, Clone)]
struct CycleStats {
    cycle_number: u64,
    started_at: String,
    elapsed: StdDuration,
    regions_scanned: u64,
    regions_applied: u64,
    regions_failed: u64,
    pages_fetched: u64,
    source_orders: u64,
    station_orders: u64,
    structure_orders_dropped: u64,
    unknown_type_orders_dropped: u64,
    zero_quantity_orders_dropped: u64,
    invalid_price_orders_dropped: u64,
    total_orders_changed: u64,
    created_buy_orders: u64,
    created_sell_orders: u64,
    removed_buy_orders: u64,
    removed_sell_orders: u64,
    price_changed_orders: u64,
    volume_changed_orders: u64,
    sell_volume_decreased_units: u64,
    buy_volume_decreased_units: u64,
    seed_rows_changed: u64,
    seed_sell_rows: u64,
    seed_buy_rows: u64,
}

pub fn spawn_console_controller(runtime: MarketRuntime) {
    let (tx, rx) = mpsc::channel::<ConsoleCommand>(16);
    let worker_runtime = runtime.clone();
    tokio::spawn(async move {
        if let Err(error) = controller_loop(worker_runtime, rx).await {
            warn!("TQ live market controller stopped: {}", error);
        }
    });

    tokio::spawn(async move {
        print_console_help();
        let stdin = tokio::io::stdin();
        let mut lines = BufReader::new(stdin).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if let Some(command) = parse_console_command(&line) {
                        if tx.send(command).await.is_err() {
                            break;
                        }
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    warn!("TQ live console reader failed: {}", error);
                    break;
                }
            }
        }
    });
}

async fn controller_loop(
    runtime: MarketRuntime,
    mut rx: mpsc::Receiver<ConsoleCommand>,
) -> Result<()> {
    let config = runtime.config.tq_live.clone();
    let client = build_http_client(&config)?;
    let index = load_tq_live_index(runtime.database_path.as_ref(), &config)?;
    let mut ticker = interval(StdDuration::from_secs(
        config.update_interval_seconds.max(30),
    ));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    ticker.tick().await;

    let mut enabled = false;
    let mut cycle_number = 0u64;
    let mut last_cycle: Option<CycleStats> = None;

    loop {
        tokio::select! {
            Some(command) = rx.recv() => {
                match command {
                    ConsoleCommand::On => {
                        if enabled {
                            println!("{}", color_dim("[TQ-LIVE] mirror already online"));
                            continue;
                        }
                        enabled = true;
                        println!("{}", color_green("[TQ-LIVE] mirror ONLINE - running an immediate refresh."));
                        cycle_number += 1;
                        match run_cycle(&runtime, &client, &config, &index, cycle_number).await {
                            Ok(stats) => {
                                if config.dashboard_enabled {
                                    print_cycle_dashboard(&stats, config.update_interval_seconds);
                                }
                                last_cycle = Some(stats);
                            }
                            Err(error) => warn!("TQ live immediate cycle failed: {}", error),
                        }
                    }
                    ConsoleCommand::Off => {
                        enabled = false;
                        println!("{}", color_yellow("[TQ-LIVE] mirror OFFLINE - market server remains live."));
                    }
                    ConsoleCommand::Now => {
                        println!("{}", color_cyan("[TQ-LIVE] manual refresh requested."));
                        cycle_number += 1;
                        match run_cycle(&runtime, &client, &config, &index, cycle_number).await {
                            Ok(stats) => {
                                if config.dashboard_enabled {
                                    print_cycle_dashboard(&stats, config.update_interval_seconds);
                                }
                                last_cycle = Some(stats);
                            }
                            Err(error) => warn!("TQ live manual cycle failed: {}", error),
                        }
                    }
                    ConsoleCommand::Status => {
                        print_status(enabled, config.update_interval_seconds, last_cycle.as_ref(), &index);
                    }
                    ConsoleCommand::Help => {
                        print_console_help();
                    }
                }
            }
            _ = ticker.tick() => {
                if !enabled {
                    continue;
                }
                cycle_number += 1;
                match run_cycle(&runtime, &client, &config, &index, cycle_number).await {
                    Ok(stats) => {
                        if config.dashboard_enabled {
                            print_cycle_dashboard(&stats, config.update_interval_seconds);
                        }
                        last_cycle = Some(stats);
                    }
                    Err(error) => warn!("TQ live scheduled cycle failed: {}", error),
                }
            }
        }
    }
}

async fn run_cycle(
    runtime: &MarketRuntime,
    client: &Client,
    config: &TqLiveConfig,
    index: &TqLiveIndex,
    cycle_number: u64,
) -> Result<CycleStats> {
    let started = Instant::now();
    let started_at = market_common::now_rfc3339();
    let mut stats = CycleStats {
        cycle_number,
        started_at,
        ..CycleStats::default()
    };

    for region_id in index.region_ids.iter().copied() {
        stats.regions_scanned += 1;
        match fetch_region_orders(client, config, index, region_id).await {
            Ok((orders, fetch_report)) => {
                stats.pages_fetched += fetch_report.pages_fetched;
                stats.source_orders += fetch_report.source_orders;
                stats.station_orders += fetch_report.station_orders;
                stats.structure_orders_dropped += fetch_report.structure_orders_dropped;
                stats.unknown_type_orders_dropped += fetch_report.unknown_type_orders_dropped;
                stats.zero_quantity_orders_dropped += fetch_report.zero_quantity_orders_dropped;
                stats.invalid_price_orders_dropped += fetch_report.invalid_price_orders_dropped;

                match runtime.apply_tq_live_orders(region_id, orders).await {
                    Ok(report) => {
                        stats.regions_applied += 1;
                        absorb_apply_report(&mut stats, &report);
                        if config.dashboard_enabled {
                            print_region_line(&fetch_report, &report);
                        }
                    }
                    Err(error) => {
                        stats.regions_failed += 1;
                        warn!("TQ live apply failed for region {}: {}", region_id, error);
                    }
                }
            }
            Err(error) => {
                stats.regions_failed += 1;
                warn!("TQ live fetch failed for region {}: {}", region_id, error);
            }
        }

        if config.region_pause_millis > 0 {
            tokio::time::sleep(StdDuration::from_millis(config.region_pause_millis)).await;
        }
    }

    stats.elapsed = started.elapsed();
    Ok(stats)
}

async fn fetch_region_orders(
    client: &Client,
    config: &TqLiveConfig,
    index: &TqLiveIndex,
    region_id: u32,
) -> Result<(Vec<TqLiveSourceOrder>, RegionFetchReport)> {
    let first_page = fetch_esi_page(client, config, region_id, 1).await?;
    let page_count = config
        .max_pages_per_region
        .map(|limit| first_page.x_pages.min(limit.max(1)))
        .unwrap_or(first_page.x_pages)
        .max(1);

    let mut pages = Vec::with_capacity(page_count as usize);
    pages.push(first_page);

    if page_count > 1 {
        let semaphore = Arc::new(Semaphore::new(config.request_concurrency.max(1)));
        let mut futures = FuturesUnordered::new();
        for page in 2..=page_count {
            let permit = semaphore.clone().acquire_owned().await?;
            let client = client.clone();
            let config = config.clone();
            futures.push(tokio::spawn(async move {
                let _permit = permit;
                fetch_esi_page(&client, &config, region_id, page).await
            }));
        }

        while let Some(result) = futures.next().await {
            pages.push(result.context("TQ live page task join failed")??);
        }
    }

    let mut report = RegionFetchReport {
        region_id,
        pages_fetched: pages.len() as u64,
        ..RegionFetchReport::default()
    };
    let mut orders = Vec::new();

    for page in pages {
        for order in page.orders {
            report.source_orders += 1;
            if order.volume_remain == 0 {
                report.zero_quantity_orders_dropped += 1;
                continue;
            }
            if !order.price.is_finite() || order.price <= 0.0 {
                report.invalid_price_orders_dropped += 1;
                continue;
            }
            if !index.market_type_ids.contains(&order.type_id) {
                report.unknown_type_orders_dropped += 1;
                continue;
            }
            let Some(station) = index.stations.get(&order.location_id) else {
                report.structure_orders_dropped += 1;
                continue;
            };
            if station.region_id != region_id {
                report.structure_orders_dropped += 1;
                continue;
            }

            orders.push(TqLiveSourceOrder {
                order_id: order.order_id,
                station_id: order.location_id,
                solar_system_id: station.solar_system_id,
                constellation_id: station.constellation_id,
                region_id,
                type_id: order.type_id,
                is_buy_order: order.is_buy_order,
                price: order.price,
                volume_remain: order.volume_remain,
                volume_total: order.volume_total,
                min_volume: order.min_volume.max(1),
                range_value: if order.range.is_empty() {
                    "region".to_string()
                } else {
                    order.range
                },
                issued_at: order.issued,
                duration_days: order.duration,
            });
            report.station_orders += 1;
        }
    }

    Ok((orders, report))
}

async fn fetch_esi_page(
    client: &Client,
    config: &TqLiveConfig,
    region_id: u32,
    page: u32,
) -> Result<EsiPage> {
    let base = config.source_base_url.trim_end_matches('/');
    let url = format!(
        "{base}/markets/{region_id}/orders/?datasource=tranquility&order_type=all&page={page}"
    );
    let response = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("ESI request failed for region {region_id} page {page}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(anyhow!(
            "ESI returned {} for region {} page {}",
            status,
            region_id,
            page
        ));
    }
    let x_pages = response
        .headers()
        .get("x-pages")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(1);
    let orders = response
        .json::<Vec<EsiMarketOrder>>()
        .await
        .with_context(|| format!("ESI JSON decode failed for region {region_id} page {page}"))?;
    Ok(EsiPage { x_pages, orders })
}

fn load_tq_live_index(database_path: &Path, config: &TqLiveConfig) -> Result<TqLiveIndex> {
    let connection = Connection::open(database_path).with_context(|| {
        format!(
            "failed to open market database for TQ live index at {}",
            database_path.to_string_lossy()
        )
    })?;

    let mut station_statement = connection.prepare(
        "SELECT station_id, solar_system_id, constellation_id, region_id FROM stations",
    )?;
    let station_rows = station_statement.query_map([], |row| {
        Ok((
            row.get::<_, u64>(0)?,
            StationMeta {
                solar_system_id: row.get(1)?,
                constellation_id: row.get(2)?,
                region_id: row.get(3)?,
            },
        ))
    })?;
    let mut stations = HashMap::new();
    let mut available_regions = HashSet::<u32>::new();
    for row in station_rows {
        let (station_id, station) = row?;
        available_regions.insert(station.region_id);
        stations.insert(station_id, station);
    }

    let mut type_statement = connection.prepare("SELECT type_id FROM market_types WHERE published = 1")?;
    let type_rows = type_statement.query_map([], |row| row.get::<_, u32>(0))?;
    let mut market_type_ids = HashSet::new();
    for row in type_rows {
        market_type_ids.insert(row?);
    }

    let mut region_ids = if config.region_ids.is_empty() {
        available_regions.into_iter().collect::<Vec<_>>()
    } else {
        config
            .region_ids
            .iter()
            .copied()
            .filter(|region_id| available_regions.contains(region_id))
            .collect::<Vec<_>>()
    };
    region_ids.sort_unstable();

    Ok(TqLiveIndex {
        stations: Arc::new(stations),
        market_type_ids: Arc::new(market_type_ids),
        region_ids: Arc::new(region_ids),
    })
}

fn build_http_client(config: &TqLiveConfig) -> Result<Client> {
    Client::builder()
        .user_agent(config.user_agent.clone())
        .timeout(StdDuration::from_secs(
            config.request_timeout_seconds.max(5),
        ))
        .build()
        .context("failed to build TQ live HTTP client")
}

fn absorb_apply_report(stats: &mut CycleStats, report: &TqLiveApplyReport) {
    stats.total_orders_changed += report.total_orders_changed;
    stats.created_buy_orders += report.created_buy_orders;
    stats.created_sell_orders += report.created_sell_orders;
    stats.removed_buy_orders += report.removed_buy_orders;
    stats.removed_sell_orders += report.removed_sell_orders;
    stats.price_changed_orders += report.price_changed_orders;
    stats.volume_changed_orders += report.volume_changed_orders;
    stats.sell_volume_decreased_units += report.sell_volume_decreased_units;
    stats.buy_volume_decreased_units += report.buy_volume_decreased_units;
    stats.seed_rows_changed += report.seed_rows_changed;
    stats.seed_sell_rows += report.seed_sell_rows;
    stats.seed_buy_rows += report.seed_buy_rows;
}

fn parse_console_command(line: &str) -> Option<ConsoleCommand> {
    let normalized = line.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "tq on" | "tq start" | "tq live on" => Some(ConsoleCommand::On),
        "tq off" | "tq stop" | "tq live off" => Some(ConsoleCommand::Off),
        "tq now" | "tq refresh" => Some(ConsoleCommand::Now),
        "tq status" => Some(ConsoleCommand::Status),
        "tq help" | "help tq" => Some(ConsoleCommand::Help),
        "" => None,
        _ => {
            if normalized.starts_with("tq ") {
                println!("{}", color_yellow("[TQ-LIVE] unknown command. Try: tq help"));
            }
            None
        }
    }
}

fn print_console_help() {
    println!(
        "\n{}\n  {}  {}\n  {}  {}\n  {}  {}\n  {}  {}\n",
        color_cyan("╭─ TQ Live Market Console ─────────────────────────────╮"),
        color_green("tq on"),
        "start near-live TQ station mirroring",
        color_yellow("tq off"),
        "stop after the current cycle",
        color_cyan("tq now"),
        "run one refresh immediately",
        color_dim("tq status"),
        "show mirror state",
    );
}

fn print_status(
    enabled: bool,
    interval_seconds: u64,
    last_cycle: Option<&CycleStats>,
    index: &TqLiveIndex,
) {
    println!("{}", color_cyan("╭─ TQ Live Status ─────────────────────────────────────╮"));
    println!(
        "  state: {}    interval: {}s    regions: {}",
        if enabled {
            color_green("ONLINE")
        } else {
            color_yellow("OFFLINE")
        },
        interval_seconds,
        format_count(index.region_ids.len() as u64),
    );
    if let Some(cycle) = last_cycle {
        println!(
            "  last: cycle #{} at {} | {} changed | {} station orders | {}",
            cycle.cycle_number,
            cycle.started_at,
            format_count(cycle.total_orders_changed),
            format_count(cycle.station_orders),
            format_duration(cycle.elapsed),
        );
    } else {
        println!("  last: never refreshed in this process");
    }
    println!("{}", color_cyan("╰──────────────────────────────────────────────────────╯"));
}

fn print_region_line(fetch: &RegionFetchReport, report: &TqLiveApplyReport) {
    if report.total_orders_changed == 0 && report.seed_rows_changed == 0 {
        return;
    }
    println!(
        "{} reg {} | {} changed | +{} buys +{} sells | -{} buys -{} sells | seed rows {}",
        color_dim("[TQ-LIVE]"),
        fetch.region_id,
        format_count(report.total_orders_changed),
        format_count(report.created_buy_orders),
        format_count(report.created_sell_orders),
        format_count(report.removed_buy_orders),
        format_count(report.removed_sell_orders),
        format_count(report.seed_rows_changed),
    );
    println!(
        "{}        applied reg {} | raw {} | src {} | affected: {} types, {} stations, {} systems | {}",
        color_dim("[TQ-LIVE]"),
        report.region_id,
        format_count(fetch.source_orders),
        format_count(report.source_orders),
        format_count(report.affected_types as u64),
        format_count(report.affected_stations as u64),
        format_count(report.affected_systems as u64),
        report.applied_at,
    );
}

fn print_cycle_dashboard(stats: &CycleStats, interval_seconds: u64) {
    println!("{}", color_cyan("╭─ TQ Live Market Mirror ──────────────────────────────╮"));
    println!(
        "  cycle #{:<5} {}    elapsed {}    next ~{}s",
        stats.cycle_number,
        stats.started_at,
        format_duration(stats.elapsed),
        interval_seconds,
    );
    println!(
        "  regions {} scanned | {} applied | {} failed | pages {}",
        format_count(stats.regions_scanned),
        color_green(&format_count(stats.regions_applied)),
        if stats.regions_failed == 0 {
            color_green("0")
        } else {
            color_yellow(&format_count(stats.regions_failed))
        },
        format_count(stats.pages_fetched),
    );
    println!(
        "  orders  {} source | {} station-only | {} structures dropped",
        format_count(stats.source_orders),
        color_green(&format_count(stats.station_orders)),
        format_count(stats.structure_orders_dropped),
    );
    println!(
        "  delta   {} total changed | +{} buys +{} sells | -{} buys -{} sells",
        color_cyan(&format_count(stats.total_orders_changed)),
        format_count(stats.created_buy_orders),
        format_count(stats.created_sell_orders),
        format_count(stats.removed_buy_orders),
        format_count(stats.removed_sell_orders),
    );
    println!(
        "  motion  {} price changes | {} quantity changes | sell volume down {} | buy volume down {}",
        format_count(stats.price_changed_orders),
        format_count(stats.volume_changed_orders),
        color_yellow(&format_count(stats.sell_volume_decreased_units)),
        color_yellow(&format_count(stats.buy_volume_decreased_units)),
    );
    println!(
        "  seed    {} rows changed | {} sells | {} buys",
        color_green(&format_count(stats.seed_rows_changed)),
        format_count(stats.seed_sell_rows),
        format_count(stats.seed_buy_rows),
    );
    println!("{}", color_cyan("╰──────────────────────────────────────────────────────╯"));

    info!(
        "TQ live cycle #{}: {} total orders changed, {} new buys, {} new sells, sell volume down {}, buy volume down {}",
        stats.cycle_number,
        stats.total_orders_changed,
        stats.created_buy_orders,
        stats.created_sell_orders,
        stats.sell_volume_decreased_units,
        stats.buy_volume_decreased_units,
    );
}

fn format_count(value: u64) -> String {
    let raw = value.to_string();
    let mut output = String::new();
    for (index, ch) in raw.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            output.push(',');
        }
        output.push(ch);
    }
    output.chars().rev().collect()
}

fn format_duration(value: StdDuration) -> String {
    if value.as_secs() >= 60 {
        format!("{}m {:02}s", value.as_secs() / 60, value.as_secs() % 60)
    } else {
        format!("{:.1}s", value.as_secs_f64())
    }
}

fn color_green(value: &str) -> String {
    format!("\x1b[32m{value}\x1b[0m")
}

fn color_yellow(value: &str) -> String {
    format!("\x1b[33m{value}\x1b[0m")
}

fn color_cyan(value: &str) -> String {
    format!("\x1b[36m{value}\x1b[0m")
}

fn color_dim(value: &str) -> String {
    format!("\x1b[2m{value}\x1b[0m")
}
