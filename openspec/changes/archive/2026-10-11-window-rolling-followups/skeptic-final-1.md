## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `d3c56d8e7bcb0ee8d986af04839c52e502cfd3be`. Diff base resolved live via `resolve-review-base.sh` (main/origin): `e56d94b107acfc72ac100803c9b26fa471ac3ad9`. `git diff base...HEAD` covers 15 files (+661/-14). None of HEL-1459's merged files are in it.

Scope: items 2, 3 and 4. Item 1 (centred frames) is out of scope by driver decision and was not assessed.

### What I verified (with evidence)
- **Spawn guard:** `assert-cwd.sh` printed READY, branch `task/window-rolling-followups/HEL-1489`.
- **Commit hygiene:** `git log base..HEAD` contains no `claude.ai` link and no `Claude-Session` trailer.
- **AC2a, AC2c (patch-set apply):** `PatchSetWindowRollingRejectionRoutesSpec` goes through the real `PatchSetRoutes`.
  - It covers all three edit kinds: pipelineStep create, pipelineStep update and pipeline create.
  - Each kind is tested with 7 invalid cases from `testkit/WindowRollingRejectionCases.scala`: frameSize 7.5, 5e9, 0 and 1001; frameUnit `weeks`; `days` with a two-key orderBy; `days` with a desc orderBy.
  - Each case asserts 422, the edit prefix plus the exact frame message, and an unchanged stored state: no step, the step unchanged, or no pipeline.
  - A positive control runs on each kind.
- **AC2b, AC2c (apply-proposal):** `PipelineApplyProposalWindowRollingSpec` covers the same 7 cases. It asserts 422, the `step 1: ` prefix plus the message, and unchanged pipeline and step counts. The control is a valid config that returns 201 with +1/+1.
- **AC2d: my own mutations, chosen differently from the executor's and evaluator's.**
  - **Mutation A** inserts `false &&` into the days-orderBy rule at `WindowStep.scala:151`. Exactly the 8 days cases went red (2 per surface across 4 surfaces), and the other 24 passed. Summary line: `[hel1468-guard] ScalaTest summary: failed=8`. Evidence: `.concertino/runs/HEL-1489/evidence/skeptic-final-mutA-days.txt`.
  - **Mutation B** replaces `PipelineProposalService.scala:298` (the proposal's `rawConfigProblem`) with `(None: Option[String]) match`. All 7 proposal rejection cases went red (`failed=7`). Evidence: `skeptic-final-mutB-proposal.txt`.
    - The failure was the prefix assertion: `"Step 'w1': ..." did not start with substring "step 1: "`. The `PipelineCreatePreflight` backstop still returns 422 downstream, so the prefix pin is what ties the test to the proposal-layer check. That is good test design, not a weakness.
  - I reverted both mutations; `git status` shows only the untracked evaluation reports.
  - **Green at HEAD:** both new specs plus the `com.helio.domain.steps.*Window*` suites ran 4 suites, 58 tests, 0 failed, with the `[hel1468-guard]` line present (`skeptic-final-green.txt`).
- **AC3a:** `WindowConfig.tsx` has no hard-coded DOM ids left. The offset, frame-size and output-column inputs and their labels' `htmlFor` all derive from `useId()` (lines 101-105, 255-302). Grep found no remaining reference to the old ids anywhere in `frontend/src`.
- **AC3b:** I checked out the pre-fix `WindowConfig.tsx` (from base) and ran `WindowConfig.ids.test.tsx`. It went RED: `Expected: 8 Received: 3` on the uniqueness assertion. After restoring HEAD, the 3 WindowConfig suites pass (29 tests).
- **AC3c:** I did not start the app. The change only alters `id`/`htmlFor` attribute values, so there is no visual delta to judge.
  - I read the evaluator's running-app a11y snapshots: `eval1-a11y-two-rolling-cards.yml` and `eval1-a11y-two-lag-cards.yml`. In each, both cards expose their own named `spinbutton "Frame size"` / `"Offset"` and `textbox "Output column"`.
  - Duplicate ids would leave the second card's inputs unnamed, so these snapshots do discriminate.
  - My jsdom red-to-green run above independently confirms the label-to-input mapping.
- **AC4:** the diff in `WindowStep.scala:218-223` is whitespace only; the arrows are now aligned. No behaviour change.
- **UI / design:** no styling, token or layout change, so the DESIGN.md judgment is not engaged.

### Verdict: CONFIRM

### Non-blocking notes
- The pipelineStep-update positive control only asserts 200 with no `failure`. It does not check that `frameSize` actually changed to 5.
- The evaluator's dev-DB fixtures are listed in `eval1-devdb-fixture-ids.txt`. The orchestrator should make sure they were deleted by exact id.
