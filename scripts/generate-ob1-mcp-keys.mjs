#!/usr/bin/env node
/**
 * generate-ob1-mcp-keys — Print secure per-agent OB1 MCP access keys.
 *
 * Usage:
 *   node scripts/generate-ob1-mcp-keys.mjs
 *
 * What it does:
 *   - Reads docker-compose.yml
 *   - Discovers all openclaw-* services
 *   - Prints one secure MCP access key env line per agent/service
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

function toEnvPrefix(name) {
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

const agentNames = [...compose.matchAll(/container_name:\s*openclaw-([a-z0-9-]+)/g)]
  .map((m) => m[1]);

if (agentNames.length === 0) {
  console.error("Error: no openclaw-* services found in docker-compose.yml");
  process.exit(1);
}

console.log("# OB1 MCP access keys");
console.log("# Paste these into .env and keep them secret.");
for (const name of agentNames) {
  const prefix = toEnvPrefix(name);
  console.log(`${prefix}_OB1_MCP_ACCESS_KEY=${makeKey()}`);
}
