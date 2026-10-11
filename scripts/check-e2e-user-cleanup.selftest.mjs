#!/usr/bin/env node
// Self-test for scripts/check-e2e-user-cleanup.mjs (HEL-1301): every unrecorded registration shape
// is red, every recorded shape green, and the repository itself is clean.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const guard = join(dirname(fileURLToPath(import.meta.url)), "check-e2e-user-cleanup.mjs");
const repoRoot = join(dirname(guard), "..");
const fixtures = [];
let passed = 0;
let failed = 0;

function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    process.stderr.write(`FAIL: ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
}

function run(root) {
  const res = spawnSync("node", [guard, root], { encoding: "utf8" });
  return { status: res.status, stderr: res.stderr ?? "" };
}

function fixture(source) {
  const root = mkdtempSync(join(tmpdir(), "e2e-user-cleanup-selftest-"));
  fixtures.push(root);
  mkdirSync(join(root, "e2e"), { recursive: true });
  writeFileSync(join(root, "e2e/fixture.spec.ts"), source);
  return root;
}

function red(name, source, expectLine) {
  const res = run(fixture(source));
  record(
    `red: ${name}`,
    res.status === 1 && res.stderr.includes(`e2e/fixture.spec.ts:${expectLine}:`),
    `status=${res.status} stderr=${res.stderr}`,
  );
}

function green(name, source) {
  const res = run(fixture(source));
  record(`green: ${name}`, res.status === 0, `status=${res.status} stderr=${res.stderr}`);
}

const FILLER = Array.from({ length: 45 }, (_, i) => `const filler${i} = ${i};`).join("\n");

try {
  red("unrecorded API registration", 'await request.post("/api/auth/register", { data });\n', 1);
  red(
    "unrecorded UI signup form",
    'await page.goto("/register");\nawait page.fill("#email", e);\n',
    1,
  );
  red(
    "recorder too far from the site",
    `await request.post("/api/auth/register", { data });\n${FILLER}\nrecordCreatedUser(u);\n`,
    1,
  );
  red(
    "only a comment mentions the recorder",
    'await request.post("/api/auth/register", { data });\n// recordCreatedUser(u)\n',
    1,
  );
  red(
    "second site unrecorded while the first is recorded",
    `await request.post("/api/auth/register", { data });\nrecordCreatedUser(a);\n${FILLER}\nawait request.post("/api/auth/register", { data });\n`,
    48,
  );
  green(
    "API registration followed by the recorder",
    'const res = await request.post("/api/auth/register", { data });\nrecordCreatedUser(await res.json());\n',
  );
  green(
    "UI signup recorded from the awaited response",
    'await page.goto("/register");\nconst body = await response.json();\nrecordCreatedUser(body.user);\n',
  );
  green(
    "API registration recorded straight from the response",
    'const res = await request.post("/api/auth/register", { data });\nawait recordRegisteredUser(res);\n',
  );
  green("a spec with no registration", 'await page.goto("/login");\n');
  green(
    "reviewed site",
    'await request.post("/api/auth/register", { data }); // e2e-user-cleanup: reviewed — fixture\n',
  );
  const repo = run(repoRoot);
  record("the repository's e2e tree is clean", repo.status === 0, repo.stderr);
} finally {
  for (const f of fixtures) rmSync(f, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
