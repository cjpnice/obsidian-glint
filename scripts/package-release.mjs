import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const outDir = path.join(root, "dist");
const pluginDir = path.join(outDir, manifest.id);
const zipPath = path.join(outDir, `${manifest.id}-${manifest.version}.zip`);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(pluginDir, { recursive: true });

for (const file of ["manifest.json", "main.js", "styles.css"]) {
  fs.copyFileSync(path.join(root, file), path.join(pluginDir, file));
}

execFileSync("zip", ["-q", "-r", zipPath, "manifest.json", "main.js", "styles.css"], {
  cwd: pluginDir,
  stdio: "inherit"
});

console.log(`Packaged ${zipPath}`);
