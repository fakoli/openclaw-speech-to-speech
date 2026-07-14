import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "dist", "node_modules"]);

function markdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFiles(path));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push(path);
    }
  }
  return files;
}

function localTarget(rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/gu, "");
  if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    return undefined;
  }
  return decodeURIComponent(target.split(/[?#]/u, 1)[0] ?? "");
}

const failures = [];
let checkedLinks = 0;

for (const file of markdownFiles(root)) {
  const source = readFileSync(file, "utf8");
  const targets = [];
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    targets.push(match[1]);
  }
  for (const match of source.matchAll(/(?:href|src)="([^"]+)"/gu)) {
    targets.push(match[1]);
  }
  for (const rawTarget of targets) {
    const target = localTarget(rawTarget);
    if (!target) {
      continue;
    }
    checkedLinks += 1;
    if (!existsSync(resolve(dirname(file), target))) {
      failures.push(`${relative(root, file)} -> ${rawTarget}`);
    }
  }
}

assert.equal(
  failures.length,
  0,
  `broken local documentation links:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
);

process.stdout.write(`checked ${checkedLinks} local documentation links\n`);
