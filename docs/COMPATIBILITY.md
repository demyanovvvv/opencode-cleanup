# Compatibility and limitations

## Runtime baseline

| Component | Requirement / tested baseline |
| --- | --- |
| Node.js | At least 22.16; local release checks use 22.22.2 |
| OpenCode | Tested API: 1.18.34; package range: `>=1.18.34 <2` |
| OpenTUI core and Solid renderer | 0.4.5 |
| SolidJS | 1.9.12 |
| Bun | Required for renderer tests; local baseline: 1.4.2 |

The package range is not a guarantee that every host release has been tested. OpenCode supplies the Solid/OpenTUI runtime; the plugin does not bundle another copy. Node's SQLite support may print an experimental-feature warning.

## Storage assumptions

The current analyzer expects a local SQLite schema with `session`, `message`, `part`, `event` and `event_sequence` tables. In particular, it reads session timestamps and parent IDs, `part.data`, and event aggregate IDs. Additional table counts are optional. Unknown core schema variants are not supported by this release.

The basic session query returns up to 250 entries; deep analysis reads the complete session list for this supported schema. The displayed list should not be treated as a global inventory of every OpenCode database or channel. Set `OPENCODE_DB` to an explicit absolute path for custom storage.

## Current limitations

- The selective-cleanup screen is preliminary. Its preview action does not build an executable user-approved selection; the maintenance screen does not request session deletion.
- Protection selection is not yet a complete persistent pinning workflow.
- The current TUI calls the analyzer directly; deep SQLite work is not yet isolated in an analysis subprocess. Large databases can affect interface responsiveness.
- The analyzer is schema-specific and does not support remote or ambiguous database discovery.
- Maintenance archives detached event records and compacts the database. The existing implementation also removes detached `event_sequence` entries after archival; it is not an archive-only operation. Event rows are not automatically classified as garbage.
- A queued worker waits for detected OpenCode processes to close. This is not a guarantee that unrelated SQLite clients have disconnected.
- Backups and archives use fixed default names under the database directory. Retain a separate copy of previous outputs before queueing another maintenance operation.

Disk bytes, logical payload bytes and process RAM are distinct. Session logical bytes count UTF-8 `part.data` payloads, not all associated history or physical storage. RAM is process-wide. SQLite deletions do not guarantee immediate file shrinkage; VACUUM is separate compaction.

These limitations are recorded explicitly so the first GitHub release does not imply a complete selective-cleanup workflow or universal schema support.
