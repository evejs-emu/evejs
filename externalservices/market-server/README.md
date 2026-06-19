# EvEJS Standalone Market Server

This is the optional fast market daemon used by EvEJS.

Most people do **not** need to start here.

If you just want to get in-game, go back and use:

- `tools\ClientSETUP\StartClientSetup.bat`
- `StartServer.bat`

## What This Is For

The standalone market server exists so EvEJS can keep market reads and seeded market data in a separate fast process.

That gives you:

- faster market window reads
- seeded market stock
- a dedicated place for market persistence
- less pressure on the main Node server

## The Normal User Path

1. build a market seed with `BuildMarketSeed.bat`
2. start this daemon with `StartMarketServer.bat`
3. leave it running
4. start the main server with `StartServer.bat`

If you skip the seed build, this server will not have a useful market database to serve.

## What It Serves

By default it listens on:

- HTTP `127.0.0.1:40110`
- RPC `127.0.0.1:40111`

The EVE client still talks to the main EvEJS server. The main server bridges market traffic into this daemon.

## TQ Live Market Mirror

When the daemon is running, the market-server console accepts live TQ mirror
commands:

- `tq on` starts near-live station-only TQ mirroring.
- `tq off` stops the mirror after the current refresh cycle.
- `tq now` runs one refresh immediately.
- `tq status` shows the current mirror state.
- `tq help` prints the command list again.

The refresh interval and ESI source knobs live in `config/market-server.local.toml`
under `[tq_live]`. The default interval is `300` seconds. The on/off switch is
intentionally console-driven so the server can boot safely and you choose when
to begin talking to ESI.

The mirror updates the compatible seed tables, not player-owned market orders:

- TQ sell liquidity updates `seed_stock`.
- TQ buy demand updates `seed_buy_orders`.
- TQ raw order snapshots are retained in `tq_mirror_orders` for audit/debug.
- Local player consumption is tracked so a refresh does not blindly resurrect
  stock or demand already consumed on this server.

Each refresh prints a dashboard with changed orders, created/removed buys and
sells, volume movement, seed rows changed, regions scanned, page counts, and
structure orders dropped.

## The Good News

You usually do not need to know any internal endpoint details to use it.

If the launcher starts and stays open, that is the important part.

## If Rust Is Missing

The launcher will tell you and stop.

Install Rust, then run `StartMarketServer.bat` again.

## Want The Friendly Setup Guide?

Open:

- [../../doc/MARKET_SETUP.md](../../doc/MARKET_SETUP.md)
- [../../doc/MARKET_SEEDER.md](../../doc/MARKET_SEEDER.md)

## Useful Truth

This daemon is optional.

The main EvEJS server can still boot without it. You only need it if you want the separate standalone market experience.
