#!/usr/bin/env node
// Télécharge la liste des applications détectables de Discord et en écrit une
// version allégée dans `src-tauri/assets/gamelist.min.json`.
//
// Ce snapshot sert de dernier recours lorsque ni le miroir, ni l'API Discord,
// ni le cache disque ne sont disponibles. Le schéma de sortie doit rester
// synchronisé avec `src-tauri/src/catalog/model.rs`.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://discord.com/api/v10/applications/detectable";
const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/assets/gamelist.min.json",
);

/** @param {unknown} value */
const asStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

/** @param {any} raw */
function slimGame(raw) {
  const executables = (Array.isArray(raw.executables) ? raw.executables : [])
    .filter((exe) => typeof exe?.name === "string" && typeof exe?.os === "string")
    .map((exe) => ({
      name: exe.name,
      os: exe.os,
      ...(exe.is_launcher ? { is_launcher: true } : {}),
    }));

  const aliases = asStringArray(raw.aliases);
  const themes = asStringArray(raw.themes);
  const iconHash = raw.icon_hash ?? raw.icon ?? null;

  return {
    id: String(raw.id),
    name: String(raw.name),
    ...(aliases.length ? { aliases } : {}),
    executables,
    ...(iconHash ? { icon_hash: iconHash } : {}),
    ...(themes.length ? { themes } : {}),
  };
}

const response = await fetch(SOURCE_URL, { headers: { accept: "application/json" } });
if (!response.ok) {
  console.error(`Échec du téléchargement (${response.status} ${response.statusText})`);
  process.exit(1);
}

const raw = await response.json();
if (!Array.isArray(raw) || raw.length === 0) {
  console.error("Réponse inattendue : liste vide ou format invalide.");
  process.exit(1);
}

const games = raw
  .filter((game) => game?.id && game?.name)
  .map(slimGame)
  .filter((game) => game.executables.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name));

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(games));

const kib = (JSON.stringify(games).length / 1024).toFixed(0);
console.log(`${games.length} jeux écrits dans ${OUTPUT} (${kib} KiB)`);
