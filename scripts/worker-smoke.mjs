import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "opencode-cleanup-built-worker-"));
const cli = fileURLToPath(new URL("../dist/worker/cli.js", import.meta.url));
try {
  const database = join(root, "opencode.db");
  const backup = join(root, "backup.db");
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
    CREATE TABLE event_sequence(aggregate_id TEXT PRIMARY KEY, seq INTEGER);
    CREATE TABLE event(id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT);
    INSERT INTO session VALUES ('ses_smoke', NULL, 'Built smoke', '.', 1, 2);`);
  db.close();
  const analysis = JSON.parse(execFileSync(process.execPath, [cli, "analyze", "--db", database], { encoding: "utf8" }));
  assert.equal(analysis.sessions[0].id, "ses_smoke");
  execFileSync(process.execPath, [cli, "backup", "--db", database, "--out", backup], { encoding: "utf8" });
  const copy = new DatabaseSync(backup, { readOnly: true });
  assert.equal(copy.prepare("SELECT count(*) AS n FROM session").get().n, 1);
  copy.close();
  console.log("Built worker smoke passed: read-only analysis and verified backup of a temporary SQLite DB.");
} finally { await rm(root, { recursive: true, force: true }); }
