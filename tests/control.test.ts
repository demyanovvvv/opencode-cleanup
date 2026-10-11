import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerJob, stopRegisteredJobs, jobIsCancelled, pluginStateDirectory } from "../src/maintenance/control.js"
import { executeMaintenance } from "../src/maintenance/executor.js"

test("uninstall cancels registered queued jobs in custom data roots before clearing state", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-cleanup-control-"))
  try {
    const config = join(root, "config"), data = join(root, "custom-data")
    await mkdir(data, { recursive: true })
    const jobPath = join(data, "opencode-cleanup-job.json")
    await writeFile(jobPath, JSON.stringify({ id: "test-job", state: "queued" }))
    await registerJob(config, jobPath)
    await stopRegisteredJobs(config, [])
    assert.equal(await jobIsCancelled(jobPath), true)
    assert.equal(JSON.parse(await readFile(jobPath, "utf8")).state, "cancelled")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("cancelled execution returns actual zero changes before opening a database", async () => {
  const report = await executeMaintenance({ databasePath: "missing.db", managedRoot: ".", backupPath: "backup.db", archivePath: "archive.gz", plan: { fingerprint: "test", deleteIds: [], protectedIds: [], reasonById: new Map(), removedBytes: 0 }, deleteSessions: true, archiveDetached: true, vacuum: true, shouldCancel: async () => true })
  assert.equal(report.state, "cancelled")
  assert.equal(report.deletedSessions, 0)
  assert.equal(report.deletedEvents, 0)
  assert.equal(report.vacuumed, false)
})
