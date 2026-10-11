import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

test("built TUI module has the required OpenCode module shape", async () => {
  const source = await readFile(new URL("../src/tui.tsx", import.meta.url), "utf8")
  assert.match(source, /id: "opencode-cleanup"/)
  assert.match(source, /api\.keymap\.registerLayer/)
  assert.match(source, /namespace: "palette"/)
  assert.match(source, /initialPage=\{page\}/)
})
