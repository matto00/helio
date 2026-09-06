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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts/check-no-credential-in-agent-surface.mjs");
// HEL-996: this self-test's own path, used to spawn itself as a subprocess
// for the forced-skip probe cases (design.md Decision 4).
const selfPath = fileURLToPath(import.meta.url);
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

// HEL-993 additions (design.md Decisions 0-4) — planted paths for the new
// unreadable-file/directory, import-graph, credential-property, BFS-read-
// failure and entry-guard cases. Each is `.hel993-`-prefixed, gitignored,
// `finally`-guarded and cleaned idempotently at startup, matching the
// existing convention above.
const assistantRoot = join(repoRoot, "frontend/src/features/assistant");
const hel993McpUnreadableFile = join(mcpRoot, ".hel993-unreadable-secret.ts");
const hel993ImporterFile = join(assistantRoot, ".hel993-importer.ts");
const hel993ReexportFile = join(assistantRoot, ".hel993-reexport.ts");
const hel993CredentialPropFile = join(assistantRoot, ".hel993-credential-prop.ts");
const hel993BfsImporterFile = join(assistantRoot, ".hel993-bfs-importer.ts");
// Deliberately OUTSIDE the assistant surface root (skeptic-final-1.md
// non-blocking note): if this sat under `assistantRoot`, `readSurfaceFiles`
// would catch its unreadability first, making the BFS-specific assertion
// below the only arm that actually exercises `findBannedImport`'s own catch
// site. Living under `frontend/src/shared/` (never collected directly —
// reached only through the import-graph walk) makes BOTH assertions
// site-specific to the BFS catch site.
const hel993BfsUnreadableFile = join(repoRoot, "frontend/src/shared/.hel993-bfs-unreadable.ts");
const hel993LockedDir = join(assistantRoot, ".hel993-locked-dir");
const hel993LockedDirFile = join(hel993LockedDir, "placeholder.ts");
const hel993MutatedEntryScriptPath = join(repoRoot, "scripts/.hel993-selftest-mutated-entry.mjs");

// HEL-846 additions (design.md Decisions 2/2a/3/4/7) — planted paths for the
// new `deliverySecret` check and its three surfaces (`delivery-evidence`
// (openspec/), `docs`, `notes`). Following design.md Decision 2a: the
// unelided planted value lives ONLY in these untracked, `.gitignore`d
// `.hel846-`-prefixed scratch files, never in a tracked evidence file. Each
// is `finally`-guarded AND cleaned idempotently at startup, matching the
// existing convention above.
//
// Deliberately planted directly at each surface ROOT (`openspec/`, `docs/`,
// `notes/`), NOT inside this change's own in-flight directory
// (`openspec/changes/credential-shaped-string-commit-guard/`) — evaluation-1.md
// CR1 found that the change-directory path breaks the moment `/opsx-archive`
// moves that directory, turning this self-test into a crash (`ENOENT` on
// `writeFileSync`) rather than a check failure, on a step this very change
// just made merge-blocking in CI. `openspec/`, `docs/` and `notes/` are all
// surface roots that exist unconditionally in every checkout, independent of
// any change's name or lifecycle.
const hel846OpenspecPlant = join(repoRoot, "openspec/.hel846-plant.md");
const hel846DocsPlant = join(repoRoot, "docs/.hel846-plant.md");
const hel846NotesPlant = join(repoRoot, "notes/.hel846-plant.md");
const hel846MutatedSurfacesScriptPath = join(
  repoRoot,
  "scripts/.hel846-selftest-mutated-surfaces.mjs",
);
const hel846MutatedChecksScriptPath = join(repoRoot, "scripts/.hel846-selftest-mutated-checks.mjs");
// A vendor-prefixed value that structurally matches VENDOR_PREFIX_SECRET_REGEX
// (helio_pat_ + >= 20 chars) — obviously synthetic (repeated hex-shaped
// filler), never a real credential, and carries NO synthetic marker (a
// marker would exempt it and prove nothing).
const HEL846_VENDOR_VALUE = "helio_pat_" + "a1b2c3d4e5f6".repeat(6);
// A high-entropy value that structurally matches HIGH_ENTROPY_NAMED_SECRET_REGEX
// (>= 32 base64/hex-alphabet chars) when assigned to an identifier ending
// KEY/SECRET/TOKEN/PASSWORD — likewise obviously synthetic and unmarked.
const HEL846_ENTROPY_VALUE = "a".repeat(44);

/** Writes a HEL-846 plant file, first ensuring its parent directory exists
 *  (evaluation-1.md CR1 — belt-and-braces: even though all three plant paths
 *  now sit directly at a permanent surface root, this guard means a future
 *  plant path nested one level deeper can never again turn a missing
 *  directory into a crash rather than a check failure). */
function writeHel846Plant(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function removeHel846Plants() {
  if (existsSync(hel846OpenspecPlant)) rmSync(hel846OpenspecPlant);
  if (existsSync(hel846DocsPlant)) rmSync(hel846DocsPlant);
  if (existsSync(hel846NotesPlant)) rmSync(hel846NotesPlant);
}

function removeHel846MutatedScripts() {
  if (existsSync(hel846MutatedSurfacesScriptPath)) rmSync(hel846MutatedSurfacesScriptPath);
  if (existsSync(hel846MutatedChecksScriptPath)) rmSync(hel846MutatedChecksScriptPath);
}

// `chmod 000` behaves differently for `root` (reads/lists still succeed) —
// design.md Risks/Trade-offs. Rather than assert a failure that cannot
// occur under root, these cases print an explicit, loud SKIP line. The
// overall self-test does NOT exit 0 claiming full coverage without naming
// which cases were skipped (skeptic-design-2.md non-blocking note).
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const skippedCases = [];

function skip(name, reason) {
  skippedCases.push(name);
  console.log(`  SKIP - ${name} (${reason})`);
}

// HEL-996 test-only forced-skip hook (design.md Decision 4). The euid-0
// hard-failure branch below is unreachable on a non-root developer machine
// and on `ubuntu-latest` CI runners, so without a probe it would ship as an
// unexecuted claim -- the exact defect class this ticket exists to close.
// This hook can only ADD a synthetic skipped case, never clear or suppress
// a real one, so it cannot be misused to make a genuinely skipped case
// report success; its presence also doubles as the recursion guard so a
// child spawned by the probe cases below does not itself spawn probes.
if (process.env.HEL996_FORCE_SKIP_SELFTEST === "1") {
  skip(
    "hel996-forced-skip-probe",
    "HEL996_FORCE_SKIP_SELFTEST forced for CI-fatal-branch coverage",
  );
}

function removeHel993McpUnreadableFile() {
  if (existsSync(hel993McpUnreadableFile)) {
    chmodSync(hel993McpUnreadableFile, 0o644);
    rmSync(hel993McpUnreadableFile);
  }
}

function removeHel993ImportGraphFiles() {
  if (existsSync(hel993ImporterFile)) rmSync(hel993ImporterFile);
  if (existsSync(hel993ReexportFile)) rmSync(hel993ReexportFile);
}

function removeHel993CredentialPropFile() {
  if (existsSync(hel993CredentialPropFile)) rmSync(hel993CredentialPropFile);
}

function removeHel993BfsFiles() {
  if (existsSync(hel993BfsUnreadableFile)) {
    chmodSync(hel993BfsUnreadableFile, 0o644);
    rmSync(hel993BfsUnreadableFile);
  }
  if (existsSync(hel993BfsImporterFile)) rmSync(hel993BfsImporterFile);
}

function removeHel993LockedDir() {
  if (existsSync(hel993LockedDir)) {
    chmodSync(hel993LockedDir, 0o755);
    rmSync(hel993LockedDir, { recursive: true, force: true });
  }
}

function removeHel993MutatedEntryScript() {
  if (existsSync(hel993MutatedEntryScriptPath)) rmSync(hel993MutatedEntryScriptPath);
}

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

/** Removes the HEL-993 case-3 stand-in `helio-mcp/` (the freshly-created
 *  directory holding only `.hel993-only-file.ts`) if a previous run died
 *  mid-case, BEFORE `restoreMcpRootIfMoved()` runs (skeptic-final-1.md CR1).
 *  `restoreMcpRootIfMoved()`'s `!existsSync(mcpRoot)` guard only holds for
 *  HEL-956's case (which never leaves anything at `mcpRoot`); HEL-993's
 *  case 3 renames the real `helio-mcp/` aside AND creates a stand-in in its
 *  place, so a crash inside that window leaves `mcpRoot` occupied by the
 *  stand-in and `restoreMcpRootIfMoved()` would otherwise no-op forever,
 *  then throw `ENOTEMPTY` on the next `renameSync`. Only ever removes when
 *  `mcpMovedRoot` (the parked real directory) exists — that is the sole
 *  evidence a real `helio-mcp/` is safely parked elsewhere, so a real
 *  `helio-mcp/` can never be destroyed by this function. Idempotent. */
function removeHel993McpStandIn() {
  if (existsSync(mcpMovedRoot) && existsSync(mcpRoot)) {
    chmodSync(mcpRoot, 0o755);
    for (const entry of readdirSync(mcpRoot)) {
      chmodSync(join(mcpRoot, entry), 0o644);
    }
    rmSync(mcpRoot, { recursive: true, force: true });
  }
}

/** Restores `helio-mcp/` from its renamed-aside location if a previous run
 *  died mid-rename. Idempotent: a no-op when nothing is renamed aside. Must
 *  run AFTER `removeHel993McpStandIn()` — see that function's doc comment. */
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
function runMutatedScript(find, replace, destPath = mutatedScriptPath) {
  const source = readFileSync(scriptPath, "utf8");
  const occurrences = source.split(find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `runMutatedScript: expected exactly one occurrence of ${JSON.stringify(find)} in ` +
        `${scriptPath}, found ${occurrences}`,
    );
  }
  writeFileSync(destPath, source.replace(find, replace));
  return spawnSync("node", [destPath], { cwd: repoRoot, encoding: "utf8" });
}

// Startup cleanup (idempotent) — see design.md Decision 5 / Gate-Chain
// checklist: a crashed prior run must not poison this one.
removeMcpPlantedSecret();
removeDriftProbe();
removeHel993McpStandIn();
restoreMcpRootIfMoved();
removeMutatedScript();
removeHel993McpUnreadableFile();
removeHel993ImportGraphFiles();
removeHel993CredentialPropFile();
removeHel993BfsFiles();
removeHel993LockedDir();
removeHel993MutatedEntryScript();
removeHel846Plants();
removeHel846MutatedScripts();

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

  // ── HEL-993 case 1: a file the gate cannot read is never counted as
  //    scanned (tasks.md 2.1, spec "A scanned file cannot be read"). ───────
  if (isRoot) {
    skip(
      "unreadable mcp file fails the gate",
      "running as root; chmod 000 does not deny root reads",
    );
  } else {
    console.log("case: baseline is green before planting an unreadable mcp file");
    const unreadableBaseline = runScript();
    check("baseline exits 0", unreadableBaseline.status === 0, unreadableBaseline.stderr);

    console.log("case: planted credential-shaped literal under helio-mcp/, chmod 000 -> FAIL");
    writeFileSync(
      hel993McpUnreadableFile,
      'export const HEL993_SELFTEST_TOKEN = "helio_pat_' + "b".repeat(64) + '";\n',
    );
    chmodSync(hel993McpUnreadableFile, 0o000);
    const unreadableRed = runScript();
    check(
      "unreadable planted file fails the gate (never reported as scanned)",
      unreadableRed.status === 1,
      unreadableRed.stderr,
    );
    check(
      "failure names the unreadable file and 'cannot read file'",
      unreadableRed.stderr.includes(".hel993-unreadable-secret.ts") &&
        unreadableRed.stderr.includes("cannot read file"),
      unreadableRed.stderr,
    );

    console.log("case: restoring mode and removing the unreadable file -> PASS");
    removeHel993McpUnreadableFile();
    const unreadableGreen = runScript();
    check("gate passes again after removal", unreadableGreen.status === 0, unreadableGreen.stderr);
  }

  // ── HEL-993 case 2: an unlistable directory fails the gate, and (since
  //    this directory's single file is the only content) also exercises
  //    "every file of a surface is unreadable" without masking the access
  //    error behind a bare vacuity report (tasks.md 1.4/1.5/2.6). ─────────
  if (isRoot) {
    skip(
      "unlistable directory fails the gate",
      "running as root; chmod 000 does not deny root directory listing",
    );
  } else {
    console.log("case: baseline is green before planting an unlistable directory");
    const lockedDirBaseline = runScript();
    check("baseline exits 0", lockedDirBaseline.status === 0, lockedDirBaseline.stderr);

    console.log("case: planted unlistable directory under the assistant surface -> FAIL");
    mkdirSync(hel993LockedDir, { recursive: true });
    writeFileSync(hel993LockedDirFile, "// hel993 selftest locked-dir placeholder\n");
    chmodSync(hel993LockedDir, 0o000);
    const lockedDirRed = runScript();
    check("unlistable directory fails the gate", lockedDirRed.status === 1, lockedDirRed.stderr);
    check(
      "failure names the directory and 'cannot list directory'",
      lockedDirRed.stderr.includes(".hel993-locked-dir") &&
        lockedDirRed.stderr.includes("cannot list directory"),
      lockedDirRed.stderr,
    );

    console.log("case: restoring mode and removing the locked directory -> PASS");
    removeHel993LockedDir();
    const lockedDirGreen = runScript();
    check("gate passes again after removal", lockedDirGreen.status === 0, lockedDirGreen.stderr);
  }

  // ── HEL-993 case 3: "every file of a surface is unreadable" reports the
  //    access errors, not a bare VACUOUS SURFACE line (tasks.md 1.5, spec
  //    "Every file of a surface is unreadable"). Renames helio-mcp/ aside
  //    and replaces it with a single-file directory whose only file is
  //    unreadable, so the surface's readable-file count drops to zero AND
  //    the access error fires — proving access errors are reported BEFORE,
  //    not instead of, the vacuity line. ────────────────────────────────
  if (isRoot) {
    skip(
      "every-file-unreadable surface names access errors, not bare vacuity",
      "running as root; chmod 000 does not deny root reads",
    );
  } else {
    console.log(
      "case: baseline is green before replacing helio-mcp/ with an all-unreadable stand-in",
    );
    const allUnreadableBaseline = runScript();
    check("baseline exits 0", allUnreadableBaseline.status === 0, allUnreadableBaseline.stderr);

    console.log(
      "case: helio-mcp/ replaced by a directory with one unreadable file -> FAIL (access, not bare vacuity)",
    );
    renameSync(mcpRoot, mcpMovedRoot);
    mkdirSync(mcpRoot, { recursive: true });
    const onlyFile = join(mcpRoot, ".hel993-only-file.ts");
    writeFileSync(onlyFile, "// hel993 selftest: sole file of a stand-in mcp surface\n");
    chmodSync(onlyFile, 0o000);
    const allUnreadableRed = runScript();
    check(
      "surface whose only file is unreadable fails the gate",
      allUnreadableRed.status === 1,
      allUnreadableRed.stderr,
    );
    check(
      "failure names the unreadable file AND still reports VACUOUS SURFACE, access before vacuity",
      allUnreadableRed.stderr.includes(".hel993-only-file.ts") &&
        allUnreadableRed.stderr.includes("cannot read file") &&
        allUnreadableRed.stderr.includes("VACUOUS SURFACE") &&
        allUnreadableRed.stderr.indexOf("cannot read file") <
          allUnreadableRed.stderr.indexOf("VACUOUS SURFACE"),
      allUnreadableRed.stderr,
    );

    console.log("case: restoring helio-mcp/ -> PASS");
    chmodSync(onlyFile, 0o644);
    rmSync(mcpRoot, { recursive: true, force: true });
    renameSync(mcpMovedRoot, mcpRoot);
    const allUnreadableGreen = runScript();
    check(
      "gate passes again after restoring helio-mcp/",
      allUnreadableGreen.status === 0,
      allUnreadableGreen.stderr,
    );
  }

  // ── HEL-993 case 4: the assistant-surface `importGraph` check is genuinely
  //    live, including transitively through a second planted module (tasks.md
  //    2.3, spec "The self-test proves the import-graph check is live"). ───
  console.log("case: baseline is green before planting a transitive banned-import chain");
  const importGraphBaseline = runScript();
  check("baseline exits 0", importGraphBaseline.status === 0, importGraphBaseline.stderr);

  console.log(
    "case: planted assistant-surface module transitively importing ConnectorCredentialField -> FAIL",
  );
  writeFileSync(
    hel993ReexportFile,
    'export { ConnectorCredentialField } from "../connectors/ui/ConnectorCredentialField";\n',
  );
  writeFileSync(hel993ImporterFile, 'import "./.hel993-reexport";\n');
  const importGraphRed = runScript();
  check(
    "transitive banned import fails the gate",
    importGraphRed.status === 1,
    importGraphRed.stderr,
  );
  check(
    "failure names the importer file and the banned module and chain",
    importGraphRed.stderr.includes(".hel993-importer.ts") &&
      importGraphRed.stderr.includes("ConnectorCredentialField") &&
      importGraphRed.stderr.includes("transitively imports banned module"),
    importGraphRed.stderr,
  );

  console.log("case: removing the planted import-graph chain -> PASS");
  removeHel993ImportGraphFiles();
  const importGraphGreen = runScript();
  check("gate passes again after removal", importGraphGreen.status === 0, importGraphGreen.stderr);

  // ── HEL-993 case 5: the assistant-surface `credentialProp` check is
  //    genuinely live (tasks.md 2.4, spec "The self-test proves the
  //    credential-property check is live"). ────────────────────────────
  console.log("case: baseline is green before planting a 'credential' property");
  const credentialPropBaseline = runScript();
  check("baseline exits 0", credentialPropBaseline.status === 0, credentialPropBaseline.stderr);

  console.log("case: planted assistant-surface module declaring a 'credential' property -> FAIL");
  writeFileSync(
    hel993CredentialPropFile,
    "export interface Hel993Selftest {\n  credential?: string;\n}\n",
  );
  const credentialPropRed = runScript();
  check(
    "planted 'credential' property fails the gate",
    credentialPropRed.status === 1,
    credentialPropRed.stderr,
  );
  check(
    "failure names the file, line, and 'credential'",
    credentialPropRed.stderr.includes(".hel993-credential-prop.ts:2") &&
      credentialPropRed.stderr.includes('literally named "credential"'),
    credentialPropRed.stderr,
  );

  console.log("case: removing the planted 'credential' property module -> PASS");
  removeHel993CredentialPropFile();
  const credentialPropGreen = runScript();
  check(
    "gate passes again after removal",
    credentialPropGreen.status === 0,
    credentialPropGreen.stderr,
  );

  // ── HEL-993 case 6: an unreadable module reached through the import-graph
  //    BFS fails the walk (tasks.md 2.5, spec "The self-test proves an
  //    unreadable imported module fails the walk"). Independent catch site
  //    from case 1 above — a mutation of one must not mask the other. ────
  if (isRoot) {
    skip(
      "unreadable imported module fails the import-graph walk",
      "running as root; chmod 000 does not deny root reads",
    );
  } else {
    console.log("case: baseline is green before planting a BFS-unreadable imported module");
    const bfsBaseline = runScript();
    check("baseline exits 0", bfsBaseline.status === 0, bfsBaseline.stderr);

    console.log(
      "case: planted assistant-surface module importing an unreadable module -> FAIL (incomplete walk)",
    );
    writeFileSync(hel993BfsUnreadableFile, "// hel993 selftest: BFS-unreadable imported module\n");
    chmodSync(hel993BfsUnreadableFile, 0o000);
    writeFileSync(hel993BfsImporterFile, 'import "../../shared/.hel993-bfs-unreadable";\n');
    const bfsRed = runScript();
    check("unreadable imported module fails the gate", bfsRed.status === 1, bfsRed.stderr);
    check(
      "failure names the unreadable imported module and the import-graph walk",
      bfsRed.stderr.includes(".hel993-bfs-unreadable.ts") &&
        bfsRed.stderr.includes("import-graph walk"),
      bfsRed.stderr,
    );

    console.log("case: restoring mode and removing the BFS files -> PASS");
    removeHel993BfsFiles();
    const bfsGreen = runScript();
    check("gate passes again after removal", bfsGreen.status === 0, bfsGreen.stderr);
  }

  // ── HEL-993 case 7: the entry guard cannot produce a silent zero-exit
  //    no-op (tasks.md 2.2, spec "The entry comparison is false while the
  //    module is the process entry"). No injection hook exists in the
  //    shipped gate by design, so — following the same convention as HEL-956
  //    case 4 above — this runs a MUTATED COPY, never the shipped file,
  //    with the strict entry comparison forced false. `runMutatedScript`'s
  //    exactly-once check means this can never silently degrade into
  //    running the unmodified script. ────────────────────────────────────
  console.log(
    "case: entry comparison forced false -> non-zero exit, not a silent zero exit (CR-entry)",
  );
  const entryGuardResult = runMutatedScript(
    "import.meta.url === pathToFileURL(entryRealPath).href",
    "false",
    hel993MutatedEntryScriptPath,
  );
  check(
    "forced-false entry comparison does not exit 0 silently",
    entryGuardResult.status !== 0,
    `status=${entryGuardResult.status} stdout=${entryGuardResult.stdout} stderr=${entryGuardResult.stderr}`,
  );
  check(
    "diagnostic states main() never ran",
    entryGuardResult.stderr.includes("main() never ran"),
    entryGuardResult.stderr,
  );
  removeHel993MutatedEntryScript();

  console.log("case: mutation harness with a no-op replacement (entry guard) -> still green");
  const entryGuardNoOp = runMutatedScript(
    "import.meta.url === pathToFileURL(entryRealPath).href",
    "import.meta.url === pathToFileURL(entryRealPath).href",
    hel993MutatedEntryScriptPath,
  );
  check("no-op-mutated copy still passes", entryGuardNoOp.status === 0, entryGuardNoOp.stderr);
  removeHel993MutatedEntryScript();

  // ── HEL-846 case 1: each of the three new surfaces (delivery-evidence/
  //    openspec, docs, notes) genuinely detects the vendor-prefix rule. ───
  for (const [label, plantPath] of [
    ["openspec", hel846OpenspecPlant],
    ["docs", hel846DocsPlant],
    ["notes", hel846NotesPlant],
  ]) {
    console.log(`case: baseline is green before planting a vendor-prefix secret under ${label}/`);
    const vendorBaseline = runScript();
    check("baseline exits 0", vendorBaseline.status === 0, vendorBaseline.stderr);

    console.log(`case: planted vendor-prefix credential under ${label}/ -> FAIL`);
    writeHel846Plant(plantPath, `hel846 selftest plant\n${HEL846_VENDOR_VALUE}\n`);
    const vendorRed = runScript();
    check(
      `planted vendor-prefix credential under ${label}/ fails the gate`,
      vendorRed.status === 1,
      vendorRed.stderr,
    );
    check(
      "failure names the planted file and the vendor-prefixed message, never the matched value",
      vendorRed.stderr.includes(".hel846-plant.md") &&
        vendorRed.stderr.includes("vendor-prefixed credential-shaped") &&
        !vendorRed.stderr.includes(HEL846_VENDOR_VALUE),
      vendorRed.stderr,
    );

    console.log(`case: removing the planted ${label}/ vendor-prefix credential -> PASS`);
    if (existsSync(plantPath)) rmSync(plantPath);
    const vendorGreen = runScript();
    check("gate passes again after removal", vendorGreen.status === 0, vendorGreen.stderr);
  }

  // ── HEL-846 case 2: the high-entropy named-literal rule is live. ────────
  console.log("case: baseline is green before planting a high-entropy named secret");
  const entropyBaseline = runScript();
  check("baseline exits 0", entropyBaseline.status === 0, entropyBaseline.stderr);

  console.log("case: planted high-entropy API_KEY value under openspec/ -> FAIL");
  writeHel846Plant(hel846OpenspecPlant, `hel846 selftest plant\nAPI_KEY=${HEL846_ENTROPY_VALUE}\n`);
  const entropyRed = runScript();
  check(
    "planted high-entropy named secret fails the gate",
    entropyRed.status === 1,
    entropyRed.stderr,
  );
  check(
    "failure names the planted file, identifier and 'high-entropy', never the matched value",
    entropyRed.stderr.includes(".hel846-plant.md") &&
      entropyRed.stderr.includes('identifier "API_KEY"') &&
      entropyRed.stderr.includes("high-entropy") &&
      !entropyRed.stderr.includes(HEL846_ENTROPY_VALUE),
    entropyRed.stderr,
  );

  console.log("case: removing the planted high-entropy secret -> PASS");
  removeHel846Plants();
  const entropyGreen = runScript();
  check("gate passes again after removal", entropyGreen.status === 0, entropyGreen.stderr);

  // ── HEL-846 case 3: the synthetic-marker convention (including
  //    underscore normalization) exempts a marker-carrying value. ─────────
  console.log("case: high-entropy value carrying the 'dummy' marker -> PASS");
  writeHel846Plant(
    hel846OpenspecPlant,
    `hel846 selftest plant\nAPI_KEY=${HEL846_ENTROPY_VALUE}-dummy\n`,
  );
  const markerHyphen = runScript();
  check(
    "hyphenated marker exempts the planted value",
    markerHyphen.status === 0,
    markerHyphen.stderr,
  );

  console.log("case: high-entropy value carrying an underscore-separated marker -> PASS");
  writeHel846Plant(
    hel846OpenspecPlant,
    `hel846 selftest plant\nAPI_KEY=${HEL846_ENTROPY_VALUE}should_never\n`,
  );
  const markerUnderscore = runScript();
  check(
    "underscore-separated marker is normalized and exempts the planted value",
    markerUnderscore.status === 0,
    markerUnderscore.stderr,
  );

  console.log(
    "case: removing '_'->'-' normalization on a mutated copy -> the same underscore marker goes red",
  );
  const normalizationResult = runMutatedScript(
    'const normalized = value.toLowerCase().replaceAll("_", "-");',
    "const normalized = value.toLowerCase();",
    hel846MutatedSurfacesScriptPath,
  );
  check(
    "removing normalization turns the underscore-marker case red",
    normalizationResult.status === 1,
    normalizationResult.stderr,
  );
  removeHel846MutatedScripts();

  console.log("case: removing the marker-convention plant -> PASS");
  removeHel846Plants();
  const markerGreen = runScript();
  check("gate passes again after removal", markerGreen.status === 0, markerGreen.stderr);

  // ── HEL-846 case 4: each new surface is genuinely scanned — removing a
  //    surface's SURFACES entry stops detecting its planted credential AND
  //    fails instead for a coverage-drift reason (both observations). ────
  console.log(
    "case: removing the delivery-evidence (openspec) SURFACES entry on a mutated copy " +
      "-> plant undetected, coverage drift instead",
  );
  writeHel846Plant(hel846OpenspecPlant, `hel846 selftest plant\n${HEL846_VENDOR_VALUE}\n`);
  const removedSurfaceResult = runMutatedScript(
    "  {\n" +
      '    id: "delivery-evidence",\n' +
      "    root: openspecRoot,\n" +
      '    include: "allNonBinary",\n' +
      '    checks: ["deliverySecret"],\n' +
      "  },\n",
    "",
    hel846MutatedSurfacesScriptPath,
  );
  check(
    "removing the surface entry still fails (coverage drift), but never names the plant",
    removedSurfaceResult.status === 1 &&
      removedSurfaceResult.stderr.includes("COVERAGE DRIFT") &&
      !removedSurfaceResult.stderr.includes("vendor-prefixed credential-shaped"),
    removedSurfaceResult.stderr,
  );
  removeHel846MutatedScripts();
  removeHel846Plants();

  // ── HEL-846 case 5: the check is genuinely dispatched — removing
  //    "deliverySecret" from a surface's checks, and separately from the
  //    needsText disjunction, both silently stop detecting the plant. ────
  console.log(
    "case: removing 'deliverySecret' from the delivery-evidence checks array on a mutated copy " +
      "-> plant undetected, gate still passes",
  );
  writeHel846Plant(hel846OpenspecPlant, `hel846 selftest plant\n${HEL846_VENDOR_VALUE}\n`);
  const removedCheckResult = runMutatedScript(
    "{\n" +
      '    id: "delivery-evidence",\n' +
      "    root: openspecRoot,\n" +
      '    include: "allNonBinary",\n' +
      '    checks: ["deliverySecret"],\n' +
      "  }",
    "{\n" +
      '    id: "delivery-evidence",\n' +
      "    root: openspecRoot,\n" +
      '    include: "allNonBinary",\n' +
      '    checks: ["importGraph"],\n' +
      "  }",
    hel846MutatedChecksScriptPath,
  );
  check(
    "removing the check from the checks array silently stops detecting the plant",
    removedCheckResult.status === 0,
    removedCheckResult.stderr,
  );
  removeHel846MutatedScripts();

  console.log(
    "case: removing 'deliverySecret' from the needsText disjunction on a mutated copy " +
      "-> plant undetected, gate still passes",
  );
  const removedNeedsTextResult = runMutatedScript(
    'surface.checks.includes("secretLiteral") ||\n' +
      '      surface.checks.includes("deliverySecret");',
    'surface.checks.includes("secretLiteral");',
    hel846MutatedChecksScriptPath,
  );
  check(
    "removing deliverySecret from needsText silently stops detecting the plant",
    removedNeedsTextResult.status === 0,
    removedNeedsTextResult.stderr,
  );
  removeHel846MutatedScripts();
  removeHel846Plants();

  // ── HEL-846 case 6: the vacuity guard covers the new surfaces —
  //    pointing a surface root at a nonexistent path (never renaming a
  //    tracked directory; never openspec/) fails vacuously, naming the
  //    surface and its root. ──────────────────────────────────────────────
  console.log("case: notes surface root pointed at a nonexistent path on a mutated copy -> FAIL");
  const vacuityResult = runMutatedScript(
    'const notesRoot = join(repoRoot, "notes");',
    'const notesRoot = join(repoRoot, "notes-hel846-nonexistent");',
    hel846MutatedSurfacesScriptPath,
  );
  check(
    "nonexistent surface root fails vacuously, naming the surface and root",
    vacuityResult.status === 1 &&
      vacuityResult.stderr.includes('"notes"') &&
      vacuityResult.stderr.includes("VACUOUS SURFACE"),
    vacuityResult.stderr,
  );
  removeHel846MutatedScripts();

  // ── HEL-846 case 7: `assertSurfacesValid` still rejects an unrecognized
  //    check name or a duplicate id among the new entries. ────────────────
  console.log("case: notes surface declares an unrecognized check name -> throws");
  const unknownDeliveryCheckResult = runMutatedScript(
    '{ id: "notes", root: notesRoot, include: "allNonBinary", checks: ["deliverySecret"] },',
    '{ id: "notes", root: notesRoot, include: "allNonBinary", checks: ["deliverySecretTypo"] },',
    hel846MutatedChecksScriptPath,
  );
  check(
    "unrecognized check name crashes the mutated copy",
    unknownDeliveryCheckResult.status !== 0,
    `status=${unknownDeliveryCheckResult.status} stderr=${unknownDeliveryCheckResult.stderr}`,
  );
  check(
    "error names the unrecognized check",
    unknownDeliveryCheckResult.stderr.includes('unrecognized check "deliverySecretTypo"'),
    unknownDeliveryCheckResult.stderr,
  );
  removeHel846MutatedScripts();

  console.log("case: docs/notes surfaces declare a duplicate id -> throws");
  const duplicateDeliveryIdResult = runMutatedScript(
    '{ id: "notes", root: notesRoot, include: "allNonBinary", checks: ["deliverySecret"] },',
    '{ id: "docs", root: notesRoot, include: "allNonBinary", checks: ["deliverySecret"] },',
    hel846MutatedChecksScriptPath,
  );
  check(
    "duplicate id crashes the mutated copy",
    duplicateDeliveryIdResult.status !== 0,
    `status=${duplicateDeliveryIdResult.status} stderr=${duplicateDeliveryIdResult.stderr}`,
  );
  check(
    "error names the duplicate id",
    duplicateDeliveryIdResult.stderr.includes('duplicate id "docs"'),
    duplicateDeliveryIdResult.stderr,
  );
  removeHel846MutatedScripts();

  // ── HEL-996 case 1 & 2: a forced skip is a hard failure when CI is set,
  //    and stays a non-fatal warning when CI is cleared. ──────────────────
  // Placed at the END of the try block, after every other case has cleaned
  // up: the spawned child re-plants the same fixed-path fixtures used above
  // in this same worktree, so its own `finally` would delete a still-live
  // parent plant if this ran interleaved (skeptic-design-1 note 1).
  //
  // The forced-skip hook (`HEL996_FORCE_SKIP_SELFTEST`) is ALSO the
  // recursion guard: only the top-level, non-forced run reaches this block
  // at all, so a spawned child -- which always runs with the hook set --
  // never re-spawns probes of its own (design.md Decision 4).
  if (!process.env.HEL996_FORCE_SKIP_SELFTEST) {
    console.log(
      "case: forced skip with CI set -> hard failure naming the skip and the fatal branch",
    );
    const forcedSkipCiResult = spawnSync("node", [selfPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HEL996_FORCE_SKIP_SELFTEST: "1", CI: "1" },
    });
    check(
      "forced skip with CI set exits non-zero",
      forcedSkipCiResult.status !== 0,
      `status=${forcedSkipCiResult.status} stderr=${forcedSkipCiResult.stderr}`,
    );
    check(
      "output names the synthetic skipped case",
      forcedSkipCiResult.stdout.includes("hel996-forced-skip-probe"),
      forcedSkipCiResult.stdout,
    );
    check(
      "output carries the fatal-skip-in-CI token",
      forcedSkipCiResult.stderr.includes("FATAL SKIP IN CI"),
      forcedSkipCiResult.stderr,
    );

    // ── HEL-996 case 2: the same forced skip stays a non-fatal warning when
    //    CI is cleared (the local-developer-running-as-root case). ──────────
    console.log("case: forced skip with CI cleared -> non-fatal, still names the skip");
    const forcedSkipEnvNoCi = { ...process.env, HEL996_FORCE_SKIP_SELFTEST: "1" };
    delete forcedSkipEnvNoCi.CI;
    const forcedSkipNoCiResult = spawnSync("node", [selfPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: forcedSkipEnvNoCi,
    });
    check(
      "forced skip with CI cleared exits zero",
      forcedSkipNoCiResult.status === 0,
      `status=${forcedSkipNoCiResult.status} stderr=${forcedSkipNoCiResult.stderr}`,
    );
    check(
      "output still names the synthetic skipped case",
      forcedSkipNoCiResult.stdout.includes("hel996-forced-skip-probe"),
      forcedSkipNoCiResult.stdout,
    );
  }
} finally {
  removePlanted();
  removeMcpPlantedSecret();
  removeDriftProbe();
  removeHel993McpStandIn();
  restoreMcpRootIfMoved();
  removeMutatedScript();
  removeHel993McpUnreadableFile();
  removeHel993ImportGraphFiles();
  removeHel993CredentialPropFile();
  removeHel993BfsFiles();
  removeHel993LockedDir();
  removeHel993MutatedEntryScript();
  removeHel846Plants();
  removeHel846MutatedScripts();
}

if (failures > 0) {
  console.error(`\ncheck-no-credential-in-agent-surface.selftest: FAIL (${failures} failure(s))`);
  process.exit(1);
} else if (skippedCases.length > 0) {
  // A silent skip would be exactly the defect class this ticket exists to
  // close (design.md Risks/Trade-offs) — never claim full coverage without
  // naming what was skipped and why (skeptic-design-2.md non-blocking note).
  //
  // HEL-996: a skip reaching a merge-blocking CI run must never be reported
  // as success -- that is precisely how the euid-0 branch dodged coverage
  // for HEL-846's CI wiring (design.md Decisions 2-3). Key this on the
  // accumulated `skippedCases` list, not on `isRoot`, so any future skip
  // reason inherits the guard for free. Outside CI (a developer legitimately
  // running as root locally) this remains a visible, non-fatal skip at
  // exit 0, so the local hook stays usable.
  const skipSummary = `${skippedCases.length} case(s) skipped: ${skippedCases.join("; ")}`;
  if (process.env.CI) {
    console.error(
      `\ncheck-no-credential-in-agent-surface.selftest: FATAL SKIP IN CI (${skipSummary}) -- ` +
        `a skipped case can never be reported as coverage in a merge-blocking run.`,
    );
    process.exit(1);
  }
  console.log(`\ncheck-no-credential-in-agent-surface.selftest: OK WITH SKIPS (${skipSummary})`);
} else {
  console.log("\ncheck-no-credential-in-agent-surface.selftest: OK");
}
