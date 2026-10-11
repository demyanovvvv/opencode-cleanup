import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { analyzeDatabase } from "../src/analysis/database.js"
import { buildCleanupPlan } from "../src/cleanup/plan.js"
import { executeMaintenance } from "../src/maintenance/executor.js"

test("maintenance archives detached events, backs up, deletes approved sessions and vacuums", async () => {
  const root = await mkdtemp("./cleanup-executor-")
  const dbPath = join(root, "opencode.db")
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL, directory TEXT NOT NULL, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE);
    CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE, session_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE event_sequence(aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL);
    CREATE TABLE event(id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
    INSERT INTO session VALUES ('ses_delete', NULL, 'Delete me', '.', 1, 2);
    INSERT INTO message VALUES ('msg_delete', 'ses_delete');
    INSERT INTO part VALUES ('part_delete', 'msg_delete', 'ses_delete', '{"type":"text","text":"keep test"}');
    INSERT INTO event_sequence VALUES ('ses_delete', 1);
    INSERT INTO event VALUES ('evt_delete', 'ses_delete', 1, 'session.updated', '{}');
    INSERT INTO event_sequence VALUES ('ses_detached', 1);
    INSERT INTO event VALUES ('evt_detached', 'ses_detached', 1, 'unknown.event', '{"provider":"keep"}');`)
  db.close()
  try {
    const analysis = await analyzeDatabase(dbPath, { deep: true })
    const plan = buildCleanupPlan([{ kind: "session", id: "ses_delete", parentId: null, title: "Delete me", updatedAt: 2, logicalBytes: 10, physicalBytes: 10 }], { selectedIds: new Set(["ses_delete"]), protectedIds: new Set(), currentSessionId: undefined, busySessionIds: new Set(), latestRootIds: new Set(), fingerprint: analysis.identity.databaseFingerprint })
    const report = await executeMaintenance({ databasePath: dbPath, managedRoot: root, backupPath: join(root, "backup.db"), archivePath: join(root, "history.jsonl.gz"), plan, deleteSessions: true, archiveDetached: true, vacuum: true, expectedDatabaseFingerprint: analysis.identity.databaseFingerprint })
    assert.equal(report.state, "completed")
    assert.equal(report.deletedSessions, 1)
    assert.equal(report.archivedRecords, 1)
    assert.equal((await stat(join(root, "backup.db"))).size > 0, true)
    const final = new DatabaseSync(dbPath, { readOnly: true })
    assert.equal((final.prepare("SELECT COUNT(*) AS count FROM session").get() as { count: number }).count, 0)
    assert.equal((final.prepare("SELECT COUNT(*) AS count FROM event_sequence").get() as { count: number }).count, 0)
    final.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})
