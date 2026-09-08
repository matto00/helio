#!/usr/bin/env node
// Self-test for scripts/check-tokens.mjs (HEL-1037). This is the actual deliverable of that
// ticket: a guard proven failable ONCE at review time (by manual mutation) can silently stop
// being failable through a later refactor; this selftest re-proves it on every commit and CI run.
//
// Two kinds of cases, deliberately kept separate:
//   (1) Pure-function cases, driven directly against the exported extractors/checkTokens over
//       in-memory fixture text -- no disk, no subprocess.
//   (2) A real CLI-subprocess case, because task 4.3a's seam (a scan-root argument) exists
//       specifically so main() can be exercised end to end -- the pure functions alone cannot
//       prove the CLI wiring (argv parsing, process.exit, stdout) actually works.
//
// EVERY case asserts on the TOKEN NAMED IN THE OUTPUT, never on exit code / error-count alone
// (design.md D3a mechanism 2): pointed at a fixture whose shape is nothing like `main`, a
// corpus-shaped assertion would make every "must fail" case pass for the fixture's own size
// (the decoy proving nothing) and every "must pass" case could never go green.
//
// SANDBOX HAZARD (task 4.3/4.3b): the CLI case plants its fixture under `mkdtemp` in
// `os.tmpdir()`, NEVER inside the tracked repo tree, and is removed in `finally`. Because
// `finally` does not survive SIGKILL, this also sweeps stale `helio-tokens-selftest-*`
// directories at startup -- idempotent, so a killed prior run cannot poison this one and cannot
// accumulate.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments, extractDefinitions, checkTokens, ALLOWLIST } from "./check-tokens.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts/check-tokens.mjs");

const TMP_PREFIX = "helio-tokens-selftest-";

// Idempotent startup sweep -- `mkdtemp` gives no deterministic path to clean, so this removes
// any stale `helio-tokens-selftest-*` directory left by a run that was SIGKILLed before its
// `finally` could run. Safe to run every time: a live run's own directory is created AFTER this
// sweep executes.
function sweepStaleFixtures() {
  let entries;
  try {
    entries = readdirSync(tmpdir(), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(TMP_PREFIX)) {
      rmSync(join(tmpdir(), entry.name), { recursive: true, force: true });
    }
  }
}

let passed = 0;
let failed = 0;

function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail) console.log(`        ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// (1) Pure-function cases
// ---------------------------------------------------------------------------

function caseA_exactSetOverControlledFixture() {
  // Task 4.2a -- the over-permissiveness detector (design.md D3a). A real declaration alongside
  // decoys that resemble declarations textually but are selector fragments.
  const fixture = `
.a__b--decoy:hover {
  color: red;
}
.x--other::before {
  content: "";
}
.foo {
  --real: 1px;
}
`;
  const defs = extractDefinitions(stripComments(fixture));
  record(
    '(a) exact-set: controlled fixture\'s extracted definitions equal exactly ["--real"]',
    defs.size === 1 && defs.has("--real"),
    `got: ${JSON.stringify([...defs])}`,
  );
}

function caseB_decoyReferenceStillFails() {
  // Same fixture, but also referencing var(--decoy). Asserting only that the run stays green is
  // insufficient (a decoy silently ignored for an unrelated reason would pass a green-only
  // assertion while proving nothing) -- assert the OUTPUT NAMES --decoy.
  const fixture = new Map([
    [
      "fixture.css",
      `
.a__b--decoy:hover { color: red; }
.foo {
  --real: 1px;
  color: var(--decoy);
}
`,
    ],
  ]);
  const { errors } = checkTokens(fixture, {});
  const named = errors.some((e) => e.includes("--decoy"));
  record(
    "(b) decoy reference still fails, and the output names --decoy",
    errors.length === 1 && named,
    `got errors: ${JSON.stringify(errors)}`,
  );
}

function caseC_commentDoesNotTrip() {
  // Task 4.2: exercised against the REAL shared/chrome/MobileNavSheet.css:54-55 shape -- a
  // comment wrapping mid-token across a line break.
  const fixture = new Map([
    [
      "MobileNavSheet.css",
      `.wrapper {
  /* entirely from the wrapper's anchor. Repeating \`top: var(--app-top-chrome-
   * -height)\` here would be a RELATIVE offset */
  top: var(--app-top-chrome-height);
}
:root {
  --app-top-chrome-height: 56px;
}
`,
    ],
  ]);
  const { errors } = checkTokens(fixture, {});
  record(
    "(c) var() inside a comment does not trip the check, and the real token still resolves",
    errors.length === 0,
    `got errors: ${JSON.stringify(errors)}`,
  );
}

function caseD_allowlistedTokenPasses() {
  const [name] = Object.keys(ALLOWLIST);
  const fixture = new Map([["fixture.css", `.x { background: var(${name}, transparent); }`]]);
  const { errors } = checkTokens(fixture);
  record(
    `(d) allowlisted token (${name}) passes even with a fallback`,
    errors.length === 0,
    `got errors: ${JSON.stringify(errors)}`,
  );
}

function caseE_nonAllowlistedUndefinedFails() {
  const fixture = new Map([["fixture.css", `.x { color: var(--nope); }`]]);
  const { errors } = checkTokens(fixture, {});
  const named = errors.some((e) => e.includes("--nope"));
  record(
    "(e) a non-allowlisted undefined token fails, and the output names --nope",
    errors.length === 1 && named,
    `got errors: ${JSON.stringify(errors)}`,
  );
}

function caseF_fallbackDoesNotExemptAReference() {
  // Task 2.1a / design.md D3b -- var(--typo, fallback) is still checked.
  const fixture = new Map([["fixture.css", `.x { color: var(--typo, #fff); }`]]);
  const { errors } = checkTokens(fixture, {});
  const named = errors.some((e) => e.includes("--typo"));
  record(
    "(f) a fallback does not exempt a reference, and the output names --typo",
    errors.length === 1 && named,
    `got errors: ${JSON.stringify(errors)}`,
  );
}

function caseG_definitionOutsidePrimaryFileResolves() {
  // design.md D3 -- the token source set is every scanned file, not just theme.css.
  const fixture = new Map([
    ["theme.css", `:root { --app-accent: blue; }`],
    ["toast.css", `.toast { --toast-intent-color: green; }`],
    ["consumer.css", `.x { color: var(--toast-intent-color); }`],
  ]);
  const { errors } = checkTokens(fixture, {});
  record(
    "(g) a token defined outside theme.css still resolves",
    errors.length === 0,
    `got errors: ${JSON.stringify(errors)}`,
  );
}

// ---------------------------------------------------------------------------
// (2) Real CLI-subprocess case -- exercises main() end to end via the scan-root seam
// (task 4.3a), under `mkdtemp`, never touching a tracked file.
// ---------------------------------------------------------------------------

function withMkdtempFixture(build, run) {
  const dir = mkdtempSync(join(tmpdir(), TMP_PREFIX));
  try {
    build(dir);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function caseH_cliFailsOnUndefinedReference() {
  withMkdtempFixture(
    (dir) => {
      writeFileSync(join(dir, "fixture.css"), `.x { color: var(--nope); }\n`);
    },
    (dir) => {
      const result = spawnSync(process.execPath, [scriptPath, dir], { encoding: "utf8" });
      const namesToken = (result.stdout + result.stderr).includes("--nope");
      record(
        "(h) CLI subprocess over a mkdtemp fixture: undefined reference fails, output names --nope",
        result.status !== 0 && namesToken,
        `status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`,
      );
    },
  );
}

function caseI_cliPassesOnResolvedTree() {
  withMkdtempFixture(
    (dir) => {
      writeFileSync(
        join(dir, "fixture.css"),
        `:root { --app-accent: blue; }\n.x { color: var(--app-accent); }\n`,
      );
    },
    (dir) => {
      const result = spawnSync(process.execPath, [scriptPath, dir], { encoding: "utf8" });
      record(
        "(i) CLI subprocess over a mkdtemp fixture: fully-resolved tree passes",
        result.status === 0,
        `status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Task 4.4 -- cleanup MUST survive the self-test failing PARTWAY, not only succeeding. A cleanup
// that only runs on the success path is the hazard restated. This deliberately throws INSIDE the
// fixture body and asserts the mkdtemp directory is gone afterwards regardless.
// ---------------------------------------------------------------------------

function caseJ_cleanupSurvivesPartialFailure() {
  let plantedDir;
  let threw = false;
  try {
    withMkdtempFixture(
      (dir) => {
        plantedDir = dir;
        writeFileSync(join(dir, "fixture.css"), `.x { color: var(--nope); }\n`);
      },
      () => {
        throw new Error("simulated mid-run failure");
      },
    );
  } catch (err) {
    threw = err instanceof Error && err.message === "simulated mid-run failure";
  }
  record(
    "(j) cleanup survives a forced failure partway through -- the fixture directory is gone",
    threw && typeof plantedDir === "string" && !existsSync(plantedDir),
    `threw=${threw} plantedDir=${plantedDir} stillExists=${plantedDir ? existsSync(plantedDir) : "n/a"}`,
  );
}

function main() {
  sweepStaleFixtures();

  console.log("check-tokens.selftest: running fixture cases\n");
  caseA_exactSetOverControlledFixture();
  caseB_decoyReferenceStillFails();
  caseC_commentDoesNotTrip();
  caseD_allowlistedTokenPasses();
  caseE_nonAllowlistedUndefinedFails();
  caseF_fallbackDoesNotExemptAReference();
  caseG_definitionOutsidePrimaryFileResolves();
  caseH_cliFailsOnUndefinedReference();
  caseI_cliPassesOnResolvedTree();
  caseJ_cleanupSurvivesPartialFailure();

  const total = passed + failed;
  console.log(`\n${passed} passed, ${failed} failed, ${total} total`);
  if (total !== 10) {
    console.error(`check-tokens.selftest: expected 10 cases, ran ${total} -- failing.`);
    process.exit(1);
  }
  if (failed > 0) process.exit(1);
}

main();
