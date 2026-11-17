## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `812728f49552e95db214eed3b3d246b2afe565af`. Base resolved live: `ab6cc9416c9451eded398b5787a7d0de707d8d1f`.

### Phase 1: Spec Review — FAIL

The code fix is correct and the root cause holds up (details below). The one failure: tasks 1.1, 1.2 and 2.3 are ticked, but
none of the evidence they require was recorded in the change.

**Root cause, checked independently against the CI trace** (`.concertino/scratch/HEL-1711/trace3/`, parsed with
`python3 -I` using scripts kept in a separate scratchpad dir):
- The first `POST /draft/save` request body has no filter step `a01caaef`; it has only sort `37cfa1c0` and compute `ce6da272`.
  The 422 `CASCADE_CONFIRMATION_REQUIRED` response gives `stepIds:["a01caaef…"]` and `outputIds:["70ce139d…"]`. 70ce139d is the
  "Run duration" chart, whose step is the filter.
- The failing assertion names `preview?outputId=b581d5f4…`, which is the "Avg minutes" metric on compute. The save never
  removed it, so its 200 preview after the save is legitimate.
- The trace shows the clicks `Step 3:` → unscoped `Remove step` → `Save and run` with no wait in between. So this is a race in
  the test, not in the product, which matches design.md Decision 2.

**AC "reproduced locally (e.g. --repeat-each), not assumed": met under design.md Decision 1's fallback, but only by this
evaluation's own evidence.** I ran the following against the live servers on 7143/10050. The specs and config are in
`/home/matt/Development/helio/.concertino/scratch/HEL-1711/eval/`.
- M2 forces the race and keeps the original assertions. One `page.evaluate` clicks the `Step 3:` spine button and then
  `Remove step`, with no dialog check. Result: **red with the exact CI signature.** The focused region afterwards was "Step 1
  Sort rows", so the filter step was removed. The dialog listed "Output: Run duration". The test then failed at `requests
  naming the removed Output` with `+ Received + 3` and one `POST …/preview?outputId=<watched metric>`. This is the CI
  failure, reproduced locally with its root cause shown.
- M1 forces the same race with the executor's new dialog assertion. Result: **red at the new assertion.** Received
  `"…Step: Filter rowsOutput: Run duration…"`, expected `"Avg minutes"`. This confirms the executor's claim that the
  self-check names "Run duration"/"Filter rows".
- The fixed spec, item 7, `--repeat-each=10 --workers=2`: 10/10 passed.
- I did not obtain a natural (unforced) local red, and did not try CPU load. This matches the executor's "no natural local
  red". The CI trace (the natural red) together with the forced-race mutation (the local red) is exactly the fallback
  Decision 1 prescribes. I count the AC as met.

**Issue: the required evidence is not in the change.** Task 1.1 says to "record the command, N, pass/fail counts and the
failing trace path in the commit-adjacent evidence (or the documented no-local-red fallback)". Decision 1 says "if no red is
obtained, say so explicitly". Neither is in the diff:
- The change dir has no record of the 20/20 or 30/30 runs, the CPU-load method, the mutation, or its red output.
- `.concertino/scratch/HEL-1711/local/` contains only `.last-run.json` (`"status":"passed"`).
- The commit message states the cause but no evidence.

Task 1.2's confirmation that the cascade removed the Filter step is also not written anywhere. The ticked task items
therefore do not match what was delivered, and the AC's "not assumed" would rest on transient chat claims once the scratch
dir is swept.

Other checklist items:
- Ticket ACs, second bullet (make the wait deterministic, no wider timeout): PASS. The new wait is a web-first `toBeVisible`
  on the scoped region. No `waitForTimeout` was added and no timeout was changed.
- No AC was reinterpreted.
- Scope: PASS. Only the two specs listed in the proposal were touched, plus the change artifacts.
- Regressions: none. Full `hel1685` + `hel1631` specs: 15/15 passed in my run.
- API contracts: N/A.
- CONSTRAINTS: `[]`, so nothing to check.

### Phase 2: Code Review — PASS

Gates, all run fresh in WORKTREE_PATH by me. The changed files are under `e2e/**` and `openspec/**`; no `frontend/**` or
`backend/**` file changed, so the build, jest and sbt gates do not apply.
- `npm run lint`: exit 0, zero warnings.
- `npm run format:check`: all files pass.
- `npx eslint --max-warnings 0` on both specs: OK. `prettier --check` on both specs and the change-dir markdown: OK.
- Playwright `e2e/hel1685-draft-polish.spec.ts e2e/hel1631-draft-mode.spec.ts --workers=2`: 15 passed.

Code:
- `e2e/hel1685-draft-polish.spec.ts:273-276`: `getByRole("region", { name: /^Step 3 Compute/ })` matches
  `StepCardFocused.tsx:53-55` (`<section aria-label={`Step ${n} ${label}`}>`, which is exposed as role `region`; the live
  ARIA snapshot shows `region "Step 1 Sort rows"`). The scoped `Remove step` click is then guaranteed to hit Step 3's own
  button. Correct.
- `e2e/hel1685-draft-polish.spec.ts:281`: the dialog assertion carries a message. Mutation M1 showed it fails with a clear
  diagnosis.
- `e2e/hel1631-draft-mode.spec.ts:253-255`: same pattern. `/^Step 3 /` does not collide with the sibling region "Step editor
  and preview" (the regex needs a digit).
- Comments are short and carry the ticket reference. No dead code, no duplication worth extracting (two 3-line sites), no
  type escape hatches.

### Phase 3: UI Review — N/A

No trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The e2e run above exercised
the live UI anyway.

### Overall: FAIL

### Change Requests
1. Add an evidence record to the change dir, e.g. `openspec/changes/fix-remove-step-e2e-race/evidence.md`. Tasks 1.1, 1.2
   and 2.3 require it, and Decision 1 requires the explicit no-local-red statement. It must state:
   - the exact commands and N for the unmodified-spec runs, with pass counts (20/20 plain, 30/30 under CPU load, and how the
     load was generated), and an explicit "no natural local red was obtained";
   - the CI trace as the red: run 43949524653, job 133587986311, plus the self-authenticating facts. The 422 body's
     `stepIds:[a01caaef (filter)]` / `outputIds:[70ce139d (Run duration)]`, the save body without the filter step, and the
     200 preview of `b581d5f4` (Avg minutes) after the save;
   - the forced-race mutation (the code used), its red output (the dialog text naming "Filter rows"/"Run duration"), and the
     fixed spec's green count.

   If you prefer this to live in the PR body instead, put it there and remove the claim from the ticked tasks. Either way, the
   ticked tasks must point at a real record. No code change is needed.

### Non-blocking Suggestions
- In the same record, also cite the forced race with the *original* assertions (my M2). It reproduces the exact CI failure
  message locally, which is stronger evidence for the AC than the dialog-assertion variant alone.
