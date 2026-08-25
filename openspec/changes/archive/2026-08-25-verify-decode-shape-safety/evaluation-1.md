## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL
- Worked examples + decoder-verified tests for join/pivot/window/unpivot were added unconditionally per
  design.md D1/tasks 3.1 — matches plan. Join example correctly targets `joinKey`/`joinType` (not
  `rightDataSourceId`, per the corrected premise in design.md/ticket.md) — PASS.
- `specs/conversational-refinement/spec.md` ADDED requirement matches the shipped behavior (worked example +
  decoder-verified test per kind) — PASS.
- FilterStep/SortStep and decoder-hardening (scope item 4) were correctly NOT touched — confirmed via
  `git diff main...HEAD --name-only` (only `RefinementEditShape.scala`, `RefinementEditShapeSpec.scala`, and
  openspec artifacts changed) — PASS, no scope creep.
- **Issue — task 2.5 / design.md D1 not satisfiable from any artifact.** design.md D1 and tasks.md 2.5
  explicitly require: "Record, per trial: the exact prompt used, the resulting PatchSet edit's
  `patch.config`, and whether the existing... prompt rule prevented the wrong shape" and D1's Risks section
  says "record the exact prompt used in the evaluator/skeptic evidence trail." No such artifact exists
  anywhere: not in `openspec/changes/verify-decode-shape-safety/`, not in
  `.concertino/runs/HEL-671/evidence/`, not in `files-modified.md` (which only summarizes files touched, not
  trial transcripts), and `.concertino-backend.log` shows no `/api/refinements` traffic from a trial run
  (the log's only backend-start timestamp, 19:32:26, is well after the executor's commit at 19:41:09 — i.e.
  this log is from my own gate re-run, not the executor's trial session; the executor's own trial-session
  backend log was not preserved). The commit message asserts specific trial counts ("join/pivot/unpivot:
  2-3 adversarial trials each; window: 4 trials") but there is no way to verify any of it — no prompt text,
  no returned `patch.config`, no pass/fail-per-trial record. Per the task's own instruction #3 ("verify the
  executor's live-trial evidence is real... not fabricated or asserted without artifacts") this is
  unverifiable as delivered. This is the central acceptance-criteria item ("LIVE-verify... whether the
  existing general prompt rule genuinely prevents a wrong-shape edit") and the plan is explicit that this
  record belongs in the evidence trail, not just narrated in a commit message.
- Task list (`tasks.md`) marks 2.5 ("Record, per trial...") as `[x]` complete, but no artifact backing that
  record exists — the task item is marked done without the deliverable it describes.

### Phase 2: Code Review — PASS
- Fresh gate re-run (in `WORKTREE_PATH`, `CLEAN_WORKTREE` not set at `default` speed):
  - `cd backend && sbt test` → 3350/3350 passing, 0 failures (independently re-run, not trusted from
    executor's report).
  - `npm run check:scala-quality` → clean (130 pre-existing soft file-size warnings, none touching the
    diff's files).
- No inline FQNs introduced — new decoders (`JoinConfig`, `PivotConfig`, `UnpivotConfig`, `WindowConfig`)
  are added to the existing top-of-file import in `RefinementEditShapeSpec.scala:7`, not inlined.
- `RefinementEditShapeSpec.scala`'s 4 new tests decode through the REAL decoders
  (`JoinConfig.decode`/`PivotConfig.decode`/`UnpivotConfig.decode`/`WindowConfig.decode`) and assert actual
  field values — e.g. `decoded.joinKey shouldBe "customerId"`, `decoded.orderBy.map(_.field) should contain
  ("revenue")` — not a bare decodes-without-throwing check. This is exactly the assertion shape design.md D2
  requires and the one that would catch the defect class. Confirmed by direct diff read and by running the
  new suite (`testOnly ...RefinementEditShapeSpec`) — 15/15 passing.
- DRY / readable / modular: examples mirror the existing `AggregateStepExample`/`GroupByStepExample`
  pattern exactly; no duplication introduced.
- No dead code, no TODO/FIXME left behind.
- `files-modified.md` accurately lists the two touched Scala files.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` files changed — backend-only
prompt-grounding + test change.

### Additional checks performed
- Shared dev Postgres: queried `pipelines`/`data_sources` for any name matching `671`/`join`/`pivot`/
  `unpivot`/`window` — zero rows. No leftover throwaway resources from this ticket's live trials remain in
  the shared dev DB (item 5 in the task brief) — consistent with cleanup having happened, though this alone
  doesn't prove the trials happened as described (see Phase 1 issue above).

### Overall: FAIL

### Change Requests
1. Produce and commit (or persist as run evidence) an actual live-trial record satisfying design.md D1 /
   tasks.md 2.5: for each of join/pivot/unpivot (2-3 trials) and window (4 trials), the exact prompt text
   sent to `POST /api/refinements`, the exact returned `PatchSet` edit's `patch.config`, and an explicit
   pass/fail verdict against the real decoder's expected shape. Without this, AC item 2 ("LIVE-verify...
   whether the existing general prompt rule genuinely prevents a wrong-shape edit") is asserted, not
   demonstrated — the ticket's central technical claim ("no live-reproduced gap") currently rests solely on
   an unverifiable commit-message narrative.
2. Either re-run the trials with a captured transcript (backend request/response logging, or a saved
   evidence file per D1's own instruction), or downgrade the commit-message/handoff language so it does not
   claim a specific trial count that cannot be substantiated.

### Non-blocking Suggestions
- Consider having the live-trial harness write its evidence file directly under
  `.concertino/runs/<TICKET>/evidence/` (mirroring how `premise-validation.md` was already produced in
  Setup) so a future cycle's re-run of this same design's D1 leaves a durable, gate-checkable artifact by
  construction rather than relying on the executor to remember to write one.
