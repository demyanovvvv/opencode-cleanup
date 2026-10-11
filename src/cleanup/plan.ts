export type CleanupCandidate = {
  kind: "session" | "event-history" | "file"
  id: string
  parentId: string | null
  title: string
  updatedAt: number
  logicalBytes: number
  physicalBytes: number
}

export type CleanupPlanInput = {
  selectedIds: ReadonlySet<string>
  protectedIds: ReadonlySet<string>
  currentSessionId: string | undefined
  busySessionIds: ReadonlySet<string>
  latestRootIds: ReadonlySet<string>
  fingerprint: string
}

export type CleanupPlan = {
  fingerprint: string
  deleteIds: string[]
  protectedIds: string[]
  reasonById: Map<string, string>
  removedBytes: number
}

/** Build a frozen plan; this function never adds candidates outside selectedIds. */
export function buildCleanupPlan(candidates: readonly CleanupCandidate[], input: CleanupPlanInput): CleanupPlan {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const protectedIds = new Set<string>()
  const reasonById = new Map<string, string>()

  const protect = (id: string, reason: string) => {
    if (!byId.has(id)) return
    protectedIds.add(id)
    if (!reasonById.has(id)) reasonById.set(id, reason)
  }

  for (const id of input.protectedIds) protect(id, "pinned")
  for (const id of input.selectedIds) {
    if (id === input.currentSessionId) protect(id, "current")
    else if (input.busySessionIds.has(id)) protect(id, "busy")
    else if (input.latestRootIds.has(id)) protect(id, "latest")
  }

  // Deleting through OpenCode recursively removes children. A protected child
  // therefore protects every selected ancestor that would otherwise contain it.
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of candidates) {
      if (!candidate.parentId || !protectedIds.has(candidate.id)) continue
      let ancestor = byId.get(candidate.parentId)
      while (ancestor) {
        if (input.selectedIds.has(ancestor.id) && !protectedIds.has(ancestor.id)) {
          protect(ancestor.id, "protected descendant")
          changed = true
        }
        ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined
      }
    }
  }

  const deleteIds = candidates
    .filter((candidate) => input.selectedIds.has(candidate.id) && !protectedIds.has(candidate.id))
    .map((candidate) => candidate.id)
  const removedBytes = candidates
    .filter((candidate) => deleteIds.includes(candidate.id))
    .reduce((total, candidate) => total + candidate.logicalBytes, 0)

  return { fingerprint: input.fingerprint, deleteIds, protectedIds: [...protectedIds], reasonById, removedBytes }
}

export function assertPlanCurrent(plan: CleanupPlan, fingerprint: string): void {
  if (plan.fingerprint !== fingerprint) throw new Error("Cleanup plan is stale; refresh the preview before executing it")
}
