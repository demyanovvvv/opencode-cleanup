import { lstat, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

export async function assertManagedPath(root: string, target: string): Promise<true> {
  const managedRoot = await realpath(resolve(root))
  const absoluteTarget = resolve(target)
  if (!isAbsolute(absoluteTarget) || relative(managedRoot, absoluteTarget).startsWith("..")) {
    throw new Error(`Path is outside the managed root: ${target}`)
  }
  const relativeTarget = relative(managedRoot, absoluteTarget)
  const parts = relativeTarget ? relativeTarget.split(/[\\/]/) : []
  let current = managedRoot
  for (const part of parts) {
    current = resolve(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error(`Symlinks and junctions are not managed: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break
      throw error
    }
  }
  return true
}
