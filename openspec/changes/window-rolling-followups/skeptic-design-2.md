## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `6ac99447d07fd5bf5ee065b1141c1a31d0ea08a8`. The planning artifacts are uncommitted (`?? openspec/changes/window-rolling-followups/`). Scope is items 2, 3 and 4. Item 1 is out of scope by driver decision.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/window-rolling-followups/HEL-1489`.
- **Round-1 change requests:**
  - **CR1 (apply-proposal discrimination): addressed.** Decision 2 pins `startWith("step 1: ")`. Decision 3 names the second gate.
    - I traced it again: `PipelineProposalService.apply` → `createPipeline` (l.454) → `pipelineService.create` → `PipelineCreateWrites.checkedCreate`.
    - In `checkedCreate`, `transactional = req.steps.nonEmpty || ...` (l.73), then `PipelineCreatePreflight.run` → `checkStep` → `:155`, which returns `Step '<clientId>': $problem`.
    - `createPipeline`'s `Left` branch passes `err` through unchanged.
    - So with l.298 → `None`, the response is still 422 with the frame text, but the prefix changes. The `startWith("step 1: ")` assertion goes red, as the design says.
  - **CR2 (WindowStep double gating): addressed.** I checked each rule mutation against the code:
    - `rawFrameSizeProblem` → `None`. `StepCodecUtil.intOpt` (l.103-108) uses `Try(n.toIntExact).toOption`, so `7.5` and `5000000000` decode to `None`. `rollingFrameProblems` then sees no frameSize and `strictDecodeProblem` does not throw, so the step is stored as a draft. Both cases go red on every route. Correct.
    - The l.149 frameUnit branch disabled → `weeks` passes the later days check and is stored. Red. Correct.
    - The l.151-153 days/orderBy branch disabled → both days cases are stored. Red. Correct.
    - `0` and `1001` are rejected by both `rawFrameSizeProblem` and l.147. The design now says this and assigns those cases to the call-site mutations only. Correct.
  - **CR3 (exact message text): addressed.** All three asserted substrings match `frameSizeMessage` (l.123-124), l.150 and l.153. The draft message at l.160 (`requires 'frameSize'` with nothing after it) cannot satisfy `requires 'frameSize' to be an integer in 1..1000, got <v>`.
- **Call-site mutations go red on every case, including 0 and 1001:**
  - **Patch-set step update, l.50 → `None`:**
    - The forward apply re-checks at `PipelineStepWrites.scala:71`.
    - That `Left` reaches `PatchSetApplyService.applyResolved`, which rolls back and returns `Right(... failure = Some(msg))`, i.e. HTTP 200. So the 422 assertion goes red.
  - **Patch-set step create, l.223 → `None`:** the forward apply re-checks at `PipelineStepCreate.scala:36`. Same outcome: 200 with a failure, so red.
  - **Patch-set pipeline create, `PipelineCreatePreflight.scala:155` → `None`:**
    - This removes both the resolve-time gate (`PatchSetPipelineResolvers.scala:138`) and the forward-apply gate, because both go through the same preflight line.
    - Every case (`0` decodes to `Some(0)`) is then stored and returns 200. Red.
    - The `edit N: ` prefix comes from `prefixedWithEdit` (l.89-93), so `startWith("edit N: ")` holds in the green state.
- **Full call-site list:** `grep rawConfigProblem` in `src/main` finds exactly six callers: `PipelineStepWrites:71`, `PipelineCreatePreflight:155`, `PipelineProposalService:298`, `PipelineStepCreate:36`, and `PatchSetPipelineStepResolvers:50/223`. The design's Context covers the four that are reachable from the two routes, and I traced the other two as the patch-set forward-apply re-gates. No call site is missing.
- **Item 3:**
  - `WindowConfig.tsx` hard-codes the ids at l.251/255, 270/275 and 297/301. `useId` is already imported (l.11).
  - A repo-wide grep over ts/tsx/css/js finds no consumer of the three literal ids outside `WindowConfig.tsx`.
  - The offset input shows only for lag/lead (l.61-62, l.161), and the frame-size input only for rolling functions. That is why Decision 5 renders both variants, which is correct.
- **Harnesses:** both `PatchSetStepCreateConfigRoutesSpec` (l.62) and `PipelineApplyProposalSpecBase` (l.123) use `VerifiedEmbeddedPostgres.start`. The existing patch-set spec already asserts that a positive case has `should not include "\"failure\""`. That is the right pattern for the new positive controls.
- **Item 4:** the `cfg.function match` at `WindowStep.scala:218-223` has the `running_sum` arrow out of column. A hand alignment checked with an empty `git diff -w` is sound, and the repo has no `.scalafmt.conf`.
- **Placeholders and scope:** none found. Each of AC2a–d, AC3a–c and AC4 maps to a task. The non-goals (`/api/proposals/apply`, preview, centred frames) are stated and consistent with the ticket.

### Verdict: CONFIRM

Category: design-judgment (emitted category for this CONFIRM; no divergence found).

### Non-blocking notes

- **Spec delta wording.** In `specs/pipeline-window-op/spec.md`, the scenario's GIVEN says each editor shows "its offset, frame-size and output-column inputs". No single editor can show both offset and frame-size: offset is lag/lead only and frame-size is rolling only (`WindowConfig.tsx:61-62, 161`). Consider rewording to "each showing the inputs its function uses", or to two editor pairs (lag + rolling). Decision 5 already handles this in the test.
- **Positive controls on `/patch-sets/apply`.** These return 200 even when an edit fails at forward apply. Each positive control must assert that `failure` is absent (as `PatchSetStepCreateConfigRoutesSpec` l.163 does), not just the status code. Otherwise the control does not prove acceptance.
- **Apply-proposal runs under mutation.** A rule mutation makes an invalid proposal create a pipeline and submit a real run, which is subject to the HEL-505 concurrency cap (3) and rate limit (10/window). That can surface as a 429 instead of 201. It is still red against the 422 assertion, but the transcript may show 429s, and these are not a separate finding. Using a unique pipeline name per case keeps the "no pipeline created" assertion unambiguous.
- **"One-line" rule mutations.** The l.151-153 condition spans three lines. A one-line mutation such as appending `&& false` to l.151 satisfies "one-line". Record the exact diff in the evidence.
