import { DatabaseSync } from "node:sqlite"
import { analyzeDatabase, databaseFingerprint } from "../analysis/database.js"
import { archiveJsonLines, verifyArchive } from "./archive.js"
import { verifiedSqliteBackup } from "./backup.js"
import type { CleanupPlan } from "../cleanup/plan.js"
import { assertManagedPath } from "./paths.js"

export type ExecutionOptions = {
  databasePath: string
  managedRoot: string
  backupPath: string
  archivePath: string
  plan: CleanupPlan
  deleteSessions: boolean
  archiveDetached: boolean
  vacuum: boolean
  isOpenCodeRunning?: () => Promise<boolean>
  expectedSchemaSignature?: string
  expectedDatabaseFingerprint?: string
  shouldCancel?: () => Promise<boolean>
}

export type ExecutionReport = {
  state: "completed" | "failed" | "cancelled"
  planFingerprint: string
  actualFingerprint?: string
  archivedRecords: number
  deletedSessions: number
  deletedEvents: number
  vacuumed: boolean
  backupPath?: string
  archivePath?: string
  error?: string
}

class MaintenanceCancelled extends Error {}
async function waitUntilClosed(check: () => Promise<boolean>, checkCancel: () => Promise<void>, timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (await check()) {
    await checkCancel()
    if (Date.now() >= deadline) throw new Error("OpenCode did not close before the maintenance timeout")
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  await checkCancel()
}

export async function executeMaintenance(options: ExecutionOptions): Promise<ExecutionReport> {
  const report: ExecutionReport = { state: "failed", planFingerprint: options.plan.fingerprint, archivedRecords: 0, deletedSessions: 0, deletedEvents: 0, vacuumed: false }
  const checkCancel = async () => { if (await options.shouldCancel?.()) throw new MaintenanceCancelled("Maintenance cancelled") }
  try {
    await checkCancel()
    await assertManagedPath(options.managedRoot, options.databasePath)
    await assertManagedPath(options.managedRoot, options.backupPath)
    await assertManagedPath(options.managedRoot, options.archivePath)
    await waitUntilClosed(options.isOpenCodeRunning ?? (async () => false), checkCancel)
    const initial = await analyzeDatabase(options.databasePath, { deep: true })
    const initialDb = new DatabaseSync(options.databasePath, { readOnly: true })
    const actualFingerprint = databaseFingerprint(initialDb)
    initialDb.close()
    report.actualFingerprint = actualFingerprint
    if (options.expectedDatabaseFingerprint && actualFingerprint !== options.expectedDatabaseFingerprint) throw new Error("Cleanup plan is stale; refresh the preview before executing it")
    if (options.expectedSchemaSignature && initial.identity.schemaSignature !== options.expectedSchemaSignature) {
      throw new Error("Database schema changed since the cleanup preview")
    }
    await checkCancel()
    const backup = await verifiedSqliteBackup(options.databasePath, options.backupPath)
    report.backupPath = backup.path

    await checkCancel()
    const source = new DatabaseSync(options.databasePath)
    try {
      source.exec("PRAGMA foreign_keys = ON")
      const eventRows = options.archiveDetached
        ? source.prepare("SELECT e.id, e.aggregate_id AS aggregateId, e.seq, e.type, e.data FROM event e LEFT JOIN session s ON s.id = e.aggregate_id WHERE s.id IS NULL ORDER BY e.aggregate_id, e.seq").all()
        : []
      if (options.archiveDetached) {
        const archive = await archiveJsonLines(options.archivePath, eventRows)
        await verifyArchive(archive.path, archive.sha256, archive.recordCount)
        report.archivePath = archive.path
        report.archivedRecords = archive.recordCount
      }
      const liveFingerprint = databaseFingerprint(source)
      // The backup/archive are complete, but the source may have changed while
      // they ran. We can only proceed when the approved source is unchanged.
      if (liveFingerprint !== actualFingerprint || (options.expectedDatabaseFingerprint && liveFingerprint !== options.expectedDatabaseFingerprint)) throw new Error("Database changed while preparing maintenance; no deletion was committed")
      await checkCancel()
      source.exec("BEGIN IMMEDIATE")
      try {
        if (options.deleteSessions && options.plan.deleteIds.length) {
          const placeholders = options.plan.deleteIds.map(() => "?").join(",")
          const existing = source.prepare(`SELECT id FROM session WHERE id IN (${placeholders})`).all(...options.plan.deleteIds) as { id: string }[]
          for (const row of existing) {
            source.prepare("DELETE FROM event_sequence WHERE aggregate_id = ?").run(row.id)
            report.deletedEvents += Number(source.prepare("SELECT changes() AS count").get()?.count ?? 0)
            source.prepare("DELETE FROM session WHERE id = ?").run(row.id)
            report.deletedSessions += Number(source.prepare("SELECT changes() AS count").get()?.count ?? 0)
          }
        }
        if (options.archiveDetached && report.archivedRecords) {
          const detached = source.prepare("SELECT aggregate_id AS aggregateId FROM event_sequence e LEFT JOIN session s ON s.id = e.aggregate_id WHERE s.id IS NULL").all() as { aggregateId: string }[]
          for (const row of detached) {
            source.prepare("DELETE FROM event_sequence WHERE aggregate_id = ?").run(row.aggregateId)
            report.deletedEvents += Number(source.prepare("SELECT changes() AS count").get()?.count ?? 0)
          }
        }
        source.exec("COMMIT")
      } catch (error) {
        source.exec("ROLLBACK")
        report.deletedSessions = 0
        report.deletedEvents = 0
        throw error
      }
      await checkCancel()
      if (options.vacuum) {
        source.exec("VACUUM")
        report.vacuumed = true
      }
    } finally { source.close() }
    report.state = "completed"
    return report
  } catch (error) {
    if (error instanceof MaintenanceCancelled) report.state = "cancelled"
    report.error = error instanceof Error ? error.message : String(error)
    return report
  }
}
