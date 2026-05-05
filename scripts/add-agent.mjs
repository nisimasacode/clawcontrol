#!/usr/bin/env node
/**
 * add-agent — Add a new worker agent to the ClawControl stack.
 *
 * Usage:
 *   node scripts/add-agent.mjs --name <agent-name> [--browser <true|false>] [--seed-auth-profiles] [--auth-profiles-source <path>]
 *
 * What it does:
 *   1. Adds ob1-mcp-<name>, openclaw-<name> (+ optional chromium-<name>) to docker-compose.yml
 *   2. Adds orchestrator volume mount for the new agent's config
 *   3. Updates PostgREST PGRST_DB_SCHEMAS
 *   4. Updates ob1/init.sql with the new schema + grants
 *   5. Renders configs/<name>/openclaw.json from template
 *   6. Optionally seeds configs/<name>/auth-profiles.json from a source file
 *   7. Appends env vars to .env.example (and .env if present)
 *   8. Regenerates nginx gateway routing template/config wiring
 *   9. Prints SQL to create the schema in a running database
 *
 * Zero dependencies — runs on any Node.js 18+.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

// ── Paths ───────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSE = resolve(ROOT, "docker-compose.yml");
const ENV_EXAMPLE = resolve(ROOT, ".env.example");
const ENV_FILE = resolve(ROOT, ".env");
const INIT_SQL = resolve(ROOT, "ob1", "init.sql");
const TEMPLATE = resolve(ROOT, "templates", "openclaw.worker.json");
const TEMPLATE_NO_BROWSER = resolve(ROOT, "templates", "openclaw.worker.nobrowser.json");
const DEFAULT_AUTH_PROFILES_SOURCE = resolve(
  ROOT,
  ".openclaw",
  "agents",
  "main",
  "agent",
  "auth-profiles.json"
);
const USAGE =
  "Usage: node scripts/add-agent.mjs --name <agent-name> [--browser <true|false>] [--seed-auth-profiles] [--auth-profiles-source <path>]";

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const nameIdx = args.indexOf("--name");
const browserIdx = args.indexOf("--browser");
const seedAuthProfiles = args.includes("--seed-auth-profiles");
const authProfilesSourceIdx = args.indexOf("--auth-profiles-source");

if (nameIdx === -1 || !args[nameIdx + 1] || args[nameIdx + 1].startsWith("--")) {
  console.error(USAGE);
  process.exit(1);
}

if (browserIdx !== -1 && (!args[browserIdx + 1] || args[browserIdx + 1].startsWith("--"))) {
  console.error(USAGE);
  process.exit(1);
}

if (
  authProfilesSourceIdx !== -1 &&
  (!args[authProfilesSourceIdx + 1] || args[authProfilesSourceIdx + 1].startsWith("--"))
) {
  console.error(USAGE);
  process.exit(1);
}

const name = args[nameIdx + 1];
const browserArg = browserIdx === -1 ? "true" : args[browserIdx + 1].toLowerCase();
const authProfilesSourceArg =
  authProfilesSourceIdx === -1 ? null : args[authProfilesSourceIdx + 1];

if (browserArg !== "true" && browserArg !== "false") {
  console.error('Error: --browser must be "true" or "false".');
  process.exit(1);
}

const browserEnabled = browserArg === "true";

if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(
    'Error: name must start with a lowercase letter and contain only [a-z0-9-].'
  );
  process.exit(1);
}

const shouldSeedAuthProfiles = seedAuthProfiles || authProfilesSourceArg !== null;
const authProfilesSourcePath = authProfilesSourceArg
  ? resolve(authProfilesSourceArg)
  : DEFAULT_AUTH_PROFILES_SOURCE;
let authProfilesSeedContent = null;

if (shouldSeedAuthProfiles) {
  if (!existsSync(authProfilesSourcePath)) {
    console.error(
      `Error: auth profiles source not found at "${authProfilesSourcePath}". ` +
      "Provide --auth-profiles-source <path> or omit --seed-auth-profiles."
    );
    process.exit(1);
  }
  authProfilesSeedContent = readFileSync(authProfilesSourcePath, "utf-8");
  try {
    JSON.parse(authProfilesSeedContent);
  } catch (err) {
    console.error(
      `Error: auth profiles source at "${authProfilesSourcePath}" is not valid JSON: ${err.message}`
    );
    process.exit(1);
  }
}

// Derived identifiers
const envPrefix = name.toUpperCase().replace(/-/g, "_"); // RESEARCH_ASSISTANT
const schema = name.replace(/-/g, "_"); // research_assistant
const label = name.toUpperCase().replace(/-/g, " "); // RESEARCH ASSISTANT

// ── Read compose ────────────────────────────────────────────────────────────
let compose = readFileSync(COMPOSE, "utf-8");

if (compose.includes(`openclaw-${name}:`)) {
  console.error(`Error: agent "${name}" already exists in docker-compose.yml`);
  process.exit(1);
}

// ── Auto-detect next available ports ────────────────────────────────────────
function findHighestDefault(pattern) {
  let max = 0;
  for (const m of compose.matchAll(pattern)) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max;
}

// Gateway ports use odd numbers starting at 18791, bridge = gateway + 1
const highestGateway = findHighestDefault(/:-(\d+)\}:18789/g) || 18789;
const nextGateway = highestGateway + 2;
const nextBridge = nextGateway + 1;

// Chromium UI ports increment from 3002
const highestChromiumUI = browserEnabled
  ? findHighestDefault(/:-(\d+)\}:3001/g) || 3001
  : 0;
const nextChromiumUI = browserEnabled ? highestChromiumUI + 1 : null;

// ── Generate service blocks ─────────────────────────────────────────────────
const ob1McpBlock = `
  ob1-mcp-${name}:
    build:
      context: ./ob1/mcp-server
    container_name: ob1-mcp-${name}
    restart: unless-stopped
    depends_on:
      ob1-db:
        condition: service_healthy
    environment:
      DB_HOST: ob1-db
      DB_PORT: 5432
      DB_NAME: \${POSTGRES_DB:-openbrain}
      DB_USER: \${POSTGRES_USER:-ob1}
      DB_PASSWORD: \${POSTGRES_PASSWORD}
      OB1_SCHEMA: ${schema}
      OPENROUTER_API_KEY: \${OPENROUTER_API_KEY:-}
      EMBEDDING_API_BASE: \${OB1_EMBEDDING_API_BASE:-https://openrouter.ai/api/v1}
      EMBEDDING_API_KEY: \${OB1_EMBEDDING_API_KEY:-}
      EMBEDDING_MODEL: \${OB1_EMBEDDING_MODEL:-openai/text-embedding-3-small}
      MCP_ACCESS_KEY: \${${envPrefix}_OB1_MCP_ACCESS_KEY:-}
      PORT: 8000
    networks:
      - agent-net
`;

const agentBlock = `
  # ═══════════════════════════════════════════════════════════════════════════
  #  ${label} — Worker agent
  # ═══════════════════════════════════════════════════════════════════════════

  openclaw-${name}:
    <<: *openclaw-common
    image: \${OPENCLAW_${envPrefix}_IMAGE:-ghcr.io/openclaw/openclaw:latest}
    container_name: openclaw-${name}
    depends_on:
      ob1-db:
        condition: service_healthy
      ob1-mcp-${name}:
        condition: service_started
    environment:
      HOME: /home/node
      TERM: xterm-256color
      TZ: \${TZ:-Europe/Berlin}
      OPENCLAW_GATEWAY_TOKEN: \${${envPrefix}_GATEWAY_TOKEN:-}
      OPENCLAW_GATEWAY_PORT: \${${envPrefix}_GATEWAY_PORT:-${nextGateway}}
      TELEGRAM_BOT_TOKEN: \${${envPrefix}_TELEGRAM_BOT_TOKEN:-}
      OPENAI_API_KEY: \${OPENAI_API_KEY:-}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      OPENROUTER_API_KEY: \${OPENROUTER_API_KEY:-}
      OB1_DB_URL: "postgres://\${POSTGRES_USER:-ob1}:\${POSTGRES_PASSWORD}@ob1-db:5432/\${POSTGRES_DB:-openbrain}"
      OB1_REST_URL: "http://ob1-rest:3000"
      OB1_SCHEMA: ${schema}
      OB1_MCP_URL: "http://ob1-mcp-${name}:8000"
      OB1_MCP_ACCESS_KEY: \${${envPrefix}_OB1_MCP_ACCESS_KEY:-}
${browserEnabled ? `      BROWSER_CDP_URL: "http://chromium-${name}:9223"\n` : ""}    volumes:
      - \${DATA_ROOT}/openclaw-${name}/.openclaw:/home/node/.openclaw
      - \${DATA_ROOT}/openclaw-${name}/workspace:/home/node/.openclaw/workspace
      - ./configs/${name}:/seed:ro
    ports:
      - "\${${envPrefix}_GATEWAY_PORT:-${nextGateway}}:\${${envPrefix}_GATEWAY_PORT:-${nextGateway}}"
      - "\${${envPrefix}_BRIDGE_PORT:-${nextBridge}}:\${${envPrefix}_BRIDGE_PORT:-${nextBridge}}"
    command:
      - "/bin/sh"
      - "-c"
      - |
        test -f /home/node/.openclaw/openclaw.json || cp /seed/openclaw.json /home/node/.openclaw/openclaw.json
        if [ -f /seed/auth-profiles.json ] && [ ! -f /home/node/.openclaw/agents/main/agent/auth-profiles.json ]; then
          mkdir -p /home/node/.openclaw/agents/main/agent
          cp /seed/auth-profiles.json /home/node/.openclaw/agents/main/agent/auth-profiles.json
        fi
        exec node dist/index.js gateway --bind lan --port \${${envPrefix}_GATEWAY_PORT:-${nextGateway}}
    healthcheck:
      test:
        [
          "CMD", "node", "-e",
          "fetch('http://127.0.0.1:\${${envPrefix}_GATEWAY_PORT:-${nextGateway}}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s
`;

const chromiumBlock = browserEnabled
  ? `
  chromium-${name}:
    <<: *chromium-common
    container_name: chromium-${name}
    environment:
      TZ: \${TZ:-Europe/Berlin}
      CUSTOM_HTTPS_PORT: 3001
      CHROME_CLI: "--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=*"
      DISPLAY: ":1"
      START_DOCKER: "true"
    volumes:
      - \${DATA_ROOT}/chromium-${name}:/config:rw
    ports:
      - "\${${envPrefix}_CHROMIUM_UI_PORT:-${nextChromiumUI}}:3001"
`
  : "";

const serviceBlock = `${ob1McpBlock}${agentBlock}${chromiumBlock}`;

// ── 1. Insert agent block before the NETWORKS section ───────────────────────
// Detect line ending style used in the file
const eol = compose.includes("\r\n") ? "\r\n" : "\n";
const networkRe = /^# =+\r?\n#  NETWORKS/m;
const networkMatch = compose.match(networkRe);
if (!networkMatch) {
  console.error("Error: could not find NETWORKS marker in docker-compose.yml");
  process.exit(1);
}
// Normalise the generated block to the file's line-ending style
const block = serviceBlock.trimEnd().replace(/\r?\n/g, eol);
compose = compose.replace(networkRe, block + eol + eol + networkMatch[0]);

// ── 2. Add orchestrator mount for the new agent's config ────────────────────
// Insert after the last existing /mounted-agents/ line
const mountLine = `      - \${DATA_ROOT}/openclaw-${name}/.openclaw:/mounted-agents/${name}/.openclaw`;
const mountPattern = /( +- \$\{DATA_ROOT\}\/openclaw-[^/]+\/\.openclaw:\/mounted-agents\/[^/]+\/\.openclaw\r?\n)(?!.*\/mounted-agents\/)/s;
compose = compose.replace(mountPattern, `$1${mountLine}${eol}`);

// ── 3. Update PostgREST PGRST_DB_SCHEMAS ────────────────────────────────────
compose = compose.replace(
  /(PGRST_DB_SCHEMAS:\s*"[^"]*)/,
  `$1,${schema}`
);

writeFileSync(COMPOSE, compose);
console.log(`✓ docker-compose.yml updated`);

// ── 3b. Regenerate nginx routing template and nginx env wiring ───────────────
execFileSync(process.execPath, [resolve(ROOT, "scripts", "render-nginx-config.mjs")], {
  stdio: "inherit",
});

// ── 1b. Render config template ───────────────────────────────────────────────
const configDir = resolve(ROOT, "configs", name);
mkdirSync(configDir, { recursive: true });
const configOut = resolve(configDir, "openclaw.json");
if (!existsSync(configOut)) {
  const templatePath = browserEnabled ? TEMPLATE : TEMPLATE_NO_BROWSER;
  const tpl = readFileSync(templatePath, "utf-8");
  const rendered = tpl.replace(/\{\{AGENT_NAME\}\}/g, name);
  writeFileSync(configOut, rendered);
  console.log(`✓ configs/${name}/openclaw.json rendered from template`);
} else {
  console.log(`• configs/${name}/openclaw.json already exists, skipped`);
}

if (shouldSeedAuthProfiles) {
  const authProfilesOut = resolve(configDir, "auth-profiles.json");
  if (!existsSync(authProfilesOut)) {
    writeFileSync(authProfilesOut, authProfilesSeedContent);
    console.log(`✓ configs/${name}/auth-profiles.json seeded from ${authProfilesSourcePath}`);
  } else {
    console.log(`• configs/${name}/auth-profiles.json already exists, skipped`);
  }
}

// ── 4. Update ob1/init.sql — add schema creation + grants ───────────────────
if (existsSync(INIT_SQL)) {
  let sql = readFileSync(INIT_SQL, "utf-8");

  // Add schema creation call before the public schema line
  const schemaCall = `SELECT create_ob1_schema('${schema}');`;
  if (!sql.includes(schemaCall)) {
    sql = sql.replace(
      "-- Also set up the public schema",
      `${schemaCall}\n\n-- Also set up the public schema`
    );
  }

  // Add grants for the new schema
  const grantUsage = `GRANT USAGE ON SCHEMA public, orchestrator, agent1, agent2`;
  if (sql.includes(grantUsage) && !sql.includes(`, ${schema} TO anon`)) {
    // Add new schema to all GRANT lines
    sql = sql.replace(
      new RegExp(`(GRANT USAGE ON SCHEMA [^;]+)(\\s+TO anon)`, "g"),
      `$1, ${schema}$2`
    );
    sql = sql.replace(
      new RegExp(`(GRANT SELECT.*IN SCHEMA )(?!.*${schema})`, "g"),
      ""
    );
    // Append the new schema grant
    const lastGrant = sql.match(/GRANT SELECT.*IN SCHEMA\s+\w+\s+TO anon;/g);
    if (lastGrant) {
      const after = lastGrant[lastGrant.length - 1];
      sql = sql.replace(
        after,
        `${after}\nGRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema.padEnd(14)} TO anon;`
      );
    }
  }

  writeFileSync(INIT_SQL, sql);
  console.log(`✓ ob1/init.sql updated`);
}

// ── 5. Append env vars to .env.example and .env ─────────────────────────────
const envBlock = `
# ── ${label} ──
${envPrefix}_GATEWAY_TOKEN=
${envPrefix}_TELEGRAM_BOT_TOKEN=
${envPrefix}_GATEWAY_PORT=${nextGateway}
${envPrefix}_BRIDGE_PORT=${nextBridge}
${envPrefix}_OB1_MCP_ACCESS_KEY=
${browserEnabled ? `${envPrefix}_CHROMIUM_UI_PORT=${nextChromiumUI}\n` : ""}#OPENCLAW_${envPrefix}_IMAGE=ghcr.io/openclaw/openclaw:latest
`;

for (const path of [ENV_EXAMPLE, ENV_FILE]) {
  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8");
    if (!content.includes(`${envPrefix}_GATEWAY_TOKEN`)) {
      writeFileSync(path, content.trimEnd() + "\n" + envBlock);
      console.log(`✓ ${path === ENV_FILE ? ".env" : ".env.example"} updated`);
    }
  }
}

// ── 6. Print next steps ─────────────────────────────────────────────────────
console.log(`
Agent "${name}" added successfully.

  Ports:  gateway=${nextGateway}  bridge=${nextBridge}${browserEnabled ? `  chromium-ui=${nextChromiumUI}` : ""}
  Schema: ${schema}
  Browser: ${browserEnabled ? "enabled" : "disabled"}
  Auth profile seed: ${shouldSeedAuthProfiles ? `enabled (${authProfilesSourcePath})` : "disabled"}

Next steps:

  # If the database is already running, create the schema:
  docker exec ob1-db psql -U ob1 -d openbrain -c "SELECT create_ob1_schema('${schema}');"

  # Start the new containers:
  docker compose up -d openclaw-${name}${browserEnabled ? ` chromium-${name}` : ""}
`);
