import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "opencode-cleanup-built-installer-"));
const project = fileURLToPath(new URL("../", import.meta.url));
const config = join(root, "configuration with spaces"), data = join(root, "data");
const args = ["--config-dir", config, "--data-dir", data];
function run(action, script = join(project, "dist", "install", "cli.js")) {
  const output = execFileSync(process.execPath, [script, action, "--source", project, ...args], { encoding: "utf8", cwd: root });
  console.log(output.trim());
  return output;
}
try {
  await mkdir(config, { recursive: true });
  await mkdir(data);
  await writeFile(join(config, "tui.json"), JSON.stringify({ plugin: [join(project, "dist", "tui.js"), "keep-plugin"] }));
  assert.match(run("install"), /installed/);
  const manifest = JSON.parse(await readFile(join(config, "plugins", "opencode-cleanup", ".opencode-cleanup-install.json"), "utf8"));
  await access(manifest.entrypoint);
  assert.match(run("install"), /unchanged/);
  // Run uninstallation from the installed release: no source node_modules are
  // resolved by this copied CLI, including the bundled JSONC parser.
  const output = execFileSync(process.execPath, [join(config, "plugins", "opencode-cleanup", "uninstall.mjs")], { encoding: "utf8", cwd: root });
  console.log(output.trim());
  assert.match(output, /uninstalled/);
  assert.deepEqual(JSON.parse(await readFile(join(config, "tui.json"), "utf8")).plugin, ["keep-plugin"]);
  await assert.rejects(() => access(join(config, "plugins", "opencode-cleanup")));
  assert.match(run("uninstall"), /not-installed/);
  if (process.platform === "win32") {
    for (const action of ["install", "uninstall"]) {
      const command = `""${join(project, `${action}.cmd`)}" --no-pause --config-dir "${config}" --data-dir "${data}""`;
      const text = execFileSync("cmd.exe", ["/d", "/s", "/c", command], { encoding: "utf8", cwd: root, windowsVerbatimArguments: true });
      console.log(text.trim());
      assert.match(text, action === "install" ? /installed/ : /uninstalled/);
    }
  }
  console.log("Built installer smoke passed: install, idempotent update and full uninstall.");
} finally { await rm(root, { recursive: true, force: true }); }
