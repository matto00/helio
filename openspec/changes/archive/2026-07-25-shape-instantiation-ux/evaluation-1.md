## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 5 ticket ACs addressed explicitly: shape selection seeds correct step cards; seeded steps are
  ordinary editable/previewable steps (confirmed live — `StepCard`/`OP_TYPES` render, expand/edit/remove
  all work identically to hand-authored steps); params form is generic and driven by `paramsSchema.dataType`
  (verified across `single-row` and `top-n` shapes live, including the numeric `N` field using a
  `spinbutton`); frontend tests cover shape selection → seeded steps (`ShapePickerModal.test.tsx`,
  `PipelineDetailPage.test.tsx` new describe block, `pipelineService.test.ts`); DESIGN.md tokens used
  throughout new CSS, additive-only UI, no breaking changes.
- No AC silently reinterpreted. tasks.md's 13 items all done and match the diff exactly (verified each
  task item against the corresponding file/behavior).
- No scope creep beyond the one flagged, self-approved addition: `POST /api/pipeline-shapes/:id/expand`
  (design.md Decision 4) — pre-confirmed by a design-gate skeptic round 1(design-gate-round1.md), and
  independently re-verified against spec.md's four scenarios (200/404/422/401) below.
- No regressions: full backend suite (2030 tests) and full frontend suite (132 suites / 1380 tests) pass
  clean, re-run independently this cycle (not taken from the executor's report).
- API contract: new `ExpandPipelineShapeRequest`/`ShapeStepExpansionResponse` wire types added to
  `PipelineShapeProtocol.scala` and re-exported via `api/package.scala`, matching every sibling wire-type's
  pattern. No JSON Schema file added for the new endpoint, but this matches the codebase's existing
  selective-schema convention (many endpoints, e.g. all pipeline-step CRUD, have no dedicated
  `schemas/*.schema.json` file either) — `npm run check:schemas` passes clean.
- Planning artifacts (proposal/design/tasks) reflect the final implementation — every one of design.md's
  six Decisions was verified against the actual diff/live behavior and matched exactly (see Phase 2/3).

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Backend**: `PipelineShapeService.expand` (services/PipelineShapeService.scala:43-56) delegates to
  `PipelineShape.shapeFor(id).flatMap(_.expand(params))`, maps unknown-id → `ServiceError.NotFound`,
  invalid-params → `ServiceError.UnprocessableEntity`, wraps in `Future.successful` exactly as
  design.md Decision 4 specifies. `PipelineShapeRoutes.scala` adds `POST /pipeline-shapes/:id/expand`
  inside the same authenticated route composition as the existing catalog GET (no new auth wiring needed —
  `PipelineShapeRoutes` is already inside the authenticated tree in `ApiRoutes.scala:275`). Verified the
  422 message is the shape's own message verbatim (`SingleRowShape.scala:124`) — matched byte-for-byte
  in `PipelineShapeRoutesSpec`/`PipelineShapeServiceSpec`/`ApiRoutesSpec` and independently in the live
  browser check (Phase 3). 404 message lists registered ids via `PipelineShape.shapeFor`'s own `Left`.
  No Flyway migration, no persistence touched — confirmed via diff (only service/route/protocol files
  changed).
- **check:scala-quality**, **lint**, **format:check**, **check:schemas** all re-run independently this
  cycle and clean (matches the executor's report; the commit's `--no-verify` bypass was for
  `check:openspec`'s expected mid-flow "not yet archived" false-positive, called out explicitly in the
  commit body per CONTRIBUTING.md's AI-collaborator rule).
- **Full `sbt test`** (2030 tests, all passing) and **full frontend `npm test`** (1380 tests, all passing)
  re-run independently.
- No inline FQNs found in the new/changed files (`ExpandPipelineShapeRequest`/`ShapeStepExpansionResponse`
  imported at top of file in both `PipelineShapeProtocol.scala` and `PipelineShapeRoutesSpec.scala`/
  `ApiRoutesSpec.scala`).
- DRY: reuses `Modal`, `TextField`, `Textarea`, `InlineError` (shared components), reuses
  `createPipelineStep`/`pipelineStepToStep`, reuses the `ServiceResponse`/`ServiceError` pattern from
  `PipelineStepRoutes`. No hand-rolled equivalents.
- Type safety: no `any` in any new file; `ShapeStepExpansion.kind`/`config` typed against
  `PipelineStepKind`/`PipelineStepConfig`.
- Error handling: exactly matches design.md Decisions 5/6 — client-side JSON-parse failure blocks
  submission with an inline error and no request sent; 422/404 from `/expand` shown inline, modal stays
  open, no steps created; mid-loop per-step-POST failure stops the loop, keeps already-created steps,
  closes the modal, and pushes a named-count error toast. All four failure paths independently
  live-verified or unit-tested (see Phase 3 for the live verification).
- Tests are meaningful, not rubber-stamp: `PipelineDetailPage.test.tsx`'s new describe block asserts the
  actual created-step count via toast text (`"1 of 2 steps were added"`), the actual DOM presence/absence
  of steps, and modal open/closed state — these would catch a real regression to the HEL-336 defect
  pattern.
- No dead code / stray TODOs in the diff.
- No over-engineering: the params-form widget mapping is exactly 4 cases + fallback, no premature
  abstraction for future `dataType`s.

**Non-blocking suggestions:**
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` was already 541 lines (over the ~400-line
  "propose a split in the PR description" soft threshold in CONTRIBUTING.md) before this ticket and is
  now 571. This is a pre-existing condition (the file was already over budget going into this ticket, and
  a `PipelineRiverView.tsx` comment notes it was already split once for this reason), not a new violation
  introduced here, and the ~30 lines added are cohesive (`handleInstantiateShape` + wiring) — but a future
  ticket should consider a second extraction (e.g. pulling step-mutation handlers into a hook) before this
  file grows further.
- `.pipeline-detail-page__shape-picker-btn` (PipelineDetailPage.css:261-274) uses literal `padding: 8px
  18px` and `border-radius: var(--app-radius-md)` rather than `--space-*` tokens / `--app-radius-sm` per
  DESIGN.md's canonical button recipe (Section 5). This exactly mirrors the pre-existing sibling
  `.pipeline-detail-page__add-step-btn` recipe in the same file (also non-token padding, predating this
  ticket) — matching sibling metrics exactly is the DESIGN.md-preferred behavior over inventing a new
  button style, so this isn't flagged as a new defect, but both recipes are candidates for a follow-up
  token-normalization pass.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via the canonical script (already healthy, reused) and `assert-phase.sh servers`
returned `PASS`. All checks below were driven live in a real browser via Playwright, independently of the
executor's unit tests, with particular focus on the HEL-336 defect-pattern re-verification requested by
the orchestrator brief:

- **HEL-336 defect re-verification (empty/default params)**: Opened "Start from a shape" on a pipeline
  with existing steps ("Profit (migrated)", 4 steps), selected "Single row", filled only the required
  `Mode` field (`"aggregate"`) and left the required-when-aggregate `Measures` field **empty** (the exact
  empty-default picker pattern from HEL-336), clicked "Add steps". Result: the inline error
  `single-row shape: missing required field 'measures' (expected a non-empty array of { fn, field, alias }
  objects) when mode is "aggregate"` appeared **verbatim** matching the backend's `Left` message, the
  modal **stayed open**, and the step count remained **4** (no step silently created) — this is the direct
  disproof of the HEL-336 defect pattern for this ticket, confirmed via fresh live evidence, not from the
  executor's report or unit tests.
- **Happy path**: Filled valid `Measures` JSON, submitted — a new "Group & aggregate" step card appeared,
  step count became 5, modal closed. Verified via a direct authenticated `fetch` to
  `GET /api/pipelines/:id/steps` that the persisted step's `config` contains **only**
  `{aggregations, groupBy}` — no `shapeId`/`sourceShape`/any provenance field (spec.md "Seeded steps carry
  no shape provenance" scenario, independently confirmed against the wire response, not just the UI).
  Step appeared at `position: 4`, after the 4 pre-existing steps (append, not replace — design.md
  Decision 3). The seeded step was fully expandable/editable (Group by, Aggregations, alias/function/field
  editors, Remove step) — indistinguishable from a hand-authored step.
- **Multi-step ordered seeding**: On a zero-step pipeline ("Popover Test Pipeline"), selected "Top N"
  (expands to `sort` then `limit`), filled `Measure=amount`, `Direction=desc`, `N=5` — two step cards
  appeared in the correct order: "Sort rows" first, "Limit rows" second, with the sort key and row-limit
  values correctly populated from the expansion.
- **Both entry points**: "Start from a shape" confirmed present in both the empty-state layout (zero
  steps) and the "+ Add" row layout (steps present), per spec.md's two scenarios.
- **All 5 catalog shapes** listed with label + description (Passthrough, Pivot / matrix, Single row, Time
  series, Top N).
- **Generic params form**: confirmed `dataType`-driven widgets live — `string` → text input, `integer` →
  numeric `spinbutton` (Top N's `N` field), helper text sourced from each field's `description`; required
  fields correctly disable "Add steps" until filled.
- **No console errors from application logic**: the only console entries during the entire session were
  expected non-2xx network-status log lines (the intentional 422 test, a stray manual cleanup 403 from my
  own out-of-band DELETE attempt, and a 404 for a pipeline with no schedule set) — no unhandled JS
  exceptions, no blank screens, no crashes.
- **Breakpoints**: 1440 / 768 / 430 all screenshotted with the modal open — renders cleanly at all three,
  no layout breakage, shape list and form remain usable.
- **Accessibility**: dialog has an accessible name ("Start from a shape" / "Start from a shape — <Shape
  label>"), all inputs have accessible names (label `htmlFor` + `aria-label` on the underlying
  `TextField`/`Textarea`), Escape closes the dialog and returns focus to the trigger button.
- Test artifacts created during this live verification (the aggregate step on "Profit (migrated)" and the
  sort/limit steps on "Popover Test Pipeline") were removed via the UI's own "Remove step" affordance
  before concluding the review, restoring both pipelines to their pre-review step counts.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Consider a follow-up ticket to extract more of `PipelineDetailPage.tsx`'s step-mutation handlers into a
  hook (file is 571 lines, over the ~400-line soft-split threshold; this predates HEL-402 but grew
  further here).
- Consider normalizing `.pipeline-detail-page__add-step-btn` / `.pipeline-detail-page__shape-picker-btn`
  padding to `--space-*` tokens and radius to `--app-radius-sm` in a future design-token cleanup pass
  (pre-existing pattern, mirrored rather than introduced by this ticket).
