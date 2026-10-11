import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
const output = join(project, "release-artifacts");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "opencode-cleanup-release-"));
const archive = join(output, `${pkg.name}-${pkg.version}.tgz`);
const zip = join(output, `${pkg.name}-${pkg.version}.zip`);
const run = (command, args, cwd = project) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
try {
  assert.equal(JSON.parse(await readFile(join(project, "package-lock.json"), "utf8")).version, pkg.version);
  // Build is verified separately; avoid invoking npm through a Windows shell.
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run with: npm run release:prepare");
  console.log(run(process.execPath, [npmCli, "pack", "--ignore-scripts", "--pack-destination", output]));
  run("tar", ["-xzf", archive, "-C", temporary]);
  const extracted = join(temporary, "package");
  for (const required of ["dist/tui.js", "dist/worker/cli.js", "scripts/setup.mjs", "install.cmd", "uninstall.cmd", "README.ru.md", "CHANGELOG.md"]) {
    await access(join(extracted, required));
  }
  const config = join(temporary, "config"), data = join(temporary, "data");
  await mkdir(config);
  await mkdir(data);
  await writeFile(join(config, "tui.json"), JSON.stringify({ plugin: ["preserved-plugin"] }));
  const args = ["--config-dir", config, "--data-dir", data];
  console.log(run(process.execPath, [join(extracted, "scripts/setup.mjs"), "install", ...args], temporary));
  const manifest = JSON.parse(await readFile(join(config, "plugins/opencode-cleanup/.opencode-cleanup-install.json"), "utf8"));
  assert.equal(manifest.version, pkg.version);
  await access(manifest.entrypoint);
  console.log(run(process.execPath, [join(extracted, "scripts/setup.mjs"), "uninstall", ...args], temporary));
  assert.deepEqual(JSON.parse(await readFile(join(config, "tui.json"), "utf8")).plugin, ["preserved-plugin"]);
  await rm(zip, { force: true });
  if (process.platform === "win32") {
    const literal = (path) => `'${path.replaceAll("'", "''")}'`;
    run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -LiteralPath ${literal(extracted)} -DestinationPath ${literal(zip)}`]);
    const zipExtract = join(temporary, "zip-check");
    run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${literal(zip)} -DestinationPath ${literal(zipExtract)}`]);
    await verifySameTree(extracted, join(zipExtract, "package"));
  } else {
    run("zip", ["-qr", zip, "package"], temporary);
    const zipExtract = join(temporary, "zip-check");
    await mkdir(zipExtract);
    run("unzip", ["-q", zip, "-d", zipExtract]);
    await verifySameTree(extracted, join(zipExtract, "package"));
  }
  const sums = [];
  for (const asset of [archive, zip]) {
    sums.push(`${createHash("sha256").update(await readFile(asset)).digest("hex")}  ${basename(asset)}`);
  }
  await writeFile(join(output, "SHA256SUMS.txt"), sums.join("\n") + "\n");
  console.log("Release archives verified: package contents, temporary installation/removal, ZIP byte equality.");
  console.log(sums.join("\n"));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function verifySameTree(source, copy) {
  const entries = await readdir(source, { withFileTypes: true });
  assert.deepEqual((await readdir(copy)).sort(), entries.map((entry) => entry.name).sort());
  for (const entry of entries) {
    const original = join(source, entry.name), duplicate = join(copy, entry.name);
    if (entry.isDirectory()) await verifySameTree(original, duplicate);
    else assert.deepEqual(await readFile(duplicate), await readFile(original), entry.name);
  }
}
