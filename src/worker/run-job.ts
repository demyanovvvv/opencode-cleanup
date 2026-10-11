import { writeFile, rm } from "node:fs/promises"
import { loadJob, saveJob } from "../maintenance/job.js"
import { executeMaintenance } from "../maintenance/executor.js"
import { assertInstallationEnabled, jobIsCancelled, registerJob } from "../maintenance/control.js"
import { openCodeProcesses } from "../platform/processes.js"
import { resolveConfigDirectory } from "../install/manager.js"

export async function runJob(jobPath: string, configDir = resolveConfigDirectory(), options: { isOpenCodeRunning?: () => Promise<boolean> } = {}) {
  const job = await loadJob(jobPath)
  if (job.state !== "queued") return { state: job.state, message: "Job is not queued; it will not be rerun" }
  await assertInstallationEnabled(configDir)
  await registerJob(configDir, jobPath)
  await saveJob(jobPath, { ...job, state: "running" })
  await writeFile(`${jobPath}.worker.json`, JSON.stringify({ owner: "opencode-cleanup", pid: process.pid, jobPath, startedAt: new Date().toISOString() }), { flag: "wx" })
  let signalled = false
  const cancel = () => { signalled = true }
  process.on("SIGTERM", cancel)
  process.on("SIGINT", cancel)
  try {
    // Queued persists while waiting; an uninstaller can cancel before startup.
    const report = await executeMaintenance({
      databasePath: job.databasePath, managedRoot: job.managedRoot, backupPath: job.backupPath, archivePath: job.archivePath,
      plan: job.plan, deleteSessions: job.operations.deleteSessions, archiveDetached: job.operations.archiveDetached,
      vacuum: job.operations.vacuum, expectedSchemaSignature: job.schemaSignature,
      expectedDatabaseFingerprint: job.expectedDatabaseFingerprint,
      isOpenCodeRunning: options.isOpenCodeRunning ?? (async () => (await openCodeProcesses()).length > 0),
      shouldCancel: async () => {
        if (signalled || await jobIsCancelled(jobPath)) return true
        try { await assertInstallationEnabled(configDir); return false } catch { return true }
      },
    })
    await writeFile(`${jobPath}.report.json`, JSON.stringify(report, null, 2))
    await saveJob(jobPath, { ...job, state: report.state, reportPath: `${jobPath}.report.json` })
    return report
  } finally {
    process.off("SIGTERM", cancel)
    process.off("SIGINT", cancel)
    await rm(`${jobPath}.worker.json`, { force: true })
  }
}
