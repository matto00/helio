#!/usr/bin/env node
// Guards against `.husky/pre-commit` and `.github/workflows/ci.yml` silently
// diverging again (HEL-1123): a check that lives ONLY in the hook is
// bypassable with `--no-verify`/`HUSKY=0`/a worktree whose hooks don't fire,
// while `ci-complete` still goes green -- exactly the class of gap this
// ticket exists to close. Runs in CI only (`frontend` job), never inside the
// hook itself -- wiring it into `.husky/pre-commit` would let the same `-n`
// bypass defeat the guard meant to catch that bypass (same reasoning already
// applied to check:no-credential-leak/check:tokens/check:node-root-encoding
// in ci.yml's own comments).
//
// Two invocation forms are recognized on both sides, hook and CI:
//   1. `npm run <script>` -- the explicit form.
//   2. Bare npm aliases `npm test` / `npm start` -- npm's own shorthand for
//      `npm run test` / `npm run start` when package.json defines that key.
//      (`npm ci` is NOT one of these; it's npm's clean-install command, not
//      an alias for a package.json script.)
//
// Every hook script name is resolved generically against the repo's own
// package.json `scripts` map -- never a hand-maintained name-to-path table,
// which is exactly the kind of side list that silently goes stale. Each
// resolved command string may itself invoke other npm scripts by name and/or
// `node <path>` directly (e.g. `test` = `jest && npm --prefix frontend test`)
// -- every `node <path>` reference in that command string counts as one of
// the script's underlying paths, so CI covering the script indirectly (by
// path, not by npm-script name) still counts as coverage.
//
// CI is scanned scoped to what actually gates a merge: only
// `.github/workflows/ci.yml`'s own jobs named in its `ci-complete` job's
// `needs:` array are scanned for `run:` blocks. A check living solely in a
// tag-triggered workflow (e.g. cd-backend.yml) blocks nothing on a PR, so
// counting it as "covered" would recreate the exact hole this ticket closes.
//
// Usage: node check-precommit-ci-parity.mjs [repoRoot]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const NPM_RUN_RE = /npm(?:\s+--prefix\s+\S+)?\s+run\s+([\w:.-]+)/g;
const NPM_BARE_ALIAS_RE = /npm(?:\s+--prefix\s+\S+)?\s+(test|start)\b(?!\S)/g;
const NODE_PATH_RE = /\bnode\s+(\S+\.m?js)\b/g;

/** Extract every `npm run <script>` and bare-alias (`npm test`/`npm start`) name from a text blob. */
function extractNpmScriptInvocations(text) {
  const names = new Set();
  let m;
  NPM_RUN_RE.lastIndex = 0;
  while ((m = NPM_RUN_RE.exec(text))) names.add(m[1]);
  NPM_BARE_ALIAS_RE.lastIndex = 0;
  while ((m = NPM_BARE_ALIAS_RE.exec(text))) names.add(m[1]);
  return names;
}

/** Extract every direct `node <path>` invocation from a text blob. */
function extractNodePaths(text) {
  const paths = new Set();
  let m;
  NODE_PATH_RE.lastIndex = 0;
  while ((m = NODE_PATH_RE.exec(text))) paths.add(m[1]);
  return paths;
}

/** Parse `.husky/pre-commit` into the resolved set of npm script names it invokes. */
export function parseHookScripts(hookText) {
  const names = new Set();
  for (const rawLine of hookText.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    for (const name of extractNpmScriptInvocations(line)) names.add(name);
  }
  return names;
}

/**
 * Resolve each hook script name to its underlying `node <path>` invocations
 * via the repo's own package.json `scripts` map -- the single source of
 * truth, so no separate name-to-path table can fall out of sync with it.
 */
export function resolveUnderlyingPaths(scriptNames, packageJsonScripts) {
  const resolved = new Map();
  for (const name of scriptNames) {
    const command = packageJsonScripts[name];
    resolved.set(name, command ? extractNodePaths(command) : new Set());
  }
  return resolved;
}

/**
 * Parse the top-level job names in `ci-complete`'s `needs:` array from
 * `ci.yml`'s raw text. Deliberately a narrow, purpose-built scan (not a full
 * YAML parser) matching this file's own established convention
 * (check-dependabot-groups.mjs) for CI-adjacent config files.
 */
export function parseCiCompleteNeeds(ciYamlText) {
  const jobBlockMatch = /^ {2}ci-complete:\n([\s\S]*?)(?=^ {2}\S|Z$)/m.exec(ciYamlText + "\nZ");
  const jobBlock = jobBlockMatch ? jobBlockMatch[1] : ciYamlText;
  const needsMatch = /needs:\s*\[([^\]]*)\]/.exec(jobBlock);
  if (!needsMatch) return [];
  return needsMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Extract, for each job name in `jobNames`, the raw text of that job's block
 * from `ci.yml`'s top-level `jobs:` mapping (each job is a `  <name>:` line
 * at 2-space indent under `jobs:`, ending at the next 2-space-indented key).
 */
export function extractJobBlocks(ciYamlText, jobNames) {
  const blocks = {};
  for (const name of jobNames) {
    const re = new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\S|Z$)`, "m");
    const m = re.exec(ciYamlText + "\nZ");
    if (m) blocks[name] = m[1];
  }
  return blocks;
}

/**
 * Compare the hook's resolved script set against what's actually reachable
 * from a merge-blocking `ci-complete` dependency.
 *
 * @param {object} args
 * @param {string} args.hookText raw `.husky/pre-commit` contents
 * @param {string} args.ciYamlText raw `.github/workflows/ci.yml` contents
 * @param {Record<string, string>} args.packageJsonScripts the repo's package.json `scripts` map
 * @returns {{ errors: string[], hookScripts: string[], coveredScripts: string[] }}
 */
export function checkPrecommitCiParity({ hookText, ciYamlText, packageJsonScripts }) {
  const hookScripts = parseHookScripts(hookText);
  const underlyingPaths = resolveUnderlyingPaths(hookScripts, packageJsonScripts);

  const neededJobs = parseCiCompleteNeeds(ciYamlText);
  const jobBlocks = extractJobBlocks(ciYamlText, neededJobs);

  const ciScriptNames = new Set();
  const ciNodePaths = new Set();
  for (const block of Object.values(jobBlocks)) {
    for (const name of extractNpmScriptInvocations(block)) ciScriptNames.add(name);
    for (const path of extractNodePaths(block)) ciNodePaths.add(path);
  }

  const errors = [];
  const covered = [];
  const uncovered = [];
  for (const name of hookScripts) {
    const byName = ciScriptNames.has(name);
    const paths = underlyingPaths.get(name) ?? new Set();
    const byPath = [...paths].some((p) => ciNodePaths.has(p));
    if (byName || byPath) {
      covered.push(name);
    } else {
      uncovered.push(name);
    }
  }

  if (uncovered.length > 0) {
    errors.push(
      `${uncovered.length} hook script(s) run in .husky/pre-commit but are not reachable from ` +
        `ci-complete's needs (${neededJobs.join(", ")}): ${uncovered.sort().join(", ")}`,
    );
  }

  return {
    errors,
    hookScripts: [...hookScripts].sort(),
    coveredScripts: covered.sort(),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const repoRoot = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const hookText = readFileSync(join(repoRoot, ".husky/pre-commit"), "utf8");
  const ciYamlText = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  const { errors, hookScripts, coveredScripts } = checkPrecommitCiParity({
    hookText,
    ciYamlText,
    packageJsonScripts: packageJson.scripts ?? {},
  });

  console.log(
    `check-precommit-ci-parity: hook scripts (${hookScripts.length}): ${hookScripts.join(", ")}`,
  );
  console.log(
    `check-precommit-ci-parity: ci-complete-covered scripts (${coveredScripts.length}): ${coveredScripts.join(", ")}`,
  );

  if (errors.length > 0) {
    console.error("\ncheck-precommit-ci-parity: FAILED\n");
    for (const error of errors) console.error(`  - ${error}`);
    console.error(
      "\nAdd a `run:` step (by npm script name or the script's underlying `node <path>`) to a " +
        "job in ci-complete's needs list, or remove the script from .husky/pre-commit.",
    );
    process.exit(1);
  }
  console.log("\ncheck-precommit-ci-parity: OK — every hook script is covered by ci-complete.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
