# Design: step-duplicate-disable-enable

## Context

Base `68a2dd32` (includes all five prior HEL-339 tickets). Backend: `pipeline_steps` has no
`enabled` column; origin/main's latest migration is `V84__pipeline_run_assertions.sql` → this
change takes **V86** (coordinator-confirmed: V85 is claimed by the parallel HEL-462 lane). `PipelineStepResponse` is a
sealed trait with ~23 per-kind case classes (id/pipelineId/position/createdAt/updatedAt/config)
(`PipelineStepProtocol.scala:17+`); requests: `CreatePipelineStepRequest(type, config, position)`
(HEL-410), `UpdatePipelineStepRequest(type, config, position)`. `insertAtInternal` (HEL-410) does
transactional splice + full 0..n renumber. Duplicate route precedents:
`path(DashboardIdSegment / "duplicate")` (`DashboardRoutes.scala:57`),
`path(PanelIdSegment / "duplicate")` (`PanelRoutes.scala:93`). `PipelineAnalyzeService.analyze`
takes a pre-built steps vector (line ~41) — filtering happens at call sites. Preview runs the
step prefix 0..K. Frontend: `Step` (types/step.ts) has no `enabled`; StepCard has the HEL-407
sibling actions cluster (drag handle + Move buttons) and the HEL-409 error chip; page owns steps
as local state with optimistic conventions; analyze refresh keys on `stepsFingerprint`
(`id:opType:config` join); open previews key on `${stepIndex}:config`.

## Goals / Non-Goals

Goals: persisted disable/enable with run/analyze/preview exclusion; one-click duplicate inserted
after the original; muted disabled rendering; additive wire only; migration safe on fresh +
existing DBs. Non-goals: DAG; bulk operations; delete-renumbering; run-history semantics changes.

## Decisions

1. **Migration `V86__pipeline_steps_enabled.sql`** (number coordinator-confirmed: origin/main
   HEAD is V84 and the parallel HEL-462 lane has claimed V85 for its `last_source_schema`
   migration — V86 is this change's number, everywhere):
   `ALTER TABLE pipeline_steps ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;` — additive,
   instant default, safe on fresh + existing DBs and for the other lane sharing the dev DB.
2. **Domain/wire threading**: `PipelineStep.enabled: Boolean`; repository row mapping + all
   reads/writes. Every response subtype gains `enabled: Boolean` (always serialized — additive;
   the sealed trait gains the accessor). `CreatePipelineStepRequest.enabled: Option[Boolean] =
   None` (None → true) and `UpdatePipelineStepRequest.enabled: Option[Boolean]` (None →
   no-change), formats bumped. Frontend `Step`/`PipelineStep` types gain `enabled` with a
   normalize-at-boundary default (`enabled ?? true`, the spray-json Option-omission precedent —
   though responses always send it, normalize anyway per `normalizeSchedule`/`normalizeRunRecord`
   convention).
3. **Skip semantics — filter at the list-assembly boundary, at EVERY `analyze`/execute call
   site** (five, enumerated — the invariant is "the engine sees enabled steps only", everywhere):
   (i) full run and (ii) dry run (`PipelineRunService`) execute `steps.filter(_.enabled)`;
   (iii) the live analyze call site filters before `PipelineAnalyzeService.analyze` (the analyze
   response therefore contains entries for enabled steps ONLY — the editor already renders
   gracefully when a step has no analyze entry, per HEL-404); (iv)
   `PipelineService.analyzeProposal` (~line 249-273) and (v) `BoundPanelService.projectSchema`
   (~line 129-134) — both consume `CreatePipelineStepRequest`-shaped steps, which gain the
   `enabled` field via Decision 2's type reuse (`PipelineProposal.steps` /
   `BoundPipelineSpec.steps` reuse the request type verbatim), so both filter
   `enabled.getOrElse(true)` when building their step inputs. This closes the divergence the
   design-gate round 1 caught: `pipeline-proposal-analyze-api`'s Purpose explicitly disclaims "a
   second, divergent implementation" of analyze, so a proposal step with `enabled: false` must be
   excluded exactly as a persisted disabled step is (today no sanctioned caller sends it — the
   MCP tool schemas don't expose `enabled` — but the wire accepts it, and silence here is not
   compiler-enforced). `previewStep` filters disabled steps out of the 0..K prefix, and
   previewing a step that is itself disabled returns 422 ("step is disabled") — the UI never
   offers it (Decision 6), so the 422 is a defensive backstop. Positions/ordering are untouched
   by disable (a disabled step keeps its position; skip is a runtime filter, not a reorder).
4. **Duplicate endpoint**: `POST /api/pipeline-steps/:id/duplicate` (route shape mirrors the
   dashboard/panel precedents). Service `duplicateStep(stepId, user)`: `findByIdInternal` →
   NotFound masking + editor/owner ACL (the `updateStep` pattern verbatim) → compute the
   original's list index in the position-sorted steps → `insertAtInternal(pipelineId, kind,
   config, index + 1)` with the original's config AND `enabled` cloned → 201 with the created
   step response. No request body. Re-uses HEL-410's transactional renumber wholesale — no new
   persistence machinery.
5. **Config-decode note for duplicate**: the original's persisted config is already-valid JSON
   for its kind; duplicate round-trips it through the existing typed decode (same helper
   `addStep` uses) so an unparseable legacy row fails loudly (500-classified) rather than
   cloning garbage — matches the analyze service's decode posture.
6. **Frontend actions**: Disable/Enable and Duplicate buttons join the HEL-407 sibling actions
   cluster (interactive → siblings of the toggle, never nested; the cluster already exists so
   this is additive). Disabled card: `pipeline-detail-page__step-card--disabled` modifier
   (muted: reduced opacity on the body/label via existing muted tokens; token-only), a
   "Disabled" state communicated accessibly (the toggle button's label flips
   Disable step ↔ Enable step — the state is conveyed by the action name), preview button
   hidden for disabled steps, editor remains visible-but-muted (config stays editable — disabling
   is about execution, not locking; PATCHes still allowed). Error chip (HEL-409) naturally
   disappears for disabled steps (no analyze entry → no validationError prop).
7. **Page handlers** (page-local, plain-service convention): `handleToggleStepEnabled(stepId,
   enabled)` — optimistic `setSteps` flip → PATCH `{enabled}` via the existing
   `updatePipelineStep` service (gains an options object or a sibling fn — keep the existing
   config-only signature intact for `useStepCardState`; add `updatePipelineStepEnabled(stepId,
   enabled)` to avoid touching every config call site) → reconcile from response; revert + toast
   on failure (reorder precedent — a silently-lost disable is worse than a snap-back).
   `handleDuplicateStep(stepId)` — call duplicate service → splice `pipelineStepToStep(created)`
   after the original locally (server already renumbered; local order is what renders) → toast on
   failure (nothing to revert — no optimistic clone; duplicate is a single POST, the button can
   show its result when the response lands; simpler than optimistic-then-reconcile for a
   sub-second call).
8. **Freshness**: extend `stepsFingerprint` with `enabled` (`id:opType:enabled:config`) so a
   toggle re-runs analyze (the analyze list changes!). Extend the StepCard preview fingerprint
   with an `enabledBits` prop (the join of every step's enabled flag, same string passed to all
   cards): `${stepIndex}:${enabledBits}:${config}` — any toggle refreshes all open previews
   (slightly broader than strictly needed; upstream-only tracking isn't worth the plumbing).
   Duplicate needs nothing: the splice changes list length/order → both fingerprints fire.
9. **Schemas**: `create-pipeline-step-request.schema.json` gains `enabled` (checker diffs the
   full property set — update it). `UpdatePipelineStepRequest` has no schema file today (only
   create + reorder exist for steps) — the checker only validates files that exist, so no new
   file is required; not adding one keeps this change's schema surface minimal.

## Planner Notes (self-approved)

- Spec modeling: run/analyze/preview skip semantics live in the NEW `pipeline-step-lifecycle`
  capability rather than as MODIFIED deltas to `pipeline-run-execution`/`pipeline-analyze-api`/
  `pipeline-step-preview` — one cohesive spec owns the whole enabled feature (the HEL-407
  new-capability precedent), avoiding three near-duplicate full-body rewrites whose existing
  requirements remain true for enabled steps. The persistence spec IS modified (table/POST/PATCH
  are explicit column/field contracts).
- Analyze excludes disabled steps entirely (ticket's literal "drop them from the analyzed step
  list") — accepted consequence: a disabled step shows no schema chips/diff/validation, which
  reads correctly as "not participating".
- Disabled steps keep their position; enabling never moves anything.
- Duplicate is non-optimistic (Decision 7) — deliberate divergence from add/insert's optimistic
  temp-step pattern: there's no user-entered config to preserve, so the temp-step machinery buys
  nothing and risks temp-id edge cases for a single fast POST.
- Sizing: StepCard 529 → ~+25; PipelineDetailPage 653 → ~+40; PipelineRiverView 289 → ~+10
  (prop threading). All past/near budget — HEL-682 owns splits; record actuals.

## Risks

- Migration-number contention with the parallel lane — gated on coordinator confirmation before
  execution (ticket.md). The migration itself is additive/instant-default: even if the other
  lane's backend starts first with a DIFFERENT number, no conflict; only a same-number different-
  content collision is dangerous.
- ~23 response case classes gaining a field is broad but mechanical; `sbt test` (3048 tests)
  catches any missed format bump loudly.
- A pipeline whose EVERY step is disabled runs as a passthrough of the source — same as a
  zero-step pipeline today; tests cover it.
