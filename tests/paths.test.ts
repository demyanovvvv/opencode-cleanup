import test from "node:test"
import assert from "node:assert/strict"
import { assertManagedPath } from "../src/maintenance/paths.js"

test("managed paths reject traversal and symlinks", async () => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp("./cleanup-test-"))
  try {
    assert.equal(await assertManagedPath(root, `${root}/archive.jsonl`), true)
    await assert.rejects(() => assertManagedPath(root, `${root}/../outside.jsonl`), /managed root/)
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})
