import { backup, DatabaseSync } from "node:sqlite"
import { mkdir, stat } from "node:fs/promises"
import { dirname } from "node:path"

export async function verifiedSqliteBackup(sourcePath: string, targetPath: string): Promise<{ path: string; pages: number; bytes: number }> {
  await mkdir(dirname(targetPath), { recursive: true })
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    const pages = await backup(source, targetPath)
    const target = new DatabaseSync(targetPath, { readOnly: true })
    try {
      const result = target.prepare("PRAGMA quick_check").get() as { quick_check: string }
      if (result.quick_check !== "ok") throw new Error(`SQLite backup quick_check failed: ${result.quick_check}`)
    } finally { target.close() }
    return { path: targetPath, pages, bytes: (await stat(targetPath)).size }
  } finally { source.close() }
}
