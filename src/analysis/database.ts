import { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { formatBytes, percent } from "./format.js"

export type DatabaseIdentity = {
  path: string
  canonicalPath: string
  fileSize: number
  walSize: number
  shmSize: number
  device: number | bigint
  inode: number | bigint
  schemaSignature: string
  databaseFingerprint: string
}

export type PartStat = { type: string; count: number; logicalBytes: number; percent: number }
export type SessionStat = {
  id: string
  parentId: string | null
  title: string
  directory: string
  createdAt: number
  updatedAt: number
  messageCount: number
  partCount: number
  logicalBytes: number
}
export type DatabaseAnalysis = {
  identity: DatabaseIdentity
  tables: Record<string, number>
  sessions: SessionStat[]
  partStats: PartStat[]
  eventCount: number
  detachedEventAggregates: number
  pageCount: number
  pageSize: number
  freePages: number
  databaseBytes: number
  freeBytes: number
  filesystem: { sessionDiffBytes: number; snapshotBytes: number; toolOutputBytes: number; snapshotCount: number; sessionDiffCount: number }
}

const knownTables = ["session", "message", "part", "event", "event_sequence", "project", "todo", "session_input", "session_context_epoch"]

export function databaseFingerprint(db: DatabaseSync): string {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all()
  const counts = db.prepare("SELECT (SELECT COUNT(*) FROM session) AS sessions, (SELECT COUNT(*) FROM event) AS events, (SELECT page_count FROM pragma_page_count()) AS pages").get()
  return createHash("sha256").update(JSON.stringify({ rows, counts })).digest("hex")
}

function optionalCount(db: DatabaseSync, table: string): number {
  try { return Number((db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count) } catch { return 0 }
}

async function directoryStats(root: string) {
  async function walk(path: string): Promise<{ bytes: number; count: number }> {
    let bytes = 0, count = 0
    try {
      for (const entry of await (await import("node:fs/promises")).readdir(path, { withFileTypes: true })) {
        const target = join(path, entry.name)
        if (entry.isDirectory()) { const nested = await walk(target); bytes += nested.bytes; count += nested.count }
        else if (entry.isFile()) { bytes += (await stat(target)).size; count += 1 }
      }
    } catch { /* directory is optional */ }
    return { bytes, count }
  }
  const sessionDiff = await walk(join(root, "storage", "session_diff"))
  const snapshots = await walk(join(root, "snapshot"))
  const toolOutput = await walk(join(root, "tool-output"))
  return { sessionDiffBytes: sessionDiff.bytes, snapshotBytes: snapshots.bytes, toolOutputBytes: toolOutput.bytes, snapshotCount: snapshots.count, sessionDiffCount: sessionDiff.count }
}

export async function analyzeDatabase(path: string, options: { deep?: boolean } = {}): Promise<DatabaseAnalysis> {
  const canonicalPath = await realpath(path)
  const fileInfo = await stat(canonicalPath)
  const walInfo = await stat(`${canonicalPath}-wal`).catch(() => undefined)
  const shmInfo = await stat(`${canonicalPath}-shm`).catch(() => undefined)
  const db = new DatabaseSync(canonicalPath, { readOnly: true })
  try {
    db.exec("PRAGMA query_only = ON")
    const schemaRows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all() as { name: string; sql: string | null }[]
    const schemaSignature = createHash("sha256").update(JSON.stringify(schemaRows)).digest("hex")
    const fingerprint = databaseFingerprint(db)
    const pragma = db.prepare("SELECT page_count, page_size, freelist_count FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count()")
      .get() as { page_count: number; page_size: number; freelist_count: number }
    const sessions = db.prepare(`
      SELECT s.id, s.parent_id AS parentId, s.title, s.directory, s.time_created AS createdAt, s.time_updated AS updatedAt,
        (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS messageCount,
        (SELECT COUNT(*) FROM part p WHERE p.session_id = s.id) AS partCount,
        COALESCE((SELECT SUM(length(CAST(p.data AS BLOB))) FROM part p WHERE p.session_id = s.id), 0) AS logicalBytes
      FROM session s ORDER BY logicalBytes DESC, s.time_updated DESC${options.deep ? "" : " LIMIT 250"}
    `).all() as SessionStat[]
    const partStats = db.prepare(`
      SELECT COALESCE(json_extract(data, '$.type'), 'unknown') AS type, COUNT(*) AS count,
        COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS logicalBytes
      FROM part GROUP BY type ORDER BY logicalBytes DESC
    `).all() as Omit<PartStat, "percent">[]
    const totalPartBytes = partStats.reduce((sum, item) => sum + Number(item.logicalBytes), 0)
    const tables = Object.fromEntries(knownTables.map((table) => [table, optionalCount(db, table)]))
    const eventCount = tables.event ?? 0
    const detachedEventAggregates = Number((db.prepare("SELECT COUNT(*) AS count FROM event_sequence e LEFT JOIN session s ON s.id = e.aggregate_id WHERE s.id IS NULL").get() as { count: number }).count)
    const root = dirname(canonicalPath)
    return {
      identity: { path, canonicalPath, fileSize: fileInfo.size, walSize: walInfo?.size ?? 0, shmSize: shmInfo?.size ?? 0, device: fileInfo.dev, inode: fileInfo.ino, schemaSignature, databaseFingerprint: fingerprint },
      tables,
      sessions,
      partStats: partStats.map((item) => ({ ...item, percent: percent(Number(item.logicalBytes), totalPartBytes) })),
      eventCount,
      detachedEventAggregates,
      pageCount: pragma.page_count,
      pageSize: pragma.page_size,
      freePages: pragma.freelist_count,
      databaseBytes: pragma.page_count * pragma.page_size,
      freeBytes: pragma.freelist_count * pragma.page_size,
      filesystem: await directoryStats(root),
    }
  } finally { db.close() }
}

export function summarizeAnalysis(analysis: DatabaseAnalysis): string[] {
  const totalSessions = analysis.sessions.length
  return [
    `Database ${basename(analysis.identity.canonicalPath)}: ${formatBytes(analysis.identity.fileSize + analysis.identity.walSize)}`,
    `Sessions: ${totalSessions}  Events: ${analysis.eventCount}  Detached history: ${analysis.detachedEventAggregates}`,
    `Free SQLite pages: ${formatBytes(analysis.freeBytes)} (${percent(analysis.freePages, analysis.pageCount)}%)`,
  ]
}
