import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { testRender, type JSX } from "@opentui/solid"

test("built palette callbacks render maintenance and Back returns to the dashboard", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-cleanup-renderer-"))
  const previousDatabase = process.env.OPENCODE_DB
  const database = join(root, "opencode.db")
  execFileSync("node", ["--input-type=module", "-e", `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER); CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT); CREATE TABLE part(id TEXT PRIMARY KEY, session_id TEXT, data TEXT); CREATE TABLE event(id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT); CREATE TABLE event_sequence(aggregate_id TEXT PRIMARY KEY, seq INTEGER);');
    db.close();
  `, database])
  process.env.OPENCODE_DB = database
  const moduleUrl = new URL("../dist/tui.js", import.meta.url).href
  const plugin = (await import(moduleUrl)).default
  let content: (() => JSX.Element) | undefined
  let commands: { name: string; namespace: string; run: () => void }[] = []
  let bindings: { key: string; cmd: string }[] = []
  let size = ""
  let cleared = false
  const api = {
    keymap: { registerLayer: (layer: { commands: typeof commands; bindings: typeof bindings }) => {
      commands = layer.commands
      bindings = layer.bindings
      return () => {}
    } },
    ui: { dialog: {
      setSize: (value: string) => { size = value },
      replace: (factory: () => JSX.Element) => { content = factory },
      clear: () => { cleared = true; content = undefined },
    } },
    state: { path: { state: join(root, "state") } },
  } as unknown as TuiPluginApi
  let setup: Awaited<ReturnType<typeof testRender>> | undefined
  try {
    assert.equal(plugin.id, "opencode-cleanup")
    assert.equal(plugin.server, undefined)
    await plugin.tui(api)
    assert.equal(commands.length, 5)
    assert.ok(commands.every((command) => command.namespace === "palette"))
    assert.ok(bindings.some((binding) => binding.key === "ctrl+shift+o" && binding.cmd === "opencode-cleanup.dashboard"))
    commands.find((command) => command.name === "opencode-cleanup.maintenance")!.run()
    setup = await testRender(() => content!(), { width: 100, height: 24 })
    assert.equal(size, "xlarge")
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    assert.match(frame, /Database maintenance/)
    assert.match(frame, /No maintenance job queued/)
    const rows = frame.split("\n")
    const backRow = rows.findIndex((row) => row.includes("[Back]"))
    assert.ok(backRow >= 0)
    await setup.mockMouse.click(rows[backRow].indexOf("[Back]") + 1, backRow)
    assert.equal(cleared, false)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Dashboard/)
    setup.renderer.destroy()
    commands.find((command) => command.name === "opencode-cleanup.selective")!.run()
    setup = await testRender(() => content!(), { width: 100, height: 24 })
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Protected in this preview: 0/)
    setup.renderer.resize(48, 16)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Selective cleanup/)
  } finally {
    setup?.renderer.destroy()
    if (previousDatabase === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = previousDatabase
    // Dashboard refresh also queries the process list; let it settle before
    // removing the temporary database after renderer destruction.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await rm(root, { recursive: true, force: true })
  }
})
