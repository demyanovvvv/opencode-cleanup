import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile, lstat, open } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { homedir } from "node:os"
import { pathToFileURL } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parseConfig, updateConfig } from "./config.js"
import { stopRegisteredJobs, removeRegisteredJobFiles, pluginStateDirectory } from "../maintenance/control.js"

const exec = promisify(execFile)
const marker = ".opencode-cleanup-install.json"
type Manifest = { owner: "opencode-cleanup"; format: 1; version: string; digest: string; entrypoint: string; configFiles: string[]; dataDirs: string[] }
export type InstallOptions = { sourceRoot: string; configDir: string; dataDir: string; configFiles?: string[] }
export type InstallResult = { action: "installed" | "updated" | "unchanged" | "uninstalled" | "not-installed"; entrypoint: string; version?: string; preserved: string[] }

export function resolveConfigDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENCODE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")
}
export function resolveDataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode")
}
async function exists(path: string) { try { await access(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error } }

async function noLinks(path: string): Promise<void> {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  if (parent !== absolute) await noLinks(parent)
  try { if ((await lstat(absolute)).isSymbolicLink()) throw new Error(`Symlink/junction is not an owned installation path: ${absolute}`) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
}
async function files(root: string, prefix = ""): Promise<string[]> {
  const result: string[] = []
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error("Build contains a symlink; refusing to install")
    const path = join(prefix, item.name)
    if (item.isDirectory()) result.push(...await files(root, path))
    else if (item.isFile()) result.push(path)
  }
  return result.sort()
}
async function digestBuild(root: string, version: string): Promise<string> {
  const hash = createHash("sha256").update(version)
  for (const file of await files(root)) hash.update(file.replaceAll("\\", "/")).update(await readFile(join(root, file)))
  return hash.digest("hex")
}
async function validateBuild(root: string): Promise<void> {
  if (!await exists(join(root, "tui.js")) || !await exists(join(root, "worker", "cli.js"))) throw new Error("Build is incomplete: run npm run build")
  for (const file of await files(root)) if (file.endsWith(".js")) {
    try { await exec(process.execPath, ["--check", join(root, file)], { timeout: 30_000 }) }
    catch { throw new Error(`Build has invalid JavaScript syntax: ${file}`) }
  }
}
async function readManifest(root: string): Promise<Manifest | undefined> {
  if (!await exists(root)) return undefined
  await noLinks(root)
  try {
    const manifest = JSON.parse(await readFile(join(root, marker), "utf8")) as Manifest
    if (manifest.owner !== "opencode-cleanup" || manifest.format !== 1 || !Array.isArray(manifest.configFiles) || !Array.isArray(manifest.dataDirs)) throw new Error("invalid")
    return manifest
  } catch { throw new Error(`Installation directory is not owned by this installer (missing/invalid manifest): ${root}`) }
}
async function atomicWrite(path: string, content: string) {
  await noLinks(path)
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temp, content, { flag: "wx" }); await rename(temp, path) }
  finally { await rm(temp, { force: true }) }
}
async function configs(options: InstallOptions, manifest?: Manifest) {
  const paths = [...new Set([join(options.configDir, "tui.json"), join(options.configDir, "tui.jsonc"), ...(options.configFiles ?? []), ...(manifest?.configFiles ?? [])].map((path) => resolve(path)))]
  const result = new Map<string, string | undefined>()
  for (const path of paths) {
    await noLinks(path)
    if (await exists(path)) { const text = await readFile(path, "utf8"); parseConfig(text); result.set(path, text) }
  }
  return result
}
export async function withInstallationLock<T>(configDir: string, work: () => Promise<T>): Promise<T> {
  const options = { configDir }
  await noLinks(options.configDir)
  await mkdir(options.configDir, { recursive: true })
  const lockPath = join(options.configDir, ".opencode-cleanup-install.lock")
  let lock
  try { lock = await open(lockPath, "wx") } catch { throw new Error("Another installer/uninstaller is active; retry after it exits") }
  try { return await work() } finally { await lock.close(); await rm(lockPath, { force: true }) }
}

export async function installPlugin(options: InstallOptions): Promise<InstallResult> {
  return withInstallationLock(options.configDir, async () => {
    const root = join(options.configDir, "plugins", "opencode-cleanup")
    const previous = await readManifest(root)
    const original = await configs(options, previous)
    for (const path of options.configFiles ?? []) if (!original.has(resolve(path))) original.set(resolve(path), undefined)
    const pkg = JSON.parse(await readFile(join(options.sourceRoot, "package.json"), "utf8")) as { name: string; version: string }
    if (pkg.name !== "opencode-cleanup" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(pkg.version)) throw new Error("Invalid source package")
    const build = join(options.sourceRoot, "dist")
    await validateBuild(build)
    const digest = await digestBuild(build, pkg.version)
    const release = join(root, "releases", `${pkg.version}-${digest.slice(0, 16)}`)
    const entrypoint = join(release, "tui.js")
    const same = previous?.digest === digest && await exists(entrypoint) && await digestBuild(release, pkg.version) === digest
    const changedFiles: string[] = []
    let createdRelease = false
    let originalMarker: string | undefined
    try {
      if (previous) originalMarker = await readFile(join(root, marker), "utf8")
      if (!same) {
        await noLinks(release)
        await mkdir(join(root, "releases"), { recursive: true })
        // Existing content-addressed releases cannot be overwritten while a host
        // may still have them loaded. A damaged copy is rejected instead.
        if (await exists(release)) throw new Error("Installed build is damaged; uninstall it before reinstalling")
        const stage = join(root, `stage-${randomUUID()}`)
        try {
          await cp(build, stage, { recursive: true, dereference: false })
          if (await digestBuild(stage, pkg.version) !== digest) throw new Error("Source build changed during installation")
          await validateBuild(stage)
          await rename(stage, release)
          createdRelease = true
        } finally { await rm(stage, { recursive: true, force: true }) }
      }
      if (!original.size) original.set(resolve(options.configFiles?.at(-1) ?? join(options.configDir, "tui.json")), undefined)
      const target = [...original.keys()].at(-1)!
      // Keep highest-precedence plugin options when migrating old registrations.
      let savedOptions: unknown
      for (const text of original.values()) if (text) savedOptions = updateConfig(text).options ?? savedOptions
      for (const [path, text] of original) {
        let next = updateConfig(text ?? '{\n  "$schema": "https://opencode.ai/tui.json"\n}\n', path === target ? pathToFileURL(entrypoint).href : undefined).text
        if (path === target && savedOptions !== undefined) {
          const parsed = parseConfig(next)
          const plugins = parsed.plugin as unknown[]
          const wanted = [pathToFileURL(entrypoint).href, savedOptions]
          // updateConfig preserves comments; only replace the appended element.
          const { applyEdits, modify } = await import("jsonc-parser")
          if (JSON.stringify(plugins.at(-1)) !== JSON.stringify(wanted)) next = applyEdits(next, modify(next, ["plugin", plugins.length - 1], wanted, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
        }
        if (next !== text) { await atomicWrite(path, next); changedFiles.push(path) }
      }
      const manifest: Manifest = { owner: "opencode-cleanup", format: 1, version: pkg.version, digest, entrypoint, configFiles: [...original.keys()], dataDirs: [...new Set([...(previous?.dataDirs ?? []), resolve(options.dataDir)])] }
      const uninstallScript = `import { readFile } from "node:fs/promises";\nimport { spawnSync } from "node:child_process";\nimport { fileURLToPath } from "node:url";\nimport { join } from "node:path";\nconst root = fileURLToPath(new URL("./", import.meta.url));\nconst manifest = JSON.parse(await readFile(join(root, ${JSON.stringify(marker)}), "utf8"));\nconst cli = join(manifest.entrypoint, "..", "install", "cli.js");\nconst result = spawnSync(process.execPath, [cli, "uninstall", "--config-dir", ${JSON.stringify(resolve(options.configDir))}, "--data-dir", manifest.dataDirs[0], ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });\nif (result.error) console.error(result.error.message);\nprocess.exitCode = result.status ?? 1;\n`
      await atomicWrite(join(root, "uninstall.mjs"), uninstallScript)
      await atomicWrite(join(root, "uninstall.cmd"), '@echo off\r\nnode "%~dp0uninstall.mjs" %*\r\nset "result=%errorlevel%"\r\nif /i not "%~1"=="--no-pause" pause\r\nexit /b %result%\r\n')
      await atomicWrite(join(root, marker), JSON.stringify(manifest, null, 2) + "\n")
      await atomicWrite(join(pluginStateDirectory(options.configDir), "enabled"), "installed\n")
      return { action: same && !changedFiles.length ? "unchanged" : previous ? "updated" : "installed", entrypoint, version: pkg.version, preserved: [] }
    } catch (error) {
      for (const path of changedFiles.reverse()) { const text = original.get(path); if (text === undefined) await rm(path, { force: true }); else await atomicWrite(path, text) }
      if (originalMarker) await atomicWrite(join(root, marker), originalMarker)
      if (createdRelease) await rm(release, { recursive: true, force: true })
      if (!previous) await rm(root, { recursive: true, force: true })
      throw error
    }
  })
}

export async function uninstallPlugin(options: InstallOptions): Promise<InstallResult> {
  return withInstallationLock(options.configDir, async () => {
    const root = join(options.configDir, "plugins", "opencode-cleanup")
    const previous = await readManifest(root)
    const original = await configs(options, previous)
    const dataDirs = [...new Set([resolve(options.dataDir), ...(previous?.dataDirs ?? [])])]
    for (const dataDir of dataDirs) await noLinks(dataDir)
    await noLinks(pluginStateDirectory(options.configDir))
    await stopRegisteredJobs(options.configDir, dataDirs)
    let changed = false
    for (const [path, text] of original) {
      const next = updateConfig(text!).text
      if (next !== text) { await atomicWrite(path, next); changed = true }
    }
    const state = pluginStateDirectory(options.configDir)
    await removeRegisteredJobFiles(options.configDir)
    if (previous) { await rm(root, { recursive: true }); changed = true }
    await rm(state, { recursive: true, force: true })
    const preserved: string[] = []
    for (const dataDir of dataDirs) {
      await noLinks(dataDir)
      for (const name of ["opencode-cleanup-job.json", "opencode-cleanup-job.json.cancel", "opencode-cleanup-job.json.worker.json", "opencode-cleanup-job.json.report.json", "opencode-cleanup-report.json", "opencode-cleanup-settings.json"]) {
        const path = join(dataDir, name)
        if (await exists(path)) { await noLinks(path); await rm(path); changed = true }
      }
      for (const name of ["opencode-cleanup-backups", "opencode-cleanup-archives"]) if (await exists(join(dataDir, name))) preserved.push(join(dataDir, name))
    }
    return { action: previous || changed ? "uninstalled" : "not-installed", entrypoint: "", preserved }
  })
}
