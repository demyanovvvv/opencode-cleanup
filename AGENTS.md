# opencode-cleanup development

Build an English-language OpenCode TUI plugin. Target the tested OpenCode
1.18.34 API, OpenTUI 0.4.5 and Solid 1.9.12. Use current official types, not
old community examples. Fetch current documentation when changing host APIs.

Read `.opencode/skills/opencode-tui-development/SKILL.md` for UI work and
`.opencode/skills/opencode-storage-maintenance/SKILL.md` for storage changes.

## Invariants

- Analysis is read-only; never migrate or create a user OpenCode database.
- Run expensive SQLite scans in a separate process, never in the TUI thread.
- A DB is identified by canonical path, file identity and schema signature.
  Show that identity to the user. Ambiguous/remote targets require an explicit
  database choice. An API session list is not a global DB session inventory.
- Disk bytes, logical UTF-8 payload bytes and process RAM are different metrics.
  Do not promise that logical deletions immediately shrink a SQLite file.
- Cleanup has a frozen preview and execution-time revalidation. Do not expand
  an approved plan after the preview. Protect current/busy/pinned/latest sessions
  and recursively protected descendants. Protect shared snapshots conservatively.
- All destructive changes run after OpenCode closes, with a verified SQLite
  backup and a verified streaming archive before any deletion.
- Event history is persistent source data. No session row does not imply garbage.
  Preserve identities, event sequences, unknown event types and provider metadata.
- Use parameterized SQL, foreign keys, bounded batches, transactions and real
  filesystem paths. Reject symlinks/junctions and files outside the managed root.
- Never delete WAL/SHM files manually or replace a DB file while clients use it.
- Cancel/timeout/error paths release workers and UI registrations. Interrupted
  jobs must report their actual committed changes; never blindly rerun them.
- Never run cleanup against the developer's real database as a test.

## Verification

Use meaningful tests with real temporary SQLite databases and directories.
Test stale plans, child protection, unknown schemas, archives, rollback,
unreferenced files, delayed jobs, interrupted execution and schema variants.
Run `npm run check`, `npm run test:tui`, and a built worker smoke check before
claiming completion. No subagents are needed for this project.

## Packaging

Export `./tui` with default `{ id, tui }`. Register palette commands with
`api.keymap.registerLayer`. Keep host Solid/OpenTUI packages external in the
build. Project skills are development guidance, not runtime plugin dependencies.
