---
name: opencode-storage-maintenance
description: Analyze and selectively clean OpenCode SQLite, event history and managed files with verified archives and delayed maintenance.
---

# OpenCode storage maintenance

## Analysis

Discover data roots via XDG_DATA_HOME, OPENCODE_DB and an explicit configured
path. Show all channel DB candidates, but never infer the active DB from size.
Open SQLite read-only. Inspect sqlite_master and table_info before querying.
Report legacy message/part and newer session_message separately from durable
event/event_sequence data. Use length(cast(data as blob)) for UTF-8 bytes.
Use page_count, page_size, freelist_count and optional dbstat for physical bytes.
Use limited scans and explicit deep analysis. RSS is process-wide, not per session.

## Cleanup

Preview exact session IDs, child closure, event aggregates, reasoning objects
and file identities. Filters combine with AND, with last activity as default age.
Pin protection is DB-scoped, persistent and reread by the maintenance worker.
A protected child prevents deleting its ancestor via a recursive host operation.

Run cleanup only after host processes exit and a quiet-period check succeeds.
Take a SQLite online backup, run quick_check on it, archive selected source
records to JSONL gzip and verify their digest/count. Then begin a write
transaction and revalidate the approved fingerprint before mutation.

Delete a session's events and dependent tables together. For reasoning cleanup,
redact only schema-understood text payloads in projections and corresponding
durable events; keep event IDs, sequence numbers, model/provider metadata and
other message content intact. Abort on malformed/unsupported affected records.
Never label detached event histories as disposable automatically.

Check file realpaths and reject symlinks/junctions, changed files and files
referenced by retained messages/events. Snapshot roots are shared by project;
never delete snapshots of a project with retained or protected history.

VACUUM is optional compaction, not deletion. Check disk space for backup,
archives and temporary DB pages. Never unlink a WAL to shrink a database.
Keep a durable job report and recover interrupted states without reapplying.

References:
- https://github.com/whtsky/ocgc
- https://github.com/anomalyco/opencode/tree/dev/packages/core/src/session
- https://github.com/anomalyco/opencode/blob/dev/packages/core/src/event.ts
- https://www.sqlite.org/backup.html
- https://www.sqlite.org/lang_vacuum.html
- https://www.sqlite.org/wal.html
