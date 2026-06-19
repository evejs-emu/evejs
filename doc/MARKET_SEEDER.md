# Market Seeder Guide

This guide explains the tool that builds the optional standalone market database.

The launcher for it is:

```text
BuildMarketSeed.bat
```

## What It Does

The seeder builds the market database used by the standalone market server.

In plain English:

- no seed database = no useful standalone market
- a fresh seed database = the standalone market has stock and data to serve

## The Easiest First Build

Double-click:

```text
BuildMarketSeed.bat
```

Then choose:

```text
Jita + New Caldari
```

That is the best default build for most people.

It is much faster than a full-universe build and still gives you a realistic market area to test with.

## The Main Options

- `Full universe rebuild`
  Biggest build. Takes longer and creates a much larger database.
- `Jita + New Caldari rebuild`
  Best first choice.
- `Quick smoke rebuild`
  Tiny test build used mostly for fast checks.
- `Rebuild summaries only`
  Refreshes summary tables without doing a full reseed.
- `Doctor`
  Checks the current market seed/database state.
- `Edit market seed config`
  Opens the seeder config file in Notepad.

## Where The Config Lives

The config file is:

```text
tools\market-seed\config\market-seed.local.toml
```

That is the file you edit if you want to change how the seeder behaves.

## How To Turn On Seeded Buy Orders

Open:

```text
tools\market-seed\config\market-seed.local.toml
```

Find:

```toml
seed_buy_orders_enabled = false
```

Change it to:

```toml
seed_buy_orders_enabled = true
```

Then build the seed again and restart `StartMarketServer.bat`.

## What Happens If I Run It Again?

Running a full build again replaces the previous generated market database with a new one.

It does not stack a second seed on top of the first.

## What Most People Should Do

If you are not sure which option to pick:

1. build `Jita + New Caldari`
2. start `StartMarketServer.bat`
3. start `StartServer.bat`

## If Rust Is Missing

The seeder will tell you and stop cleanly.

The easiest path here is:

```text
scripts\InstallRustForMarket.bat
```

Run that helper, let it finish installing Rust, then run the same market seeder launcher again.

## Related Guides

- [MARKET_SETUP.md](MARKET_SETUP.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
