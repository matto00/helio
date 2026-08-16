## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 gap (analyzeProposal / projectSchema) — confirmed genuinely resolved**

- `PipelineService.analyzeProposal` re-read at
  `backend/src/main/scala/com/helio/services/PipelineService.scala:249-273` — still builds
  `stepInputs` from `proposal.steps.zipWithIndex` with no `enabled` filter today (pre-execution;
  correct, since no code has shipped yet), exactly the round-1 citation.
- `BoundPanelService.projectSchema` re-read at
  `backend/src/main/scala/com/helio/services/BoundPanelService.scala:129-134` — same shape,
  `stepInputs` built unfiltered, `.lastOption.map(_.outputSchema).getOrElse(sourceSchema)` as the
  fallback (confirms the "all-disabled = passthrough" claim in design.md's Risks composes
  correctly here too: an empty filtered `stepInputs` → `analyze` returns `Vector.empty` →
  `lastOption` is `None` → falls back to raw `sourceSchema`, i.e. exactly the zero-step-pipeline
  behavior the design claims).
- Verbatim type reuse confirmed: `PipelineProposal.steps: Vector[CreatePipelineStepRequest]`
  (`PipelineProposalProtocol.scala:33-37`, doc comment: "reuses `CreatePipelineStepRequest`
  verbatim") and `BoundPipelineSpec.steps: Vector[CreatePipelineStepRequest]`
  (`BoundPanelProtocol.scala:32-36`) — both real, both will carry the new `enabled` field once
  Decision 2 lands, confirming Decision 3(iv)/(v)'s premise.
- `design.md` Decision 3 now enumerates all five boundaries by name and (approximate) line number,
  cites the `pipeline-proposal-analyze-api` no-divergence principle, and explicitly states the gap
  "is not compiler-enforced" — this is the exact framing round 1 asked for, not a restatement of
  the ticket text.
- `tasks.md` 1.4 names all five sites in one task; `tasks.md` 2.3 appends two concrete tests
  ("analyzeProposal excludes a proposal step with enabled:false"; "projectSchema excludes a
  BoundPipelineSpec step with enabled:false").
- `specs/pipeline-step-lifecycle/spec.md`'s Requirement gains an explicit bullet ("Every other
  analyze entry point... SHALL apply the same exclusion: proposal analysis... and bound-panel
  schema projection... absent `enabled` = true") and a new Scenario ("Proposal analysis excludes a
  disabled proposed step").
- Traced downstream consumers of both new sites for index/order assumptions that filtering could
  break: `analyzeProposal`'s only route caller is `PipelineRoutes.scala:47`
  (`ServiceResponse.run(pipelineService.analyzeProposal(...))` — a thin pass-through), and
  `helio-mcp`'s `analyzePipelineProposalHandler` (`pipelineProposalHandlers.ts:59-64`) is
  documented as a "thin pass-through" with no index-alignment logic. `projectSchema`'s only caller
  (`BoundPanelService.scala:~105`) only reads the final projected schema for
  `PanelBindingSpec.evaluate`, never per-step. No hidden regression from filtering either list.
  `PipelineAnalyzeService.analyze` itself (`PipelineAnalyzeService.scala:41-57`) threads schema
  purely by vector order via a `var currentSchema`, never by the `position` field, so filtering
  before `analyze` (regardless of exactly where in the two new call sites the filter is inserted
  relative to `zipWithIndex`) cannot desync input/output schema propagation.
- Cross-checked the design's supporting rationale text ("no sanctioned caller can currently set
  `enabled: false` on a proposal step") is still accurate:
  `helio-mcp/src/tools/write.ts`'s `boundPipelineStepSchema` (lines 39-42) still only exposes
  `{type, config}`, no `enabled`. This is now stated as color/rationale, not as the basis for a
  scope exclusion — decision (a), full filtering, was chosen, so this claim is no longer
  load-bearing for correctness, only for context.

### Regression spot-checks (round 1's other confirmed items)

- Migration numbering: `git ls-tree -r --name-only origin/main -- backend/.../db/migration | sort
  -V | tail` still shows `V84__pipeline_run_assertions.sql` as HEAD's latest — `V85` is still
  correct at planning time; unchanged from round 1.
- `schemas/` still contains only `create-pipeline-step-request.schema.json` and
  `reorder-pipeline-steps-request.schema.json` — no stray `update-pipeline-step-request` schema
  appeared; Decision 9's "no new schema file" claim still holds.
- Duplicate-endpoint precedents re-confirmed verbatim: `path(DashboardIdSegment / "duplicate")`
  (`DashboardRoutes.scala:57`), `path(PanelIdSegment / "duplicate")` (`PanelRoutes.scala:93`).
- `PipelineStepRepository.insertAtInternal` re-confirmed at
  `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala:198` (round 1
  cited the file under a different, incorrect subpackage path — `infrastructure/`, not
  `repositories/` — but the line/signature itself is exactly as claimed).
  `PipelineStepConfigCodec.decode` reused by `addStep` re-confirmed at
  `PipelineService.scala:443`.
- `PipelineRunService.previewStep`/`runPipeline`/`executeRun` re-confirmed present at their cited
  line ranges (147, 113, 299) with the same `listByPipelineInternal` → filter → slice shape.
- File budgets re-confirmed exactly via fresh `wc -l`: `StepCard.tsx` 529,
  `PipelineDetailPage.tsx` 653, `PipelineRiverView.tsx` 289 — no drift since round 1, consistent
  with both design.md's Context and ticket.md's stated budgets.
- Frontend/wire-threading decisions (2, 6, 7, 8, 9) and the new-capability spec-modeling choice
  (Planner Notes) are textually unchanged from round 1's verified version — the diff between
  rounds is scoped to Decision 3, tasks.md 1.4/2.3, and the one spec requirement/scenario, exactly
  as the revision was intended to be.
- All five ticket acceptance criteria still trace to a decision + task: duplicate-via-UI (Decision
  4/6/7, tasks 2.1-2.2/3.3-3.4), disable/enable persisted + excluded from runs+analyze/preview +
  clean re-enable (Decisions 2/3/6/7, tasks 1.2-1.4/3.3-3.4), migration safety (Decision 1, task
  1.1), test coverage (tasks 2.3/4.1), backward-compat/additive wire (Decision 2, tasks 1.3/3.1).

### Verdict: CONFIRM

### Non-blocking notes

- The new spec Requirement's bullet states the exclusion applies symmetrically to *both* proposal
  analysis and bound-panel schema projection, and `tasks.md` 2.3 has a test for both, but only one
  new Scenario was added (proposal analysis). Consider adding a sibling scenario ("Bound-panel
  schema projection excludes a disabled step") for symmetry/completeness — this is not blocking:
  the Requirement's normative "SHALL" text is unambiguous on its own, and the task-level test
  already covers the `projectSchema` case, so there's no ambiguity for an implementer to trip on.
- Round 1's non-blocking note about the three sibling specs' (`pipeline-analyze-api`,
  `pipeline-run-execution`, `pipeline-step-preview`) "every step" prose going mildly stale once
  disabled steps are excluded is unaddressed in this revision — still non-blocking (the mechanics
  those specs assert remain literally true over the filtered list), carried forward as a note for
  whoever eventually revisits those specs.
