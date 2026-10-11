## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `a0ab703c62ce7aadf74a4864d66ffccc35e8a56e`. Diff base resolved live: `e56d94b107acfc72ac100803c9b26fa471ac3ad9`.
I re-ran everything myself. The transcript is at
`/home/matt/Development/helio/.concertino/runs/HEL-1462/evidence/evaluator-cycle1-reruns.txt`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1: PASS. `check-precommit-ci-parity.mjs` no longer reads the YAML structure with regexes. `parseCiCompleteNeeds` and
  `extractJobBlocks` are deleted, and no references to them remain in code. The script gets `needs` from the shared
  js-yaml `readCiTopology`. It gets commands only from parsed `steps[].run` strings, through `jobRunCommands`. Any reader
  error makes it fail closed, and it never treats the covered set as empty.
- AC2: PASS, and I checked the red-first claim independently. I ran the new parity selftest against the e56d94b10
  scripts: 7 of 14 cases failed (f, h, i, j, k, l, n), with exit 1. The decoy case (f) passed the old code ("no errors —
  check passed"). I also ran a real-file version: base ci.yml plus the m1 comment decoy. The old parity check exited 0
  (the defect). The new one exited 1 and named all 28 hook scripts. My results match the executor's
  `red-first-selftests.txt` line for line. Note: case (g), the block-scalar decoy, and case (m), null steps, already pass
  on the old code. (g) can't go red there because the old regex only looked at the ci-complete block. (m) exists to stop
  regressions. Neither is presented as a red.
- AC3: PASS. `ci-complete` now runs `npm run check:ci-complete-needs` (ci.yml:721). I applied mutation m2 (drop
  `frontend` from needs) to a temp copy and ran the exact CI command (`npm run check:ci-complete-needs` in the mutated
  root): exit 1, naming `"frontend" is missing`. `ci-complete` has `if: always()`, so it still runs when `frontend`
  is no longer awaited.
- AC4: PASS. Both checks and both selftests are green on the clean tree. Every mutation goes red (see Phase 2). The
  gate-chain isolation evidence is where the delivery gate looks for it (see below).
- Tasks: all items are checked off and match the diff. There is no scope creep. The only changes are the two scripts,
  their selftests, ci.yml, and the change artifacts.
- Spec deltas: the `ci-required-jobs-guard` MODIFIED/ADDED requirements and the new `precommit-ci-parity-guard`
  capability describe what was built. No existing spec covers parity, so a new capability is correct.
- CONSTRAINTS C1 and C2 are met. The real ci.yml was changed only by the intended diff. All mutations ran on copies under
  `.hel1462-scratch/`. Red-first evidence is recorded in the run evidence directory.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in `WORKTREE_PATH`. No `frontend/**` or `backend/**` files changed, so the configured npm/sbt gate
sets don't trigger. I ran the checks that are relevant here:
- `npm run check:ci-complete-needs`: exit 0. `check:ci-complete-needs:selftest`: all passed, exit 0.
- `npm run check:precommit-ci-parity`: OK, 28/28 covered, exit 0. `check:precommit-ci-parity:selftest`: 14/14, exit 0.
- `npx eslint --max-warnings=0` on the 4 changed scripts: exit 0. `npx prettier --check` on the scripts, ci.yml and the
  change dir: clean. `npm run check:openspec`: clean.

Mutations I ran on temp copies of the HEAD repo files (`.hel1462-scratch/eval-mut/`, never the real ci.yml). Each diff
was confirmed to be a real one-hunk change:

| mutation | needs-guard (`npm run check:ci-complete-needs`) | parity |
|---|---|---|
| clean | exit 0 | exit 0 |
| m1 decoy comment + `frontend` dropped | exit 1 (`frontend` missing) | exit 1 (27 scripts uncovered) |
| m2 `frontend` dropped | exit 1 (`frontend` missing) | exit 1 |
| guard step removed from ci-complete | exit 1 ("must run the guard") | exit 1 (`check:ci-complete-needs` uncovered) |
| ci-complete runs only `:selftest` | exit 1 ("must run the guard") | exit 1 (`check:ci-complete-needs` uncovered) |

ci.yml review:
- Steps in `ci-complete`: the existing "Verify no job failed or was cancelled" step stays first and is unchanged. It is
  followed by `actions/checkout@v7`, `actions/setup-node@v7` (node 22, `cache: npm`,
  `cache-dependency-path: package-lock.json`), `npm ci`, and `npm run check:ci-complete-needs`. The action versions and
  node version match the `frontend` job. The root `package-lock.json` exists and js-yaml 4.3.2 is a root devDependency.
- There is no step-level `if:`. If an earlier need failed, step 1 exits 1 and the later steps are skipped, so the job is
  still red, which is correct.
- `timeout-minutes` went from 2 to 6, as design D4 says. The comment says this is an estimate, and design D4 says the
  real number will be measured on the PR.
- The YAML is valid: the new check parses the real file, and its output lists all 6 jobs.
- `frontend` lost only the `- run: npm run check:ci-complete-needs` step. The non-comment diff of ci.yml confirms this.
  `check:ci-complete-needs:selftest` and the parity steps stay.

Code quality: DRY is improved. The token extractors now live in one place and parity imports them. There is one YAML
parser for the file and no reverse import, so the hook-invoked surface is still only `check-ci-complete-needs.mjs`.
Existing error messages and selftest assertions are kept. Structural errors return before the D5 anchor check runs, and
a selftest asserts that. Non-list `steps` is an error, not a silent empty list.

Fixture edit (case e: `frontendRun` undefined changed to `"      - run: true\n"`): this is a legitimate fixture
correction, not a masking symptom. The old fixture put the literal text `undefined` at column 0 under `frontend.steps`,
which is not valid YAML. I checked it with js-yaml: "can not read a block mapping entry ... (6:10)". The old regex
scanner never noticed. Under the new parser, the original fixture fails only with the parse error. That error doesn't
match the case's `/check:schemas/` assertion, so the case would fail for the wrong reason. With the corrected fixture,
the new code fails for the intended reason: `check:schemas` is uncovered because it runs only in `backend`, which isn't
in needs. The assertion pattern and the case's intent are unchanged, and nothing was loosened.

Gate-chain isolation evidence location: verified. `check-gate-chain-change.sh "$W" origin/main HEL-1462` prints
`GATECHAIN yes` / `SCRIPT scripts/check-ci-complete-needs.mjs`. `assert-phase.sh` delivery (lines 277 and 322) looks for
`${main checkout}/.concertino/runs/HEL-1462/evidence/.concertino/gate-chain-isolation-evidence/scripts__check-ci-complete-needs.mjs.md`.
That file exists and contains `**PASS**`, which is the string the gate greps for. The persisted `design.md` that check (a)
reads is at `evidence/openspec/changes/parity-yaml-needs-guard/design.md`. It is byte-identical to the worktree copy and
contains the fully answered Gate-Chain Implications Checklist.

### Phase 3: UI Review — N/A
None of the trigger paths changed (`frontend/**`, ApiRoutes.scala, `schemas/**`, `openspec/specs/**`). The spec deltas
are under `openspec/changes/`, not `openspec/specs/`, and nothing in the change renders UI.

### Overall: PASS

### Non-blocking Suggestions
- `.hel1462-scratch/` is untracked and not gitignored (`git status`: `?? .hel1462-scratch/`). Remove it before the
  Delivery squash or push so it can't be swept into a commit. The design already says it is never committed.
- The `ci-complete` setup-node cache key covers only the root lockfile, so it is a separate cache entry from `frontend`'s
  three-lockfile key. The first run will miss the cache. Record the measured `ci-complete` duration in the PR body, as
  design D4 says.
- Known residual gaps are written down in design Risks (`if: false` or `continue-on-error` on the guard step; removing
  the step and dropping `frontend` in the same edit). They are caught only by the hook and are out of scope.
