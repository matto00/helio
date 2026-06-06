#!/usr/bin/env node
// Catches OpenSpec drift that should be cleaned up before commit:
//   1. Active changes that are complete or have no tasks (should be archived).
//   2. Stray files in `openspec/changes/` (should only contain change dirs + `archive/`).
//   3. Executor handoff files (`files-modified.md`) left behind in archived changes.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const changesDir = join(repoRoot, "openspec/changes");
const archiveDir = join(changesDir, "archive");

const errors = [];

// 1. Active change status
let listJson;
try {
  const out = execFileSync("openspec", ["list", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  listJson = JSON.parse(out);
} catch (e) {
  console.error("Failed to run `openspec list --json`:", e.message);
  process.exit(2);
}

for (const change of listJson.changes ?? []) {
  if (change.status === "complete") {
    errors.push(
      `change "${change.name}" is complete (${change.completedTasks}/${change.totalTasks}) but not archived — run \`openspec archive ${change.name}\``,
    );
  } else if (change.status === "no-tasks") {
    errors.push(
      `change "${change.name}" has no tasks — finish the proposal or remove the directory`,
    );
  }
}

// 2. Stray entries in openspec/changes/
for (const entry of readdirSync(changesDir)) {
  const full = join(changesDir, entry);
  const isDir = statSync(full).isDirectory();
  if (!isDir) {
    errors.push(`stray file in openspec/changes/: ${entry} — remove or move into a change dir`);
  }
}

// 3. Leftover executor handoff in archived changes
for (const entry of readdirSync(archiveDir)) {
  const full = join(archiveDir, entry);
  if (!statSync(full).isDirectory()) continue;
  try {
    statSync(join(full, "files-modified.md"));
    errors.push(
      `archive/${entry}/files-modified.md is an executor handoff and should not persist — delete it`,
    );
  } catch {
    // not present, fine
  }
}

if (errors.length) {
  console.error("OpenSpec hygiene issues:\n");
  for (const e of errors) console.error("  - " + e);
  console.error("");
  process.exit(1);
}

console.log("openspec/ is clean");
