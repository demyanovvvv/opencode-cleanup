import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const action = args[0];
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };
function run(command, argv, shell = false) {
  const result = spawnSync(command, argv, { cwd: root, stdio: "inherit", shell, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `${command} exited with ${result.status}`);
}
try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw new Error("Node.js 22.16 or newer is required.");
  if (!["install", "uninstall"].includes(action)) throw new Error("Use install or uninstall.");
  const cli = join(root, "dist", "install", "cli.js");
  const source = await exists(join(root, "src", "install", "cli.ts"));
  if ((action === "install" && source) || !await exists(cli)) {
    if (!await exists(join(root, "node_modules", "@babel", "core", "package.json")) || !await exists(join(root, "node_modules", "jsonc-parser", "package.json"))) {
      run("npm", [await exists(join(root, "package-lock.json")) ? "ci" : "install"], process.platform === "win32");
    }
    run(process.execPath, [join(root, "scripts", "build.mjs")]);
  }
  run(process.execPath, [cli, ...args]);
} catch (error) {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
}
