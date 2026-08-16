## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Migration number / origin-main state**
- `git ls-tree -r --name-only origin/main -- backend/src/main/resources/db/migration | sort -V | tail`
  confirms origin/main HEAD's latest migration is `V84__pipeline_run_assertions.sql` — the design's
  claim that this change takes `V85` is correct at planning time (the cross-lane re-confirmation
  gate for execution time is appropriately deferred, not resolved here, since HEL-462 could land in
  the interim).
- `ALTER TABLE <t> ADD COLUMN <col> BOOLEAN|TEXT NOT NULL DEFAULT <lit>;` on an already-populated
  table is an established, already-shipped pattern in this codebase — e.g.
  `backend/src/main/resources/db/migration/V63__pipeline_run_trigger_source.sql:6`
  (`ALTER TABLE pipeline_runs ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'manual';`) and
  `V12__add_computed_fields_to_data_types.sql:3`. Corroborates the additive/instant-default safety
  claim.

**Skip semantics — call sites**
- `PipelineAnalyzeService.analyze(steps: Vector[PipelineStepInput], sourceSchema)` is at
  `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala:41`, exactly as cited.
- `PipelineRunService.previewStep` (`.../PipelineRunService.scala:147-195`) builds `sortedSteps`,
  finds the target's index `k`, and slices `sortedSteps.take(k+1)` as the executed prefix — the
  filter-prefix-and-422-on-disabled-target plan is mechanically straightforward against this shape.
- `PipelineRunService.runPipeline`/`executeRun` (lines 113-142, 299-337): both full run and dry run
  share one `listByPipelineInternal` call before `executeRun`, so Decision 3's single
  `steps.filter(_.enabled)` genuinely covers both modes in one place, as claimed.
- `PipelineService.analyze` (lines 186-227) is the one persisted-pipeline analyze call site the
  design names, and it is correctly targeted.
- **Gap found** (see Change Request 1): `PipelineAnalyzeService.analyze` has two more production
  call sites the design does not enumerate or filter — `PipelineService.analyzeProposal`
  (`PipelineService.scala:249-273`) and `BoundPanelService.projectSchema`
  (`BoundPanelService.scala:129-134`) — both of which feed it steps built from
  `CreatePipelineStepRequest`, the exact type Decision 2 adds `enabled` to.

**Duplicate endpoint**
- `DashboardRoutes.scala:57` (`path(DashboardIdSegment / "duplicate")`) and `PanelRoutes.scala:93`
  (`path(PanelIdSegment / "duplicate")`) confirmed verbatim, both `post`, no request body, both
  call a `service.duplicate(id, user)` that returns `201`. `PipelineStepRoutes.scala` (current,
  45 lines) already has `pathPrefix("pipeline-steps" / PipelineStepIdSegment) { stepId => ... }` —
  adding a sibling `path("duplicate") { post { ... } }` inside that prefix is mechanically
  equivalent even though the current step routes use a `pathPrefix`+`pathEndOrSingleSlash` shape
  rather than dashboard/panel's flat `path(id / "duplicate")` — not a real discrepancy.
- `PipelineService.updateStep` (lines 556-658) confirmed: `findByIdInternal` → NotFound-masking on
  both the step-missing and pipeline-invisible branches → owner-or-`requireEditorAccess` check —
  exactly the "verbatim" ACL pattern Decision 4 cites.
- `PipelineStepRepository.insertAtInternal(pipelineId, kind, config, index)` confirmed at
  `PipelineStepRepository.scala:198-213`; adding a 5th `enabled` parameter (needed so a disabled
  original clones as disabled, not the type's `= true` default) is a mechanical, in-scope signature
  change under task 1.2's "insertInternal/insertAtInternal accept enabled."
- `PipelineStepConfigCodec.decode(req.type, req.config.compactPrint)` confirmed as `addStep`'s
  decode helper (`PipelineService.scala:443`) — Decision 5's "same helper addStep uses" is accurate.

**Wire threading**
- `PipelineStepProtocol.scala:17-24` (`sealed trait PipelineStepResponse`) and its 23 case-class
  subtypes (`RenameStepResponse` … `AssertStepResponse`, lines 26-139, all `jsonFormat6`) — counted
  exactly 23, matching "~23" and confirming each is a mechanical `jsonFormat6→jsonFormat7` bump.
- `CreatePipelineStepRequest(type, config, position: Option[Int] = None)` (line 146, `jsonFormat3`)
  and `UpdatePipelineStepRequest(type: Option[String], config: Option[JsObject], position: Option[Int])`
  (line 150, `jsonFormat3`) confirmed as designed.
- No `update-pipeline-step-request.schema.json` exists (`find schemas -iname '*pipeline-step*'` →
  only `create-pipeline-step-request.schema.json` and `reorder-pipeline-steps-request.schema.json`);
  `scripts/check-schema-drift.mjs` only diffs schema files that exist against matching case classes
  — Decision 9's "no new schema file required for the PATCH request" is verified correct, and
  `npm run check:schemas` script exists (`package.json:12`).
- Frontend: `updatePipelineStep(stepId, config)` (`pipelineService.ts:79-87`) has the exact
  config-only signature the design says to leave untouched, with `updatePipelineStepEnabled` added
  as a sibling — confirmed against `useStepCardState.ts`'s `persist()` (line 180) which calls
  `updatePipelineStep(step.id, newConfig)` directly; a signature change there would ripple through
  all eight-plus per-op change handlers.
- `stepsFingerprint` (`PipelineDetailPage.tsx:179-181`, `id:opType:config` join) and StepCard's
  `configFingerprint` (`StepCard.tsx:153`, `${stepIndex}:config`) confirmed verbatim.
- `normalizeSchedule`/`normalizeRunRecord` precedent for boundary-normalization confirmed real
  (`pipelineService.ts:149-154`, `:226`).
- `StepCard.tsx`'s existing `actions-cluster` (line 306, containing the drag handle + Move buttons,
  lines 313-339) and the card's `--expanded`/`--errored` modifier pattern (line 264) confirmed —
  both the Disable/Enable + Duplicate buttons and the `--disabled` modifier slot cleanly into
  existing, established patterns. `--app-text-muted` token exists (`DESIGN.md:84`), supporting the
  token-only muted-card claim.
- `PipelineRiverView.tsx` (289 lines) already receives `steps: Step[]` as a top-level prop and maps
  over it building per-card props/callbacks (lines 223-252) — threading `onToggleEnabled`,
  `onDuplicate`, and a computed `enabledBits` string through is a small, bounded addition,
  supporting the "~+10 lines" estimate.
- `PipelineDetailPage.handleReorderSteps` (lines 399-427) is a real, already-shipped instance of
  exactly the optimistic-flip → persist → reconcile-by-id → revert+toast-on-failure convention
  Decision 7 cites for `handleToggleStepEnabled`.
- File budgets confirmed exact via `wc -l`: `StepCard.tsx` 529, `PipelineDetailPage.tsx` 653,
  `PipelineRiverView.tsx` 289.

**Spec modeling choice**
- `openspec/specs/pipeline-step-reorder/` exists as a standalone capability (confirmed via
  directory listing), corroborating the "HEL-407 new-capability precedent" claim used to justify
  putting skip semantics in a new `pipeline-step-lifecycle` capability rather than three modified
  deltas. This is a defensible, precedented choice, not hand-waving — see non-blocking note below
  for a related staleness concern in the untouched sibling specs.

### Verdict: REFUTE

### Change Requests

1. **Decision 3's "list-assembly boundary" filtering must also cover (or explicitly exclude, with
   rationale) `PipelineService.analyzeProposal` and `BoundPanelService.projectSchema` — both of
   which also call `PipelineAnalyzeService.analyze` fed by the very type Decision 2 adds `enabled`
   to.**
   `CreatePipelineStepRequest` (`PipelineStepProtocol.scala:146`) is reused verbatim (not a
   separate DTO) by `PipelineProposal.steps` (`PipelineProposalProtocol.scala:33-36`, doc comment:
   "reuses `CreatePipelineStepRequest` verbatim") and `BoundPipelineSpec.steps`
   (`BoundPanelProtocol.scala:32-36`). Once Decision 2 lands, both gain a real, callable `enabled`
   field on the wire via those two paths — but:
   - `PipelineService.analyzeProposal` (`PipelineService.scala:249-273`, the dry-analyze of an
     unapplied `PipelineProposal`, backing `POST /api/pipelines/analyze-proposal`) builds
     `stepInputs` from `proposal.steps` with no `enabled` filter, then calls
     `PipelineAnalyzeService.analyze(stepInputs, sourceSchema)` at line 264.
   - `BoundPanelService.projectSchema` (`BoundPanelService.scala:129-134`) does the same from
     `BoundPipelineSpec.steps` for panel-binding validation.
   - Neither is named in design.md Decision 3, tasks.md 1.4, or tasks.md 2.3's test list.
   - This is not hypothetical: `openspec/specs/pipeline-proposal-analyze-api/spec.md`'s Purpose
     explicitly states the endpoint exists by "reusing the existing analyze engine and inline-source
     inference/guard calls rather than a second, divergent implementation" — once the live analyze
     endpoint (`PipelineService.analyze`) starts excluding disabled steps and `analyzeProposal`
     does not, that is precisely the "second, divergent implementation" this existing spec disclaims.
     It is also inconsistent with the new capability spec's own general framing ("A pipeline step
     SHALL carry a persisted `enabled` flag... The analyze endpoint SHALL compute schemas over the
     enabled steps only").
   - Unlike the frontend `Step.enabled` field (where TypeScript's structural typing forces every
     construction site to supply it, catching omissions at compile time), this is **not**
     compiler-enforced on the backend: `Option[Boolean]` on `CreatePipelineStepRequest` compiles
     fine whether or not any given consumer reads it, so this gap has no automatic backstop and will
     not surface as a build failure.
   - Required: add an explicit decision to design.md (and corresponding tasks/spec scenarios) that
     either (a) filters `enabled` out of `analyzeProposal`'s and `projectSchema`'s step-input
     construction too, with test coverage proving a disabled proposal/binding step is excluded from
     the projected schema, or (b) explicitly states this is out of scope with a stated rationale
     (e.g., "no sanctioned caller can currently set `enabled: false` on a proposal step — the
     `add_pipeline_step`/`create_bound_panel` MCP tool schemas (`helio-mcp/src/tools/write.ts:40-43`,
     `:615`) don't expose it — so `enabled` is a no-op there by design until a future ticket adds
     support"), recorded in Non-goals or Risks so a future reader doesn't read the silence as an
     oversight. Given the real-world exposure today is null (confirmed: `boundPipelineStepSchema`
     in `helio-mcp/src/tools/write.ts:40-43` only exposes `{type, config}`, not `enabled`), option
     (b) is a legitimate choice — but it must be a *recorded* decision, not a silent gap.

### Non-blocking notes

- `openspec/specs/pipeline-analyze-api/spec.md:5` ("Provide schema-inference results for every step
  in a pipeline") and the sibling `pipeline-run-execution`/`pipeline-step-preview` specs' Purpose/
  Requirement prose will become mildly stale once disabled steps are excluded (the mechanics they
  assert — e.g. "Step N's inputSchema SHALL equal step N-1's outputSchema" — remain literally true
  over the filtered list, so this is prose staleness, not a mechanics contradiction). Given the
  deliberate choice not to add MODIFIED deltas to those three specs (Planner Notes, defensible per
  the HEL-407 precedent), consider at least a one-line cross-reference from
  `pipeline-step-lifecycle`'s new Requirement back to the three specs it partially supersedes, so a
  future reader of e.g. `pipeline-analyze-api` alone isn't misled by "every step."
- Decision 4/8's route and fingerprint plumbing, and Decision 7's page-handler conventions, are all
  well-precedented and required no changes.
