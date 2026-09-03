#!/usr/bin/env node
// Self-test for the HEL-927 fixture-scan addition to
// scripts/check-no-credential-in-agent-surface.mjs. Unlike
// check-dependabot-groups.selftest.mjs, the target script isn't structured
// as an importable pure function -- it's a top-level CLI that reads the real
// filesystem and calls process.exit -- so this drives it exactly as Husky
// does: as a real subprocess against a real, temporary file planted under
// the newly-covered path (backend/src/test/resources/db/fixtures/), one
// case at a time. The planted file is removed in a `finally` so a failed
// assertion never leaves a stray fixture behind.
//
// Follows the check-openspec-hygiene.selftest.mjs convention: a standalone
// script, not a jest test (the jest gate is vacuous inside a worktree --
// HEL-880 -- which is exactly where these gates are verified).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts/check-no-credential-in-agent-surface.mjs");
const fixtureDir = join(repoRoot, "backend/src/test/resources/db/fixtures");
const plantedFile = join(fixtureDir, ".hel927-selftest-planted.sql");

let failures = 0;

function runScript() {
  return spawnSync("node", [scriptPath], { cwd: repoRoot, encoding: "utf8" });
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok - ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

function plant(contents) {
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(plantedFile, contents);
}

function removePlanted() {
  if (existsSync(plantedFile)) rmSync(plantedFile);
}

try {
  // Baseline: the real tree (this planted file absent) must already be
  // green -- if it isn't, every case below is meaningless.
  console.log("case: pre-existing tree is green before any planting");
  removePlanted();
  const baseline = runScript();
  check(
    "baseline exits 0",
    baseline.status === 0,
    `status=${baseline.status} stdout=${baseline.stdout} stderr=${baseline.stderr}`,
  );

  // RED case 1: a realistic-looking (but obviously synthetic) bcrypt hash.
  console.log("case: planted fake bcrypt hash under backend/src/test/resources -> FAIL");
  plant(
    "INSERT INTO public.users VALUES " +
      "('11111111-1111-1111-1111-111111111111', 'planted@example.invalid', " +
      "'$2b$12$KIXQ8n0J9wYqz5f3aB1cGuXyZ2vN4pQrS6tUvWxYzA0bC1dE2fG3H', " +
      "'Planted User');\n",
  );
  const bcryptRed = runScript();
  check("planted bcrypt hash fails the gate", bcryptRed.status === 1, bcryptRed.stderr);
  check(
    "failure names the planted file and 'bcrypt hash'",
    bcryptRed.stderr.includes(".hel927-selftest-planted.sql") &&
      bcryptRed.stderr.includes("bcrypt hash"),
    bcryptRed.stderr,
  );

  // GREEN: remove the planted file, confirm the gate passes again.
  console.log("case: removing the planted bcrypt hash -> PASS");
  removePlanted();
  const bcryptGreen = runScript();
  check("gate passes again after removal", bcryptGreen.status === 0, bcryptGreen.stderr);

  // RED case 2: a real-looking email on a non-placeholder domain.
  console.log("case: planted real-looking email under backend/src/test/resources -> FAIL");
  plant(
    "INSERT INTO public.users VALUES " +
      "('22222222-2222-2222-2222-222222222222', 'qa-fixture@examplecorp.com', NULL, 'Planted User');\n",
  );
  const emailRed = runScript();
  check("planted non-placeholder email fails the gate", emailRed.status === 1, emailRed.stderr);
  check(
    "failure names the planted file and 'non-placeholder domain'",
    emailRed.stderr.includes(".hel927-selftest-planted.sql") &&
      emailRed.stderr.includes("non-placeholder domain"),
    emailRed.stderr,
  );

  // GREEN: remove the planted file, confirm the gate passes again.
  console.log("case: removing the planted email -> PASS");
  removePlanted();
  const emailGreen = runScript();
  check("gate passes again after removal", emailGreen.status === 0, emailGreen.stderr);

  // Coverage control: the dummy bcrypt hash and example.invalid domain
  // already used by this repo's real fixtures must NOT trip the gate.
  console.log("case: the repo's established dummy bcrypt value + example.invalid -> PASS");
  plant(
    "INSERT INTO public.users VALUES " +
      "('33333333-3333-3333-3333-333333333333', 'allowlisted@example.invalid', " +
      "'$2a$12$0000000000000000000000000000000000000000000000000000', 'Scrubbed User');\n",
  );
  const allowlisted = runScript();
  check(
    "allow-listed dummy hash + placeholder domain does not fail",
    allowlisted.status === 0,
    allowlisted.stderr,
  );
} finally {
  removePlanted();
}

if (failures > 0) {
  console.error(`\ncheck-no-credential-in-agent-surface.selftest: FAIL (${failures} failure(s))`);
  process.exit(1);
} else {
  console.log("\ncheck-no-credential-in-agent-surface.selftest: OK");
}
