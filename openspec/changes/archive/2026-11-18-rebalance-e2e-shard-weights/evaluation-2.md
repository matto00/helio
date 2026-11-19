## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: d4facfea875dd04d942045425f8cd01a6d92d6ca. Base, resolved live: 5f137cb5ffbf358b4ac47f044ad6fe26fce74d37 (origin/main after the merge 8cdc5525a).

Scope: the fold-in tasks 2b.1-2b.4, checked against design.md Decisions 4-5, plus a re-check that the cycle-1 work still holds. Section 3 (the CI measurement) is orchestrator-owned and not yet expected. It is not counted against this cycle.

The worktree was clean before the mutation checks and is clean after them (`git status --short` prints nothing). Every mutation was reverted with `git checkout -- <file>`.

### Phase 1: Spec Review — PASS
Issues: none.

- **New AC (7 legs, keep the weights):** met.
  - The matrix is `shard: [1, 2, 3, 4, 5, 6, 7]` and `max-parallel` is 7.
  - `DEFAULT_E2E_LEGS` is 7.
  - `e2e/shard-weights.tsv` is unchanged since cycle 1: it is byte-identical (`cmp`) to my cycle-1 fresh regeneration.
  - The measurement part of the AC is section 3 and is not due yet.
- **Tasks 2b.1-2b.4:** all four are checked and match the diff. The executor's record of the red result for 2b.1 is in `.concertino/scratch/HEL-1772/fold-in.md`.
- **Decision 4 premise figures**, checked against the GitHub API (`/runs/44410691147/attempts/{1,2,3}/jobs`, e2e job walls):

  | Attempt | Slowest leg | Mean leg | Known-flake failure |
  |---|---|---|---|
  | 1 | 1433 s | 1118 s | leg 4 |
  | 2 | 1395 s | 1118 s | leg 1 |
  | 3 | 1340 s | 1102 s | none |

  These match the design and the disclosure about which attempts count.
- **Constraints C1-C9 are honored.** In particular, C7:
  - `timeout-minutes: 25` is unchanged.
  - The only change to `scripts/e2e-shard.mjs` is the constant and its comment. The partition logic is untouched.
  - No `cd-*.yml`, HEL-1743 or HEL-1732 file is in the diff.
  - Scratch files are not committed.
- **Spec fit:** `openspec/specs/e2e-ci-sharding/spec.md` never hardcodes a leg count, so `skip_specs` still holds.

### Phase 2: Code Review — PASS
Issues: none blocking.

Fresh evidence, all run by me in `WORKTREE_PATH`:

- **ci.yml non-comment diff:** only `max-parallel: 6 -> 7` and `shard: [...6] -> [...7]`. I grepped every changed line that does not start with `#`; nothing else appears.
- **Selftest at HEAD:** 18 cases passed, rc=0.
- **Fixtures derive from the leg count.** `full()` is `reps(EXPECTED_SHARD_REPORTS)`. The under-count case uses n-1 and the over-count case uses n+1. The "expected exactly" strings are built from the constant. The explicit `--legs 6` 5-of-6 case keeps its literal 6, which the task allows.
- **The drift guard fails both ways.** I re-ran each mutation myself, then restored the file:
  - (a) Matrix only set back to 6 legs: rc=1, failing with `ci.yml e2e matrix has 6 legs but DEFAULT_E2E_LEGS is 7`. All earlier fixture cases still printed `ok`.
  - (a2) `max-parallel` only set back to 6: fails with `ci.yml e2e max-parallel is 6 but DEFAULT_E2E_LEGS is 7`.
  - (b) `DEFAULT_E2E_LEGS` only set back to 6: fails at the drift assertion (`ci.yml e2e matrix has 7 legs but DEFAULT_E2E_LEGS is 6`), not at a fixture. The fixture cases before it all print `ok`, which confirms they follow the constant.
- **Every RED case can still fail.** Each mutation below is a one-line change to `validateRunReports`, reverted afterwards:
  - (c1) Count check changed `!==` to `<`, so an over-count passes: the selftest fails with `expected a throw`.
  - (c3) Count check changed `!==` to `>`, so an under-count passes: fails with `expected a throw`.
  - (c2) Flaky check disabled: the stats RED case fails with `expected a throw`.
- **`node scripts/e2e-shard.mjs plan`:**
  - 7 legs, 1382-1387 s weighted each, 114 files assigned.
  - No `defaulted` line and no `stale weight rows` line, even after the merge from main.
  - No file appears twice. The 13 discovered `*.spec.ts` files missing from the plan are excluded by `playwright.config.ts` `testIgnore`; the tool's own listing-equality check is what enforces exactly-once.
- **Docs are current.** The widened grep (`6 legs`, `six legs`, `~8 legs`, `never add legs`, `4 + e2e 6`, `backend 4 + e2e`, `6-leg`, `10 parallel`, `--legs 6` and similar, outside `openspec/changes/**`) hits only:
  - historical HEL-1698/HEL-1772 context in ci.yml, each marked as superseded;
  - the updated MISTAKES.md:211 (`backend 4 + e2e 7 = 11 parallel jobs; adding legs is an owner decision`);
  - playwright.config.ts:192 (7 legs).

  e2e/README.md now says `default 7 legs`, `7 since HEL-1772`, and that runs from before the current count need `--legs 6` or `--legs 4`. No stale e2e leg count or cap statement remains.
- **Other gates:**
  - `npm run format:check` passes, and `npm run lint` passes (rc=0).
  - eslint with `--max-warnings 0` on the two scripts and `playwright.config.ts` passes.
  - `check:ci-complete-needs`, `check:openspec`, `check:precommit-ci-parity` and `check:repo-integrity` all pass. No `frontend/**` or `backend/**` file changed, so jest, build and sbt are not triggered.
- **Code quality:** the code changes are small and readable. The new assert messages name both values in a mismatch. There is no dead code and no over-engineering.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed. No servers were started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- **`.github/workflows/ci.yml:619` is one comment line of about 400 characters.** The surrounding block wraps at about 120. Also, its closing "Regenerate it again when a heavy spec is added" now comes after the 7th-leg sentence, so "it" no longer clearly means the weight table. Re-wrapping the line and writing "the weight table" would fix both. This is cosmetic; prettier does not wrap YAML comments.
- **The ci.yml comment says the mean leg was "about 1100-1118 s".** The API gives 1102-1118 s. This is not wrong, but the exact range would be more precise.
