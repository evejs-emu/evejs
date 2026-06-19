mod config;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration as StdDuration;

use anyhow::{Context, Result, anyhow, bail};
use clap::{Args, Parser, Subcommand};
use config::MarketSeedConfig;
use indicatif::{ProgressBar, ProgressStyle};
use market_common::{
    MANIFEST_KEY, MARKET_SCHEMA_VERSION, MarketManifest, RUNTIME_INDEX_DROP_SQL, SCHEMA_SQL,
    fallback_base_price, now_rfc3339, round_isk,
};
use rayon::prelude::*;
use rusqlite::{Connection, params};
use serde::Deserialize;
use serde_json::json;
use time::format_description::FormatItem;
use time::macros::format_description;
use time::{Date, Duration, OffsetDateTime};

const DAY_FORMAT: &[FormatItem<'static>] = format_description!("[year]-[month]-[day]");
const PRESET_FULL_UNIVERSE: &str = "full_universe";
const PRESET_JITA_NEW_CALDARI: &str = "jita_new_caldari";
const PRESET_JITA_ONLY: &str = "jita_only";
const PRESET_NEW_CALDARI_ONLY: &str = "new_caldari_only";
const JITA_SYSTEM_ID: u32 = 30000142;
const NEW_CALDARI_SYSTEM_ID: u32 = 30000145;

#[derive(Debug, Clone)]
struct SeedPreset {
    key: &'static str,
    label: &'static str,
    description: &'static str,
    solar_system_ids: &'static [u32],
}

const MARKET_SEED_PRESETS: &[SeedPreset] = &[
    SeedPreset {
        key: PRESET_FULL_UNIVERSE,
        label: "Full Universe",
        description: "Seeds every station in every system that has stations.",
        solar_system_ids: &[],
    },
    SeedPreset {
        key: PRESET_JITA_NEW_CALDARI,
        label: "Jita + New Caldari",
        description: "Seeds only the Jita (30000142) and New Caldari (30000145) systems.",
        solar_system_ids: &[JITA_SYSTEM_ID, NEW_CALDARI_SYSTEM_ID],
    },
    SeedPreset {
        key: PRESET_JITA_ONLY,
        label: "Jita Only",
        description: "Seeds only the Jita system (30000142).",
        solar_system_ids: &[JITA_SYSTEM_ID],
    },
    SeedPreset {
        key: PRESET_NEW_CALDARI_ONLY,
        label: "New Caldari Only",
        description: "Seeds only the New Caldari system (30000145).",
        solar_system_ids: &[NEW_CALDARI_SYSTEM_ID],
    },
];

#[derive(Debug, Parser)]
#[command(author, version, about = "Builds the standalone EvEJS market database")]
struct Cli {
    #[arg(long, default_value = "config/market-seed.local.toml")]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Build(BuildArgs),
    RebuildSummaries(RebuildSummariesArgs),
    Doctor(DoctorArgs),
    Presets,
}

#[derive(Debug, Args)]
struct BuildArgs {
    #[arg(long)]
    force: bool,
    #[arg(long, value_name = "PRESET")]
    preset: Option<String>,
    #[arg(
        long = "solar-system-id",
        value_delimiter = ',',
        value_name = "SYSTEM_ID"
    )]
    solar_system_ids: Vec<u32>,
    #[arg(
        long = "solar-system-name",
        value_delimiter = ',',
        value_name = "SYSTEM_NAME"
    )]
    solar_system_names: Vec<String>,
    #[arg(long)]
    station_limit: Option<usize>,
    #[arg(long)]
    type_limit: Option<usize>,
}

#[derive(Debug, Args)]
struct RebuildSummariesArgs {
    #[arg(long)]
    region_id: Option<u32>,
}

#[derive(Debug, Args)]
struct DoctorArgs {}

#[derive(Debug, Deserialize)]
struct StationsFile {
    stations: Vec<StationRecord>,
}

#[derive(Debug, Clone, Deserialize)]
struct StationRecord {
    #[serde(rename = "stationID")]
    station_id: u64,
    #[serde(rename = "solarSystemID")]
    solar_system_id: u32,
    #[serde(rename = "constellationID")]
    constellation_id: u32,
    #[serde(rename = "regionID")]
    region_id: u32,
    #[serde(rename = "regionName")]
    region_name: String,
    #[serde(rename = "stationName")]
    station_name: String,
    security: f64,
}

#[derive(Debug, Deserialize)]
struct SolarSystemsFile {
    #[serde(rename = "solarSystems")]
    solar_systems: Vec<SolarSystemRecord>,
}

#[derive(Debug, Clone, Deserialize)]
struct SolarSystemRecord {
    #[serde(rename = "solarSystemID")]
    solar_system_id: u32,
    #[serde(rename = "regionID")]
    region_id: u32,
    #[serde(rename = "constellationID")]
    constellation_id: u32,
    #[serde(rename = "solarSystemName")]
    solar_system_name: String,
    security: f64,
}

#[derive(Debug, Deserialize)]
struct ItemTypesFile {
    #[serde(rename = "types")]
    item_types: Vec<ItemTypeRecord>,
}

#[derive(Debug, Clone, Deserialize)]
struct ItemTypeRecord {
    #[serde(rename = "typeID")]
    type_id: u32,
    #[serde(rename = "groupID")]
    group_id: Option<u32>,
    #[serde(rename = "categoryID")]
    category_id: Option<u32>,
    #[serde(rename = "groupName")]
    group_name: Option<String>,
    name: String,
    #[serde(rename = "basePrice")]
    base_price: Option<f64>,
    #[serde(rename = "marketGroupID")]
    market_group_id: Option<u32>,
    volume: Option<f64>,
    #[serde(rename = "portionSize")]
    portion_size: Option<u32>,
    published: bool,
}

#[derive(Debug, Clone)]
struct RegionRow {
    region_id: u32,
    region_name: String,
}

#[derive(Debug)]
struct SeedInputData {
    selection_mode: String,
    selection_label: String,
    selected_solar_system_ids: Vec<u32>,
    selected_solar_system_names: Vec<String>,
    regions: Vec<RegionRow>,
    solar_systems: Vec<SolarSystemRecord>,
    stations: Vec<StationRecord>,
    item_types: Vec<ItemTypeRecord>,
}

#[derive(Debug, Clone)]
struct SeedSelection {
    mode: String,
    label: String,
    solar_system_ids: Vec<u32>,
}

#[derive(Debug, Clone)]
struct RegionSeedPlan {
    region_id: u32,
    station_count: usize,
}

#[derive(Debug, Clone)]
struct RegionSummaryInsertRow {
    region_id: u32,
    row: SummaryRowSeed,
}

#[derive(Debug, Clone)]
struct SystemSummaryInsertRow {
    solar_system_id: u32,
    row: SummaryRowSeed,
}

#[derive(Debug, Clone)]
struct SummaryRowSeed {
    type_id: u32,
    best_ask_price: Option<f64>,
    total_ask_quantity: u64,
    best_ask_station_id: Option<u64>,
    best_bid_price: Option<f64>,
    total_bid_quantity: u64,
    best_bid_station_id: Option<u64>,
}

#[derive(Debug, Clone)]
struct HistorySeedRow {
    type_id: u32,
    day: String,
    low_price: f64,
    high_price: f64,
    avg_price: f64,
    volume: u64,
    order_count: u32,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let config = MarketSeedConfig::load(&cli.config)?;

    match cli.command {
        Command::Build(args) => build_database(&config, args),
        Command::RebuildSummaries(args) => rebuild_summaries_only(&config, args.region_id),
        Command::Doctor(_) => doctor(&config),
        Command::Presets => print_presets(),
    }
}

fn build_database(config: &MarketSeedConfig, args: BuildArgs) -> Result<()> {
    let spinner = new_spinner("Loading static data");
    let input = load_seed_input(config, &args)?;
    let seed_row_count = input.stations.len() as u64 * input.item_types.len() as u64;
    let parallelism = config.build.parallelism.max(1);
    let compute_pool = rayon::ThreadPoolBuilder::new()
        .num_threads(parallelism)
        .build()
        .context("failed to build seeder rayon thread pool")?;
    let region_plans = build_region_seed_plans(&input);
    spinner.finish_with_message(format!(
        "Loaded {} using {}: {} stations, {} systems, {} regions, {} market types ({} seed rows)",
        input.selection_mode,
        input.selection_label,
        input.stations.len(),
        input.solar_systems.len(),
        input.regions.len(),
        input.item_types.len(),
        seed_row_count
    ));

    let database_path = &config.output.database_path;
    if database_path.exists() {
        if !args.force {
            bail!(
                "market database already exists at {}. Re-run with --force to replace it.",
                database_path.to_string_lossy()
            );
        }
        fs::remove_file(database_path).with_context(|| {
            format!(
                "failed to remove existing market database at {}",
                database_path.to_string_lossy()
            )
        })?;
    }

    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut connection = open_build_connection(
        database_path,
        config.build.sqlite_cache_size_kib,
        config.build.sqlite_page_size_bytes,
        config.build.sqlite_worker_threads,
    )?;
    connection.execute_batch(SCHEMA_SQL)?;

    let static_bar = new_stage_bar(
        "Static tables",
        (input.regions.len()
            + input.solar_systems.len()
            + input.stations.len()
            + input.item_types.len()) as u64,
    );
    write_static_tables(&mut connection, &input, &static_bar)?;
    static_bar.finish_with_message(format!(
        "Static tables 100% | {} reg | {} sys | {} stn | {} types",
        input.regions.len(),
        input.solar_systems.len(),
        input.stations.len(),
        input.item_types.len()
    ));

    let seed_stock_bar = new_stage_bar("Seed stock", seed_row_count);
    materialize_seed_stock(
        &mut connection,
        config,
        &region_plans,
        input.item_types.len(),
        &seed_stock_bar,
    )?;
    seed_stock_bar.finish_with_message(format!(
        "Seed stock 100% | {} rows",
        format_count(seed_row_count)
    ));

    if config.seed.seed_buy_orders_enabled {
        let buy_bar = new_stage_bar("Seed buys", seed_row_count);
        materialize_seed_buy_orders(
            &mut connection,
            config,
            &region_plans,
            input.item_types.len(),
            &buy_bar,
        )?;
        buy_bar.finish_with_message(format!(
            "Seed buys 100% | {} rows",
            format_count(seed_row_count)
        ));
    }

    let summary_total_rows = input.regions.len() as u64 * input.item_types.len() as u64;
    let summary_compute_bar = new_stage_bar("Seed summaries", summary_total_rows);
    let computed_summaries = compute_pool
        .install(|| compute_seed_region_summaries(&input, config, &summary_compute_bar))?;
    summary_compute_bar.finish_with_message(format!(
        "Seed summaries 100% | {} rows",
        format_count(computed_summaries.len())
    ));

    let summary_write_bar = new_stage_bar("Write summaries", computed_summaries.len() as u64);
    write_seed_region_summaries(&mut connection, &computed_summaries, &summary_write_bar)?;
    summary_write_bar.finish_with_message(format!(
        "Write summaries 100% | {} rows",
        format_count(computed_summaries.len())
    ));

    let system_seed_summary_rows = input.solar_systems.len() as u64 * input.item_types.len() as u64;
    let system_summary_bar = new_stage_bar("System summaries", system_seed_summary_rows);
    compute_pool.install(|| {
        build_and_write_seed_system_summaries(
            &mut connection,
            &input,
            config,
            parallelism,
            &system_summary_bar,
        )
    })?;
    system_summary_bar.finish_with_message(format!(
        "System summaries 100% | {} rows",
        format_count(system_seed_summary_rows)
    ));

    let history_total_rows =
        input.item_types.len() as u64 * u64::from(config.seed.history_days_seeded);
    let history_compute_bar = new_stage_bar("History build", history_total_rows);
    let history_rows = compute_pool.install(|| {
        build_price_history_rows(
            &input.item_types,
            config.seed.history_days_seeded,
            &history_compute_bar,
        )
    })?;
    history_compute_bar.finish_with_message(format!(
        "History build 100% | {} rows",
        format_count(history_rows.len())
    ));

    let history_write_bar = new_stage_bar("History write", history_rows.len() as u64);
    write_price_history_rows(&mut connection, &history_rows, &history_write_bar)?;
    history_write_bar.finish_with_message(format!(
        "History write 100% | {} rows",
        format_count(history_rows.len())
    ));

    let manifest = MarketManifest {
        schema_version: MARKET_SCHEMA_VERSION,
        generated_at: now_rfc3339(),
        static_data_dir: config.input.static_data_dir.to_string_lossy().to_string(),
        database_path: database_path.to_string_lossy().to_string(),
        selection_mode: input.selection_mode.clone(),
        selection_label: input.selection_label.clone(),
        selected_solar_system_ids: input.selected_solar_system_ids.clone(),
        selected_solar_system_names: input.selected_solar_system_names.clone(),
        region_count: input.regions.len() as u32,
        solar_system_count: input.solar_systems.len() as u32,
        station_count: input.stations.len() as u32,
        market_type_count: input.item_types.len() as u32,
        seed_row_count,
        default_quantity_per_station_type: config.seed.default_quantity_per_station_type,
        seed_buy_orders_enabled: config.seed.seed_buy_orders_enabled,
        history_days_seeded: config.seed.history_days_seeded,
        seed_markup_percent: config.seed.seed_markup_percent,
        station_jitter_percent: config.seed.station_jitter_percent,
        region_jitter_percent: config.seed.region_jitter_percent,
    };
    write_manifest(&connection, &manifest)?;

    let index_bar = new_stage_bar("Runtime indexes", runtime_index_statements().len() as u64);
    build_runtime_indexes(&connection, &index_bar)?;
    index_bar.finish_with_message(format!(
        "Runtime indexes 100% | {} indexes",
        runtime_index_statements().len()
    ));

    let finalize_bar = new_stage_bar("Finalize", 3);
    finalize_database(&connection, &finalize_bar)?;
    finalize_bar.finish_with_message(format!(
        "Market database ready at {}",
        database_path.to_string_lossy()
    ));

    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
          "ok": true,
          "database": database_path,
          "selectionMode": input.selection_mode,
          "selectionLabel": input.selection_label,
          "selectedSolarSystemIds": input.selected_solar_system_ids,
          "selectedSolarSystemNames": input.selected_solar_system_names,
          "stations": input.stations.len(),
          "marketTypes": input.item_types.len(),
          "seedRows": seed_row_count,
          "regionSummaryRows": computed_summaries.len(),
          "systemSeedSummaryRows": system_seed_summary_rows,
          "seedBuyOrdersEnabled": config.seed.seed_buy_orders_enabled,
          "historyDays": config.seed.history_days_seeded
        }))?
    );

    Ok(())
}

fn rebuild_summaries_only(config: &MarketSeedConfig, region_id: Option<u32>) -> Result<()> {
    let database_path = &config.output.database_path;
    if !database_path.exists() {
        bail!(
            "market database not found at {}",
            database_path.to_string_lossy()
        );
    }
    let mut connection = open_runtime_connection(database_path)?;
    let spinner = new_spinner("Rebuilding region summaries");
    rebuild_region_summaries_with_connection(&mut connection, region_id)?;
    spinner.finish_with_message(match region_id {
        Some(region_id) => format!("Rebuilt region summaries for {}", region_id),
        None => "Rebuilt region summaries for all regions".to_string(),
    });
    Ok(())
}

fn doctor(config: &MarketSeedConfig) -> Result<()> {
    let database_path = &config.output.database_path;
    if !database_path.exists() {
        bail!(
            "market database not found at {}",
            database_path.to_string_lossy()
        );
    }
    let connection = open_runtime_connection(database_path)?;
    let manifest = load_manifest(&connection)?;
    let region_summary_rows: u64 =
        connection.query_row("SELECT COUNT(*) FROM region_summaries", [], |row| {
            row.get(0)
        })?;
    let system_seed_summary_rows: u64 =
        connection.query_row("SELECT COUNT(*) FROM system_seed_summaries", [], |row| {
            row.get(0)
        })?;
    let seed_rows: u64 =
        connection.query_row("SELECT COUNT(*) FROM seed_stock", [], |row| row.get(0))?;
    let seed_buy_orders: u64 =
        connection.query_row("SELECT COUNT(*) FROM seed_buy_orders", [], |row| row.get(0))?;
    let player_orders: u64 =
        connection.query_row("SELECT COUNT(*) FROM market_orders", [], |row| row.get(0))?;
    let file_size_bytes = fs::metadata(database_path)?.len();

    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
          "ok": true,
          "database": database_path,
          "fileSizeBytes": file_size_bytes,
          "seedStockRows": seed_rows,
          "seedBuyOrderRows": seed_buy_orders,
          "marketOrdersRows": player_orders,
          "regionSummaryRows": region_summary_rows,
          "systemSeedSummaryRows": system_seed_summary_rows,
          "manifest": manifest
        }))?
    );
    Ok(())
}

fn load_seed_input(config: &MarketSeedConfig, args: &BuildArgs) -> Result<SeedInputData> {
    let static_dir = &config.input.static_data_dir;
    let stations_path = static_dir.join("stations").join("data.json");
    let solar_systems_path = static_dir.join("solarSystems").join("data.json");
    let item_types_path = static_dir.join("itemTypes").join("data.json");

    let stations_raw = fs::read_to_string(&stations_path)?;
    let solar_systems_raw = fs::read_to_string(&solar_systems_path)?;
    let item_types_raw = fs::read_to_string(&item_types_path)?;

    let mut stations = serde_json::from_str::<StationsFile>(&stations_raw)?.stations;
    let solar_systems = serde_json::from_str::<SolarSystemsFile>(&solar_systems_raw)?.solar_systems;
    let mut item_types = serde_json::from_str::<ItemTypesFile>(&item_types_raw)?.item_types;

    stations.sort_by_key(|station| station.station_id);
    let selection = resolve_seed_selection(
        args.preset.as_deref(),
        &args.solar_system_ids,
        &args.solar_system_names,
        &solar_systems,
    )?;

    if !selection.solar_system_ids.is_empty() {
        let allowed_ids = selection
            .solar_system_ids
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        stations.retain(|station| allowed_ids.contains(&station.solar_system_id));
    }

    if let Some(limit) = args.station_limit {
        stations.truncate(limit);
    }
    if stations.is_empty() {
        bail!(
            "no stations matched the current selection. Try `market-seed presets` or remove the system filters."
        );
    }

    let allowed_systems = stations
        .iter()
        .map(|station| station.solar_system_id)
        .collect::<BTreeSet<_>>();
    let mut filtered_systems = solar_systems
        .into_iter()
        .filter(|system| allowed_systems.contains(&system.solar_system_id))
        .collect::<Vec<_>>();
    filtered_systems.sort_by_key(|system| system.solar_system_id);
    if filtered_systems.is_empty() {
        bail!("the selected stations did not leave any solar systems to seed");
    }

    item_types.retain(|item| item.published && item.market_group_id.is_some());
    item_types.sort_by_key(|item| item.type_id);
    if let Some(limit) = args.type_limit {
        item_types.truncate(limit);
    }
    if item_types.is_empty() {
        bail!("no market types matched the current type selection");
    }

    let mut region_map = BTreeMap::<u32, String>::new();
    for station in &stations {
        region_map
            .entry(station.region_id)
            .or_insert_with(|| station.region_name.clone());
    }
    let regions = region_map
        .into_iter()
        .map(|(region_id, region_name)| RegionRow {
            region_id,
            region_name,
        })
        .collect::<Vec<_>>();

    let selected_solar_system_ids = if selection.solar_system_ids.is_empty() {
        Vec::new()
    } else {
        filtered_systems
            .iter()
            .map(|system| system.solar_system_id)
            .collect::<Vec<_>>()
    };
    let selected_solar_system_names = if selection.solar_system_ids.is_empty() {
        Vec::new()
    } else {
        filtered_systems
            .iter()
            .map(|system| format!("{} ({})", system.solar_system_name, system.solar_system_id))
            .collect::<Vec<_>>()
    };

    Ok(SeedInputData {
        selection_mode: selection.mode,
        selection_label: selection.label,
        selected_solar_system_ids,
        selected_solar_system_names,
        regions,
        solar_systems: filtered_systems,
        stations,
        item_types,
    })
}

fn resolve_seed_selection(
    preset_name: Option<&str>,
    solar_system_ids: &[u32],
    solar_system_names: &[String],
    solar_systems: &[SolarSystemRecord],
) -> Result<SeedSelection> {
    let mut selected_ids = BTreeSet::<u32>::new();
    let preset = match preset_name {
        Some(name) => Some(find_seed_preset(name)?),
        None => None,
    };

    if let Some(preset) = preset {
        selected_ids.extend(preset.solar_system_ids.iter().copied());
    }
    selected_ids.extend(solar_system_ids.iter().copied());

    if !solar_system_names.is_empty() {
        let names_by_key = solar_systems
            .iter()
            .map(|system| {
                (
                    system.solar_system_name.to_ascii_lowercase(),
                    (system.solar_system_id, system.solar_system_name.clone()),
                )
            })
            .collect::<BTreeMap<_, _>>();

        for solar_system_name in solar_system_names {
            let lookup_key = solar_system_name.trim().to_ascii_lowercase();
            let Some((solar_system_id, _)) = names_by_key.get(&lookup_key) else {
                bail!(
                    "solar system '{}' was not found in static data",
                    solar_system_name
                );
            };
            selected_ids.insert(*solar_system_id);
        }
    }

    let selected_ids_vec = selected_ids.into_iter().collect::<Vec<_>>();
    if selected_ids_vec.is_empty() {
        let label = preset
            .map(|entry| entry.label.to_string())
            .unwrap_or_else(|| "Full Universe".to_string());
        let mode = preset
            .map(|entry| entry.key.to_string())
            .unwrap_or_else(|| PRESET_FULL_UNIVERSE.to_string());
        return Ok(SeedSelection {
            mode,
            label,
            solar_system_ids: Vec::new(),
        });
    }

    let systems_by_id = solar_systems
        .iter()
        .map(|system| {
            (
                system.solar_system_id,
                format!("{} ({})", system.solar_system_name, system.solar_system_id),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let selected_names = selected_ids_vec
        .iter()
        .map(|solar_system_id| {
            systems_by_id.get(solar_system_id).cloned().ok_or_else(|| {
                anyhow!(
                    "solar system {} was not found in static data",
                    solar_system_id
                )
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let label = if let Some(preset) = preset {
        if solar_system_ids.is_empty() && solar_system_names.is_empty() {
            preset.label.to_string()
        } else {
            format!("{} + custom systems", preset.label)
        }
    } else if selected_names.len() == 1 {
        selected_names[0].clone()
    } else {
        format!("Custom system selection ({} systems)", selected_names.len())
    };

    let mode = if let Some(preset) = preset {
        if solar_system_ids.is_empty() && solar_system_names.is_empty() {
            preset.key.to_string()
        } else {
            "preset_plus_custom_systems".to_string()
        }
    } else {
        "custom_system_selection".to_string()
    };

    Ok(SeedSelection {
        mode,
        label,
        solar_system_ids: selected_ids_vec,
    })
}

fn find_seed_preset(preset_name: &str) -> Result<&'static SeedPreset> {
    let lookup = preset_name.trim().to_ascii_lowercase().replace('-', "_");
    MARKET_SEED_PRESETS
        .iter()
        .find(|preset| preset.key == lookup)
        .ok_or_else(|| {
            anyhow!(
                "unknown preset '{}'. Run `market-seed presets` to list the supported presets.",
                preset_name
            )
        })
}

fn print_presets() -> Result<()> {
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "ok": true,
            "presets": MARKET_SEED_PRESETS.iter().map(|preset| {
                json!({
                    "key": preset.key,
                    "label": preset.label,
                    "description": preset.description,
                    "solarSystemIds": preset.solar_system_ids,
                })
            }).collect::<Vec<_>>()
        }))?
    );
    Ok(())
}

fn write_static_tables(
    connection: &mut Connection,
    input: &SeedInputData,
    progress: &ProgressBar,
) -> Result<()> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM manifest", [])?;
    transaction.execute("DELETE FROM price_history", [])?;
    transaction.execute("DELETE FROM region_summaries", [])?;
    transaction.execute("DELETE FROM system_seed_summaries", [])?;
    transaction.execute("DELETE FROM seed_buy_orders", [])?;
    transaction.execute("DELETE FROM market_orders", [])?;
    transaction.execute("DELETE FROM seed_stock", [])?;
    transaction.execute("DELETE FROM stations", [])?;
    transaction.execute("DELETE FROM solar_systems", [])?;
    transaction.execute("DELETE FROM regions", [])?;
    transaction.execute("DELETE FROM market_types", [])?;

    {
        let mut statement =
            transaction.prepare("INSERT INTO regions (region_id, region_name) VALUES (?1, ?2)")?;
        for region in &input.regions {
            statement.execute(params![region.region_id, region.region_name])?;
            progress.inc(1);
        }
    }

    {
        let mut statement = transaction.prepare(
            "INSERT INTO solar_systems (
         solar_system_id, region_id, constellation_id, solar_system_name, security
       ) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for system in &input.solar_systems {
            statement.execute(params![
                system.solar_system_id,
                system.region_id,
                system.constellation_id,
                system.solar_system_name,
                system.security
            ])?;
            progress.inc(1);
        }
    }

    {
        let mut statement = transaction.prepare(
            "INSERT INTO stations (
         station_id, solar_system_id, constellation_id, region_id, station_name, security
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for station in &input.stations {
            statement.execute(params![
                station.station_id,
                station.solar_system_id,
                station.constellation_id,
                station.region_id,
                station.station_name,
                station.security
            ])?;
            progress.inc(1);
        }
    }

    {
        let mut statement = transaction.prepare(
      "INSERT INTO market_types (
         type_id, group_id, category_id, market_group_id, name, group_name, base_price, volume, portion_size, published
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
        for item_type in &input.item_types {
            statement.execute(params![
                item_type.type_id,
                item_type.group_id.unwrap_or(0),
                item_type.category_id.unwrap_or(0),
                item_type.market_group_id.unwrap_or(0),
                item_type.name,
                item_type
                    .group_name
                    .clone()
                    .unwrap_or_else(|| "Unknown".to_string()),
                item_type.base_price,
                item_type.volume,
                item_type.portion_size.unwrap_or(1),
                if item_type.published { 1 } else { 0 }
            ])?;
            progress.inc(1);
        }
    }

    transaction.commit()?;
    Ok(())
}

fn materialize_seed_stock(
    connection: &mut Connection,
    config: &MarketSeedConfig,
    region_plans: &[RegionSeedPlan],
    market_type_count: usize,
    progress: &ProgressBar,
) -> Result<()> {
    let seeded_at = now_rfc3339();
    let transaction = connection.transaction()?;
    for region_plan in region_plans {
        transaction.execute(
            "INSERT INTO seed_stock (
               station_id, solar_system_id, constellation_id, region_id, type_id, price, quantity, initial_quantity, updated_at
             )
             SELECT
               s.station_id,
               s.solar_system_id,
               s.constellation_id,
               s.region_id,
               t.type_id,
               MAX(
                 ?10,
                 ROUND(
                   (
                     CASE
                       WHEN t.base_price IS NOT NULL AND t.base_price > 0 THEN t.base_price
                       ELSE (?1 + ((t.type_id % ?2) * ?3))
                     END
                   ) * (
                     1.0 + (?4 / 100.0)
                     + ((((ABS((s.station_id * 31) + (t.type_id * 17)) % 2001) - 1000) / 1000.0) * (?5 / 100.0))
                     + ((((ABS((s.region_id * 13) + (t.type_id * 7)) % 2001) - 1000) / 1000.0) * (?6 / 100.0))
                   ),
                   2
                 )
               ),
               ?7,
               ?7,
               ?8
             FROM stations AS s
             CROSS JOIN market_types AS t
             WHERE s.region_id = ?9",
            params![
                config.seed.fallback_base_price,
                config.seed.fallback_type_modulus,
                config.seed.fallback_type_step,
                config.seed.seed_markup_percent,
                config.seed.station_jitter_percent,
                config.seed.region_jitter_percent,
                config.seed.default_quantity_per_station_type,
                &seeded_at,
                region_plan.region_id,
                config.seed.price_floor,
            ],
        )?;
        progress.inc((region_plan.station_count * market_type_count) as u64);
        progress.set_message(format!(
            "Seed stock {:>3}% | reg {} | rows {}",
            progress.position().saturating_mul(100) / progress.length().unwrap_or(1),
            region_plan.region_id,
            format_count(progress.position())
        ));
    }
    transaction.commit()?;
    Ok(())
}

fn materialize_seed_buy_orders(
    connection: &mut Connection,
    config: &MarketSeedConfig,
    region_plans: &[RegionSeedPlan],
    market_type_count: usize,
    progress: &ProgressBar,
) -> Result<()> {
    let seeded_at = now_rfc3339();
    let transaction = connection.transaction()?;
    for region_plan in region_plans {
        transaction.execute(
            "INSERT INTO seed_buy_orders (
               station_id, solar_system_id, constellation_id, region_id,
               type_id, price, quantity, initial_quantity, updated_at
             )
             SELECT
               s.station_id,
               s.solar_system_id,
               s.constellation_id,
               s.region_id,
               t.type_id,
               MAX(
                 ?10,
                 ROUND(
                   (
                     CASE
                       WHEN t.base_price IS NOT NULL AND t.base_price > 0 THEN t.base_price
                       ELSE (?1 + ((t.type_id % ?2) * ?3))
                     END
                   ) * (
                     1.0 - (?4 / 100.0)
                     - ((((ABS((s.station_id * 19) + (t.type_id * 29)) % 2001) - 1000) / 1000.0) * (?5 / 100.0))
                     - ((((ABS((s.region_id * 11) + (t.type_id * 5)) % 2001) - 1000) / 1000.0) * (?6 / 100.0))
                   ),
                   2
                 )
               ),
               ?7,
               ?7,
               ?8
             FROM stations AS s
             CROSS JOIN market_types AS t
             WHERE s.region_id = ?9",
            params![
                config.seed.fallback_base_price,
                config.seed.fallback_type_modulus,
                config.seed.fallback_type_step,
                config.seed.seed_buy_discount_percent,
                config.seed.station_jitter_percent,
                config.seed.region_jitter_percent,
                config.seed.default_quantity_per_station_type,
                &seeded_at,
                region_plan.region_id,
                config.seed.price_floor * 0.5,
            ],
        )?;
        progress.inc((region_plan.station_count * market_type_count) as u64);
        progress.set_message(format!(
            "Seed buys {:>3}% | reg {} | rows {}",
            progress.position().saturating_mul(100) / progress.length().unwrap_or(1),
            region_plan.region_id,
            format_count(progress.position())
        ));
    }
    transaction.commit()?;
    Ok(())
}

fn rebuild_region_summaries_with_connection(
    connection: &mut Connection,
    region_id: Option<u32>,
) -> Result<()> {
    let now = now_rfc3339();
    let transaction = connection.transaction()?;

    match region_id {
        Some(region_id) => {
            transaction.execute(
                "DELETE FROM region_summaries WHERE region_id = ?1",
                params![region_id],
            )?;
            transaction.execute(
                "INSERT INTO region_summaries (
           region_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
           best_bid_price, total_bid_quantity, best_bid_station_id, updated_at
         )
         WITH sell_agg AS (
           SELECT
             region_id,
             type_id,
             MIN(price) AS best_ask_price,
             SUM(quantity_value) AS total_ask_quantity
           FROM (
             SELECT region_id, type_id, price, quantity AS quantity_value
             FROM seed_stock
             WHERE region_id = ?1 AND quantity > 0
             UNION ALL
             SELECT region_id, type_id, price, vol_remaining AS quantity_value
             FROM market_orders
             WHERE region_id = ?1 AND state = 'open' AND bid = 0 AND vol_remaining > 0
           )
           GROUP BY region_id, type_id
         ),
         sell_station AS (
           SELECT s.region_id, s.type_id, MIN(s.station_id) AS station_id
           FROM (
             SELECT region_id, type_id, station_id, price
             FROM seed_stock
             WHERE region_id = ?1 AND quantity > 0
             UNION ALL
             SELECT region_id, type_id, station_id, price
             FROM market_orders
             WHERE region_id = ?1 AND state = 'open' AND bid = 0 AND vol_remaining > 0
           ) AS s
           JOIN sell_agg
             ON sell_agg.region_id = s.region_id
            AND sell_agg.type_id = s.type_id
            AND sell_agg.best_ask_price = s.price
           GROUP BY s.region_id, s.type_id
         ),
         buy_agg AS (
           SELECT
             region_id,
             type_id,
             MAX(price) AS best_bid_price,
             SUM(quantity_value) AS total_bid_quantity
           FROM (
             SELECT region_id, type_id, price, quantity AS quantity_value
             FROM seed_buy_orders
             WHERE region_id = ?1 AND quantity > 0
             UNION ALL
             SELECT region_id, type_id, price, vol_remaining AS quantity_value
             FROM market_orders
             WHERE region_id = ?1 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
           )
           GROUP BY region_id, type_id
         ),
         buy_station AS (
           SELECT b.region_id, b.type_id, MIN(b.station_id) AS station_id
           FROM (
             SELECT region_id, type_id, station_id, price
             FROM seed_buy_orders
             WHERE region_id = ?1 AND quantity > 0
             UNION ALL
             SELECT region_id, type_id, station_id, price
             FROM market_orders
             WHERE region_id = ?1 AND state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
           ) AS b
           JOIN buy_agg
             ON buy_agg.region_id = b.region_id
            AND buy_agg.type_id = b.type_id
            AND buy_agg.best_bid_price = b.price
           GROUP BY b.region_id, b.type_id
         )
         SELECT
           COALESCE(sell_agg.region_id, buy_agg.region_id) AS region_id,
           COALESCE(sell_agg.type_id, buy_agg.type_id) AS type_id,
           sell_agg.best_ask_price,
           COALESCE(sell_agg.total_ask_quantity, 0),
           sell_station.station_id,
           buy_agg.best_bid_price,
           COALESCE(buy_agg.total_bid_quantity, 0),
           buy_station.station_id,
           ?2
         FROM sell_agg
         LEFT JOIN sell_station
           ON sell_station.region_id = sell_agg.region_id
          AND sell_station.type_id = sell_agg.type_id
         LEFT JOIN buy_agg
           ON buy_agg.region_id = sell_agg.region_id
          AND buy_agg.type_id = sell_agg.type_id
         LEFT JOIN buy_station
           ON buy_station.region_id = COALESCE(sell_agg.region_id, buy_agg.region_id)
          AND buy_station.type_id = COALESCE(sell_agg.type_id, buy_agg.type_id)
         UNION
         SELECT
           buy_agg.region_id,
           buy_agg.type_id,
           NULL,
           0,
           NULL,
           buy_agg.best_bid_price,
           COALESCE(buy_agg.total_bid_quantity, 0),
           buy_station.station_id,
           ?2
         FROM buy_agg
         LEFT JOIN buy_station
           ON buy_station.region_id = buy_agg.region_id
          AND buy_station.type_id = buy_agg.type_id
         WHERE NOT EXISTS (
           SELECT 1
           FROM sell_agg
           WHERE sell_agg.region_id = buy_agg.region_id
             AND sell_agg.type_id = buy_agg.type_id
         )",
                params![region_id, now],
            )?;
        }
        None => {
            transaction.execute("DELETE FROM region_summaries", [])?;
            transaction.execute(
                "INSERT INTO region_summaries (
           region_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
           best_bid_price, total_bid_quantity, best_bid_station_id, updated_at
         )
         WITH sell_agg AS (
           SELECT
             region_id,
             type_id,
             MIN(price) AS best_ask_price,
             SUM(quantity_value) AS total_ask_quantity
           FROM (
             SELECT region_id, type_id, price, quantity AS quantity_value
             FROM seed_stock
             WHERE quantity > 0
             UNION ALL
             SELECT region_id, type_id, price, vol_remaining AS quantity_value
             FROM market_orders
             WHERE state = 'open' AND bid = 0 AND vol_remaining > 0
           )
           GROUP BY region_id, type_id
         ),
         sell_station AS (
           SELECT s.region_id, s.type_id, MIN(s.station_id) AS station_id
           FROM (
             SELECT region_id, type_id, station_id, price
             FROM seed_stock
             WHERE quantity > 0
             UNION ALL
             SELECT region_id, type_id, station_id, price
             FROM market_orders
             WHERE state = 'open' AND bid = 0 AND vol_remaining > 0
           ) AS s
           JOIN sell_agg
             ON sell_agg.region_id = s.region_id
            AND sell_agg.type_id = s.type_id
            AND sell_agg.best_ask_price = s.price
           GROUP BY s.region_id, s.type_id
         ),
         buy_agg AS (
           SELECT
             region_id,
             type_id,
             MAX(price) AS best_bid_price,
             SUM(quantity_value) AS total_bid_quantity
           FROM (
             SELECT region_id, type_id, price, quantity AS quantity_value
             FROM seed_buy_orders
             WHERE quantity > 0
             UNION ALL
             SELECT region_id, type_id, price, vol_remaining AS quantity_value
             FROM market_orders
             WHERE state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
           )
           GROUP BY region_id, type_id
         ),
         buy_station AS (
           SELECT b.region_id, b.type_id, MIN(b.station_id) AS station_id
           FROM (
             SELECT region_id, type_id, station_id, price
             FROM seed_buy_orders
             WHERE quantity > 0
             UNION ALL
             SELECT region_id, type_id, station_id, price
             FROM market_orders
             WHERE state = 'open' AND bid = 1 AND source = 'player' AND vol_remaining > 0
           ) AS b
           JOIN buy_agg
             ON buy_agg.region_id = b.region_id
            AND buy_agg.type_id = b.type_id
            AND buy_agg.best_bid_price = b.price
           GROUP BY b.region_id, b.type_id
         )
         SELECT
           COALESCE(sell_agg.region_id, buy_agg.region_id) AS region_id,
           COALESCE(sell_agg.type_id, buy_agg.type_id) AS type_id,
           sell_agg.best_ask_price,
           COALESCE(sell_agg.total_ask_quantity, 0),
           sell_station.station_id,
           buy_agg.best_bid_price,
           COALESCE(buy_agg.total_bid_quantity, 0),
           buy_station.station_id,
           ?1
         FROM sell_agg
         LEFT JOIN sell_station
           ON sell_station.region_id = sell_agg.region_id
          AND sell_station.type_id = sell_agg.type_id
         LEFT JOIN buy_agg
           ON buy_agg.region_id = sell_agg.region_id
          AND buy_agg.type_id = sell_agg.type_id
         LEFT JOIN buy_station
           ON buy_station.region_id = COALESCE(sell_agg.region_id, buy_agg.region_id)
          AND buy_station.type_id = COALESCE(sell_agg.type_id, buy_agg.type_id)
         UNION
         SELECT
           buy_agg.region_id,
           buy_agg.type_id,
           NULL,
           0,
           NULL,
           buy_agg.best_bid_price,
           COALESCE(buy_agg.total_bid_quantity, 0),
           buy_station.station_id,
           ?1
         FROM buy_agg
         LEFT JOIN buy_station
           ON buy_station.region_id = buy_agg.region_id
          AND buy_station.type_id = buy_agg.type_id
         WHERE NOT EXISTS (
           SELECT 1
           FROM sell_agg
           WHERE sell_agg.region_id = buy_agg.region_id
             AND sell_agg.type_id = buy_agg.type_id
         )",
                params![now],
            )?;
        }
    }

    transaction.commit()?;
    Ok(())
}

fn build_price_history_rows(
    item_types: &[ItemTypeRecord],
    history_days: u32,
    progress: &ProgressBar,
) -> Result<Vec<HistorySeedRow>> {
    if history_days == 0 {
        progress.set_position(progress.length().unwrap_or(0));
        return Ok(Vec::new());
    }

    let today: Date = OffsetDateTime::now_utc().date();
    let total_rows = item_types.len() as u64 * u64::from(history_days);
    let counter = Arc::new(AtomicU64::new(0));
    let counter_for_reporter = Arc::clone(&counter);
    let reporter_bar = progress.clone();
    let reporter = spawn_progress_reporter(
        reporter_bar,
        counter_for_reporter,
        total_rows,
        "History build",
    );

    let rows = item_types
        .par_iter()
        .map(|item_type| {
            let base_price = item_type
                .base_price
                .filter(|price| *price > 0.0)
                .unwrap_or_else(|| fallback_base_price(item_type.type_id));
            let mut item_rows = Vec::with_capacity(history_days as usize);

            for day_offset in 0..history_days {
                let calendar_day = today - Duration::days(i64::from(history_days - 1 - day_offset));
                let day_string = calendar_day.format(DAY_FORMAT)?;
                let drift = ((((item_type.type_id as i64 * 37) + (day_offset as i64 * 13)) % 101)
                    - 50) as f64
                    / 1000.0;
                let avg_price = round_isk((base_price * (1.0 + drift)).max(100.0));
                item_rows.push(HistorySeedRow {
                    type_id: item_type.type_id,
                    day: day_string,
                    low_price: round_isk(avg_price * 0.985),
                    high_price: round_isk(avg_price * 1.015),
                    avg_price,
                    volume: 100 + u64::from(item_type.type_id % 500) + u64::from(day_offset * 3),
                    order_count: 10 + (item_type.type_id % 20),
                });
                counter.fetch_add(1, Ordering::Relaxed);
            }

            Ok::<Vec<HistorySeedRow>, anyhow::Error>(item_rows)
        })
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

    counter.store(total_rows, Ordering::Relaxed);
    stop_progress_reporter(reporter)?;
    progress.set_position(total_rows);
    Ok(rows)
}

fn write_price_history_rows(
    connection: &mut Connection,
    rows: &[HistorySeedRow],
    progress: &ProgressBar,
) -> Result<()> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM price_history", [])?;
    let mut statement = transaction.prepare(
        "INSERT INTO price_history (
           type_id, day, low_price, high_price, avg_price, volume, order_count
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;

    for row in rows {
        statement.execute(params![
            row.type_id,
            row.day,
            row.low_price,
            row.high_price,
            row.avg_price,
            row.volume,
            row.order_count
        ])?;
        progress.inc(1);
    }

    drop(statement);
    transaction.commit()?;
    Ok(())
}

fn write_manifest(connection: &Connection, manifest: &MarketManifest) -> Result<()> {
    let raw = serde_json::to_string_pretty(manifest)?;
    connection.execute(
        "INSERT OR REPLACE INTO manifest (key, value) VALUES (?1, ?2)",
        params![MANIFEST_KEY, raw],
    )?;
    Ok(())
}

fn load_manifest(connection: &Connection) -> Result<MarketManifest> {
    let raw: String = connection.query_row(
        "SELECT value FROM manifest WHERE key = ?1",
        params![MANIFEST_KEY],
        |row| row.get(0),
    )?;
    let manifest = serde_json::from_str::<MarketManifest>(&raw)?;
    Ok(manifest)
}

fn open_build_connection(
    path: &Path,
    cache_size_kib: i32,
    page_size_bytes: u32,
    worker_threads: usize,
) -> Result<Connection> {
    let connection = Connection::open(path).with_context(|| {
        format!(
            "failed to create market seed database at {}",
            path.to_string_lossy()
        )
    })?;
    connection.pragma_update(None, "page_size", page_size_bytes)?;
    connection.pragma_update(None, "journal_mode", "OFF")?;
    connection.pragma_update(None, "synchronous", "OFF")?;
    connection.pragma_update(None, "temp_store", "MEMORY")?;
    connection.pragma_update(None, "locking_mode", "EXCLUSIVE")?;
    connection.pragma_update(None, "cache_size", -cache_size_kib)?;
    connection.pragma_update(None, "threads", worker_threads.max(1))?;
    connection.pragma_update(None, "foreign_keys", "OFF")?;
    connection.pragma_update(None, "cache_spill", "OFF")?;
    connection.execute_batch(SCHEMA_SQL)?;
    connection.execute_batch(RUNTIME_INDEX_DROP_SQL)?;
    Ok(connection)
}

fn build_runtime_indexes(connection: &Connection, progress: &ProgressBar) -> Result<()> {
    for statement in runtime_index_statements() {
        connection.execute_batch(statement)?;
        progress.inc(1);
    }
    Ok(())
}

fn open_runtime_connection(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(connection)
}

fn new_spinner(message: &str) -> ProgressBar {
    let spinner = ProgressBar::new_spinner();
    spinner.enable_steady_tick(std::time::Duration::from_millis(120));
    spinner.set_style(
        ProgressStyle::with_template("{spinner:.green} {msg}")
            .unwrap_or_else(|_| ProgressStyle::default_spinner()),
    );
    spinner.set_message(message.to_string());
    spinner
}

fn new_stage_bar(message: &str, total: u64) -> ProgressBar {
    let bar = ProgressBar::new(total.max(1));
    bar.set_style(
        ProgressStyle::with_template(
            "  [{bar:32.cyan/blue}] {percent:>3}% | {msg} | {pos}/{len} | eta {eta_precise}",
        )
        .unwrap_or_else(|_| ProgressStyle::default_bar())
        .progress_chars("=> "),
    );
    bar.set_message(message.to_string());
    bar
}

fn build_region_seed_plans(input: &SeedInputData) -> Vec<RegionSeedPlan> {
    let mut station_counts = BTreeMap::<u32, usize>::new();
    for station in &input.stations {
        *station_counts.entry(station.region_id).or_default() += 1;
    }

    input
        .regions
        .iter()
        .map(|region| RegionSeedPlan {
            region_id: region.region_id,
            station_count: station_counts.get(&region.region_id).copied().unwrap_or(0),
        })
        .collect()
}

fn compute_seed_region_summaries(
    input: &SeedInputData,
    config: &MarketSeedConfig,
    progress: &ProgressBar,
) -> Result<Vec<RegionSummaryInsertRow>> {
    let mut stations_by_region = BTreeMap::<u32, Vec<&StationRecord>>::new();
    for station in &input.stations {
        stations_by_region
            .entry(station.region_id)
            .or_default()
            .push(station);
    }
    for stations in stations_by_region.values_mut() {
        stations.sort_by_key(|station| station.station_id);
    }

    let total_rows = input.regions.len() as u64 * input.item_types.len() as u64;
    let counter = Arc::new(AtomicU64::new(0));
    let counter_for_reporter = Arc::clone(&counter);
    let reporter_bar = progress.clone();
    let reporter = spawn_progress_reporter(
        reporter_bar,
        counter_for_reporter,
        total_rows,
        "Seed summaries",
    );

    let rows = input
        .regions
        .par_iter()
        .map(|region| {
            let stations = stations_by_region
                .get(&region.region_id)
                .cloned()
                .unwrap_or_default();
            let mut region_rows = Vec::with_capacity(input.item_types.len());
            for item_type in &input.item_types {
                let row = build_seed_summary_row(region.region_id, &stations, item_type, config);
                region_rows.push(RegionSummaryInsertRow {
                    region_id: region.region_id,
                    row,
                });
                counter.fetch_add(1, Ordering::Relaxed);
            }
            region_rows
        })
        .collect::<Vec<_>>()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

    counter.store(total_rows, Ordering::Relaxed);
    stop_progress_reporter(reporter)?;
    progress.set_position(total_rows);
    Ok(rows)
}

fn build_and_write_seed_system_summaries(
    connection: &mut Connection,
    input: &SeedInputData,
    config: &MarketSeedConfig,
    parallelism: usize,
    progress: &ProgressBar,
) -> Result<()> {
    let mut stations_by_system = BTreeMap::<u32, Vec<&StationRecord>>::new();
    for station in &input.stations {
        stations_by_system
            .entry(station.solar_system_id)
            .or_default()
            .push(station);
    }
    for stations in stations_by_system.values_mut() {
        stations.sort_by_key(|station| station.station_id);
    }

    let total_rows = input.solar_systems.len() as u64 * input.item_types.len() as u64;
    let counter = Arc::new(AtomicU64::new(0));
    let reporter = spawn_progress_reporter(
        progress.clone(),
        Arc::clone(&counter),
        total_rows,
        "System sums",
    );

    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM system_seed_summaries", [])?;
    let updated_at = now_rfc3339();
    let mut statement = transaction.prepare(
        "INSERT INTO system_seed_summaries (
           solar_system_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
           best_bid_price, total_bid_quantity, best_bid_station_id, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;

    let chunk_size = system_summary_chunk_size(parallelism, input.solar_systems.len());
    for systems_chunk in input.solar_systems.chunks(chunk_size) {
        let chunk_rows = systems_chunk
            .par_iter()
            .map(|solar_system| {
                let stations = stations_by_system
                    .get(&solar_system.solar_system_id)
                    .cloned()
                    .unwrap_or_default();
                let mut rows = Vec::with_capacity(input.item_types.len());
                for item_type in &input.item_types {
                    rows.push(SystemSummaryInsertRow {
                        solar_system_id: solar_system.solar_system_id,
                        row: build_seed_summary_row(
                            solar_system.solar_system_id,
                            &stations,
                            item_type,
                            config,
                        ),
                    });
                }
                rows
            })
            .collect::<Vec<_>>();

        for rows in chunk_rows {
            for row in rows {
                statement.execute(params![
                    row.solar_system_id,
                    row.row.type_id,
                    row.row.best_ask_price,
                    row.row.total_ask_quantity,
                    row.row.best_ask_station_id,
                    row.row.best_bid_price,
                    row.row.total_bid_quantity,
                    row.row.best_bid_station_id,
                    &updated_at,
                ])?;
                counter.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    drop(statement);
    transaction.commit()?;
    counter.store(total_rows, Ordering::Relaxed);
    stop_progress_reporter(reporter)?;
    progress.set_position(total_rows);
    Ok(())
}

fn system_summary_chunk_size(parallelism: usize, total_systems: usize) -> usize {
    let worker_count = parallelism.max(1);
    let target_chunks = worker_count.saturating_mul(4).max(1);
    total_systems.div_ceil(target_chunks).clamp(8, 64)
}

fn build_seed_summary_row(
    _region_id: u32,
    stations: &[&StationRecord],
    item_type: &ItemTypeRecord,
    config: &MarketSeedConfig,
) -> SummaryRowSeed {
    let total_quantity =
        (stations.len() as u64) * u64::from(config.seed.default_quantity_per_station_type);
    let mut best_ask_price = None;
    let mut best_ask_station_id = None;
    let mut best_bid_price = None;
    let mut best_bid_station_id = None;

    for station in stations {
        let sell_price = compute_seed_sell_price(station, item_type, config);
        if best_ask_price.is_none_or(|current| sell_price < current)
            || (best_ask_price == Some(sell_price)
                && best_ask_station_id
                    .map(|current| station.station_id < current)
                    .unwrap_or(true))
        {
            best_ask_price = Some(sell_price);
            best_ask_station_id = Some(station.station_id);
        }

        if config.seed.seed_buy_orders_enabled {
            let buy_price = compute_seed_buy_price(station, item_type, config);
            if best_bid_price.is_none_or(|current| buy_price > current)
                || (best_bid_price == Some(buy_price)
                    && best_bid_station_id
                        .map(|current| station.station_id < current)
                        .unwrap_or(true))
            {
                best_bid_price = Some(buy_price);
                best_bid_station_id = Some(station.station_id);
            }
        }
    }

    SummaryRowSeed {
        type_id: item_type.type_id,
        best_ask_price,
        total_ask_quantity: total_quantity,
        best_ask_station_id,
        best_bid_price,
        total_bid_quantity: if config.seed.seed_buy_orders_enabled {
            total_quantity
        } else {
            0
        },
        best_bid_station_id,
    }
}

fn compute_seed_sell_price(
    station: &StationRecord,
    item_type: &ItemTypeRecord,
    config: &MarketSeedConfig,
) -> f64 {
    let base_price = seed_formula_base_price(item_type, config);
    let price = base_price
        * (1.0
            + (config.seed.seed_markup_percent / 100.0)
            + price_jitter(
                station.station_id as i128 * 31 + i128::from(item_type.type_id) * 17,
                config.seed.station_jitter_percent,
            )
            + price_jitter(
                i128::from(station.region_id) * 13 + i128::from(item_type.type_id) * 7,
                config.seed.region_jitter_percent,
            ));
    round_isk(price.max(config.seed.price_floor))
}

fn compute_seed_buy_price(
    station: &StationRecord,
    item_type: &ItemTypeRecord,
    config: &MarketSeedConfig,
) -> f64 {
    let base_price = seed_formula_base_price(item_type, config);
    let price = base_price
        * (1.0
            - (config.seed.seed_buy_discount_percent / 100.0)
            - price_jitter(
                station.station_id as i128 * 19 + i128::from(item_type.type_id) * 29,
                config.seed.station_jitter_percent,
            )
            - price_jitter(
                i128::from(station.region_id) * 11 + i128::from(item_type.type_id) * 5,
                config.seed.region_jitter_percent,
            ));
    round_isk(price.max(config.seed.price_floor * 0.5))
}

fn write_seed_region_summaries(
    connection: &mut Connection,
    rows: &[RegionSummaryInsertRow],
    progress: &ProgressBar,
) -> Result<()> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM region_summaries", [])?;
    let updated_at = now_rfc3339();
    let mut statement = transaction.prepare(
        "INSERT INTO region_summaries (
           region_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
           best_bid_price, total_bid_quantity, best_bid_station_id, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;
    for row in rows {
        statement.execute(params![
            row.region_id,
            row.row.type_id,
            row.row.best_ask_price,
            row.row.total_ask_quantity,
            row.row.best_ask_station_id,
            row.row.best_bid_price,
            row.row.total_bid_quantity,
            row.row.best_bid_station_id,
            &updated_at,
        ])?;
        progress.inc(1);
    }
    drop(statement);
    transaction.commit()?;
    Ok(())
}

fn finalize_database(connection: &Connection, progress: &ProgressBar) -> Result<()> {
    connection.execute_batch("ANALYZE;")?;
    progress.inc(1);
    connection.pragma_update(None, "journal_mode", "WAL")?;
    progress.inc(1);
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    progress.inc(1);
    Ok(())
}

fn spawn_progress_reporter(
    progress: ProgressBar,
    counter: Arc<AtomicU64>,
    total: u64,
    label: &'static str,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        loop {
            let current = counter.load(Ordering::Relaxed).min(total);
            progress.set_position(current);
            progress.set_message(format!(
                "{} {:>3}% | rows {}",
                label,
                if total == 0 {
                    100
                } else {
                    current.saturating_mul(100) / total.max(1)
                },
                format_count(current)
            ));
            if current >= total {
                break;
            }
            thread::sleep(StdDuration::from_millis(200));
        }
    })
}

fn stop_progress_reporter(handle: thread::JoinHandle<()>) -> Result<()> {
    handle
        .join()
        .map_err(|_| anyhow!("progress reporter thread panicked"))?;
    Ok(())
}

fn price_jitter(seed: i128, percent: f64) -> f64 {
    let jitter = (((seed.abs() % 2001) as i64) - 1000) as f64 / 1000.0;
    jitter * (percent / 100.0)
}

fn seed_formula_base_price(item_type: &ItemTypeRecord, config: &MarketSeedConfig) -> f64 {
    item_type
        .base_price
        .filter(|price| *price > 0.0)
        .unwrap_or_else(|| {
            config.seed.fallback_base_price
                + f64::from(item_type.type_id % config.seed.fallback_type_modulus)
                    * config.seed.fallback_type_step
        })
}

fn runtime_index_statements() -> &'static [&'static str] {
    &[
        "CREATE INDEX IF NOT EXISTS idx_seed_stock_region_type_price ON seed_stock (region_id, type_id, price, station_id);",
        "CREATE INDEX IF NOT EXISTS idx_seed_stock_system_type_price ON seed_stock (solar_system_id, type_id, price, station_id);",
        "CREATE INDEX IF NOT EXISTS idx_seed_stock_station_type_price ON seed_stock (station_id, type_id, price);",
        "CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_region_type_price ON seed_buy_orders (region_id, type_id, price DESC, station_id);",
        "CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_system_type_price ON seed_buy_orders (solar_system_id, type_id, price DESC, station_id);",
        "CREATE INDEX IF NOT EXISTS idx_seed_buy_orders_station_type_price ON seed_buy_orders (station_id, type_id, price DESC);",
        "CREATE INDEX IF NOT EXISTS idx_market_orders_region_type_bid_state_price ON market_orders (region_id, type_id, bid, state, price, station_id);",
        "CREATE INDEX IF NOT EXISTS idx_market_orders_system_type_bid_state_price ON market_orders (solar_system_id, type_id, bid, state, price, station_id);",
        "CREATE INDEX IF NOT EXISTS idx_market_orders_station_type_bid_state_price ON market_orders (station_id, type_id, bid, state, price);",
        "CREATE INDEX IF NOT EXISTS idx_market_orders_owner_state ON market_orders (owner_id, is_corp, state, updated_at);",
        "CREATE INDEX IF NOT EXISTS idx_market_orders_player_owner_updated ON market_orders (owner_id, is_corp, updated_at DESC, order_id DESC) WHERE source = 'player';",
        "CREATE INDEX IF NOT EXISTS idx_market_orders_player_expiry ON market_orders (state, issued_at, duration_days, order_id) WHERE source = 'player';",
        "CREATE INDEX IF NOT EXISTS idx_market_order_events_type_id ON market_order_events (event_type, event_id);",
    ]
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
