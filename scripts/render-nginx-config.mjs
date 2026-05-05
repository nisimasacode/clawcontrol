#!/usr/bin/env node
/**
 * render-nginx-config — Regenerate nginx gateway routing from docker-compose.
 *
 * Usage:
 *   node scripts/render-nginx-config.mjs
 *
 * What it does:
 *   1. Discovers all openclaw-<name> services from docker-compose.yml
 *   2. Rebuilds the openclaw-nginx service env wiring for *_GATEWAY_PORT vars
 *   3. Regenerates nginx/nginx.conf.template routes/upstreams for every agent
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSE = resolve(ROOT, "docker-compose.yml");
const NGINX_DIR = resolve(ROOT, "nginx");
const NGINX_TEMPLATE = resolve(NGINX_DIR, "nginx.conf.template");

const compose = readFileSync(COMPOSE, "utf-8");
const eol = compose.includes("\r\n") ? "\r\n" : "\n";

function listOpenclawAgents(composeText) {
  const agents = [...composeText.matchAll(/container_name:\s*openclaw-([a-z0-9-]+)/g)].map((m) => m[1]);
  const unique = [...new Set(agents)].filter((name) => name !== "nginx");
  return unique.sort((a, b) => {
    if (a === "orchestrator") return -1;
    if (b === "orchestrator") return 1;
    return a.localeCompare(b);
  });
}

function gatewayVarForAgent(name) {
  if (name === "orchestrator") return "ORCHESTRATOR_GATEWAY_PORT";
  return `${name.toUpperCase().replace(/-/g, "_")}_GATEWAY_PORT`;
}

function gatewayDefaultForAgent(composeText, name) {
  const varName = gatewayVarForAgent(name);
  const re = new RegExp(`\\$\\{${varName}:-([0-9]+)\\}`);
  const m = composeText.match(re);
  if (m) return m[1];
  if (name === "orchestrator") return "18789";
  return "18789";
}

function buildNginxServiceBlock(composeText, agents, newline) {
  const envLines = agents.map((name) => {
    const varName = gatewayVarForAgent(name);
    const defaultPort = gatewayDefaultForAgent(composeText, name);
    return `      ${varName}: \${${varName}:-${defaultPort}}`;
  });

  return [
    "  openclaw-nginx:",
    "    image: nginx:1.27-alpine",
    "    container_name: openclaw-nginx",
    "    restart: unless-stopped",
    "    environment:",
    ...envLines,
    "    ports:",
    "      - \"${NGINX_HTTP_PORT:-80}:80\"",
    "      - \"${NGINX_HTTPS_PORT:-443}:443\"",
    "    volumes:",
    "      - ./nginx/nginx.conf.template:/etc/nginx/templates/default.conf.template:ro",
    "      - ./nginx/certs:/etc/nginx/certs:ro",
    "    networks:",
    "      - agent-net",
    "",
    "",
  ].join(newline);
}

function upsertNginxService(composeText, nginxBlock) {
  const networkMarker = /^# =+\r?\n#  NETWORKS/m;
  const networkMatch = composeText.match(networkMarker);
  if (!networkMatch || networkMatch.index === undefined) {
    throw new Error("Could not locate NETWORKS marker in docker-compose.yml");
  }
  const networkIndex = networkMatch.index;

  const nginxMatch = composeText.match(/^  openclaw-nginx:\r?\n/m);
  if (nginxMatch && nginxMatch.index !== undefined && nginxMatch.index < networkIndex) {
    return composeText.slice(0, nginxMatch.index) + nginxBlock + composeText.slice(networkIndex);
  }

  return composeText.slice(0, networkIndex) + nginxBlock + composeText.slice(networkIndex);
}

function renderNginxTemplate(agents) {
  if (agents.length === 0) {
    throw new Error("No openclaw agents discovered in compose file");
  }

  const defaultRoute = agents.includes("orchestrator") ? "orchestrator" : agents[0];

  const upstreamBlocks = agents
    .map((name) => {
      const upstreamName = `${name.replace(/-/g, "_")}_gateway`;
      const varName = gatewayVarForAgent(name);
      const varRef = `\${${varName}}`;
      return `upstream ${upstreamName} {\n  server openclaw-${name}:${varRef};\n}`;
    })
    .join("\n\n");

  const exactPathRedirects = agents
    .map(
      (name) => `  location = /${name} {\n    return 301 /${name}/;\n  }`
    )
    .join("\n\n");

  const proxyBlocks = agents
    .map((name) => {
      const upstreamName = `${name.replace(/-/g, "_")}_gateway`;
      return `  location /${name}/ {\n    rewrite ^/${name}/?(.*)$ /$1 break;\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto https;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection $connection_upgrade;\n    proxy_pass http://${upstreamName};\n  }`;
    })
    .join("\n\n");

  return `map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

${upstreamBlocks}

server {
  listen 80;
  server_name _;

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl;
  http2 on;
  server_name _;

  ssl_certificate /etc/nginx/certs/tls.crt;
  ssl_certificate_key /etc/nginx/certs/tls.key;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 10m;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;

  client_max_body_size 32m;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;

  location = / {
    return 302 /${defaultRoute}/;
  }

${exactPathRedirects}

${proxyBlocks}
}
`;
}

const agents = listOpenclawAgents(compose);
if (agents.length === 0) {
  console.error("Error: no openclaw-* services were found in docker-compose.yml");
  process.exit(1);
}

const nginxServiceBlock = buildNginxServiceBlock(compose, agents, eol);
const nextCompose = upsertNginxService(compose, nginxServiceBlock);
if (nextCompose !== compose) {
  writeFileSync(COMPOSE, nextCompose);
  console.log("✓ docker-compose.yml nginx service block regenerated");
} else {
  console.log("• docker-compose.yml nginx service block already up to date");
}

mkdirSync(NGINX_DIR, { recursive: true });
const template = renderNginxTemplate(agents).replace(/\n/g, eol);
writeFileSync(NGINX_TEMPLATE, template);
console.log("✓ nginx/nginx.conf.template regenerated");
