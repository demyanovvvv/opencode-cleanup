import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import type { CleanupPlan } from "../cleanup/plan.js"

export type MaintenanceJob = {
  id: string
  databasePath: string
  databaseCanonicalPath: string
  schemaSignature: string
  plan: CleanupPlan
  operations: { archiveDetached: boolean; deleteSessions: boolean; vacuum: boolean }
  managedRoot: string
  backupPath: string
  archivePath: string
  expectedDatabaseFingerprint: string
  createdAt: string
  state: "queued" | "running" | "completed" | "failed" | "cancelled"
  reportPath?: string
}

export async function saveJob(path: string, job: MaintenanceJob): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(job, null, 2), { encoding: "utf8", flag: "wx" })
  await rename(temp, path)
}

export async function loadJob(path: string): Promise<MaintenanceJob> {
  return JSON.parse(await readFile(path, "utf8")) as MaintenanceJob
}
