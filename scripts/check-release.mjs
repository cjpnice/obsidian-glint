import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const fail = (message) => {
  console.error(`Release check failed: ${message}`);
  process.exitCode = 1;
};

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const versions = readJson("versions.json");

if (!/^[a-z0-9-]+$/.test(manifest.id)) fail("manifest.id must contain only lowercase letters, numbers, and hyphens.");
if (manifest.id.includes("obsidian")) fail("manifest.id must not contain 'obsidian'.");
if (manifest.id.endsWith("plugin")) fail("manifest.id must not end with 'plugin'.");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail("manifest.version must use x.y.z SemVer.");
if (manifest.version !== pkg.version) fail("manifest.json version must match package.json version.");
if (!manifest.name || !/^[\x20-\x7E]+$/.test(manifest.name)) fail("manifest.name must be non-empty Basic Latin text.");
if (!manifest.author) fail("manifest.author is required.");
if (!manifest.description) fail("manifest.description is required.");
if (/\bobsidian\b/i.test(manifest.description)) fail("manifest.description must not include the word 'Obsidian'.");
if (!manifest.minAppVersion) fail("manifest.minAppVersion is required.");
if (typeof manifest.isDesktopOnly !== "boolean") fail("manifest.isDesktopOnly must be a boolean.");
if (versions[manifest.version] !== manifest.minAppVersion) fail("versions.json must map the current plugin version to minAppVersion.");

for (const file of ["README.md", "LICENSE", "manifest.json", "versions.json", "main.js", "styles.css"]) {
  if (!fs.existsSync(path.join(root, file))) fail(`${file} is missing.`);
}

if (!process.exitCode) {
  console.log(`Release check passed for ${manifest.id} ${manifest.version}.`);
}
