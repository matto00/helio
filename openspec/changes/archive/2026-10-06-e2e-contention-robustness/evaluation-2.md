## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `30f2cecce939c69b27ea0fec158697c92c07a024`. Live-resolved base: `9415a44eca125f5bee25bdd4878911d39b6ecc37` (origin/main).
Cycle-2 delta: `git diff --stat 0726c92d8 HEAD` touches 4 files, all under `openspec/changes/e2e-contention-robustness/`:
`evaluation-1.md` (+121, new), `files-modified.md` (+2), `root-cause-evidence.md` (+17/-4) and `tasks.md` (1 line).
`git diff 0726c92d8 HEAD -- e2e frontend backend playwright.config.ts .github` is empty.

### Owner rulings (verified in `.concertino/runs/HEL-1298/events.jsonl`)
| line | escalation_id | answer | answer_source |
|---|---|---|---|
| 21 | HEL-1298-1791268232005-451d3f | `remeasure-on-quiet-host` | human |
| 27 | HEL-1298-1791334299309-2c65fc | `accept-and-waive-27s` | human |
| 38 | HEL-1298-1791347289159-0ed921 | `rule-header-edit-does-not-invalidate-greens-then-respawn-for-artifacts-only` | human |

All three are `escalation.answered` with `answer_source: "human"`, so they are binding here. Two consequences:
- The hel910 D3 bar (max <= 27s) is waived.
- C8 for hel519 is resolved by the header ruling, so evaluation-1 change request 2 is closed.

The follow-up HEL-1354 exists in Linear (Backlog, relatedTo HEL-1298). Its title is "Pipeline-detail page boot cost: 7 parallel API
calls incl. duplicate run-history GET...", which matches the follow-up the waiver relied on.

### Phase 1: Spec Review — PASS

**Change request 1 (artifacts match the delivered state): resolved.**
- `tasks.md` 4.1 is now `[x]`. Its note cites `accept-and-waive-27s`, escalation `HEL-1298-1791334299309-2c65fc`, f8 at 20/20 green at
  8x with max 28.0s / p50 27.2s, and HEL-1354.
- `root-cause-evidence.md` gained an "Owner rulings" block. It cites all three escalation ids and answers correctly against
  events.jsonl.
- It also gained a "Supersession" paragraph. The loaded-host 5x config line is marked "superseded, loaded-host only". The old "NOT met ...
  Escalated, not delivered as done" sentence is now labelled `[SUPERSEDED ... kept as history]`. Batch A 21/25 is kept and
  labelled as loaded-host history, as requested.

**Change request 2 (C8 for hel519): resolved by owner ruling 0ed921.**
- I checked the ruling's factual premise. `git diff d0cbe62a5 HEAD -- e2e/hel519-recent-navigation.spec.ts` contains only the
  6-line HEL-1288 header: a 4-line comment plus `test.describe.configure({ mode: "parallel" })`.
- No test body changed, so the evidence's claim "test bodies are unchanged" is accurate.
- `git diff d0cbe62a5 HEAD -- e2e/hel910-...` is empty, so the hel910 f8 greens ran on a spec byte-identical to HEAD.
- The evidence says plainly that "no re-run was done". That is honest.

**I checked every number in the cycle-2 artifacts against the raw logs in the executor scratchpad. All of them match.**
- `q/f8.log`: 20 passed. My recomputation from the per-test durations gives min 26.8 / p50 27.2 / max 28.0, and `f8.meta` records load
  before 0.51 and after 6.48.
- `q/u8.log`: 18 failed / 2 passed, with load before 0.44 and after 6.71.
- `g519-r6.txt`: 25 passed.
- `r/u6`: 20 passed, 1.6m, load before 0.75 and after 5.70.
- `r/u8`: 1 failed / 19 passed, 1.9m, load before 1.16 and after 5.38.

The cycle-2 quiet-host hel519 batches (u6 0/20, u8 1/20) are labelled "informational only ... NOT a reproducing config and no
claim rests on them". The owner's question at line 36 of events.jsonl already disclosed those numbers, so the ruling was made with that knowledge.

**C5 (residue records): met.**
- `dev-db-residue-cycle2.txt` lives in the persisted evidence dir and is not committed. It holds 56 lines: 40 u6/u8 rows, 0
  unattributed rows and the 10 evaluator-1 rows, all as exact id and email.
- My own `users-before` snapshot has 752 hel519-/hel910- rows. That equals the file's stated baseline of 712 plus 40, which corroborates the count.
- Nothing was deleted.

The remaining constraints also hold:
- C3: `playwright.config.ts` and `ci.yml` are untouched vs base.
- C4: no assertion or timeout changed.
- C6: the only code changes are the two specs.
- C1: my own run used 2 workers under nice 19.

AC status:
- AC1–AC3 and AC5 were already PASS in evaluation-1, and no code has changed since then.
- AC4 (≥20 consecutive contended greens) is met: hel519 25/25 at 6x (C8 covered by the ruling) and hel910 20/20 at 8x (27s bar waived).

Issues: none.

### Phase 2: Code Review — PASS

Changed files vs base are `e2e/**` and `openspec/changes/**` only. Neither the `frontend/**` nor the `backend/**` gate trigger
matches, so I ran the checks that apply to these files fresh at HEAD 30f2cecce:
- `npx eslint --max-warnings=0` on both specs: exit 0.
- `npx prettier --check` on both specs and the change dir: clean.
- `tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- `check:openspec`: clean.
- `check:no-credential-leak`: 0 violations, 8706 files.
- `check:repo-integrity`: exit 0.
- `check:spec-structure`: 445 specs, 0 issues.
- Full-file run of both specs:
  - Command: `DEV_PORT=6730 BACKEND_PORT=9637 nice -n 19 npx playwright test e2e/hel519-recent-navigation.spec.ts e2e/hel910-pipeline-to-dashboard-flow.spec.ts --workers=2 --output=<scratchpad>`.
  - Servers: vite 56624 and java 56363, with cwd verified to be this worktree. They were reused and not restarted.
  - Result: **10/10 passed (35.1s)**. hel910 full-flow took 8.6s and printed "28 interactions". hel519 tests took 1.6–14.9s.
  - The host was contended by unrelated work: loadavg was 5.77 before and 10.48 after. The hel519 durations of 13.7s and 14.9s reflect that
    ambient load and are not a regression. Evaluation-1 ran on a quiet host and saw at most 6.1s.

The code is unchanged since evaluation-1, whose Phase-2 findings still stand. The cycle-2 diff is prose only.

Issues: none.

### Phase 3: UI Review — N/A

No changed file matches `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: PASS

### Non-blocking Suggestions
- `root-cause-evidence.md` line 10 still opens the measurement section with "load average 10-17 throughout". That is now true
  only of the loaded-host sections above the quiet-host remeasure. A qualifier such as "(loaded-host sections; see quiet-host
  remeasure below)" would stop a reader from misreading it.
- The design's confirmatory CI run (Risks section; C2 limits it to one at a time) is still outstanding before the PR. The driver
  should note in the PR body that hel519's 6x config no longer reproduces on a quiet host (u6 0/20). The fix's justification therefore rests
  on the loaded-host 6x flip (10/30 red -> 25/25 green) and the 8x probe flip (9/20 -> 0/20).

### Evaluator dev-DB residue (C5): users created by my run (10, exact; none deleted)
Derived by exact-id set difference of hel519-/hel910- users before and after my run. All embedded timestamps fall within my run window.
- 89f85daa-4dee-4d28-9025-66a5a34bebb9 hel519-source-list-1791347829180-86991@example.test
- 8bb9fc20-75aa-429e-9a1b-e12c8a634cd1 hel519-pipeline-url-1791347829240-87964@example.test
- aff3a29a-f675-4158-8763-fb79cf59bfe4 hel519-pipeline-bf-1791347841406-35895@example.test
- fc884f97-5809-4e50-ab0e-a78a6d712459 hel519-dashboard-reload-1791347842243-78794@example.test
- db3011f5-7163-433f-ac86-3212f3d87f4a hel519-persist-1791347845724-22284@example.test
- b064b50e-2722-4b57-8d20-3a44cae178ed hel519-fresh-1791347846151-34831@example.test
- 61609ca9-9d34-4c3c-983e-ae6c758b506e hel519-typing-1791347847787-14382@example.test
- 304811c5-e048-48fe-91ba-9d6c8eb82111 hel519-root-landing-1791347850125-32529@example.test
- 6783e898-33fd-40df-ab9d-f870183b69a0 hel910-full-flow-1791347850716-62267@example.com
- 0f85193b-21bf-43e8-8c09-c45536184297 hel910-existing-output-1791347859289-45028@example.com

The run log is in the scratchpad at `eval2/full-uncontended.log`. Every test passed, so there are no failing-run logs to keep. I started no load processes,
stopped no servers, pushed nothing and triggered no CI. `git status` is clean, and the run created no `test-results/` in the worktree.
