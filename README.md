# Please do not use this repository, as it is outdated!
# refer to the discord: https://discord.gg/H5V77HZF9n

# EvEJS

EvEJS is a local EVE Online emulator for research, preservation, and private
experimentation with a user-supplied EVE client.

It is built for people who want to study EVE's systems, explore old-school
server behavior, and help improve parity against the live client.

Current compatibility target:

- EVE `24.01`
- Client build `3396210`
- Static-data compatibility point: June 16, 2026

## Quick Start

1. Download or clone this repository.
2. Make a separate copy of your EVE Online client.
3. Run `SetupEveJS.bat`.
4. Select your copied EVE client when ClientSETUP asks for it.
5. Run `StartServer.bat`.
6. Choose option `2` to start the server and launch the client.

The setup script installs the required Node packages, creates the local EvEJS
database, and opens ClientSETUP for the copied client.

## Included Test Accounts

The local setup creates two starter accounts:

- `test`
- `test2`

It also creates the local support character used by built-in HyperNet seed
support.

## Client Files

EvEJS does not include a patched `blue.dll`, an EVE client, or any CCP-owned
client files. You must provide your own legally obtained EVE Online client.

ClientSETUP is designed to work on a copied client folder, not your live EVE
install.

## Legal Notes

EvEJS is independent and unofficial. It is not affiliated with, endorsed by, or
approved by CCP Games.

EVE Online and related names, marks, assets, and data belong to their respective
owners. See `LEGAL.md`, `NOTICE.md`, `ACCEPTABLE_USE.md`, and
`THIRD_PARTY_NOTICES.md`.

## Documentation

- [Setup guide](doc/SETUP.md)
- [Launcher guide](doc/LAUNCHERS.md)
- [Optional market setup](doc/MARKET_SETUP.md)
- [Market seeder guide](doc/MARKET_SEEDER.md)
- [Troubleshooting](doc/TROUBLESHOOTING.md)
- [Tools and admin basics](doc/TOOLS.md)
