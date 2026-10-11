import { spawn } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { saveJob, type MaintenanceJob } from "./job.js"
import { assertInstallationEnabled, registerJob } from "./control.js"
import { resolveConfigDirectory, withInstallationLock } from "../install/manager.js"
import { rm, readFile } from "node:fs/promises"

export async function queueMaintenance(jobPath: string, job: MaintenanceJob): Promise<void> {
  const configDir = resolveConfigDirectory()
  return withInstallationLock(configDir, async () => {
  await assertInstallationEnabled(configDir)
  await rm(`${jobPath}.cancel`, { force: true })
  await saveJob(jobPath, job)
  await registerJob(configDir, jobPath)
  await assertInstallationEnabled(configDir)
  const worker = fileURLToPath(new URL("../worker/cli.js", import.meta.url))
  const child = spawn("node", [worker, "run-job", "--job", jobPath, "--config-dir", configDir], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: dirname(jobPath),
  })
  await new Promise<void>((done, reject) => { child.once("spawn", done); child.once("error", reject) })
  // Do not release the installation lock until the worker registers its PID;
  // uninstall must never miss a process that has just been spawned.
  const deadline = Date.now() + 10_000
  while (true) {
    try { await readFile(`${jobPath}.worker.json`); break } catch { /* startup */ }
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill()
      throw new Error("Maintenance worker failed to register before startup timeout")
    }
    await new Promise((done) => setTimeout(done, 50))
  }
  child.unref()
  })
}

export function defaultJobPaths(databasePath: string) {
  const root = dirname(databasePath)
  return {
    managedRoot: root,
    jobPath: join(root, "opencode-cleanup-job.json"),
    backupPath: join(root, "opencode-cleanup-backups", "backup.db"),
    archivePath: join(root, "opencode-cleanup-archives", "detached-history.jsonl.gz"),
  }
}
