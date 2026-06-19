# Launcher Guide

This is the "what should I click?" page.

If you do not want to guess which batch file matters, use this.

## The Only Two Buttons Most People Need

* `tools\\\\\\\\ClientSETUP\\\\\\\\StartClientSetup.bat`
* `StartServer.bat`

That is enough for normal setup and play.

## What Each Launcher Does

|Click this|Use it when|What it does|
|-|-|-|
|`tools\\\\\\\\ClientSETUP\\\\\\\\StartClientSetup.bat`|First-time setup|Walks you through client setup, certificate install, patching, and local-server config|
|`StartServer.bat`|Normal daily use|Starts the server, or starts the server and launches the client for you|
|`Play.bat`|You already started the server yourself|Launches only the client|
|`BuildMarketSeed.bat`|You want the optional standalone market|Builds or refreshes the market database|
|`StartMarketServer.bat`|You use the optional standalone market|Starts the separate market daemon|
|`tools\\\\\\\\ConfigEditor\\\\\\\\OpenServerConfig.bat`|You want to edit local config or player data|Opens the desktop config and database editor|
|`tools\\\\\\\\NewEdenStoreEditor\\\\\\\\StartStoreEditor.bat`|You want to edit store content|Opens the desktop New Eden Store editor|

## Best Choices By Situation

### I am brand new

Click:

```text
tools\\\\\\\\ClientSETUP\\\\\\\\StartClientSetup.bat
```

Then:

```text
StartServer.bat
```

Choose `2`.

### I already set everything up before

Click:

```text
StartServer.bat
```

Choose:

* `1` if you only want the server
* `2` if you want the server and client together

### I already have the server running and only want to launch the game

Click:

```text
Play.bat
```

### I want the optional fast market

Click these in order:

1. `BuildMarketSeed.bat`
2. `StartMarketServer.bat`
3. `StartServer.bat`

### I want to edit server settings or data

Click:

```text
tools\\\\\\\\ConfigEditor\\\\\\\\OpenServerConfig.bat
```

### I want to edit the store

Click:

```text
tools\\\\\\\\NewEdenStoreEditor\\\\\\\\StartStoreEditor.bat
```

That tool needs Python 3 installed.

## Launchers Most Players Can Ignore

You usually do not need to touch:

* `PlayDebug.bat`
* `tools\\\\\\\\ClientCodeGrabber\\\\\\\\StartCodeGrabber.bat`

Those are more useful for debugging or project maintenance than normal play.

## Related Guides

* [SETUP.md](SETUP.md)
* [MARKET\_SETUP.md](MARKET_SETUP.md)
* [TOOLS.md](TOOLS.md)
* [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

