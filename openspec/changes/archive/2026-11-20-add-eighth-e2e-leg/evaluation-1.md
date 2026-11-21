## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 7b414bdd31ef0b69ae2117b1753b7152f669ff1d against live-resolved base 13180246ad2ab41bfed697e422ff419321d9df78
(commits d6b1bb7a9 red evidence, then 7b414bdd3 implementation). Scope: tasks 1-4. Task 5 (after-measurement on PR
runs, post-merge watch) belongs to Delivery and was not expected.

### Phase 1: Spec Review — PASS
- AC1 (owner remedy implemented): `ci.yml` e2e `max-parallel: 8`, `shard: [1..8]`; `timeout-minutes: 25` and
  `runs-on: ubuntu-24.04` unchanged; `DEFAULT_E2E_LEGS = 8`. Matches the owner ruling (no timeout raise, no runner class change).
- AC2/AC3 (after table on 5 counting runs): Delivery work (task 5), not expected in cycle 1. The before table is present.
- Before table checked on its own. I fetched the jobs API (`filter=latest`) and the `e2e-runner-shard-*` artifacts
  for 44855074949, 44845120888, 44840748251, 44821653778, 44811851467 and 44854332613, and computed each leg's wall
  (`completed_at - started_at`) and `cpu_model`. Every per-leg wall and CPU model in measurement.md matches, and so do
  every slowest-leg index and wall, every mean (1090/1071/1092/1005/1038) and every slowest-leg `Run e2e suite` step
  (1117/1095/1119/987/1169). The "setup" column is the `Run ./.github/actions/e2e-setup` step's duration
  (HEL-1789's method), not wall minus step. That is consistent.
- Run selection checked: `gh run list --branch main --event push` puts 44854332613 (3fa325155, failure, leg 4) as the
  only non-green run among the 6 newest. Excluding it and taking the next older run is correct, and the 5 used are the
  5 newest green main runs.
- C12: the red evidence commit d6b1bb7a9 touches only `openspec/changes/add-eighth-e2e-leg/**` and comes before the
  implementation commit.
- Every D1 leg-count site is updated: ci.yml:619/622/631/633/857, e2e-shard.mjs:231/234, playwright.config.ts:192,
  e2e/README.md:140/144/146 and MISTAKES.md:211. The task 2.3 zero-hit `git grep` gave zero hits (exit 1). A wider
  `git grep` for six/seven/6/7 leg/shard phrasing turned up no other stale count. The remaining "7-leg" text at
  ci.yml:619 is intended history.
- Spec delta: it modifies "e2e CI legs keep headroom" with the full requirement text plus a new scenario and the
  CPU-model cause clause. `openspec validate add-eighth-e2e-leg` says it is valid.
- CONSTRAINTS C1-C14 are honoured. The diff has no .env contact and no app code.
Issues: none blocking (see suggestion 1).

### Phase 2: Code Review — PASS
I ran each gate myself in WORKTREE_PATH:
- `npm run check:e2e-shard:selftest`: 28 cases passed, exit 0.
- `npm run check:ci-complete-needs:selftest`: all passed, exit 0.
- `npm run lint`: exit 0. `npm run format:check`: all files formatted, exit 0.
- No `frontend/**` or `backend/**` files changed, so the frontend build, jest and `sbt testFull` gates do not apply.

Weights regeneration, reproduced byte for byte. I downloaded `playwright-json-shard-*` for the 5 runs into my own
directory, generated my own `--list` JSON (`DEV_PORT=7225 npx playwright test --list --reporter=json --project=dev`)
and ran `node scripts/e2e-shard.mjs weights --legs 7 --list ... <5 dirs>`. `cmp` against the committed
`e2e/shard-weights.tsv` shows the files are identical, and stderr was empty. My list JSON differs from the executor's
only in the DEV_PORT-derived fixture port and the timestamps, so the result does not depend on that file. Rows exist
for hel1735 (135), hel1791 (84) and both HEL-1649 narrow specs (137/83). `plan 8` shows no `defaulted` file, and the
per-leg loads (1462-1465 s) match measurement.md.

Selftest mutation reds, reproduced on the post-change tree in a scratch mirror (since deleted; the worktree was not
touched):
- Constant 7 with matrix 8 exits 1: "matrix has 8 legs but DEFAULT_E2E_LEGS is 7".
- `max-parallel` 7 alone exits 1.
- Matrix 7 alone exits 1.
The guard can fail in each direction. The executor's pre-change reds (8 !== 7 at :211 and :216) agree with the
assertion layout.

Code quality: the edits are comment and constant changes only, with no dead code and no over-engineering. Each
history clause is kept and the HEL-1793 ruling is added to it.
Issues: none.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The spec delta lives under
`openspec/changes/`. No servers were started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- design.md D4 says the Before section also cites HEL-1789's 5 PR runs (44708860497, 44712167515, 44716239460,
  44723866593, 44728460728) from its after.md, but measurement.md does not list them. Either add a one-line citation
  or drop the clause from D4, so the planning artifact matches what was delivered.
- The measurement scripts in `.concertino/runs/HEL-1793/evidence/measurement/` read artifacts from
  `.concertino/scratch/HEL-1793/art` (lib.mjs `S`, capture.sh). A post-merge sweep of scratch would leave the driver's
  D4a main watch with scripts that point at a missing directory. Note that in the hand-off, or point `S` at the
  evidence directory. Also, the job-name regex `\((\d)\)` handles only single-digit legs. That is fine for 8.
- 44811851467 leg 2 ran 1371 s on an AMD EPYC 9V74, a host the ticket table puts at 1.11-1.17x. That leg is an
  outlier from the "slow host CPU" explanation. If an after-run has a leg over 1200 s on a fast CPU, state the cause
  rather than attributing it to the CPU.
