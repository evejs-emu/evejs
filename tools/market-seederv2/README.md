# Public EveJS Market Seeder v2

`market-seederv2` builds the standalone market-server SQLite database from the
latest public Tranquility market-order snapshot.

It intentionally keeps station markets only. Player-structure orders are dropped
because Public EveJS does not seed those TQ structures.

## Normal Run

From the repository root:

```text
BuildMarketSeedV2.bat
```

The tool fetches the latest EVE Ref market snapshot, prints the snapshot file
time and the order-page timestamp range, asks before replacing an existing
database, and writes:

- static region/system/station/type tables from `server/src/newDatabase/data`
- every TQ station buy/sell order whose type exists in Public EveJS itemTypes
  through the compatibility importer
- TQ sell liquidity into `seed_stock`
- TQ buy demand into `seed_buy_orders`
- raw accepted TQ station orders into `tq_mirror_orders` so the first live
  `tq on` compares snapshot-to-live instead of empty-to-live
- no TQ rows into `market_orders`, because that table is player/escrow-backed
  at runtime
- region summary tables for fast market browsing
- a Public-compatible manifest for the existing market daemon

`seed_stock` and `seed_buy_orders` are compatibility tables keyed by
`station_id + type_id`, not per-order snapshot tables. When multiple TQ orders
exist for the same station/type/side, v2 keeps the top-of-book price and the
quantity available at that exact top price. The build summary prints the raw
station-order count, the `tq_mirror_orders` count, and the smaller compatible
seed-row count so the collapse is visible.

## Direct CLI

```powershell
cd tools\market-seederv2
cargo run --release -- --config config/market-seederv2.local.toml build
```

For automation, pass `--yes` to overwrite the existing database without an
interactive prompt.
