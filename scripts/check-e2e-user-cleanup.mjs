#!/usr/bin/env node
// HEL-1301: every e2e code path that creates a user must record it, so the run's teardown can
// delete exactly that user (e2e/support/userCleanup.ts). Registration sites are
//   (a) a request to the register endpoint (`/api/auth/register`), and
//   (b) the UI signup form: `goto("/register")`.
// Each site must be followed, within RECORD_WINDOW_LINES lines of comment-stripped source, by a
// `recordRegisteredUser(` (from the response) or `recordCreatedUser(` call. The shared helper (e2e/support/auth.ts `registerUser`) is the one place
// that registers on behalf of most specs; it is checked by the same rule. Fails naming the file and
// line. A reviewed site can carry `// e2e-user-cleanup: reviewed — <reason>` on the offending line.
// Usage: node scripts/check-e2e-user-cleanup.mjs [targetRoot]

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripComments } from "./check-e2e-evidence-paths.mjs";

const EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];
const RECORD_WINDOW_LINES = 40;
const REVIEWED_RE = /\/\/\s*e2e-user-cleanup:\s*reviewed\s*—/;
// The cleanup machinery itself legitimately mentions the endpoint / recorder.
const EXEMPT = new Set([
  "e2e/support/userCleanup.ts",
  "e2e/support/userCleanupCore.cjs",
  "e2e/support/userCleanup.selftest.mjs",
  "e2e/support/userRegistry.globalSetup.ts",
  "e2e/support/userRegistry.globalTeardown.ts",
]);
const SITE_RES = [
  [/\/api\/auth\/register/g, "posts to /api/auth/register"],
  [/\.goto\s*\(\s*(["'`])\/register\1/g, "drives the UI signup form (goto /register)"],
];

export function checkSource(rel, raw) {
  if (EXEMPT.has(rel)) return [];
  const rawLines = raw.split("\n");
  const lines = stripComments(raw).split("\n");
  const violations = [];
  const seen = new Set();
  lines.forEach((text, i) => {
    for (const [re, what] of SITE_RES) {
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      const line = i + 1;
      if (seen.has(line) || REVIEWED_RE.test(rawLines[i] ?? "")) continue;
      seen.add(line);
      const window = lines.slice(i, i + RECORD_WINDOW_LINES).join("\n");
      if (!/\brecord(?:CreatedUser|RegisteredUser)\s*\(/.test(window)) {
        violations.push(
          `${rel}:${line}: ${what} without a recordRegisteredUser(...)/recordCreatedUser(...) call within ${RECORD_WINDOW_LINES} lines`,
        );
      }
    }
  });
  return violations;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry !== "node_modules") walk(full, out);
    } else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
}

export function checkTree(root) {
  const files = [];
  try {
    walk(join(root, "e2e"), files);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const violations = [];
  for (const abs of files) {
    violations.push(...checkSource(relative(root, abs), readFileSync(abs, "utf8")));
  }
  return { violations, fileCount: files.length };
}

function main() {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : join(dirname(fileURLToPath(import.meta.url)), "..");
  const { violations, fileCount } = checkTree(root);
  if (violations.length) {
    process.stderr.write(`E2E user-cleanup check failed — ${violations.length} violation(s):\n\n`);
    for (const v of violations) process.stderr.write(`  ${v}\n`);
    process.stderr.write(
      "\nRecord every created user with recordCreatedUser({ id, email }) from e2e/support/userCleanup.ts " +
        "(id and email from the 201 response body), or mark a reviewed site with " +
        "`// e2e-user-cleanup: reviewed — <reason>` on the offending line.\n",
    );
    process.exit(1);
  }
  process.stdout.write(`E2E user-cleanup check: clean (${fileCount} e2e files scanned)\n`);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(realpathSync(entryArg)).href) {
  main();
}
