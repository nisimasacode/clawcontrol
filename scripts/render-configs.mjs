#!/usr/bin/env node
/**
 * render-configs — Re-render all seed configs from templates.
 *
 * Usage:
 *   node scripts/render-configs.mjs
 *
 * Reads docker-compose.yml to discover agents, then renders the
 * appropriate template into configs/<name>/openclaw.json.
 *
 * Zero dependencies — runs on any Node.js 18+.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSE = resolve(ROOT, "docker-compose.yml");
const WORKER_TPL = readFileSync(resolve(ROOT, "templates", "openclaw.worker.json"), "utf-8");
const ORCH_TPL = readFileSync(resolve(ROOT, "templates", "openclaw.orchestrator.json"), "utf-8");

const compose = readFileSync(COMPOSE, "utf-8");

// Find all openclaw-<name> services (container_name lines)
const agents = [...compose.matchAll(/container_name:\s*openclaw-([a-z0-9-]+)/g)]
  .map((m) => m[1]);

let count = 0;
for (const name of agents) {
  const isOrchestrator = name === "orchestrator";
  const tpl = isOrchestrator ? ORCH_TPL : WORKER_TPL;
  const rendered = tpl.replace(/\{\{AGENT_NAME\}\}/g, name);

  const dir = resolve(ROOT, "configs", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "openclaw.json"), rendered);
  count++;
  console.log(`✓ configs/${name}/openclaw.json`);
}

console.log(`\nRendered ${count} config(s).`);
