import { analyzeDatabase } from "../analysis/database.js"
import { formatBytes } from "../analysis/format.js"
import { verifiedSqliteBackup } from "../maintenance/backup.js"
import { runJob } from "./run-job.js"

const args = process.argv.slice(2)
const command = args[0]
const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }

if (command === "analyze") {
  const path = value("--db")
  if (!path) throw new Error("Usage: opencode-cleanup analyze --db <path>")
  const result = await analyzeDatabase(path, { deep: args.includes("--deep") })
  console.log(JSON.stringify(result, (_, item) => typeof item === "bigint" ? Number(item) : item, 2))
} else if (command === "backup") {
  const source = value("--db")
  const target = value("--out")
  if (!source || !target) throw new Error("Usage: opencode-cleanup backup --db <path> --out <path>")
  const result = await verifiedSqliteBackup(source, target)
  console.log(`Backup verified: ${result.path} (${formatBytes(result.bytes)}, ${result.pages} pages)`)
} else if (command === "run-job") {
  const jobPath = value("--job")
  if (!jobPath) throw new Error("Usage: opencode-cleanup run-job --job <path>")
  const report = await runJob(jobPath, value("--config-dir"))
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.state === "failed" ? 1 : 0
} else {
  console.error("Usage: opencode-cleanup <analyze|backup|run-job> --db <path> [--out <path>] [--job <path>] [--deep]")
  process.exitCode = 2
}
