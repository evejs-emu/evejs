# Optional Market Setup

This guide is only for the optional standalone market system.

If you just want to boot EvEJS, log in, and fly around, you can skip this entire page.

## What The Optional Market Adds

The optional market path gives you:

- a separate fast market daemon
- seeded market stock
- faster market window reads
- a cleaner place for market persistence

## Before You Start

Make sure the normal setup already works first.

If you have not done that yet, go here:

- [SETUP.md](SETUP.md)

## The Easy Market Path

### 1. Build the seed database

Double-click:

```text
BuildMarketSeed.bat
```

For the easiest first build, choose:

```text
Jita + New Caldari
```

That is the best starter preset for quick builds and realistic testing.

### 2. Start the standalone market server

Double-click:

```text
StartMarketServer.bat
```

Choose the normal release option.

Leave that window open while you use EvEJS.

### 3. Start the main server

Double-click:

```text
StartServer.bat
```

Then choose:

```text
2 = Server + Play
```

## Do I Need Rust?

Only for the standalone market tools.

If Rust is missing, the market tools will tell you and stop. Install Rust, then run the same launcher again.

If you are not using the standalone market, you do not need Rust at all.

## Best First Preset

For most people, start with:

- `Jita + New Caldari`

Use a bigger seed only if you know you want it.

## When To Reseed

Run the seeder again if:

- you want a different preset
- you changed market seeder settings
- you want to refresh the generated market database

After reseeding, restart `StartMarketServer.bat` so it loads the new database.

## If The Market Looks Empty

Check these in order:

1. Did `BuildMarketSeed.bat` finish successfully?
2. Is `StartMarketServer.bat` still open?
3. Did you start the main server after the market server?

## More Help

- [MARKET_SEEDER.md](MARKET_SEEDER.md)
- [TOOLS.md](TOOLS.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
