#!/usr/bin/env node

import { readFileSync, existsSync, statSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { execFileSync } from "child_process";

const prefix = "[openclaw-mount-permissions]";
const targetPath = resolve(process.argv[2] || process.env.COMPOSE_REPO_MOUNT_PATH || "/compose-files");
const targetUid = 1000;
const targetGid = 1000;
const composeFilePath = process.env.COMPOSE_FILE_PATH || resolve(targetPath, "docker-compose.yml");
const dataRoot = process.env.DATA_ROOT || "";

function fail(message) {
  console.error(`${prefix} ${message}`);
  process.exit(1);
}

function getIndent(raw) {
  const match = raw.match(/^ */);
  return match ? match[0].length : 0;
}

function extractVolumeSources(composeText) {
  const lines = composeText.split(/\r?\n/);
  const sources = new Set();
  let inServices = false;
  let inOpenclaw = false;
  let inVolumes = false;

  for (const raw of lines) {
    const indent = getIndent(raw);
    const line = raw.trimStart();

    if (/^services:\s*$/.test(line)) {
      inServices = true;
      inOpenclaw = false;
      inVolumes = false;
      continue;
    }
    if (!inServices) continue;

    if (indent === 2 && /^[A-Za-z0-9_.-]+:\s*$/.test(line)) {
      const service = line.slice(0, -1);
      inOpenclaw = service.startsWith("openclaw-");
      inVolumes = false;
      continue;
    }

    if (!inOpenclaw) continue;

    if (indent === 4 && /^volumes:\s*$/.test(line)) {
      inVolumes = true;
      continue;
    }
    if (indent <= 4 && !/^volumes:\s*$/.test(line)) inVolumes = false;

    if (inVolumes && indent >= 6 && /^-\s*/.test(line)) {
      const item = line.replace(/^-\s*/, "").replace(/\s+#.*/, "");
      const sep = item.indexOf(":");
      if (sep !== -1) sources.add(item.slice(0, sep).trim());
    }
  }

  return [...sources].sort();
}

function resolveSourcePath(source) {
  if (source === ".") return targetPath;
  if (source.startsWith("./")) return resolve(targetPath, source.slice(2));
  if (source === "/var/run/docker.sock") return null;
  if (source.startsWith("/")) return source;
  if (source.startsWith("${DATA_ROOT}/")) return dataRoot ? resolve(dataRoot, source.slice("${DATA_ROOT}/".length)) : null;
  return null;
}

function hasOwnershipMismatch(path) {
  if (!existsSync(path)) return false;
  const first = statSync(path);
  if (first.uid !== targetUid || first.gid !== targetGid) return true;
  if (!first.isDirectory()) return false;

  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(current, entry.name);
      const info = statSync(fullPath);
      if (info.uid !== targetUid || info.gid !== targetGid) return true;
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
  return false;
}

function applyOwnership(path) {
  const isDir = statSync(path).isDirectory();
  const args = isDir ? ["-R", `${targetUid}:${targetGid}`, path] : [`${targetUid}:${targetGid}`, path];
  execFileSync("chown", args, { stdio: "inherit" });
}

if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) fail(`target path not found: ${targetPath}`);
if (!existsSync(composeFilePath) || !statSync(composeFilePath).isFile()) fail(`compose file not found: ${composeFilePath}`);

const composeText = readFileSync(composeFilePath, "utf-8");
const resolvedTargets = new Set([targetPath]);
for (const source of extractVolumeSources(composeText)) {
  const resolved = resolveSourcePath(source);
  if (resolved) resolvedTargets.add(resolved);
}

let changed = false;
for (const candidate of [...resolvedTargets].sort()) {
  if (!existsSync(candidate)) {
    console.log(`${prefix} skipping missing path: ${candidate}`);
    continue;
  }
  if (!hasOwnershipMismatch(candidate)) continue;
  console.log(`${prefix} fixing ownership to ${targetUid}:${targetGid} under ${candidate}`);
  applyOwnership(candidate);
  changed = true;
}

if (!changed) {
  console.log(`${prefix} ownership already ${targetUid}:${targetGid} for all openclaw mounts`);
} else {
  console.log(`${prefix} ownership fix complete`);
}
