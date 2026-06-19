use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::config::RpcConfig;
use crate::state::MarketRuntime;

mod string_i64 {
    use serde::de::Error as _;
    use serde::{Deserialize, Deserializer};

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

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct RpcResponse {
    id: Value,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RegionParams {
    region_id: u32,
}

#[derive(Debug, Deserialize)]
struct SystemParams {
    solar_system_id: u32,
}

#[derive(Debug, Deserialize)]
struct StationParams {
    station_id: u64,
}

#[derive(Debug, Deserialize)]
struct OrdersParams {
    region_id: u32,
    type_id: u32,
}

#[derive(Debug, Deserialize)]
struct HistoryParams {
    type_id: u32,
}

#[derive(Debug, Deserialize)]
struct ManyHistoriesParams {
    type_ids: Vec<u32>,
}

#[derive(Debug, Deserialize)]
struct OwnerOrdersParams {
    owner_id: u64,
    #[serde(default)]
    is_corp: bool,
}

#[derive(Debug, Deserialize)]
struct CancelParams {
    #[serde(deserialize_with = "string_i64::deserialize")]
    order_id: i64,
}

#[derive(Debug, Deserialize)]
struct RebuildParams {
    region_id: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OrderEventsParams {
    #[serde(default)]
    #[serde(deserialize_with = "string_i64::deserialize")]
    after_event_id: i64,
    #[serde(default)]
    event_type: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

pub async fn serve(runtime: MarketRuntime, config: RpcConfig) -> Result<()> {
    let address = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&address)
        .await
        .with_context(|| format!("failed to bind market RPC listener on {address}"))?;
    info!("market RPC listening on tcp://{}", address);

    loop {
        let (stream, peer) = listener.accept().await?;
        let runtime = runtime.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_connection(runtime, stream).await {
                warn!(
                    "market RPC client {} disconnected with error: {}",
                    peer, error
                );
            }
        });
    }
}

async fn handle_connection(runtime: MarketRuntime, stream: TcpStream) -> Result<()> {
    let peer = stream.peer_addr().ok();
    let (reader, writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let writer = Arc::new(Mutex::new(writer));
    let mut line = String::new();

    loop {
        line.clear();
        let bytes_read = reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let payload = trimmed.to_string();
        let runtime = runtime.clone();
        let writer = writer.clone();
        tokio::spawn(async move {
            let response = match serde_json::from_str::<RpcRequest>(&payload) {
                Ok(request) => {
                    match dispatch_request(runtime, &request.method, request.params).await {
                        Ok(result) => RpcResponse {
                            id: request.id,
                            ok: true,
                            result: Some(result),
                            error: None,
                        },
                        Err(error) => RpcResponse {
                            id: request.id,
                            ok: false,
                            result: None,
                            error: Some(error.to_string()),
                        },
                    }
                }
                Err(error) => RpcResponse {
                    id: Value::Null,
                    ok: false,
                    result: None,
                    error: Some(format!("invalid RPC request: {error}")),
                },
            };

            match serde_json::to_vec(&response) {
                Ok(encoded) => {
                    let mut writer = writer.lock().await;
                    if let Err(error) = writer.write_all(&encoded).await {
                        warn!("market RPC response write failed: {}", error);
                        return;
                    }
                    if let Err(error) = writer.write_all(b"\n").await {
                        warn!("market RPC response newline write failed: {}", error);
                    }
                }
                Err(error) => {
                    warn!("market RPC response encode failed: {}", error);
                }
            }
        });
    }

    if let Some(peer) = peer {
        info!("market RPC connection closed for {}", peer);
    }

    Ok(())
}

async fn dispatch_request(runtime: MarketRuntime, method: &str, params: Value) -> Result<Value> {
    match method {
        "StartupCheck" => Ok(Value::Null),
        "Health" => Ok(json!({
          "status": "ok",
          "started_at": runtime.started_at,
          "database_path": runtime.database_path.to_string_lossy(),
        })),
        "GetManifest" => Ok(serde_json::to_value(&*runtime.manifest)?),
        "GetDiagnostics" => Ok(serde_json::to_value(runtime.diagnostics().await?)?),
        "GetRegionBest" => {
            let params = serde_json::from_value::<RegionParams>(params)?;
            Ok(serde_json::to_value(
                runtime.get_region_summary(params.region_id).await?,
            )?)
        }
        "GetSystemAsks" => {
            let params = serde_json::from_value::<SystemParams>(params)?;
            Ok(serde_json::to_value(
                runtime.get_system_summary(params.solar_system_id).await?,
            )?)
        }
        "GetStationAsks" => {
            let params = serde_json::from_value::<StationParams>(params)?;
            Ok(serde_json::to_value(
                runtime.get_station_summary(params.station_id).await?,
            )?)
        }
        "GetOrders" => {
            let params = serde_json::from_value::<OrdersParams>(params)?;
            Ok(serde_json::to_value(
                runtime
                    .get_order_book(params.region_id, params.type_id)
                    .await?,
            )?)
        }
        "GetOldPriceHistory" | "GetNewPriceHistory" | "GetHistory" => {
            let params = serde_json::from_value::<HistoryParams>(params)?;
            Ok(serde_json::to_value(
                runtime.get_history(params.type_id).await?,
            )?)
        }
        "GetHistories" => {
            let params = serde_json::from_value::<ManyHistoriesParams>(params)?;
            Ok(serde_json::to_value(
                runtime.get_histories(params.type_ids).await?,
            )?)
        }
        "GetOwnerOrders" | "GetCharOrders" | "GetCorporationOrders" => {
            let mut parsed = serde_json::from_value::<OwnerOrdersParams>(params)?;
            if method == "GetCorporationOrders" {
                parsed.is_corp = true;
            }
            if method == "GetCharOrders" {
                parsed.is_corp = false;
            }
            Ok(serde_json::to_value(
                runtime
                    .get_owner_orders(parsed.owner_id, parsed.is_corp)
                    .await?,
            )?)
        }
        "GetOrder" => {
            let params = serde_json::from_value::<CancelParams>(params)?;
            Ok(serde_json::to_value(
                runtime.get_order(params.order_id).await?,
            )?)
        }
        "PlaceOrder" | "PlaceBuyOrder" | "PlaceSellOrder" => Ok(serde_json::to_value(
            runtime.place_order(serde_json::from_value(params)?).await?,
        )?),
        "ModifyOrder" => Ok(serde_json::to_value(
            runtime
                .modify_order(serde_json::from_value::<market_common::ModifyOrderRequest>(
                    params,
                )?)
                .await?,
        )?),
        "CancelOrder" => {
            let params = serde_json::from_value::<CancelParams>(params)?;
            Ok(serde_json::to_value(
                runtime.cancel_order(params.order_id).await?,
            )?)
        }
        "FillOrder" => Ok(serde_json::to_value(
            runtime
                .fill_order(serde_json::from_value::<market_common::FillOrderRequest>(
                    params,
                )?)
                .await?,
        )?),
        "AdjustSeedStock" => Ok(serde_json::to_value(
            runtime
                .adjust_seed_stock(serde_json::from_value(params)?)
                .await?,
        )?),
        "RecordTrade" => Ok(serde_json::to_value(
            runtime
                .record_trade(serde_json::from_value::<market_common::RecordTradeRequest>(
                    params,
                )?)
                .await?,
        )?),
        "SweepExpiredOrders" => Ok(serde_json::to_value(runtime.sweep_expired_orders().await?)?),
        "GetOrderEvents" => {
            let params = serde_json::from_value::<OrderEventsParams>(params)?;
            Ok(serde_json::to_value(
                runtime
                    .get_order_events(
                        params.after_event_id,
                        params.event_type,
                        params.limit.unwrap_or(100),
                    )
                    .await?,
            )?)
        }
        "RebuildRegionSummaries" => {
            let params = serde_json::from_value::<RebuildParams>(params)?;
            Ok(serde_json::to_value(
                runtime.rebuild_region_summaries(params.region_id).await?,
            )?)
        }
        other => Err(anyhow!("unsupported market RPC method: {other}")),
    }
}
