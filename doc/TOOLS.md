# Tools And Admin Basics

This page explains the `tools/` folder in normal human language.

If you are just here to play, you only need a small part of it.

## Tools Most People Will Actually Use

### `tools\ClientSETUP`

Use this for first-time setup.

Launcher:

```text
tools\ClientSETUP\StartClientSetup.bat
```

This is the main setup wizard. It is the most important tool in the repo for normal users.

### `tools\ConfigEditor`

Use this if you want to edit local server settings or local data through a desktop window.

Launcher:

```text
tools\ConfigEditor\OpenServerConfig.bat
```

Good for:

- changing local server settings
- adjusting local data without digging through files by hand

### `tools\market-seed`

Use this only if you want the optional standalone market server.

Easy launcher:

```text
BuildMarketSeed.bat
```

Good for:

- building the market database
- rebuilding the seed after config changes
- using the Jita + New Caldari preset

### `tools\NewEdenStoreEditor`

Use this if you want to edit store content.

Launcher:

```text
tools\NewEdenStoreEditor\StartStoreEditor.bat
```

This tool needs Python 3.

## Tools Most Players Can Ignore

### `tools\ClientCodeGrabber`

This is a maintainer tool, not a normal player setup tool.

It is used for refreshing client reference/code snapshots for development work.

If you are just trying to set up EvEJS and play, you do not need it.

## The Simple Rule

If you are not sure what to use:

1. use `tools\ClientSETUP\StartClientSetup.bat`
2. use `StartServer.bat`
3. ignore the rest until you actually need them

## Related Guides

- [SETUP.md](SETUP.md)
- [LAUNCHERS.md](LAUNCHERS.md)
- [MARKET_SETUP.md](MARKET_SETUP.md)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
