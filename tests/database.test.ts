import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { analyzeDatabase } from "../src/analysis/database.js"

test("database analysis identifies schema, free pages, logical parts and detached history", async () => {
  const root = await mkdtemp("./cleanup-db-")
  const path = join(root, "opencode.db")
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL, directory TEXT NOT NULL, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL);
    CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE event_sequence(aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
    CREATE TABLE event(id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
    INSERT INTO session VALUES ('ses_root', NULL, 'Root', '.', 1, 2);
    INSERT INTO message VALUES ('msg_1', 'ses_root');
    INSERT INTO part VALUES ('part_1', 'msg_1', 'ses_root', '{"type":"reasoning","text":"x"}');
    INSERT INTO event_sequence VALUES ('ses_detached', 1);
    INSERT INTO event VALUES ('evt_1', 'ses_detached', 1, 'unknown.event', '{"provider":"keep"}');`)
  db.close()
  try {
    const analysis = await analyzeDatabase(path, { deep: true })
    assert.equal(analysis.sessions[0]?.id, "ses_root")
    assert.equal(analysis.partStats[0]?.type, "reasoning")
    assert.equal(analysis.detachedEventAggregates, 1)
    assert.equal(analysis.identity.schemaSignature.length, 64)
  } finally { await rm(root, { recursive: true, force: true }) }
})
