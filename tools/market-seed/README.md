# EvEJS Market Seeder

This is the tool that builds the optional standalone market database.

If you only want to boot EvEJS and log in, you do not need this yet.

## The Friendly Version

From the repo root, double-click:

```text
BuildMarketSeed.bat
```

Then choose:

```text
Jita + New Caldari
```

That is the easiest first build.

After the seed finishes:

1. start `StartMarketServer.bat`
2. leave it open
3. start `StartServer.bat`

## What This Tool Builds

It creates the database used by the standalone market server.

In simple terms:

- no seed database = no useful standalone market
- finished seed database = the standalone market has stock and order data to serve

## Best First Choice

For most people:

- use `Jita + New Caldari`

It is faster than a full-universe seed and still gives you a very usable market area.

## The Main Menu Options

- `Full universe rebuild`
  Huge build, slower, larger output
- `Jita + New Caldari rebuild`
  Best normal choice
- `Quick smoke rebuild`
  Tiny validation build
- `Rebuild summaries only`
  Refreshes summary tables without a full reseed
- `Doctor`
  Checks the current market database state
- `Edit market seed config`
  Opens the config file in Notepad

## Config File

The seeder config lives here:

```text
tools/market-seed/config/market-seed.local.toml
```

## Seeded Buy Orders

If you want seeded buy orders too, edit:

```text
tools/market-seed/config/market-seed.local.toml
```

Change:

```toml
seed_buy_orders_enabled = false
```

to:

```toml
seed_buy_orders_enabled = true
```

Then rebuild the seed and restart `StartMarketServer.bat`.

## If Rust Is Missing

The tool will tell you and stop.

Install Rust, then run the same launcher again.

## Want The Full User Guide?

Open:

- [../../doc/MARKET_SEEDER.md](../../doc/MARKET_SEEDER.md)
- [../../doc/MARKET_SETUP.md](../../doc/MARKET_SETUP.md)

## Advanced Note

If you are a maintainer and want direct CLI access, the project still supports it, but the normal user path is the launcher above.
