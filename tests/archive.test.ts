import test from "node:test"
import assert from "node:assert/strict"
import { createReadStream } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { archiveJsonLines, verifyArchive } from "../src/maintenance/archive.js"

test("archive is streaming, checksummed and verifiable", async () => {
  const root = await mkdtemp("./cleanup-archive-")
  try {
    const target = join(root, "history.jsonl.gz")
    const records = [{ id: "evt_1", type: "unknown", data: { provider: "kept" } }, { id: "evt_2", seq: 2 }]
    const result = await archiveJsonLines(target, records)
    assert.equal(result.recordCount, 2)
    assert.ok(result.sha256.length === 64)
    assert.equal((await stat(target)).size > 0, true)
    const verified = await verifyArchive(target, result.sha256, 2)
    assert.deepEqual(verified, { sha256: result.sha256, recordCount: 2 })
    assert.ok((await readFile(target)).length > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
