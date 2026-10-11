import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { platform } from "node:os"

const exec = promisify(execFile)
export type ProcessMemory = { pid: number; name: string; rssBytes: number; privateBytes?: number }

export async function openCodeProcesses(): Promise<ProcessMemory[]> {
  if (platform() === "win32") {
    try {
      const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Process -Name opencode -ErrorAction SilentlyContinue | ConvertTo-Json -Compress"], { windowsHide: true })
      const parsed = JSON.parse(stdout || "[]") as Record<string, unknown> | Record<string, unknown>[]
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      return rows.map((row) => ({ pid: Number(row.Id), name: String(row.ProcessName ?? "opencode"), rssBytes: Number(row.WorkingSet64 ?? 0), privateBytes: Number(row.PrivateMemorySize64 ?? 0) }))
    } catch { return [] }
  }
  try {
    const { stdout } = await exec("ps", ["-eo", "pid=,comm=,rss="])
    return stdout.split("\n").flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(opencode\S*)\s+(\d+)$/)
      return match ? [{ pid: Number(match[1]), name: match[2], rssBytes: Number(match[3]) * 1024 }] : []
    })
  } catch { return [] }
}
