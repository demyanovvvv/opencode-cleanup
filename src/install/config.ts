import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { fileURLToPath } from "node:url"

export function parseConfig(text: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const value = parse(text.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true })
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON/JSONC configuration; no changes were made")
  if (value.plugin !== undefined && (!Array.isArray(value.plugin) || value.plugin.some((entry: unknown) => typeof entry !== "string" && !(Array.isArray(entry) && typeof entry[0] === "string")))) throw new Error("Invalid plugin list in configuration")
  return value
}

export function isCleanupSpec(spec: unknown): boolean {
  if (typeof spec !== "string") return false
  if (/^opencode-cleanup(?:@[^/\\]+)?$/.test(spec)) return true
  let path = spec
  if (path.startsWith("file://")) {
    try { path = fileURLToPath(path) } catch { return false }
  }
  const segments = path.replaceAll("\\", "/").split("/")
  return segments.some((part) => part === "opencode-cleanup") || /^opencode-cleanup\.(?:js|mjs|tsx?|cjs)$/.test(segments.at(-1) ?? "")
}

export function updateConfig(text: string, entrypoint?: string): { text: string; options?: unknown } {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : ""
  let output = text.replace(/^\uFEFF/, "")
  const value = parseConfig(output)
  const plugins = (value.plugin ?? []) as unknown[]
  const matching = plugins.filter((item) => isCleanupSpec(Array.isArray(item) ? item[0] : item))
  const only = matching[0]
  const enabled = value.plugin_enabled as Record<string, unknown> | undefined
  if (entrypoint && matching.length === 1 && (Array.isArray(only) ? only[0] : only) === entrypoint && !Object.hasOwn(enabled ?? {}, "opencode-cleanup")) {
    return { text, options: Array.isArray(only) ? only[1] : undefined }
  }
  const formattingOptions = { insertSpaces: !/^\t/m.test(output), tabSize: 2, eol: output.includes("\r\n") ? "\r\n" : "\n" }
  let options: unknown
  for (let index = plugins.length - 1; index >= 0; index--) {
    const item = plugins[index]
    const spec = Array.isArray(item) ? item[0] : item
    if (!isCleanupSpec(spec)) continue
    if (options === undefined && Array.isArray(item)) options = item[1]
    output = applyEdits(output, modify(output, ["plugin", index], undefined, { formattingOptions }))
  }
  if (entrypoint) {
    const remaining = (parseConfig(output).plugin ?? []) as unknown[]
    const item = options === undefined ? entrypoint : [entrypoint, options]
    output = applyEdits(output, modify(output, ["plugin", remaining.length], item, { formattingOptions, isArrayInsertion: true }))
  }
  if (value.plugin_enabled && typeof value.plugin_enabled === "object") {
    output = applyEdits(output, modify(output, ["plugin_enabled", "opencode-cleanup"], undefined, { formattingOptions }))
  }
  return { text: bom + output, options }
}
