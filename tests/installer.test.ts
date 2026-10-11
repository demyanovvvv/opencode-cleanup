import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parse } from "jsonc-parser"
import { installPlugin, uninstallPlugin, resolveConfigDirectory } from "../src/install/manager.js"

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "opencode-cleanup-install-"))
  const sourceRoot = join(root, "source", "opencode-cleanup")
  const configDir = join(root, "config with spaces")
  const dataDir = join(root, "data")
  await mkdir(join(sourceRoot, "dist", "worker"), { recursive: true })
  await mkdir(configDir, { recursive: true })
  await mkdir(dataDir, { recursive: true })
  await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "opencode-cleanup", version: "0.1.0", type: "module", exports: { "./tui": "./dist/tui.js" } }))
  await writeFile(join(sourceRoot, "dist", "tui.js"), 'export default { id: "opencode-cleanup", tui: async () => {} };\n')
  await writeFile(join(sourceRoot, "dist", "worker", "cli.js"), 'console.log("Worker ready");\n')
  return { root, sourceRoot, configDir, dataDir, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test("installer migrates path/npm duplicates, preserves JSONC and options, and is idempotent", async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.configDir, "tui.json"), JSON.stringify({ plugin: [join(f.sourceRoot, "dist", "tui.js"), "other-plugin"], theme: "keep" }))
    await writeFile(join(f.configDir, "tui.jsonc"), `// custom theme\n{\n  "keybinds": { "leader": "ctrl+x" }, // keep this comment\n  "plugin": [["opencode-cleanup@0.0.1", {"custom": true}], "other-plugin-two",],\n  "plugin_enabled": { "opencode-cleanup": false, "other": false },\n}\n`)
    const result = await installPlugin(f)
    const json = parse(await readFile(join(f.configDir, "tui.json"), "utf8"))
    const jsoncText = await readFile(join(f.configDir, "tui.jsonc"), "utf8")
    const jsonc = parse(jsoncText)
    assert.deepEqual(json.plugin, ["other-plugin"])
    assert.equal(json.theme, "keep")
    assert.ok(jsoncText.includes("keep this comment"))
    assert.ok(jsoncText.includes("custom theme"))
    assert.equal(jsonc.plugin.length, 2)
    assert.deepEqual(jsonc.plugin[1], [pathToFileURL(result.entrypoint).href, { custom: true }])
    assert.equal(jsonc.plugin_enabled["opencode-cleanup"], undefined)
    assert.equal(jsonc.plugin_enabled.other, false)
    assert.equal(await readFile(result.entrypoint, "utf8"), await readFile(join(f.sourceRoot, "dist", "tui.js"), "utf8"))
    await access(join(f.configDir, "plugins", "opencode-cleanup", "uninstall.cmd"))
    await access(join(f.configDir, "plugins", "opencode-cleanup", "uninstall.mjs"))
    const again = await installPlugin(f)
    assert.equal(again.action, "unchanged")
    assert.equal(again.entrypoint, result.entrypoint)
    assert.equal(parse(await readFile(join(f.configDir, "tui.jsonc"), "utf8")).plugin.length, 2)
  } finally { await f.cleanup() }
})

test("same-version content changes update and a broken release leaves the previous copy and config intact", async () => {
  const f = await fixture()
  try {
    const original = await installPlugin(f)
    await writeFile(join(f.sourceRoot, "dist", "tui.js"), 'export default { id: "opencode-cleanup", tui: async () => { /* new */ } };\n')
    const updated = await installPlugin(f)
    assert.equal(updated.action, "updated")
    assert.notEqual(updated.entrypoint, original.entrypoint)
    await access(original.entrypoint)
    const config = await readFile(join(f.configDir, "tui.json"), "utf8")
    await writeFile(join(f.sourceRoot, "dist", "tui.js"), "export default { broken syntax\n")
    await assert.rejects(() => installPlugin(f), /build|syntax|valid/i)
    assert.equal(await readFile(join(f.configDir, "tui.json"), "utf8"), config)
    await access(updated.entrypoint)
  } finally { await f.cleanup() }
})

test("uninstaller removes installed files, settings and legacy job but preserves backup, archive, DB and other plugins", async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.configDir, "tui.json"), JSON.stringify({ plugin: [join(f.sourceRoot, "dist", "tui.js"), "other"], plugin_enabled: { "opencode-cleanup": false, other: true } }))
    await installPlugin(f)
    await mkdir(join(f.dataDir, "opencode-cleanup-backups"))
    await mkdir(join(f.dataDir, "opencode-cleanup-archives"))
    await writeFile(join(f.dataDir, "opencode-cleanup-backups", "backup.db"), "backup")
    await writeFile(join(f.dataDir, "opencode-cleanup-archives", "history.gz"), "archive")
    await writeFile(join(f.dataDir, "opencode.db"), "user database")
    await writeFile(join(f.dataDir, "opencode-cleanup-job.json"), JSON.stringify({ state: "queued", databasePath: join(f.dataDir, "opencode.db") }))
    const result = await uninstallPlugin(f)
    assert.equal(result.action, "uninstalled")
    await assert.rejects(() => access(join(f.configDir, "plugins", "opencode-cleanup")))
    await assert.rejects(() => access(join(f.dataDir, "opencode-cleanup-job.json")))
    assert.deepEqual(parse(await readFile(join(f.configDir, "tui.json"), "utf8")).plugin, ["other"])
    assert.equal(await readFile(join(f.dataDir, "opencode.db"), "utf8"), "user database")
    await access(join(f.dataDir, "opencode-cleanup-backups", "backup.db"))
    await access(join(f.dataDir, "opencode-cleanup-archives", "history.gz"))
    await access(join(f.sourceRoot, "dist", "tui.js"))
    assert.equal((await uninstallPlugin(f)).action, "not-installed")
  } finally { await f.cleanup() }
})

test("malformed config and unowned install folders are rejected without overwriting data", async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.configDir, "tui.json"), "{broken}")
    await assert.rejects(() => installPlugin(f), /config|JSON/i)
    assert.equal(await readFile(join(f.configDir, "tui.json"), "utf8"), "{broken}")
    await rm(join(f.configDir, "tui.json"))
    const unowned = join(f.configDir, "plugins", "opencode-cleanup")
    await mkdir(unowned, { recursive: true })
    await writeFile(join(unowned, "user.txt"), "keep")
    await assert.rejects(() => installPlugin(f), /owned|manifest/i)
    await assert.rejects(() => uninstallPlugin(f), /owned|manifest/i)
    assert.equal(await readFile(join(unowned, "user.txt"), "utf8"), "keep")
  } finally { await f.cleanup() }
})

test("config directory resolution honors OpenCode and XDG overrides", () => {
  assert.equal(resolveConfigDirectory({ OPENCODE_CONFIG_DIR: "D:/custom" }), "D:/custom")
  assert.equal(resolveConfigDirectory({ XDG_CONFIG_HOME: "D:/xdg" }), join("D:/xdg", "opencode"))
})

test("unsafe configuration or install symlinks are refused and unrelated paths remain intact", async () => {
  const f = await fixture()
  try {
    const outside = join(f.root, "outside")
    await mkdir(outside)
    await writeFile(join(outside, "user.txt"), "keep")
    const { symlink } = await import("node:fs/promises")
    await mkdir(join(f.configDir, "plugins"))
    await symlink(outside, join(f.configDir, "plugins", "opencode-cleanup"), process.platform === "win32" ? "junction" : "dir")
    await assert.rejects(() => installPlugin(f), /symlink|junction/i)
    await assert.rejects(() => uninstallPlugin(f), /symlink|junction/i)
    assert.equal(await readFile(join(outside, "user.txt"), "utf8"), "keep")
  } finally { await f.cleanup() }
})

test("an invalid secondary config leaves the previous installation and primary config intact", async () => {
  const f = await fixture()
  try {
    const first = await installPlugin(f)
    const before = await readFile(join(f.configDir, "tui.json"), "utf8")
    await writeFile(join(f.sourceRoot, "dist", "tui.js"), 'export default { id: "opencode-cleanup", tui: async () => { /* update */ } };\n')
    await writeFile(join(f.configDir, "tui.jsonc"), '{"plugin": 42}')
    await assert.rejects(() => installPlugin(f), /plugin list/)
    assert.equal(await readFile(join(f.configDir, "tui.json"), "utf8"), before)
    await access(first.entrypoint)
  } finally { await f.cleanup() }
})

test("a custom TUI config is created and recorded even when a global config already exists", async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.configDir, "tui.json"), '{"plugin":["keep"]}')
    const custom = join(f.root, "custom", "tui.jsonc")
    const installed = await installPlugin({ ...f, configFiles: [custom] })
    assert.deepEqual(parse(await readFile(custom, "utf8")).plugin, [pathToFileURL(installed.entrypoint).href])
    await uninstallPlugin(f)
    assert.deepEqual(parse(await readFile(custom, "utf8")).plugin, [])
  } finally { await f.cleanup() }
})

test("failure at final installation activation rolls back the changed config and manifest", async () => {
  const f = await fixture()
  try {
    const first = await installPlugin(f)
    const before = await readFile(join(f.configDir, "tui.json"), "utf8")
    const markerPath = join(f.configDir, "plugins", "opencode-cleanup", ".opencode-cleanup-install.json")
    const beforeMarker = await readFile(markerPath, "utf8")
    await writeFile(join(f.sourceRoot, "dist", "tui.js"), 'export default { id: "opencode-cleanup", tui: async () => { /* next */ } };\n')
    const enabled = join(f.configDir, "opencode-cleanup", "enabled")
    await rm(enabled)
    await mkdir(enabled)
    await assert.rejects(() => installPlugin(f))
    assert.equal(await readFile(join(f.configDir, "tui.json"), "utf8"), before)
    assert.equal(await readFile(markerPath, "utf8"), beforeMarker)
    await access(first.entrypoint)
  } finally { await f.cleanup() }
})
