import { access, mkdir, readFile, writeFile, readdir, rm, lstat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { loadJob } from "./job.js"

const exec = promisify(execFile)
export function pluginStateDirectory(configDir: string) { return join(configDir, "opencode-cleanup") }
const registryName = (jobPath: string) => createHash("sha256").update(resolve(jobPath)).digest("hex") + ".json"

export async function registerJob(configDir: string, jobPath: string): Promise<void> {
  const registry = join(pluginStateDirectory(configDir), "jobs")
  await mkdir(registry, { recursive: true })
  await writeFile(join(registry, registryName(jobPath)), JSON.stringify({ owner: "opencode-cleanup", jobPath: resolve(jobPath) }), { flag: "w" })
}
export async function assertInstallationEnabled(configDir: string): Promise<void> {
  try { await access(join(pluginStateDirectory(configDir), "enabled")) }
  catch { throw new Error("opencode-cleanup is not installed or is being uninstalled. Install it and restart OpenCode.") }
}
export async function jobIsCancelled(jobPath: string): Promise<boolean> {
  try { await access(`${jobPath}.cancel`); return true } catch { /* inspect job below */ }
  try { return (await loadJob(jobPath)).state === "cancelled" } catch { return true }
}
async function readJson(path: string) {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error }
}
async function assertPlainFile(path: string) {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  if (parent !== absolute) await assertPlainFile(parent)
  try { if ((await lstat(absolute)).isSymbolicLink()) throw new Error(`Refusing a symlinked job path: ${absolute}`) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
}
async function matchingWorker(pid: number, jobPath: string): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    const { stdout } = process.platform === "win32"
      ? await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`], { windowsHide: true, timeout: 10_000 })
      : await exec("ps", ["-p", String(pid), "-o", "args="], { timeout: 10_000 })
    return stdout.includes("run-job") && stdout.includes(jobPath)
  } catch { return false }
}

/** Cooperatively cancel workers; never kill a process using only an old PID. */
export async function stopRegisteredJobs(configDir: string, dataDirs: string[], timeoutMs = 60_000): Promise<void> {
  const state = pluginStateDirectory(configDir)
  await assertPlainFile(state)
  await assertPlainFile(join(state, "enabled"))
  await rm(join(state, "enabled"), { force: true })
  const paths = new Set(dataDirs.map((dir) => join(dir, "opencode-cleanup-job.json")))
  const registry = join(state, "jobs")
  try {
    for (const name of await readdir(registry)) if (name.endsWith(".json")) {
      const item = await readJson(join(registry, name))
      if (item?.owner === "opencode-cleanup" && typeof item.jobPath === "string") paths.add(item.jobPath)
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  for (const jobPath of paths) {
    await assertPlainFile(jobPath)
    const job = await readJson(jobPath)
    if (!job) continue
    if (job.state === "queued" || job.state === "running") {
      await assertPlainFile(`${jobPath}.cancel`)
      await writeFile(`${jobPath}.cancel`, "cancel\n")
      if (job.state === "queued") await writeFile(jobPath, JSON.stringify({ ...job, state: "cancelled" }, null, 2))
    }
    await assertPlainFile(`${jobPath}.worker.json`)
    const worker = await readJson(`${jobPath}.worker.json`)
    const pid = Number(worker?.pid)
    const deadline = Date.now() + timeoutMs
    while (await matchingWorker(pid, jobPath)) {
      if (Date.now() >= deadline) throw new Error("Maintenance is finishing its current operation. Cancellation is saved; retry uninstall after the worker exits.")
      await new Promise((done) => setTimeout(done, 250))
    }
  }
}

export async function removeRegisteredJobFiles(configDir: string): Promise<void> {
  const registry = join(pluginStateDirectory(configDir), "jobs")
  try {
    for (const name of await readdir(registry)) if (name.endsWith(".json")) {
      const item = await readJson(join(registry, name))
      if (item?.owner !== "opencode-cleanup" || typeof item.jobPath !== "string") continue
      // Only registered job and sidecar filenames, never the paths stored inside
      // a job's database/backup/archive fields.
      for (const path of [item.jobPath, `${item.jobPath}.cancel`, `${item.jobPath}.worker.json`, `${item.jobPath}.report.json`]) {
        await assertPlainFile(path)
        await rm(path, { force: true })
      }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
}
