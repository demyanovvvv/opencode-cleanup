# opencode-cleanup

[Русский](README.ru.md)

An English-language TUI plugin for inspecting OpenCode storage and scheduling database maintenance from inside OpenCode.

## Features

- Dashboard for SQLite files, WAL/SHM, sessions, event history, snapshots, session diffs, tool output and OpenCode process memory.
- Session inspection and storage breakdown by part type.
- Database identity reporting: canonical path and schema signature.
- Background maintenance worker with verified SQLite backups and streaming, checksum-verified JSONL gzip archives.
- Installer that preserves other plugins and JSONC comments, plus a standalone uninstaller.

The selective-cleanup screen is a preliminary interface: it does not yet expose a complete filter, approval and execution flow. The maintenance command queues detached-history archiving and database compaction. Read [compatibility and limitations](docs/COMPATIBILITY.md) before use.

## Installation

Install Node.js and OpenCode with TUI plugin support. Detailed runtime requirements are listed in [compatibility](docs/COMPATIBILITY.md).

Download the ZIP from [GitHub Releases](https://github.com/demyanovvvv/opencode-cleanup/releases) and extract it. On Windows, double-click `install.cmd`. From the extracted directory on other platforms, run:

```bash
node scripts/setup.mjs install
```

Alternatively, clone the repository and run the installer from the checkout:

```bash
git clone https://github.com/demyanovvvv/opencode-cleanup.git
cd opencode-cleanup
npm run install:plugin
```

The source installer prepares dependencies and builds the plugin. The release ZIP already contains the compiled files. The installer registers the plugin in `tui.json` or `tui.jsonc` and prints its installed location. Quit and restart OpenCode after installation.

## Usage

Open the command palette with `Ctrl+P` and select:

| Command | Purpose |
| --- | --- |
| `Cleanup: Dashboard` | Storage overview and process memory |
| `Cleanup: Sessions` | Session list and logical payload sizes |
| `Cleanup: Analyze storage` | Part types and detached event-history counts |
| `Cleanup: Selective cleanup` | Preliminary session-protection interface |
| `Cleanup: Database maintenance` | Queue archival and compaction after OpenCode closes |

`Ctrl+Shift+O` opens the dashboard. Sub-screens have a clickable Back action.

Disk usage, logical UTF-8 payload size and process RAM are separate measurements. Deleting records does not immediately shrink a SQLite file; compaction is a separate operation. A detached event history is still persistent source data.

Before queueing maintenance, check the displayed database identity. After queueing, close OpenCode so the worker can proceed. Keep the generated backups, archives and job report until you have reviewed the result.

## Configuration

The installer respects `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `OPENCODE_TUI_CONFIG`. To select custom locations:

```bash
node scripts/setup.mjs install --config-dir "/path/to/config" --data-dir "/path/to/data"
```

Use `--config <file>` for a specific TUI configuration and `--source <directory>` for the package source. The database path comes from `OPENCODE_DB` when set, otherwise from the host state path. Prefer an explicit absolute database path when using custom storage.

## Uninstall

On Windows, double-click `uninstall.cmd`, or run from the extracted package or checkout:

```bash
node scripts/setup.mjs uninstall
```

The installed plugin directory also contains standalone `uninstall.cmd` and `uninstall.mjs` launchers, so removal remains possible without the original package folder.

The uninstaller removes plugin registrations, installed plugin files, settings and job registrations. It requests cancellation of queued workers and waits for them to exit. If a worker is still finishing its transaction after the timeout, retry removal afterward. **History archives and SQLite backups are preserved.** Quit and restart OpenCode to unload the plugin.

Windows launchers accept `--no-pause` for terminal use.

## Documentation

- [Compatibility and limitations](docs/COMPATIBILITY.md)
- [Contributing and development checks](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Support](SUPPORT.md)
- [Security reporting](SECURITY.md)
- [Release procedure](docs/RELEASING.md)

## License

[MIT](LICENSE)
