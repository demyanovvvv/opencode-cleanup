import test from "node:test"
import assert from "node:assert/strict"
import { buildCleanupPlan, type CleanupCandidate } from "../src/cleanup/plan.js"

const candidates: CleanupCandidate[] = [
  { kind: "session", id: "ses_root", parentId: null, title: "Root", updatedAt: 1, logicalBytes: 100, physicalBytes: 100 },
  { kind: "session", id: "ses_child", parentId: "ses_root", title: "Child", updatedAt: 1, logicalBytes: 50, physicalBytes: 50 },
  { kind: "session", id: "ses_new", parentId: null, title: "Newest", updatedAt: 99, logicalBytes: 40, physicalBytes: 40 },
]

test("plan recursively protects parents of protected descendants", () => {
  const plan = buildCleanupPlan(candidates, {
    selectedIds: new Set(["ses_root", "ses_child"]),
    protectedIds: new Set(["ses_child"]),
    currentSessionId: undefined,
    busySessionIds: new Set(),
    latestRootIds: new Set(),
    fingerprint: "before",
  })

  assert.deepEqual(plan.deleteIds, [])
  assert.deepEqual(plan.protectedIds.sort(), ["ses_child", "ses_root"])
  assert.equal(plan.removedBytes, 0)
})

test("plan excludes current, busy and latest sessions without expanding selection", () => {
  const plan = buildCleanupPlan(candidates, {
    selectedIds: new Set(candidates.map((item) => item.id)),
    protectedIds: new Set(),
    currentSessionId: "ses_root",
    busySessionIds: new Set(["ses_child"]),
    latestRootIds: new Set(["ses_new"]),
    fingerprint: "before",
  })

  assert.deepEqual(plan.deleteIds, [])
  assert.equal(plan.fingerprint, "before")
  assert.equal(plan.reasonById.get("ses_root"), "current")
  assert.equal(plan.reasonById.get("ses_child"), "busy")
  assert.equal(plan.reasonById.get("ses_new"), "latest")
})
