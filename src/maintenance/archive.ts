import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, stat } from "node:fs/promises"
import { dirname } from "node:path"
import { createGzip } from "node:zlib"
import { pipeline } from "node:stream/promises"

export type ArchiveResult = { path: string; sha256: string; recordCount: number; bytes: number }

function encodeRecord(record: unknown): Buffer {
  return Buffer.from(JSON.stringify(record) + "\n", "utf8")
}

export async function archiveJsonLines(path: string, records: Iterable<unknown>): Promise<ArchiveResult> {
  await mkdir(dirname(path), { recursive: true })
  const hash = createHash("sha256")
  let recordCount = 0
  const gzip = createGzip()
  const output = createWriteStream(path, { flags: "wx" })
  const writing = pipeline(gzip, output)
  for (const record of records) {
    const line = encodeRecord(record)
    hash.update(line)
    recordCount += 1
    if (!gzip.write(line)) await new Promise<void>((resolve) => gzip.once("drain", resolve))
  }
  gzip.end()
  await writing
  return { path, sha256: hash.digest("hex"), recordCount, bytes: (await stat(path)).size }
}

export async function verifyArchive(path: string, expectedSha256: string, expectedRecordCount: number) {
  const hash = createHash("sha256")
  const gunzip = await import("node:zlib").then(({ createGunzip }) => createGunzip())
  let recordCount = 0
  let remainder = ""
  gunzip.on("data", (chunk: Buffer) => {
    hash.update(chunk)
    remainder += chunk.toString("utf8")
    const lines = remainder.split("\n")
    remainder = lines.pop() ?? ""
    for (const line of lines) if (line.trim()) {
      JSON.parse(line)
      recordCount += 1
    }
  })
  await pipeline(createReadStream(path), gunzip)
  if (remainder.trim()) {
    JSON.parse(remainder)
    recordCount += 1
  }
  const sha256 = hash.digest("hex")
  if (sha256 !== expectedSha256 || recordCount !== expectedRecordCount) {
    throw new Error(`Archive verification failed: expected ${expectedRecordCount}/${expectedSha256}, got ${recordCount}/${sha256}`)
  }
  return { sha256, recordCount }
}
