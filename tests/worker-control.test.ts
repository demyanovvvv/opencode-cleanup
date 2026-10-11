import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"
import { stopRegisteredJobs, pluginStateDirectory } from "../src/maintenance/control.js"

test("uninstall waits for a real cancelled worker and does not let it open a missing database", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-cleanup-worker-"))
  try {
    const config = join(root, "config"), jobPath = join(root, "opencode-cleanup-job.json")
    await mkdir(pluginStateDirectory(config), { recursive: true })
    await writeFile(join(pluginStateDirectory(config), "enabled"), "installed")
    await writeFile(jobPath, JSON.stringify({ id: "worker-test", state: "queued", databasePath: join(root, "missing.db"), managedRoot: root, backupPath: join(root, "backup.db"), archivePath: join(root, "archive.gz"), plan: { fingerprint: "preview", deleteIds: [], protectedIds: [], removedBytes: 0 }, operations: { deleteSessions: false, archiveDetached: false, vacuum: false } }))
    const url = pathToFileURL(join(process.cwd(), "src", "worker", "run-job.ts")).href
    const code = `const { runJob } = await import(${JSON.stringify(url)}); await runJob(${JSON.stringify(jobPath)}, ${JSON.stringify(config)}, { isOpenCodeRunning: async () => true });`
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, "run-job", jobPath], { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const exited = new Promise<number | null>((done) => child.once("exit", done))
    const deadline = Date.now() + 8000
    while (true) {
      try {
        await readFile(`${jobPath}.worker.json`)
        assert.equal(JSON.parse(await readFile(jobPath, "utf8")).state, "running")
        break
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Worker failed to start: ${stderr}`)
      await new Promise((done) => setTimeout(done, 50))
    }
    await stopRegisteredJobs(config, [root], 8000)
    assert.equal(await exited, 0)
    const report = JSON.parse(await readFile(`${jobPath}.report.json`, "utf8"))
    assert.equal(report.state, "cancelled")
    assert.equal(report.deletedSessions, 0)
    assert.equal(JSON.parse(await readFile(jobPath, "utf8")).state, "cancelled")
  } finally { await rm(root, { recursive: true, force: true }) }
})
