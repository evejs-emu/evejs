# EvEJS Setup

This is the first-time setup guide for the source-only GitHub tree.

## Requirements

- Windows.
- An internet connection.
- A copied EVE Online client for build `3396210`.
- No bundled client files or generated data in the repo.

You should not point EvEJS at the same EVE install you use for normal live play.
Make a copy first.

## One-Click Setup

Double-click:

```text
SetupEveJS.bat
```

The setup script will:

- install Node.js LTS with `winget` if Node is missing,
- run `npm ci`,
- run `npm --prefix server ci`,
- download CCP's public SDE JSONL archive for build `3396210`,
- generate local server data under `_local\newDatabase\data`,
- create local `test`, `test2`, and `GM Elysian` bootstrap records,
- open ClientSETUP so you can select and patch your copied EVE client.

The generated data stays under `_local/` and is ignored by Git.

## Daily Use

After setup:

1. Run `StartServer.bat`.
2. Choose option `2` for server plus client.

Choose option `1` if you want to start only the server.

## If Setup Fails

If Node.js installed but `node` is not found, open a new terminal or double-click
`SetupEveJS.bat` again after Windows refreshes `PATH`.

If database generation fails, rerun:

```bat
tools\DatabaseCreator\CreateDatabase.bat /force
```

If ClientSETUP says the client build is wrong, update or copy the supported EVE
client build and run ClientSETUP again.

## Release Hygiene

Before sharing source, run:

```bat
clean.bat
node tools\ReleaseGuard\verify-public-release.js
```

Do not share `client/`, `_local/`, `server/src/newDatabase/data/`, generated
certificates, private keys, patched DLLs, market databases, logs, or
`node_modules/`.
