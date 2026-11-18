#!/usr/bin/env node
// Garde le numéro de version identique dans tous les fichiers qui le portent.
//
//   npm run version:set -- 2.2.0   écrit la version partout
//   npm run version:check          vérifie qu'elle est partout la même
//   npm run version:check -- v2.2.0  …et qu'elle correspond à ce tag (CI de release)
//
// Les fichiers sont modifiés par remplacement ciblé, jamais réécrits en entier :
// leur mise en forme ne change pas.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const V = String.raw`(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)`;

/**
 * Each place holding the version: a regex whose group 2 is the version, between
 * groups 1 and 3 that stay as they are.
 * @type {{ file: string, pattern: RegExp }[]}
 */
const TARGETS = [
  { file: "package.json", pattern: new RegExp(String.raw`^(  "version": ")${V}(",)$`, "m") },
  // The root package, then its entry under `packages[""]`.
  { file: "package-lock.json", pattern: new RegExp(String.raw`^(  "version": ")${V}(",)$`, "m") },
  {
    file: "package-lock.json",
    pattern: new RegExp(String.raw`^(    "": \{\n      "name": "discord-quest-completer",\n      "version": ")${V}(",)$`, "m"),
  },
  { file: "src-tauri/tauri.conf.json", pattern: new RegExp(String.raw`^(  "version": ")${V}(",)$`, "m") },
  { file: "src-tauri/Cargo.toml", pattern: new RegExp(String.raw`^(\[package\]\nname = "discord-quest-completer"\nversion = ")${V}(")$`, "m") },
  { file: "runner/Cargo.toml", pattern: new RegExp(String.raw`^(\[package\]\nname = "dqc-runner"\nversion = ")${V}(")$`, "m") },
  { file: "Cargo.lock", pattern: new RegExp(String.raw`^(name = "discord-quest-completer"\nversion = ")${V}(")$`, "m") },
  { file: "runner/Cargo.lock", pattern: new RegExp(String.raw`^(name = "dqc-runner"\nversion = ")${V}(")$`, "m") },
];

/** Files whose checkout uses CRLF (Windows, `core.autocrlf`): written back the same way. */
const crlfFiles = new Set();

/** @param {string} file */
async function read(file) {
  const text = await readFile(resolve(ROOT, file), "utf8");
  if (text.includes("\r\n")) crlfFiles.add(file);
  // Normalised so the multi-line patterns match whatever the line endings.
  return text.replace(/\r\n/g, "\n");
}

/** @param {string} file @param {string} text */
async function write(file, text) {
  await writeFile(resolve(ROOT, file), crlfFiles.has(file) ? text.replace(/\n/g, "\r\n") : text);
}

async function collect() {
  /** @type {Map<string, string>} */
  const contents = new Map();
  /** @type {{ file: string, version: string }[]} */
  const found = [];
  for (const { file, pattern } of TARGETS) {
    if (!contents.has(file)) contents.set(file, await read(file));
    const match = contents.get(file)?.match(pattern);
    if (!match?.[2]) {
      throw new Error(`Version introuvable dans ${file} (motif ${pattern.source})`);
    }
    found.push({ file, version: match[2] });
  }
  return { contents, found };
}

/** @param {string | undefined} tag */
async function check(tag) {
  const { found } = await collect();
  const versions = new Set(found.map(({ version }) => version));
  const expected = tag?.replace(/^v/, "");

  if (versions.size === 1 && (!expected || versions.has(expected))) {
    console.log(`Version ${[...versions][0]} partout${expected ? `, conforme au tag ${tag}` : ""}.`);
    return;
  }

  console.error("Versions incohérentes :");
  for (const { file, version } of found) console.error(`  ${version.padEnd(12)} ${file}`);
  if (expected) console.error(`  attendu      ${expected} (tag ${tag})`);
  process.exit(1);
}

/** @param {string} version */
async function set(version) {
  if (!SEMVER.test(version)) {
    console.error(`« ${version} » n'est pas une version valide (attendu : 1.2.3).`);
    process.exit(1);
  }

  const { contents, found } = await collect();
  for (const { file, pattern } of TARGETS) {
    const text = contents.get(file) ?? "";
    contents.set(file, text.replace(pattern, (_, before, _old, after) => `${before}${version}${after}`));
  }
  for (const [file, text] of contents) await write(file, text);

  const previous = [...new Set(found.map(({ version: old }) => old))].join(", ");
  console.log(`Version ${previous} → ${version} dans ${contents.size} fichiers.`);
  console.log(`Ensuite : git commit -am "Discord Quest Completer ${version}" && git tag v${version} && git push origin HEAD v${version}`);
}

const [command, argument] = process.argv.slice(2);
if (command === "set" && argument) {
  await set(argument);
} else if (command === "check") {
  await check(argument);
} else {
  console.error("Usage : node scripts/version.mjs set <version> | check [tag]");
  process.exit(1);
}
