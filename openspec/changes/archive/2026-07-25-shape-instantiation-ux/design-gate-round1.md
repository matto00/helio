## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **openspec validate**: re-ran `openspec validate shape-instantiation-ux --strict` from the worktree
  root myself → `Change 'shape-instantiation-ux' is valid` (exit 0).

- **Shape catalog ground truth**: read `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala`
  — `Registry` contains exactly `passthrough`, `single-row`, `top-n`, `time-series`, `pivot-matrix`,
  matching ticket.md and design.md's claims. `expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]`
  is confirmed pure (no repository/network/ActorSystem access per its own doc comment).

- **Existing HTTP surface**: read `PipelineShapeRoutes.scala` and `PipelineShapeService.scala` — confirmed
  today's only route is `GET /api/pipeline-shapes`, `catalog()` is synchronous (no `Future`, no `Either`),
  and the class doc comment explicitly says the service "drops the shape's `expand` behavior," matching
  design.md's Context section verbatim.

- **Decision 4 scrutiny (new `POST /api/pipeline-shapes/:id/expand`)**: read `PipelineStepRoutes.scala`
  (the cited sibling) and `ServiceResponse.scala`. Confirmed the `ServiceResponse.run`/`ServiceError`
  pattern is the correct, consistently-used idiom for every mutating route in this codebase (grepped ~15
  call sites across `AlertRuleRoutes`, `DashboardRoutes`, `PipelinePermissionRoutes`, etc. — all follow the
  same shape). Confirmed `PipelineShapeRoutes` is mounted inside `ApiRoutes.scala`'s authenticated route
  tree (`new PipelineShapeRoutes(pipelineShapeService, authenticatedUser).routes`, line 275) — so the new
  endpoint inherits authentication by construction, exactly as design.md and the registry spec claim (no
  route-level auth code needs to be added). The scope-extension justification itself (no way to satisfy
  the ticket's core ACs without exposing `expand` over HTTP; the shipped service's own doc comment
  anticipated this; ~40 lines, no migration) is sound and correctly scoped — it does not reach into
  unrelated territory (no new persistence, no step-CRUD wire-shape change).
  - **One real signature inconsistency found**: design.md Decision 4 (line 69) and tasks.md task 1.1 both
    specify `PipelineShapeService.expand(id, params): Either[ServiceError, Vector[ShapeStepExpansion]]` —
    **not** wrapped in `Future`. But `ServiceResponse.run[A]` (verified in `ServiceResponse.scala`)
    requires `Future[Either[ServiceError, A]]`; every existing service method used with it returns a
    `Future`. Passed literally as documented, task 1.3's "`ServiceResponse.run`" call would not compile.
    This is trivially fixable (wrap in `Future.successful(...)` at the call site, or state the signature
    as `Future[Either[...]]`, consistent with `expand`'s underlying purity being irrelevant to the
    HTTP-layer contract) — see Change Requests below. I judged this **non-blocking** (a one-line, obvious
    fix any implementer hits immediately upon touching `ServiceResponse.scala`), not a structural flaw.

- **Frontend composition**: read `PipelineRiverView.tsx` (confirmed empty-state / "+ Add" row structure
  the design says it will extend), `PipelineDetailPage.tsx` lines 270–330 (confirmed `handleAddStep`'s
  temp-step-then-toast-on-failure pattern and `handleRemoveStep`'s no-rollback local-delete semantics —
  both cited accurately by design.md Decision 6 as the precedent this design mirrors), and
  `stepNarrowing.ts` `OP_TYPES` (confirmed all step kinds emitted by the four shapes' `expand`
  implementations — `select`, `limit`, `sort`, `aggregate`, `filter`, `datebucket`, `pivot`, verified via
  grep of `ShapeStepExpansion(kind = ...)` call sites across all four shape files — already exist in
  `OP_TYPES`/`StepCard`'s registry, so "no special-casing downstream" is architecturally true, not
  aspirational).

- **Shared components**: confirmed `frontend/src/shared/ui/` already has `Modal.tsx`, `TextField.tsx`, and
  `Textarea.tsx` — the exact widget set Decision 5 proposes, so the design does not require inventing new
  one-off components in a way that would set up a `DESIGN.md` violation.

- **`ShapeParamDescriptor` field names**: read `ShapeParamDescriptor.scala` — confirmed
  `{name, label, dataType, required, description}` exactly matches Decision 5's widget-selection logic and
  the registry spec's wire shape.

- **`ShapeStepExpansion` wire shape**: read `ShapeStepExpansion.scala` (`{kind: String, config: JsObject}`)
  and cross-checked `SingleRowShape.scala`'s aggregate-mode example against the registry spec's Scenario
  ("Expand succeeds for a registered shape with valid params") — the expected `AggregateConfig(groupBy=[],
  aggregations=[...])` output matches the shape's actual documented behavior.

- **Three ticket-mandated decisions**: confirmed each is explicit with stated rationale in design.md —
  Decision 1 (editor-only, not create-modal — because no pipeline id exists pre-creation), Decision 2
  (plain unlinked steps, loudly flagged for HEL-399's differing needs), Decision 3 (append, matching
  `handleAddStep`'s existing always-append precedent, no confirm-dialog precedent for destructive
  replace).

- **HEL-336 defect closure**: cross-read the ticket's brief on the lookup-picker bug (empty-default POST
  silently swallowed → step vanished with no error) against design.md Decision 5/6 and the
  `pipeline-shape-instantiation-ui` spec's "A failed expand or step-create is always surfaced" requirement.
  The design closes this at two points, not just one: (a) client-side `required` gating blocks submission
  of an empty-default form before any POST is attempted, and (b) *even if* a submission somehow fails
  server-side, the 422 message is shown inline and the modal stays open (never a silent close), and a
  mid-loop step-create failure produces a visible toast naming the partial-apply count rather than a
  silent drop. This is a materially stronger closure than the original bug's fix (single toast) because it
  guards both the "expand" and "seed" failure points independently. Tasks 4.2 explicitly requires a
  live-browser-equivalent test of the empty-default path, not just unit tests.

- **Tasks structure**: `tasks.md` groups are 1 (backend), 2 (frontend service+types), 3 (frontend UI), 4
  (tests) — backend-first, frontend second, tests last, per repo convention. Each group is independently
  completable (group 1 has no frontend dependency; group 4 tests both layers, which is expected for a
  tests-last group).

- **AC traceability**: all five ticket ACs map to concrete design/spec/task content — shape selection +
  param-seeding (spec `pipeline-shape-instantiation-ui`, tasks 3.1/3.3/3.4), no special-casing downstream
  (verified above against `OP_TYPES`), params form driven by `paramsSchema` (Decision 5), frontend tests
  (task 4.2), `DESIGN.md`/backward-compat (additive-only impact, reuses existing shared components).

### Verdict: CONFIRM

### Non-blocking notes

1. **`design.md` Decision 4 (line 69) / `tasks.md` task 1.1** — the stated
   `PipelineShapeService.expand` signature (`Either[ServiceError, Vector[ShapeStepExpansion]]`) does not
   match `ServiceResponse.run`'s required `Future[Either[ServiceError, A]]` (confirmed against
   `ServiceResponse.scala` and ~15 existing call sites). Recommend the executor either return
   `Future[Either[ServiceError, Vector[ShapeStepExpansion]]]` from `expand` (wrapping the pure computation
   in `Future.successful`, consistent with every other `ServiceResponse.run`-fed method in this codebase)
   or wrap the call at the route call site. Either resolves it; flagging so it isn't a surprise mid-task 1.3.
2. No `schemas/*.json` file is proposed for the new `POST /api/pipeline-shapes/:id/expand` request/response
   pair, unlike the existing `pipeline-shape-catalog.schema.json` for the sibling GET. Not required —
   confirmed by precedent that `CreatePipelineStepRequest`/step-CRUD wire types also have no dedicated
   `schemas/*.json` file — but worth a conscious call in the PR description if omitted.
