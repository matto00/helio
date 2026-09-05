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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts/check-no-credential-in-agent-surface.mjs");
const fixtureDir = join(repoRoot, "backend/src/test/resources/db/fixtures");
const plantedFile = join(fixtureDir, ".hel927-selftest-planted.sql");

// HEL-956 additions (design.md Decision 5) — planted/renamed paths for the
// three new cases, run in this fixed order: (1) helio-mcp secret literal,
// (2) drift probe, (3) helio-mcp rename (vacuity). Each is `finally`-guarded
// AND idempotently cleaned up at startup, since a leftover copy would make
// every subsequent run red for an unrelated reason.
const mcpRoot = join(repoRoot, "helio-mcp");
const mcpMovedRoot = join(repoRoot, "helio-mcp-hel956-selftest-moved");
const mcpPlantedFile = join(mcpRoot, ".hel956-selftest-secret.ts");
const driftProbeDir = join(repoRoot, "hel956-selftest-drift-probe");

// skeptic-final-1.md CR3 — `assertSurfacesValid` (the SURFACES-table shape
// guard: unique ids, known/non-empty `checks`) has no injection hook in the
// shipped gate, by design (design.md Decision 5 rejected exactly this kind
// of self-test-only hook for the vacuity case). The only way to exercise it
// through the real subprocess harness, the same way every other case here
// does, is to run a MUTATED COPY of the script — never the shipped file —
// against a real `helio-mcp/` credential probe, and assert the mutated copy
// throws. The copy is written under `scripts/`, is `.hel956-`-prefixed and
// `.gitignore`d, and is removed in `finally` AND idempotently at startup.
const mutatedScriptPath = join(repoRoot, "scripts/.hel956-selftest-mutated-surfaces.mjs");

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

function removeMcpPlantedSecret() {
  if (existsSync(mcpPlantedFile)) rmSync(mcpPlantedFile);
}

function removeDriftProbe() {
  if (existsSync(driftProbeDir)) rmSync(driftProbeDir, { recursive: true, force: true });
}

/** Restores `helio-mcp/` from its renamed-aside location if a previous run
 *  died mid-rename. Idempotent: a no-op when nothing is renamed aside. */
function restoreMcpRootIfMoved() {
  if (existsSync(mcpMovedRoot) && !existsSync(mcpRoot)) {
    renameSync(mcpMovedRoot, mcpRoot);
  }
}

function removeMutatedScript() {
  if (existsSync(mutatedScriptPath)) rmSync(mutatedScriptPath);
}

/** Writes a mutated copy of the real gate script with one exact string
 *  replacement applied, runs IT (never the shipped script) as a subprocess,
 *  and returns the result. `find` must appear in the real script's source
 *  exactly once, or this throws — so a case can never silently degenerate
 *  into "ran the unmodified script" if the source shifts under it. */
function runMutatedScript(find, replace) {
  const source = readFileSync(scriptPath, "utf8");
  const occurrences = source.split(find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `runMutatedScript: expected exactly one occurrence of ${JSON.stringify(find)} in ` +
        `${scriptPath}, found ${occurrences}`,
    );
  }
  writeFileSync(mutatedScriptPath, source.replace(find, replace));
  return spawnSync("node", [mutatedScriptPath], { cwd: repoRoot, encoding: "utf8" });
}

// Startup cleanup (idempotent) — see design.md Decision 5 / Gate-Chain
// checklist: a crashed prior run must not poison this one.
removeMcpPlantedSecret();
removeDriftProbe();
restoreMcpRootIfMoved();
removeMutatedScript();

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
  removePlanted();

  // ── HEL-956 case 1: the `mcp` surface is genuinely scanned ──────────────
  console.log("case: baseline is green before planting an mcp secret literal");
  const mcpBaseline = runScript();
  check("baseline exits 0", mcpBaseline.status === 0, mcpBaseline.stderr);

  console.log("case: planted credential-shaped literal under helio-mcp/ -> FAIL");
  writeFileSync(
    mcpPlantedFile,
    'export const HEL956_SELFTEST_TOKEN = "helio_pat_' + "a".repeat(64) + '";\n',
  );
  const mcpSecretRed = runScript();
  check(
    "planted mcp secret literal fails the gate",
    mcpSecretRed.status === 1,
    mcpSecretRed.stderr,
  );
  check(
    "failure names the planted file and the credential-shaped-literal message",
    mcpSecretRed.stderr.includes(".hel956-selftest-secret.ts") &&
      mcpSecretRed.stderr.includes("credential-shaped"),
    mcpSecretRed.stderr,
  );

  console.log("case: removing the planted mcp secret literal -> PASS");
  removeMcpPlantedSecret();
  const mcpSecretGreen = runScript();
  check("gate passes again after removal", mcpSecretGreen.status === 0, mcpSecretGreen.stderr);

  // ── HEL-956 permanent case: the bcrypt/email checks (newly applied to the
  //    mcp surface, previously fixture-only) are genuinely wired there too,
  //    not just declared in the SURFACES table. ───────────────────────────
  console.log("case: planted real-looking email under helio-mcp/ -> FAIL");
  writeFileSync(
    mcpPlantedFile,
    "// HEL-956 selftest: qa-fixture@examplecorp.com should never pass on the mcp surface\n",
  );
  const mcpEmailRed = runScript();
  check(
    "planted non-placeholder email on mcp surface fails the gate",
    mcpEmailRed.status === 1,
    mcpEmailRed.stderr,
  );
  check(
    "failure names the planted file and 'non-placeholder domain'",
    mcpEmailRed.stderr.includes(".hel956-selftest-secret.ts") &&
      mcpEmailRed.stderr.includes("non-placeholder domain"),
    mcpEmailRed.stderr,
  );

  console.log("case: removing the planted mcp email -> PASS");
  removeMcpPlantedSecret();
  const mcpEmailGreen = runScript();
  check("gate passes again after removal", mcpEmailGreen.status === 0, mcpEmailGreen.stderr);

  // ── HEL-956 case 2: an unacknowledged top-level directory fails the drift
  //    guard (must be non-dot-prefixed, or the guard skips it — design.md
  //    Decision 5 / CR2 — which would make this case vacuously green). ────
  console.log("case: baseline is green before planting the drift probe directory");
  const driftBaseline = runScript();
  check("baseline exits 0", driftBaseline.status === 0, driftBaseline.stderr);

  console.log("case: planted unacknowledged top-level directory -> FAIL (coverage drift)");
  mkdirSync(driftProbeDir, { recursive: true });
  writeFileSync(join(driftProbeDir, "placeholder.txt"), "hel956 selftest drift probe\n");
  const driftRed = runScript();
  check("planted top-level directory fails the gate", driftRed.status === 1, driftRed.stderr);
  check(
    "failure names the directory and the COVERAGE DRIFT message",
    driftRed.stderr.includes("hel956-selftest-drift-probe") &&
      driftRed.stderr.includes("COVERAGE DRIFT"),
    driftRed.stderr,
  );

  console.log("case: removing the drift probe directory -> PASS");
  removeDriftProbe();
  const driftGreen = runScript();
  check("gate passes again after removal", driftGreen.status === 0, driftGreen.stderr);

  // ── HEL-956 case 3: a declared surface matching zero files fails loudly
  //    (vacuity). Renames helio-mcp/ aside rather than relocating tracked
  //    source under active edit — this is the riskiest step, so it runs
  //    last and is restored both here and idempotently at startup. ────────
  console.log("case: baseline is green before renaming helio-mcp/ aside");
  const vacuityBaseline = runScript();
  check("baseline exits 0", vacuityBaseline.status === 0, vacuityBaseline.stderr);

  console.log("case: helio-mcp/ renamed aside -> FAIL (vacuous surface), not coverage drift");
  renameSync(mcpRoot, mcpMovedRoot);
  const vacuityRed = runScript();
  check(
    "mcp surface matching zero files fails the gate",
    vacuityRed.status === 1,
    vacuityRed.stderr,
  );
  check(
    // While renamed aside, helio-mcp-hel956-selftest-moved/ is itself an
    // unacknowledged top-level directory, so the run would ALSO fail the
    // drift check. Assert on the VACUOUS SURFACE message specifically
    // (design.md Decision 5) so this case proves the vacuity path, not
    // merely a non-zero exit that could be explained by drift instead.
    "failure names the mcp surface and the VACUOUS SURFACE message",
    vacuityRed.stderr.includes('"mcp"') && vacuityRed.stderr.includes("VACUOUS SURFACE"),
    vacuityRed.stderr,
  );

  console.log("case: restoring helio-mcp/ -> PASS");
  renameSync(mcpMovedRoot, mcpRoot);
  const vacuityGreen = runScript();
  check(
    "gate passes again after restoring helio-mcp/",
    vacuityGreen.status === 0,
    vacuityGreen.stderr,
  );

  // ── HEL-956 case 4 (skeptic-final-1.md CR1-3): `assertSurfacesValid`
  //    rejects a malformed SURFACES table before any scan runs. Run against
  //    a MUTATED COPY of the real script (never the shipped file) so the
  //    real one is never touched by these cases. ─────────────────────────
  console.log("case: SURFACES entry with an unrecognized check name -> throws (CR1)");
  const unknownCheckResult = runMutatedScript(
    'checks: ["secretLiteral", "bcrypt", "email"],',
    'checks: ["secretLiterals", "bcrypt", "email"],',
  );
  check(
    "unrecognized check name crashes the mutated copy",
    unknownCheckResult.status !== 0,
    `status=${unknownCheckResult.status} stderr=${unknownCheckResult.stderr}`,
  );
  check(
    "error names the unrecognized check",
    unknownCheckResult.stderr.includes('unrecognized check "secretLiterals"'),
    unknownCheckResult.stderr,
  );
  removeMutatedScript();

  console.log("case: SURFACES entry with an empty checks array -> throws (CR1)");
  const emptyChecksResult = runMutatedScript(
    'checks: ["secretLiteral", "bcrypt", "email"],',
    "checks: [],",
  );
  check(
    "empty checks array crashes the mutated copy",
    emptyChecksResult.status !== 0,
    `status=${emptyChecksResult.status} stderr=${emptyChecksResult.stderr}`,
  );
  check(
    'error names the empty "checks" array',
    emptyChecksResult.stderr.includes('empty "checks" array'),
    emptyChecksResult.stderr,
  );
  removeMutatedScript();

  console.log("case: SURFACES entry with a duplicate id -> throws (CR2)");
  const duplicateIdResult = runMutatedScript(
    '{ id: "fixture", root: fixtureRoot, include: "allNonBinary", checks: ["bcrypt", "email"] },',
    '{ id: "fixture", root: fixtureRoot, include: "allNonBinary", checks: ["bcrypt", "email"] },\n' +
      '  { id: "fixture", root: mcpRoot, include: "allNonBinary", checks: ["bcrypt", "email"] },',
  );
  check(
    "duplicate id crashes the mutated copy",
    duplicateIdResult.status !== 0,
    `status=${duplicateIdResult.status} stderr=${duplicateIdResult.stderr}`,
  );
  check(
    "error names the duplicate id",
    duplicateIdResult.stderr.includes('duplicate id "fixture"'),
    duplicateIdResult.stderr,
  );
  removeMutatedScript();

  // Coverage control: the mutation harness itself must produce a genuinely
  // unmodified, passing run when given a no-op replacement — otherwise a
  // bug in `runMutatedScript` (e.g. matching the wrong occurrence) could
  // make every case above vacuously "pass" for the wrong reason.
  console.log("case: mutation harness with a no-op replacement -> still green");
  const noOpResult = runMutatedScript(
    'checks: ["secretLiteral", "bcrypt", "email"],',
    'checks: ["secretLiteral", "bcrypt", "email"],',
  );
  check("no-op-mutated copy still passes", noOpResult.status === 0, noOpResult.stderr);
  removeMutatedScript();
} finally {
  removePlanted();
  removeMcpPlantedSecret();
  removeDriftProbe();
  restoreMcpRootIfMoved();
  removeMutatedScript();
}

if (failures > 0) {
  console.error(`\ncheck-no-credential-in-agent-surface.selftest: FAIL (${failures} failure(s))`);
  process.exit(1);
} else {
  console.log("\ncheck-no-credential-in-agent-surface.selftest: OK");
}
