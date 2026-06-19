use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration as StdDuration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use bzip2::read::BzDecoder;
use clap::{Args, Parser, Subcommand};
use console::style;
use indicatif::{ProgressBar, ProgressStyle};
use market_common::{
    MANIFEST_KEY, MARKET_SCHEMA_VERSION, MarketManifest, RUNTIME_INDEX_DROP_SQL, RUNTIME_INDEX_SQL,
    SCHEMA_SQL, now_rfc3339,
};
use reqwest::blocking::Client;
use rusqlite::{Connection, params};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Parser)]
#[command(
    author,
    version,
    about = "Builds the Public EveJS market database from the latest station-only TQ market snapshot"
)]
struct Cli {
    #[arg(long, default_value = "config/market-seederv2.local.toml")]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Build(BuildArgs),
    SnapshotInfo,
    Doctor,
}

#[derive(Debug, Args)]
struct BuildArgs {
    #[arg(long, help = "Replace an existing output database without prompting")]
    yes: bool,
    #[arg(
        long,
        help = "Reuse a cached download when it matches the latest index size"
    )]
    reuse_download: bool,
    #[arg(long, hide = true)]
    limit_orders: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct SeederConfig {
    #[serde(default)]
    input: InputConfig,
    #[serde(default)]
    output: OutputConfig,
    #[serde(default)]
    source: SourceConfig,
    #[serde(default)]
    build: BuildConfig,
}

#[derive(Debug, Clone, Deserialize)]
struct InputConfig {
    #[serde(default = "default_static_data_dir")]
    static_data_dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
struct OutputConfig {
    #[serde(default = "default_database_path")]
    database_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
struct SourceConfig {
    #[serde(default = "default_index_url")]
    index_url: String,
    #[serde(default = "default_download_dir")]
    download_dir: PathBuf,
    #[serde(default = "default_user_agent")]
    user_agent: String,
}

#[derive(Debug, Clone, Deserialize)]
struct BuildConfig {
    #[serde(default = "default_sqlite_cache_size_kib")]
    sqlite_cache_size_kib: i32,
    #[serde(default = "default_sqlite_page_size_bytes")]
    sqlite_page_size_bytes: u32,
    #[serde(default = "default_sqlite_worker_threads")]
    sqlite_worker_threads: usize,
    #[serde(default = "default_insert_batch_rows")]
    insert_batch_rows: u64,
}

impl Default for SeederConfig {
    fn default() -> Self {
        Self {
            input: InputConfig::default(),
            output: OutputConfig::default(),
            source: SourceConfig::default(),
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

impl Default for SourceConfig {
    fn default() -> Self {
        Self {
            index_url: default_index_url(),
            download_dir: default_download_dir(),
            user_agent: default_user_agent(),
        }
    }
}

impl Default for BuildConfig {
    fn default() -> Self {
        Self {
            sqlite_cache_size_kib: default_sqlite_cache_size_kib(),
            sqlite_page_size_bytes: default_sqlite_page_size_bytes(),
            sqlite_worker_threads: default_sqlite_worker_threads(),
            insert_batch_rows: default_insert_batch_rows(),
        }
    }
}

impl SeederConfig {
    fn load(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path).with_context(|| {
            format!(
                "failed to read market-seederv2 config at {}",
                path.to_string_lossy()
            )
        })?;
        let config = toml::from_str::<Self>(&raw).with_context(|| {
            format!(
                "failed to parse market-seederv2 config at {}",
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

fn default_index_url() -> String {
    "https://data.everef.net/market-orders/index.json".to_string()
}

fn default_download_dir() -> PathBuf {
    PathBuf::from("cache")
}

fn default_user_agent() -> String {
    "PublicEveJS market-seederv2/0.1".to_string()
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

fn default_insert_batch_rows() -> u64 {
    100_000
}

#[derive(Debug, Deserialize)]
struct EveRefIndex {
    files: Vec<EveRefIndexFile>,
}

#[derive(Debug, Clone, Deserialize)]
struct EveRefIndexFile {
    name: String,
    url: String,
    size: u64,
    last_modified: String,
    etag: String,
    #[serde(default)]
    r#type: String,
}

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
struct StaticData {
    regions: Vec<RegionRow>,
    solar_systems: Vec<SolarSystemRecord>,
    stations: Vec<StationRecord>,
    item_types: Vec<ItemTypeRecord>,
    station_ids: BTreeSet<u64>,
    market_type_ids: BTreeSet<u32>,
}

#[derive(Debug, Deserialize)]
struct EveRefOrderRow {
    duration: u32,
    is_buy_order: bool,
    issued: String,
    location_id: u64,
    #[serde(default)]
    min_volume: u64,
    order_id: i64,
    price: f64,
    #[serde(rename = "range", default)]
    range_value: String,
    #[serde(deserialize_with = "csv::invalid_option")]
    system_id: Option<u32>,
    type_id: u32,
    volume_remain: u64,
    volume_total: u64,
    http_last_modified: String,
    #[serde(deserialize_with = "csv::invalid_option")]
    station_id: Option<u64>,
    #[serde(deserialize_with = "csv::invalid_option")]
    region_id: Option<u32>,
    #[serde(deserialize_with = "csv::invalid_option")]
    constellation_id: Option<u32>,
}

#[derive(Debug, Default)]
struct ImportStats {
    source_rows: u64,
    station_orders: u64,
    sell_orders: u64,
    buy_orders: u64,
    mirror_order_rows: u64,
    seed_sell_rows: u64,
    seed_buy_rows: u64,
    raw_sell_quantity: u64,
    raw_buy_quantity: u64,
    seed_sell_quantity: u64,
    seed_buy_quantity: u64,
    structure_orders_dropped: u64,
    unknown_type_orders_skipped: u64,
    zero_quantity_orders_skipped: u64,
    invalid_price_orders_skipped: u64,
    min_http_last_modified: Option<String>,
    max_http_last_modified: Option<String>,
    regions: BTreeSet<u32>,
    systems: BTreeSet<u32>,
    stations: BTreeSet<u64>,
    types: BTreeSet<u32>,
}

#[derive(Debug, Clone)]
struct SeedLiquidityAccumulator {
    station_id: u64,
    solar_system_id: u32,
    constellation_id: u32,
    region_id: u32,
    type_id: u32,
    price_cents: i64,
    quantity: u64,
}

impl SeedLiquidityAccumulator {
    fn new(
        station_id: u64,
        solar_system_id: u32,
        constellation_id: u32,
        region_id: u32,
        type_id: u32,
        price_cents: i64,
        quantity: u64,
    ) -> Self {
        Self {
            station_id,
            solar_system_id,
            constellation_id,
            region_id,
            type_id,
            price_cents,
            quantity,
        }
    }

    fn absorb_sell_order(&mut self, price_cents: i64, quantity: u64) {
        if price_cents < self.price_cents {
            self.price_cents = price_cents;
            self.quantity = quantity;
        } else if price_cents == self.price_cents {
            self.quantity = self.quantity.saturating_add(quantity);
        }
    }

    fn absorb_buy_order(&mut self, price_cents: i64, quantity: u64) {
        if price_cents > self.price_cents {
            self.price_cents = price_cents;
            self.quantity = quantity;
        } else if price_cents == self.price_cents {
            self.quantity = self.quantity.saturating_add(quantity);
        }
    }

    fn price(&self) -> f64 {
        self.price_cents as f64 / 100.0
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let config = SeederConfig::load(&cli.config)?;

    match cli.command {
        Command::Build(args) => build_database(&config, args),
        Command::SnapshotInfo => print_snapshot_info(&config),
        Command::Doctor => doctor(&config),
    }
}

fn build_database(config: &SeederConfig, args: BuildArgs) -> Result<()> {
    let started = Instant::now();
    print_banner();

    let client = build_http_client(&config.source.user_agent)?;
    let source_file = fetch_latest_source_file(&client, config)?;
    print_source_file(&source_file);

    let database_path = &config.output.database_path;
    if database_path.exists() {
        confirm_replace_database(database_path, args.yes)?;
    }

    let static_data = load_static_data(config)?;
    println!(
        "{} {} regions, {} systems, {} stations, {} market types",
        style("[static]").cyan().bold(),
        format_count(static_data.regions.len()),
        format_count(static_data.solar_systems.len()),
        format_count(static_data.stations.len()),
        format_count(static_data.item_types.len())
    );

    let download_path = download_snapshot(&client, config, &source_file, args.reuse_download)?;

    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let staging_path = staged_database_path(database_path);
    remove_existing_database_files(&staging_path)?;

    let mut connection = open_build_connection(
        &staging_path,
        config.build.sqlite_cache_size_kib,
        config.build.sqlite_page_size_bytes,
        config.build.sqlite_worker_threads,
    )?;

    write_static_tables(&mut connection, &static_data)?;
    let import_stats = import_station_orders(
        &mut connection,
        &static_data,
        &download_path,
        config.build.insert_batch_rows.max(1),
        args.limit_orders,
    )?;

    rebuild_region_summaries(&mut connection)?;
    rebuild_system_seed_summaries(&mut connection)?;
    write_manifest(
        &connection,
        config,
        &source_file,
        &static_data,
        &import_stats,
    )?;
    build_runtime_indexes(&mut connection)?;
    finalize_database(&connection)?;
    drop(connection);

    install_built_database(&staging_path, database_path)?;

    print_import_summary(
        database_path,
        &source_file,
        &import_stats,
        started.elapsed(),
    )?;
    Ok(())
}

fn print_snapshot_info(config: &SeederConfig) -> Result<()> {
    print_banner();
    let client = build_http_client(&config.source.user_agent)?;
    let source_file = fetch_latest_source_file(&client, config)?;
    print_source_file(&source_file);
    println!(
        "{} Run build to download and inspect the per-order HTTP timestamp range.",
        style("[info]").cyan().bold()
    );
    Ok(())
}

fn doctor(config: &SeederConfig) -> Result<()> {
    print_banner();
    let database_path = &config.output.database_path;
    if !database_path.exists() {
        bail!(
            "market database not found at {}",
            database_path.to_string_lossy()
        );
    }

    let connection = Connection::open(database_path)?;
    let manifest_raw = connection
        .query_row(
            "SELECT value FROM manifest WHERE key = ?1",
            params![MANIFEST_KEY],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "{}".to_string());

    let counts = json!({
        "database": database_path,
        "fileSizeBytes": fs::metadata(database_path)?.len(),
        "marketOrders": count_rows(&connection, "market_orders")?,
        "tqMirrorOrders": count_rows(&connection, "tq_mirror_orders")?,
        "seedStockRows": count_rows(&connection, "seed_stock")?,
        "seedBuyRows": count_rows(&connection, "seed_buy_orders")?,
        "seedStockQuantity": sum_quantity(&connection, "seed_stock")?,
        "seedBuyQuantity": sum_quantity(&connection, "seed_buy_orders")?,
        "regionSummaryRows": count_rows(&connection, "region_summaries")?,
        "systemSummaryRows": count_rows(&connection, "system_seed_summaries")?,
        "manifest": serde_json::from_str::<serde_json::Value>(&manifest_raw).unwrap_or_else(|_| json!({}))
    });
    println!("{}", serde_json::to_string_pretty(&counts)?);
    Ok(())
}

fn print_banner() {
    println!();
    println!(
        "{}",
        style("============================================================").cyan()
    );
    println!(
        "{}",
        style("  Public EveJS Market Seeder v2 - TQ Station Snapshot").bold()
    );
    println!(
        "{}",
        style("============================================================").cyan()
    );
    println!();
}

fn build_http_client(user_agent: &str) -> Result<Client> {
    Client::builder()
        .user_agent(user_agent)
        .timeout(StdDuration::from_secs(300))
        .build()
        .context("failed to build HTTP client")
}

fn fetch_latest_source_file(client: &Client, config: &SeederConfig) -> Result<EveRefIndexFile> {
    let spinner = spinner("Fetching EVE Ref market-order index");
    let index = client
        .get(&config.source.index_url)
        .send()
        .context("failed to fetch EVE Ref market order index")?
        .error_for_status()
        .context("EVE Ref market order index returned an error")?
        .json::<EveRefIndex>()
        .context("failed to parse EVE Ref market order index")?;
    spinner.finish_with_message("Fetched EVE Ref market-order index");

    index
        .files
        .into_iter()
        .filter(|file| {
            file.r#type == "market-orders"
                || (file.name.contains("market-orders-latest") && file.name.ends_with(".csv.bz2"))
        })
        .max_by(|left, right| left.last_modified.cmp(&right.last_modified))
        .ok_or_else(|| anyhow!("EVE Ref index did not contain a market-orders CSV snapshot"))
}

fn print_source_file(source_file: &EveRefIndexFile) {
    println!(
        "{} latest file: {}",
        style("[source]").green().bold(),
        style(&source_file.name).bold()
    );
    println!(
        "{} published: {}",
        style("[source]").green().bold(),
        style(&source_file.last_modified).yellow().bold()
    );
    println!(
        "{} size: {}  etag: {}",
        style("[source]").green().bold(),
        format_bytes(source_file.size),
        source_file.etag
    );
    println!(
        "{} url: {}",
        style("[source]").green().bold(),
        source_file.url
    );
    println!();
}

fn download_snapshot(
    client: &Client,
    config: &SeederConfig,
    source_file: &EveRefIndexFile,
    reuse_download: bool,
) -> Result<PathBuf> {
    fs::create_dir_all(&config.source.download_dir)?;
    let cache_name = format!(
        "{}.{}",
        source_file.name.trim_end_matches(".bz2"),
        source_file.etag.replace('"', "")
    );
    let download_path = config.source.download_dir.join(format!("{cache_name}.bz2"));

    if reuse_download && download_path.exists() {
        let cached_size = fs::metadata(&download_path)?.len();
        if cached_size == source_file.size {
            println!(
                "{} using cached snapshot {}",
                style("[download]").cyan().bold(),
                download_path.to_string_lossy()
            );
            return Ok(download_path);
        }
    }

    println!(
        "{} downloading latest snapshot",
        style("[download]").cyan().bold()
    );
    let mut response = client
        .get(&source_file.url)
        .send()
        .with_context(|| format!("failed to download {}", source_file.url))?
        .error_for_status()
        .with_context(|| format!("snapshot download returned an error: {}", source_file.url))?;

    let total_size = response.content_length().unwrap_or(source_file.size);
    let progress = download_progress_bar("Download", total_size);
    let temp_path = download_path.with_extension("bz2.part");
    let mut output = BufWriter::new(File::create(&temp_path)?);
    let mut buffer = [0u8; 128 * 1024];
    let mut downloaded = 0u64;
    loop {
        let read = response.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read])?;
        downloaded += read as u64;
        progress.set_position(downloaded.min(total_size));
    }
    output.flush()?;
    progress.finish_with_message(format!(
        "Downloaded {} ({})",
        download_path.to_string_lossy(),
        format_bytes(downloaded)
    ));
    fs::rename(&temp_path, &download_path)?;
    Ok(download_path)
}

fn load_static_data(config: &SeederConfig) -> Result<StaticData> {
    let spinner = spinner("Loading Public EveJS static market authority data");
    let static_dir = &config.input.static_data_dir;
    let mut stations =
        read_json_file::<StationsFile>(&static_dir.join("stations").join("data.json"))?.stations;
    let mut solar_systems =
        read_json_file::<SolarSystemsFile>(&static_dir.join("solarSystems").join("data.json"))?
            .solar_systems;
    let mut item_types =
        read_json_file::<ItemTypesFile>(&static_dir.join("itemTypes").join("data.json"))?
            .item_types;

    stations.sort_by_key(|station| station.station_id);
    solar_systems.sort_by_key(|system| system.solar_system_id);
    item_types.sort_by_key(|item| item.type_id);

    let station_ids = stations
        .iter()
        .map(|station| station.station_id)
        .collect::<BTreeSet<_>>();
    let market_type_ids = item_types
        .iter()
        .map(|item| item.type_id)
        .collect::<BTreeSet<_>>();

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

    spinner.finish_with_message("Loaded Public EveJS static market authority data");
    Ok(StaticData {
        regions,
        solar_systems,
        stations,
        item_types,
        station_ids,
        market_type_ids,
    })
}

fn read_json_file<T>(path: &Path) -> Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    let raw = fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.to_string_lossy()))?;
    serde_json::from_str::<T>(&raw)
        .with_context(|| format!("failed to parse {}", path.to_string_lossy()))
}

fn confirm_replace_database(database_path: &Path, yes: bool) -> Result<()> {
    if yes {
        println!(
            "{} replacing existing database: {}",
            style("[confirm]").yellow().bold(),
            database_path.to_string_lossy()
        );
        return Ok(());
    }

    println!(
        "{} existing seeded market database detected:",
        style("[confirm]").yellow().bold()
    );
    println!("  {}", database_path.to_string_lossy());
    if let Ok(metadata) = fs::metadata(database_path) {
        println!("  size: {}", format_bytes(metadata.len()));
    }
    println!();
    print!("Type OVERWRITE to replace it, or anything else to stop: ");
    io::stdout().flush()?;
    let mut answer = String::new();
    io::stdin().read_line(&mut answer)?;
    if answer.trim() != "OVERWRITE" {
        bail!("database replacement cancelled");
    }
    Ok(())
}

fn remove_existing_database_files(database_path: &Path) -> Result<()> {
    for path in database_family_paths(database_path) {
        if path.exists() {
            fs::remove_file(&path)
                .with_context(|| format!("failed to remove {}", path.to_string_lossy()))?;
        }
    }
    Ok(())
}

fn staged_database_path(database_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.building", database_path.to_string_lossy()))
}

fn backup_database_path(database_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.previous", database_path.to_string_lossy()))
}

fn install_built_database(staging_path: &Path, database_path: &Path) -> Result<()> {
    let backup_path = backup_database_path(database_path);
    remove_existing_database_files(&backup_path)?;

    if database_path.exists() {
        fs::rename(database_path, &backup_path).with_context(|| {
            format!(
                "failed to stage existing database backup {}",
                backup_path.to_string_lossy()
            )
        })?;
    }
    for sidecar in [
        PathBuf::from(format!("{}-wal", database_path.to_string_lossy())),
        PathBuf::from(format!("{}-shm", database_path.to_string_lossy())),
    ] {
        if sidecar.exists() {
            fs::remove_file(&sidecar)
                .with_context(|| format!("failed to remove {}", sidecar.to_string_lossy()))?;
        }
    }

    if let Err(error) = fs::rename(staging_path, database_path) {
        if backup_path.exists() && !database_path.exists() {
            let _ = fs::rename(&backup_path, database_path);
        }
        return Err(error).with_context(|| {
            format!(
                "failed to install built database {}",
                database_path.to_string_lossy()
            )
        });
    }

    remove_existing_database_files(&backup_path)?;
    remove_existing_database_files(staging_path)?;
    Ok(())
}

fn database_family_paths(database_path: &Path) -> Vec<PathBuf> {
    vec![
        database_path.to_path_buf(),
        PathBuf::from(format!("{}-wal", database_path.to_string_lossy())),
        PathBuf::from(format!("{}-shm", database_path.to_string_lossy())),
    ]
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

fn write_static_tables(connection: &mut Connection, static_data: &StaticData) -> Result<()> {
    let total_rows = (static_data.regions.len()
        + static_data.solar_systems.len()
        + static_data.stations.len()
        + static_data.item_types.len()) as u64;
    let progress = row_progress_bar("Static tables", total_rows);
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
        for region in &static_data.regions {
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
        for system in &static_data.solar_systems {
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
        for station in &static_data.stations {
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
               type_id, group_id, category_id, market_group_id, name, group_name,
               base_price, volume, portion_size, published
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )?;
        for item_type in &static_data.item_types {
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
    progress.finish_with_message(format!(
        "Static tables wrote {} rows",
        format_count(total_rows)
    ));
    Ok(())
}

fn import_station_orders(
    connection: &mut Connection,
    static_data: &StaticData,
    snapshot_path: &Path,
    progress_step: u64,
    limit_orders: Option<u64>,
) -> Result<ImportStats> {
    println!(
        "{} streaming station-only orders from {}",
        style("[import]").cyan().bold(),
        snapshot_path.to_string_lossy()
    );
    let spinner = spinner("Importing TQ station orders");
    let input = File::open(snapshot_path)
        .with_context(|| format!("failed to open {}", snapshot_path.to_string_lossy()))?;
    let decoder = BzDecoder::new(BufReader::new(input));
    let mut reader = csv::Reader::from_reader(decoder);
    let mut stats = ImportStats::default();
    let mut sell_liquidity = BTreeMap::<(u64, u32), SeedLiquidityAccumulator>::new();
    let mut buy_liquidity = BTreeMap::<(u64, u32), SeedLiquidityAccumulator>::new();

    {
        let transaction = connection.transaction()?;
        let mut mirror_statement = transaction.prepare(
            "INSERT OR REPLACE INTO tq_mirror_orders (
               order_id, region_id, station_id, solar_system_id, constellation_id, type_id,
               is_buy_order, price, volume_remain, volume_total, min_volume, range_value,
               issued_at, duration_days, seen_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;

        for result in reader.deserialize::<EveRefOrderRow>() {
            let row = result?;
            stats.source_rows += 1;

            if row.volume_remain == 0 {
                stats.zero_quantity_orders_skipped += 1;
                continue;
            }

            let Some(station_id) = row.station_id else {
                stats.structure_orders_dropped += 1;
                continue;
            };

            if row.location_id != station_id {
                stats.structure_orders_dropped += 1;
                continue;
            }

            if !static_data.station_ids.contains(&station_id) {
                stats.structure_orders_dropped += 1;
                continue;
            }

            let (Some(system_id), Some(region_id), Some(constellation_id)) =
                (row.system_id, row.region_id, row.constellation_id)
            else {
                stats.structure_orders_dropped += 1;
                continue;
            };

            if !static_data.market_type_ids.contains(&row.type_id) {
                stats.unknown_type_orders_skipped += 1;
                continue;
            }

            let price_cents = price_to_cents(row.price);
            if price_cents <= 0 {
                stats.invalid_price_orders_skipped += 1;
                continue;
            }

            let range_value = if row.range_value.is_empty() {
                "region"
            } else {
                row.range_value.as_str()
            };
            mirror_statement.execute(params![
                row.order_id,
                region_id,
                station_id,
                system_id,
                constellation_id,
                row.type_id,
                if row.is_buy_order { 1 } else { 0 },
                row.price,
                sqlite_quantity(row.volume_remain),
                sqlite_quantity(row.volume_total),
                sqlite_quantity(row.min_volume.max(1)),
                range_value,
                &row.issued,
                row.duration,
                &row.http_last_modified,
            ])?;
            stats.mirror_order_rows += 1;

            let key = (station_id, row.type_id);
            if row.is_buy_order {
                stats.raw_buy_quantity = stats.raw_buy_quantity.saturating_add(row.volume_remain);
                buy_liquidity
                    .entry(key)
                    .and_modify(|entry| entry.absorb_buy_order(price_cents, row.volume_remain))
                    .or_insert_with(|| {
                        SeedLiquidityAccumulator::new(
                            station_id,
                            system_id,
                            constellation_id,
                            region_id,
                            row.type_id,
                            price_cents,
                            row.volume_remain,
                        )
                    });
            } else {
                stats.raw_sell_quantity = stats.raw_sell_quantity.saturating_add(row.volume_remain);
                sell_liquidity
                    .entry(key)
                    .and_modify(|entry| entry.absorb_sell_order(price_cents, row.volume_remain))
                    .or_insert_with(|| {
                        SeedLiquidityAccumulator::new(
                            station_id,
                            system_id,
                            constellation_id,
                            region_id,
                            row.type_id,
                            price_cents,
                            row.volume_remain,
                        )
                    });
            }

            stats.station_orders += 1;
            if row.is_buy_order {
                stats.buy_orders += 1;
            } else {
                stats.sell_orders += 1;
            }
            stats.regions.insert(region_id);
            stats.systems.insert(system_id);
            stats.stations.insert(station_id);
            stats.types.insert(row.type_id);
            update_timestamp_bounds(&mut stats, &row.http_last_modified);

            if stats.station_orders % progress_step == 0 {
                spinner.set_message(format!(
                    "Imported {} station orders, mirrored {} raw orders, dropped {} structure orders",
                    format_count(stats.station_orders),
                    format_count(stats.mirror_order_rows),
                    format_count(stats.structure_orders_dropped)
                ));
            }

            if limit_orders.is_some_and(|limit| stats.station_orders >= limit) {
                break;
            }
        }

        drop(mirror_statement);
        transaction.commit()?;
    }

    stats.seed_sell_rows = sell_liquidity.len() as u64;
    stats.seed_buy_rows = buy_liquidity.len() as u64;
    stats.seed_sell_quantity = sell_liquidity
        .values()
        .map(|row| row.quantity)
        .fold(0u64, u64::saturating_add);
    stats.seed_buy_quantity = buy_liquidity
        .values()
        .map(|row| row.quantity)
        .fold(0u64, u64::saturating_add);
    write_seed_liquidity(connection, &sell_liquidity, &buy_liquidity)?;
    spinner.finish_with_message(format!(
        "Converted {} TQ station orders into {} seeded liquidity rows and mirrored {} raw orders",
        format_count(stats.station_orders),
        format_count(stats.seed_sell_rows + stats.seed_buy_rows),
        format_count(stats.mirror_order_rows)
    ));
    Ok(stats)
}

fn write_seed_liquidity(
    connection: &mut Connection,
    sell_liquidity: &BTreeMap<(u64, u32), SeedLiquidityAccumulator>,
    buy_liquidity: &BTreeMap<(u64, u32), SeedLiquidityAccumulator>,
) -> Result<()> {
    let total_rows = (sell_liquidity.len() + buy_liquidity.len()) as u64;
    let progress = row_progress_bar("Seed liquidity", total_rows);
    let seeded_at = now_rfc3339();
    let transaction = connection.transaction()?;

    {
        let mut statement = transaction.prepare(
            "INSERT INTO seed_stock (
               station_id, solar_system_id, constellation_id, region_id,
               type_id, price, quantity, initial_quantity, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)",
        )?;
        for row in sell_liquidity.values() {
            let quantity = sqlite_quantity(row.quantity);
            statement.execute(params![
                row.station_id,
                row.solar_system_id,
                row.constellation_id,
                row.region_id,
                row.type_id,
                row.price(),
                quantity,
                &seeded_at,
            ])?;
            progress.inc(1);
        }
    }

    {
        let mut statement = transaction.prepare(
            "INSERT INTO seed_buy_orders (
               station_id, solar_system_id, constellation_id, region_id,
               type_id, price, quantity, initial_quantity, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)",
        )?;
        for row in buy_liquidity.values() {
            let quantity = sqlite_quantity(row.quantity);
            statement.execute(params![
                row.station_id,
                row.solar_system_id,
                row.constellation_id,
                row.region_id,
                row.type_id,
                row.price(),
                quantity,
                &seeded_at,
            ])?;
            progress.inc(1);
        }
    }

    transaction.commit()?;
    progress.finish_with_message(format!(
        "Seed liquidity wrote {} rows",
        format_count(total_rows)
    ));
    Ok(())
}

fn update_timestamp_bounds(stats: &mut ImportStats, value: &str) {
    if stats
        .min_http_last_modified
        .as_ref()
        .is_none_or(|current| value < current.as_str())
    {
        stats.min_http_last_modified = Some(value.to_string());
    }
    if stats
        .max_http_last_modified
        .as_ref()
        .is_none_or(|current| value > current.as_str())
    {
        stats.max_http_last_modified = Some(value.to_string());
    }
}

fn price_to_cents(price: f64) -> i64 {
    if !price.is_finite() || price <= 0.0 {
        return 0;
    }
    (price * 100.0).round().clamp(0.0, i64::MAX as f64) as i64
}

fn sqlite_quantity(quantity: u64) -> i64 {
    i64::try_from(quantity).unwrap_or(i64::MAX)
}

fn rebuild_region_summaries(connection: &mut Connection) -> Result<()> {
    let spinner = spinner("Rebuilding region summaries from seeded TQ liquidity");
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM region_summaries", [])?;
    let updated_at = now_rfc3339();
    transaction.execute(
        "INSERT INTO region_summaries (
           region_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
           best_bid_price, total_bid_quantity, best_bid_station_id, updated_at
         )
         WITH sell_agg AS (
           SELECT region_id, type_id, MIN(price) AS best_ask_price, SUM(quantity) AS total_ask_quantity
           FROM seed_stock
           WHERE quantity > 0
           GROUP BY region_id, type_id
         ),
         sell_station AS (
           SELECT seed.region_id, seed.type_id, MIN(seed.station_id) AS station_id
           FROM seed_stock AS seed
           JOIN sell_agg
             ON sell_agg.region_id = seed.region_id
            AND sell_agg.type_id = seed.type_id
            AND sell_agg.best_ask_price = seed.price
           WHERE seed.quantity > 0
           GROUP BY seed.region_id, seed.type_id
         ),
         buy_agg AS (
           SELECT region_id, type_id, MAX(price) AS best_bid_price, SUM(quantity) AS total_bid_quantity
           FROM seed_buy_orders
           WHERE quantity > 0
           GROUP BY region_id, type_id
         ),
         buy_station AS (
           SELECT seed.region_id, seed.type_id, MIN(seed.station_id) AS station_id
           FROM seed_buy_orders AS seed
           JOIN buy_agg
             ON buy_agg.region_id = seed.region_id
            AND buy_agg.type_id = seed.type_id
            AND buy_agg.best_bid_price = seed.price
           WHERE seed.quantity > 0
           GROUP BY seed.region_id, seed.type_id
         ),
         keys AS (
           SELECT region_id, type_id FROM sell_agg
           UNION
           SELECT region_id, type_id FROM buy_agg
         )
         SELECT
           keys.region_id,
           keys.type_id,
           sell_agg.best_ask_price,
           COALESCE(sell_agg.total_ask_quantity, 0),
           sell_station.station_id,
           buy_agg.best_bid_price,
           COALESCE(buy_agg.total_bid_quantity, 0),
           buy_station.station_id,
           ?1
         FROM keys
         LEFT JOIN sell_agg
           ON sell_agg.region_id = keys.region_id AND sell_agg.type_id = keys.type_id
         LEFT JOIN sell_station
           ON sell_station.region_id = keys.region_id AND sell_station.type_id = keys.type_id
         LEFT JOIN buy_agg
           ON buy_agg.region_id = keys.region_id AND buy_agg.type_id = keys.type_id
         LEFT JOIN buy_station
           ON buy_station.region_id = keys.region_id AND buy_station.type_id = keys.type_id",
        params![updated_at],
    )?;
    transaction.commit()?;
    spinner.finish_with_message("Rebuilt region summaries");
    Ok(())
}

fn rebuild_system_seed_summaries(connection: &mut Connection) -> Result<()> {
    let spinner = spinner("Rebuilding system summaries from seeded TQ liquidity");
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM system_seed_summaries", [])?;
    let updated_at = now_rfc3339();
    transaction.execute(
        "INSERT INTO system_seed_summaries (
           solar_system_id, type_id, best_ask_price, total_ask_quantity, best_ask_station_id,
           best_bid_price, total_bid_quantity, best_bid_station_id, updated_at
         )
         WITH sell_agg AS (
           SELECT solar_system_id, type_id, MIN(price) AS best_ask_price, SUM(quantity) AS total_ask_quantity
           FROM seed_stock
           WHERE quantity > 0
           GROUP BY solar_system_id, type_id
         ),
         sell_station AS (
           SELECT seed.solar_system_id, seed.type_id, MIN(seed.station_id) AS station_id
           FROM seed_stock AS seed
           JOIN sell_agg
             ON sell_agg.solar_system_id = seed.solar_system_id
            AND sell_agg.type_id = seed.type_id
            AND sell_agg.best_ask_price = seed.price
           WHERE seed.quantity > 0
           GROUP BY seed.solar_system_id, seed.type_id
         ),
         buy_agg AS (
           SELECT solar_system_id, type_id, MAX(price) AS best_bid_price, SUM(quantity) AS total_bid_quantity
           FROM seed_buy_orders
           WHERE quantity > 0
           GROUP BY solar_system_id, type_id
         ),
         buy_station AS (
           SELECT seed.solar_system_id, seed.type_id, MIN(seed.station_id) AS station_id
           FROM seed_buy_orders AS seed
           JOIN buy_agg
             ON buy_agg.solar_system_id = seed.solar_system_id
            AND buy_agg.type_id = seed.type_id
            AND buy_agg.best_bid_price = seed.price
           WHERE seed.quantity > 0
           GROUP BY seed.solar_system_id, seed.type_id
         ),
         keys AS (
           SELECT solar_system_id, type_id FROM sell_agg
           UNION
           SELECT solar_system_id, type_id FROM buy_agg
         )
         SELECT
           keys.solar_system_id,
           keys.type_id,
           sell_agg.best_ask_price,
           COALESCE(sell_agg.total_ask_quantity, 0),
           sell_station.station_id,
           buy_agg.best_bid_price,
           COALESCE(buy_agg.total_bid_quantity, 0),
           buy_station.station_id,
           ?1
         FROM keys
         LEFT JOIN sell_agg
           ON sell_agg.solar_system_id = keys.solar_system_id AND sell_agg.type_id = keys.type_id
         LEFT JOIN sell_station
           ON sell_station.solar_system_id = keys.solar_system_id AND sell_station.type_id = keys.type_id
         LEFT JOIN buy_agg
           ON buy_agg.solar_system_id = keys.solar_system_id AND buy_agg.type_id = keys.type_id
         LEFT JOIN buy_station
           ON buy_station.solar_system_id = keys.solar_system_id AND buy_station.type_id = keys.type_id",
        params![updated_at],
    )?;
    transaction.commit()?;
    spinner.finish_with_message("Rebuilt system summaries");
    Ok(())
}

fn write_manifest(
    connection: &Connection,
    config: &SeederConfig,
    _source_file: &EveRefIndexFile,
    static_data: &StaticData,
    stats: &ImportStats,
) -> Result<()> {
    let manifest = MarketManifest {
        schema_version: MARKET_SCHEMA_VERSION,
        generated_at: now_rfc3339(),
        static_data_dir: config.input.static_data_dir.to_string_lossy().to_string(),
        database_path: config.output.database_path.to_string_lossy().to_string(),
        selection_mode: "tq_station_seed_liquidity".to_string(),
        selection_label: "Latest public TQ station market snapshot as seeded liquidity".to_string(),
        selected_solar_system_ids: Vec::new(),
        selected_solar_system_names: Vec::new(),
        region_count: static_data.regions.len() as u32,
        solar_system_count: static_data.solar_systems.len() as u32,
        station_count: static_data.stations.len() as u32,
        market_type_count: static_data.item_types.len() as u32,
        seed_row_count: stats.seed_sell_rows + stats.seed_buy_rows,
        default_quantity_per_station_type: 0,
        seed_buy_orders_enabled: stats.seed_buy_rows > 0,
        history_days_seeded: 0,
        seed_markup_percent: 0.0,
        station_jitter_percent: 0.0,
        region_jitter_percent: 0.0,
    };
    let raw = serde_json::to_string_pretty(&manifest)?;
    connection.execute(
        "INSERT OR REPLACE INTO manifest (key, value) VALUES (?1, ?2)",
        params![MANIFEST_KEY, raw],
    )?;
    Ok(())
}

fn build_runtime_indexes(connection: &mut Connection) -> Result<()> {
    let spinner = spinner("Building runtime indexes");
    connection.execute_batch(RUNTIME_INDEX_SQL)?;
    spinner.finish_with_message("Built runtime indexes");
    Ok(())
}

fn finalize_database(connection: &Connection) -> Result<()> {
    let spinner = spinner("Finalizing SQLite database");
    connection.pragma_update(None, "analysis_limit", 10_000)?;
    connection.execute_batch("ANALYZE;")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    spinner.finish_with_message("Finalized SQLite database");
    Ok(())
}

fn print_import_summary(
    database_path: &Path,
    source_file: &EveRefIndexFile,
    stats: &ImportStats,
    elapsed: StdDuration,
) -> Result<()> {
    println!();
    println!(
        "{}",
        style("TQ station snapshot converted to seeded liquidity.")
            .green()
            .bold()
    );
    println!(
        "{} {}",
        style("Database:").bold(),
        database_path.to_string_lossy()
    );
    println!(
        "{} {}",
        style("Snapshot file published:").bold(),
        style(&source_file.last_modified).yellow().bold()
    );
    println!(
        "{} {} -> {}",
        style("Order page timestamps:").bold(),
        stats
            .min_http_last_modified
            .as_deref()
            .unwrap_or(&source_file.last_modified),
        style(
            stats
                .max_http_last_modified
                .as_deref()
                .unwrap_or(&source_file.last_modified)
        )
        .yellow()
        .bold()
    );
    println!(
        "{} {} station orders read ({} sells, {} buys)",
        style("Accepted:").bold(),
        format_count(stats.station_orders),
        format_count(stats.sell_orders),
        format_count(stats.buy_orders)
    );
    println!(
        "{} {} raw station orders stored in tq_mirror_orders",
        style("Mirror:").bold(),
        format_count(stats.mirror_order_rows)
    );
    println!(
        "{} {} sell seed rows, {} buy seed rows",
        style("Seed rows:").bold(),
        format_count(stats.seed_sell_rows),
        format_count(stats.seed_buy_rows)
    );
    let collapsed_sell_rows = stats.sell_orders.saturating_sub(stats.seed_sell_rows);
    let collapsed_buy_rows = stats.buy_orders.saturating_sub(stats.seed_buy_rows);
    println!(
        "{} {} sell rows, {} buy rows collapsed by station/type seed compatibility",
        style("Collapsed:").bold(),
        format_count(collapsed_sell_rows),
        format_count(collapsed_buy_rows)
    );
    println!(
        "{} raw sells {}, seeded top-ask sells {}; raw buys {}, seeded top-bid buys {}",
        style("Quantity:").bold(),
        format_count(stats.raw_sell_quantity),
        format_count(stats.seed_sell_quantity),
        format_count(stats.raw_buy_quantity),
        format_count(stats.seed_buy_quantity)
    );
    println!(
        "{} {} structure/non-station orders dropped, {} unknown-type, {} zero-quantity, {} invalid-price",
        style("Filtered:").bold(),
        format_count(stats.structure_orders_dropped),
        format_count(stats.unknown_type_orders_skipped),
        format_count(stats.zero_quantity_orders_skipped),
        format_count(stats.invalid_price_orders_skipped)
    );
    println!(
        "{} {} regions, {} systems, {} stations, {} types",
        style("Coverage:").bold(),
        format_count(stats.regions.len()),
        format_count(stats.systems.len()),
        format_count(stats.stations.len()),
        format_count(stats.types.len())
    );
    println!("{} {:.2}s", style("Elapsed:").bold(), elapsed.as_secs_f64());
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "ok": true,
            "database": database_path,
            "sourceUrl": source_file.url,
            "sourceLastModified": source_file.last_modified,
            "snapshotMinHttpLastModified": stats.min_http_last_modified,
            "snapshotMaxHttpLastModified": stats.max_http_last_modified,
            "stationOrders": stats.station_orders,
            "sellOrders": stats.sell_orders,
            "buyOrders": stats.buy_orders,
            "tqMirrorOrders": stats.mirror_order_rows,
            "seedSellRows": stats.seed_sell_rows,
            "seedBuyRows": stats.seed_buy_rows,
            "collapsedSellRows": collapsed_sell_rows,
            "collapsedBuyRows": collapsed_buy_rows,
            "rawSellQuantity": stats.raw_sell_quantity,
            "rawBuyQuantity": stats.raw_buy_quantity,
            "seedSellQuantity": stats.seed_sell_quantity,
            "seedBuyQuantity": stats.seed_buy_quantity,
            "structureOrdersDropped": stats.structure_orders_dropped,
            "unknownTypeOrdersSkipped": stats.unknown_type_orders_skipped,
            "zeroQuantityOrdersSkipped": stats.zero_quantity_orders_skipped,
            "invalidPriceOrdersSkipped": stats.invalid_price_orders_skipped,
            "elapsedSeconds": (elapsed.as_secs_f64() * 100.0).round() / 100.0,
        }))?
    );
    Ok(())
}

fn spinner(message: &str) -> ProgressBar {
    let spinner = ProgressBar::new_spinner();
    spinner.enable_steady_tick(StdDuration::from_millis(120));
    spinner.set_style(
        ProgressStyle::with_template("{spinner:.cyan} {msg}")
            .unwrap_or_else(|_| ProgressStyle::default_spinner()),
    );
    spinner.set_message(message.to_string());
    spinner
}

fn download_progress_bar(message: &str, total: u64) -> ProgressBar {
    let bar = ProgressBar::new(total.max(1));
    bar.set_style(
        ProgressStyle::with_template(
            "  [{bar:36.cyan/blue}] {percent:>3}% | {msg} | {bytes}/{total_bytes} | eta {eta_precise}",
        )
        .unwrap_or_else(|_| ProgressStyle::default_bar())
        .progress_chars("=> "),
    );
    bar.set_message(message.to_string());
    bar
}

fn row_progress_bar(message: &str, total: u64) -> ProgressBar {
    let bar = ProgressBar::new(total.max(1));
    bar.set_style(
        ProgressStyle::with_template(
            "  [{bar:36.cyan/blue}] {percent:>3}% | {msg} | {pos}/{len} rows | eta {eta_precise}",
        )
        .unwrap_or_else(|_| ProgressStyle::default_bar())
        .progress_chars("=> "),
    );
    bar.set_message(message.to_string());
    bar
}

fn count_rows(connection: &Connection, table: &str) -> Result<u64> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    Ok(connection.query_row(&sql, [], |row| row.get(0))?)
}

fn sum_quantity(connection: &Connection, table: &str) -> Result<u64> {
    let sql = format!("SELECT COALESCE(SUM(quantity), 0) FROM {table}");
    Ok(connection.query_row(&sql, [], |row| row.get(0))?)
}

fn format_bytes(value: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    const GIB: f64 = MIB * 1024.0;
    let value_f = value as f64;
    if value_f >= GIB {
        format!("{:.2} GiB", value_f / GIB)
    } else if value_f >= MIB {
        format!("{:.2} MiB", value_f / MIB)
    } else if value_f >= KIB {
        format!("{:.2} KiB", value_f / KIB)
    } else {
        format!("{value} B")
    }
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
