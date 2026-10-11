# Contributing

Thank you for helping improve opencode-cleanup. Check existing issues before reporting a problem or proposing a change. Use [SECURITY.md](SECURITY.md) for vulnerability reports.

## Development setup

Use the runtimes listed in [compatibility](docs/COMPATIBILITY.md), including Bun for the TUI renderer tests.

```bash
npm ci
npm run check
npm run test:tui
npm run smoke:worker
npm run smoke:installer
```

`check` runs type checking, Node tests and the build. TUI tests exercise the built entrypoint, so build before running them in isolation. Smoke checks use temporary SQLite databases and directories.

## Project structure

- `src/tui.tsx` and `src/tui/`: OpenCode plugin entrypoint and screens.
- `src/analysis/`: database inspection and formatting.
- `src/cleanup/`: session protection and cleanup planning.
- `src/maintenance/` and `src/worker/`: archives, backups and queued jobs.
- `src/install/`: installation, configuration editing and removal.
- `scripts/`: build, setup and built-artifact checks.
- `tests/`: automated checks.

Read [AGENTS.md](AGENTS.md) and the project development skills in `.opencode/skills/` before changing storage or TUI code. Fetch official host API documentation when changing integrations.

## Storage and UI invariants

Analysis must be read-only. Never run destructive tests against your own OpenCode database. Use real temporary databases and filesystem fixtures. Preserve durable event identities and unknown source data. Revalidate approved plans at execution time. Verify backups and streaming archives before mutation; execute destructive work after the host closes. Keep expensive scans outside the TUI thread.

Host Solid/OpenTUI dependencies must remain external. Exercise observable behavior rather than source-text assertions or placeholder tests. Clean up renderers, subprocesses and registrations on every exit path.

## Pull requests

Describe the problem, the behavior change and the verification performed. Keep changes focused, add meaningful regression coverage where needed and update user-facing documentation when behavior changes. Avoid including database contents, archives, credentials or machine-specific configuration.

Be respectful and constructive in issues and reviews. Follow the release checklist in [docs/RELEASING.md](docs/RELEASING.md) when preparing a release.
