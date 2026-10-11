import { transformAsync } from "@babel/core";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await rm(join(root, "dist"), { recursive: true, force: true });
async function compile(dir, output) {
  await mkdir(output, { recursive: true });
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      await compile(join(dir, item.name), join(output, item.name));
      continue;
    }
    if (!/\.tsx?$/.test(item.name)) continue;
    const filename = join(dir, item.name);
    const result = await transformAsync(await readFile(filename, "utf8"), {
      filename,
      babelrc: false,
      configFile: false,
      presets: [
        ...(item.name.endsWith(".tsx") ? [[solid, { moduleName: "@opentui/solid", generate: "universal" }]] : []),
        [ts, { allExtensions: true, isTSX: item.name.endsWith(".tsx") }],
      ],
    });
    const code = result.code.replace(/(["'])jsonc-parser\1/g, '"../vendor/jsonc.js"');
    await writeFile(join(output, item.name.replace(/\.tsx?$/, ".js")), code + "\n");
  }
}
await compile(join(root, "src"), join(root, "dist"));
await build({
  stdin: { contents: 'export { applyEdits, modify, parse } from "jsonc-parser";', resolveDir: root, sourcefile: "jsonc-vendor.js" },
  outfile: join(root, "dist", "vendor", "jsonc.js"),
  bundle: true, format: "esm", platform: "node", target: "node22",
  mainFields: ["module", "main"],
});
await writeFile(join(root, "dist", "package.json"), '{"type":"module"}\n');
console.log("Built dist/tui.js and the standalone maintenance worker.");
