import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { installPlugin, uninstallPlugin, resolveConfigDirectory, resolveDataDirectory } from "./manager.js"

const args = process.argv.slice(2)
const action = args.shift()
const options: Record<string, string> = {}
try {
  if (action !== "install" && action !== "uninstall") throw new Error("Usage: node dist/install/cli.js <install|uninstall> [--config-dir <path>] [--data-dir <path>] [--config <file>]")
  while (args.length) {
    const flag = args.shift()!
    if (flag === "--no-pause") continue
    if (!["--config-dir", "--data-dir", "--config", "--source"].includes(flag) || !args.length || args[0].startsWith("--")) throw new Error(`Unknown/incomplete option: ${flag}`)
    options[flag] = args.shift()!
  }
  const configDir = resolve(options["--config-dir"] ?? resolveConfigDirectory())
  const configFile = options["--config"] ?? process.env.OPENCODE_TUI_CONFIG
  const paths = {
    sourceRoot: resolve(options["--source"] ?? fileURLToPath(new URL("../../", import.meta.url))),
    configDir,
    dataDir: resolve(options["--data-dir"] ?? resolveDataDirectory()),
    configFiles: configFile ? [resolve(configFile)] : undefined,
  }
  const result = action === "install" ? await installPlugin(paths) : await uninstallPlugin(paths)
  console.log(`opencode-cleanup: ${result.action}${result.version ? ` (${result.version})` : ""}`)
  if (result.entrypoint) console.log(`Entrypoint: ${result.entrypoint}`)
  for (const path of result.preserved) console.log(`Preserved archive/backup: ${path}`)
  console.log("Quit and restart OpenCode to apply the change.")
} catch (error) {
  console.error(`opencode-cleanup: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
