#!/usr/bin/env node
/**
 * generate-ob1-mcp-keys — Print secure per-agent OB1 MCP access keys.
 *
 * Usage:
 *   node scripts/generate-ob1-mcp-keys.mjs
 *
 * What it does:
 *   - Reads docker-compose.yml
 *   - Discovers OB1_MCP_ACCESS_KEY env references used by services
 *   - Prints one secure MCP access key env line per unique key prefix
 *
 * Notes:
 *   - Output is intended to be pasted into .env
 *   - Existing .env values are not modified automatically
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSE = resolve(ROOT, "docker-compose.yml");

function normalizeEnvPrefix(name) {
  return name.toUpperCase().replace(/-/g, "_");
}

function makeKey() {
  return randomBytes(32).toString("hex");
}

let compose;
try {
  compose = readFileSync(COMPOSE, "utf-8");
} catch (err) {
  console.error(`Error: could not read ${COMPOSE}: ${err.message}`);
  process.exit(1);
}

const keyPrefixes = [];
const seen = new Set();
for (const match of compose.matchAll(/OB1_MCP_ACCESS_KEY:\s*\$\{([A-Z0-9_-]+)_OB1_MCP_ACCESS_KEY(?::-[^}]*)?\}/g)) {
  const prefix = normalizeEnvPrefix(match[1]);
  if (!seen.has(prefix)) {
    seen.add(prefix);
    keyPrefixes.push(prefix);
  }
}

if (keyPrefixes.length === 0) {
  console.error("Error: no OB1_MCP_ACCESS_KEY env references found in docker-compose.yml");
  process.exit(1);
}

console.log("# OB1 MCP access keys");
console.log("# Paste these into .env and keep them secret.");
for (const prefix of keyPrefixes) {
  console.log(`${prefix}_OB1_MCP_ACCESS_KEY=${makeKey()}`);
}
