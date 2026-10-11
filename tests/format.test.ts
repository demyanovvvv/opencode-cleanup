import test from "node:test"
import assert from "node:assert/strict"
import { formatBytes, percent } from "../src/analysis/format.js"

test("formatBytes uses binary units without losing zero", () => {
  assert.equal(formatBytes(0), "0 B")
  assert.equal(formatBytes(1024), "1.0 KiB")
  assert.equal(formatBytes(20.891 * 1024 ** 3), "20.89 GiB")
})

test("percent handles empty totals and rounds stable values", () => {
  assert.equal(percent(1, 0), 0)
  assert.equal(percent(1285, 10000), 12.85)
})
