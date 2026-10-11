## Context

HEL-1316 added `rolling_avg/sum/min/max/count` window functions with `frameSize` (1..1000 integer) and `frameUnit` (`rows|days`). Write-time rejection is centralised in `PipelineStep.rawConfigProblem(kind, raw)` (`backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:289`), which for `window` delegates to `WindowStep`'s raw validation (including the rolling-frame rules). The call sites relevant here:

- patch-set `pipelineStep` update edit: `services/patchsets/PatchSetPipelineStepResolvers.scala:50`
- patch-set `pipelineStep` create edit: `services/patchsets/PatchSetPipelineStepResolvers.scala:223`
- patch-set `pipeline` create edit: `services/patchsets/PatchSetPipelineResolvers.scala:138` -> `services/pipelines/PipelineCreatePreflight.scala:155`
- `POST /api/pipelines/apply-proposal`: `services/pipelines/PipelineProposalService.scala:298`, and again (second gate, before any write) at `PipelineCreatePreflight.scala:155` via `pipelineService.create`

HEL-1316's step-create route test (`WindowRollingSeamSpec`) pins the REST step route only. HEL-1417's `PatchSetStepCreateConfigRoutesSpec` pins generic (unknown-function) rejection on patch-set create, not rolling frames.

`frontend/src/features/pipelines/ui/stepConfigs/WindowConfig.tsx` hard-codes three ids: `window-offset-input`, `window-frame-size-input`, `window-output-column` (the ticket names two; the offset input collides the same way). It already imports `useId` for its error id. HEL-1465 fixed the same defect in `LookupConfig.tsx` with `useId()`.

The repo has no `.scalafmt.conf`, so scalafmt is not a configured tool here; item 4 is a hand alignment.

## Goals / Non-Goals

**Goals:** pin rolling-frame rejection at the route level on the four call sites above with mutation-proven tests; make window editor ids unique per instance; align the `case` arrows.

**Non-Goals:** `POST /api/proposals/apply` (CombinedProposalRoutes; not named by the ticket); centred rolling frames (ticket item 1 — owner product call, stays open); any validation behaviour change; patch-set preview (a non-write route; already shares the same resolvers) beyond what is free; touching HEL-1459's patch-set production code; adding scalafmt config.

## Decisions

1. **New, dedicated spec files rather than extending existing ones.** Add `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetWindowRollingRejectionRoutesSpec.scala` (harness modelled on `PatchSetStepCreateConfigRoutesSpec`, real `POST /patch-sets/apply`) and `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalWindowRollingSpec.scala` (on `PipelineApplyProposalSpecBase` if it fits, else its own harness). Rationale: concurrent lane HEL-1459 is editing patch-set code and its specs; new files cannot conflict textually. Both use `VerifiedEmbeddedPostgres.start(...)`; no inline FQNs (imports only).
2. **Invalid-config matrix (each route):** `frameSize: 7.5`; `frameSize: 5000000000`; `frameSize: 0`; `frameSize: 1001`; `frameUnit: "weeks"`; `frameUnit: "days"` with a two-key `orderBy`; `frameUnit: "days"` with one descending key. Assert 422 and the EXACT frame message text (so neither the draft message `requires 'frameSize'` at `WindowStep.scala:160` nor a decode/generic error can satisfy it):
   - frame size: `requires 'frameSize' to be an integer in 1..1000, got <v>`;
   - unit: `has unsupported frameUnit: 'weeks'`;
   - days/orderBy: `with frameUnit 'days' requires exactly one ascending 'orderBy' key`.
   Each assertion also pins the route's own prefix with an exact `startWith`: patch-set edits `edit N: `; apply-proposal `step 1: ` (from `PipelineProposalService.scala:299`). The persisted state is asserted unchanged (step count / step config / no pipeline with the test's unique name). A positive control per route accepts a valid rolling config (200/201) so the 422s are attributable to the frame rule; on `/patch-sets/apply` the control must also assert the response has no `failure` (a failed edit still returns 200).
3. **Mutation proof — exact one-line mutations, applied and reverted ONE AT A TIME.**
   - **Call-site mutations (prove the route wiring; turn every case of that route red):**
     - patch-set step update: `PatchSetPipelineStepResolvers.scala:50` `rawConfigProblem(...)` -> `None`. The edit then fails later during apply and comes back 200 with a failure message, so the 422/`edit N: ` assertions go red.
     - patch-set step create: `PatchSetPipelineStepResolvers.scala:223` likewise.
     - patch-set pipeline create: `PipelineCreatePreflight.scala:155` likewise (reached from `PatchSetPipelineResolvers.scala:138`).
     - apply-proposal: `PipelineProposalService.scala:298` -> `None`. **Known second gate:** `PipelineProposalService.apply -> createPipeline -> pipelineService.create -> PipelineCreateWrites.checkedCreate -> PipelineCreatePreflight.run -> checkStep` re-runs `rawConfigProblem` at `PipelineCreatePreflight.scala:155` before any write, so under this mutation the route still returns 422 with the frame text and stores nothing; ONLY the prefix changes from `step 1: ` to `Step '<clientId>': `. The exact `startWith("step 1: ")` assertion is what turns red here — this is expected, not a finding.
   - **Rule mutations in `WindowStep.scala` (prove the tests discriminate the rolling rule), each applied once and run across ALL new specs:**
     - `rawFrameSizeProblem` (l.168-176) made to return `None` -> the `7.5` and `5000000000` cases go red on every route (they decode to `None` via `intOpt` and would be stored as drafts).
     - l.149 frameUnit check disabled -> the `weeks` cases go red.
     - l.151-153 days/orderBy check disabled (single edit, e.g. append `&& false` to l.151; record the exact diff) -> the two days/orderBy cases go red.
     - Under a rule mutation an invalid apply-proposal case may create a pipeline and submit a run that hits the run rate/concurrency limit (429); the test is still red, so a 429 in the transcript is expected, not a finding.
     - `0` and `1001` are double-rejected (by `rawFrameSizeProblem` and l.147), so no single-line rule mutation reaches them; they are proven only by the call-site mutations. State this in the evidence.
   If any listed mutation does NOT turn its listed cases red, that is a finding to report, not an assertion to weaken. Red/green transcripts go in `/home/matt/Development/helio/.concertino/runs/HEL-1489/evidence/` (never `/tmp`), and the tree must be restored (`git -C <worktree> diff -- backend/src/main` empty apart from the item-4 whitespace) before commit.
4. **Ids via `useId()`.** One `const baseId = useId()` (or one per input), ids derived as `${baseId}-offset` etc., `htmlFor` updated to match. No test or CSS selects these ids by literal value (executor must grep `window-offset-input|window-frame-size-input|window-output-column` across `frontend/` and e2e and update any consumer).
5. **Two-editor test, red first.** Extend `WindowConfig.test.tsx` (or a sibling `WindowConfig.ids.test.tsx`) rendering two `WindowConfig` instances with a rolling function (so frame-size shows) and a lag/lead variant where needed so offset shows, collecting all input ids: assert uniqueness, and, using `within(container)` per editor, that each label's `htmlFor` resolves to an input inside the SAME editor (one distinct input per editor for each accessible name). Run it on the unfixed component first and record the red. Accessible names are additionally checked in the running app (evaluator, Playwright) with two window cards open.
6. **Item 4:** whitespace-only alignment of the non-rolling `cfg.function match` arrows (~l.218-223) to the column of the widest pattern; `git diff -w` on `WindowStep.scala` must be empty.

## Risks / Trade-offs

- HEL-1459 may change patch-set resolver line numbers/shape before this merges -> new tests only use the public route; re-sync origin/main before the PR and re-run the new specs.
- Parked HEL-1314/HEL-1483 branches have their own WindowStep.scala edits -> keep item 4 to the one match block.
- `testOnly` scope: run the new specs plus existing window specs; the `[hel1468-guard]` summary line must appear in sbt output.
