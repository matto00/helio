## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established**
- Read `ticket.md`, `proposal.md`, `design.md` (all six Decisions), both spec deltas
  (`specs/pipeline-shape-registry/spec.md`, `specs/pipeline-shape-instantiation-ui/spec.md`), and
  `evaluation-1.md` (treated as claims, not fact).
- `git diff main...HEAD --stat` reviewed; read the actual diffs for every backend file
  (`PipelineShapeService.scala`, `PipelineShapeRoutes.scala`, `PipelineShapeProtocol.scala`,
  `api/package.scala`) and every new/changed frontend file (`ShapePickerModal.tsx/.css`,
  `PipelineRiverView.tsx`, `PipelineDetailPage.tsx`, `pipelineService.ts`, `types/pipelineShape.ts`).

**Automated gates — re-run from scratch, not trusted from the evaluator's report**
- `sbt -batch test` (full backend suite): **2030 tests, 0 failures** — matches evaluator's claim,
  independently reproduced.
- `npm test` (full frontend suite): **132 suites / 1380 tests, all passing** — matches evaluator's claim,
  independently reproduced.
- Targeted re-run of the new suites (`PipelineShapeRoutesSpec`, `PipelineShapeServiceSpec`,
  `ApiRoutesSpec`): 196 tests, all passing.
- `npm run lint` (zero-warnings ESLint): clean.
- `npm run format:check` (Prettier): clean.
- `npm run build` (Vite production build): succeeds.
- `npm run check:scala-quality`: clean (only pre-existing soft line-count warnings, none touching
  ticket files).
- `npm run check:schemas`: clean, in sync.

**Backend scrutiny (adversarial, on the shipped code — not the design doc)**
- `POST /api/pipeline-shapes/:id/expand` is genuinely auth-gated: confirmed structurally
  (`ApiRoutes.scala:275`, `new PipelineShapeRoutes(...)` is instantiated inside the
  `authDirectives.authenticate { authenticatedUser => ... }` block) **and** empirically — a bare
  `curl -X POST` with no session cookie against the live backend on port 8482 returned `401`.
- 422 message is the shape's own message verbatim, not rewritten: reproduced live in the browser
  (see UI verification below) and confirmed via `browser_network_requests` that the response status
  was exactly `422 Unprocessable Content`; the on-screen error text matched the shape's `Left` message
  word-for-word, including the embedded quote characters.
- 404 (not 400/500) for an unknown shape id: fired a direct authenticated `fetch()` from the live page
  to `POST /api/pipeline-shapes/does-not-exist/expand` — got `404` with body
  `"Unknown pipeline shape: 'does-not-exist'. Valid values: passthrough, pivot-matrix, single-row,
  time-series, top-n"`.
- `ServiceResponse.completeError` mapping confirmed by reading `ServiceResponse.scala`:
  `NotFound → 404`, `UnprocessableEntity → 422` — verified this is the actual dispatch table, not
  inferred.
- No inline FQNs in any new/changed file (grepped `com\.helio\.` across all six touched backend files
  and both new test specs — the only matches are legitimate Scaladoc cross-references
  (`[[com.helio.domain.shapes.PipelineShape.expand]]`), not inline code usage).

**Frontend / DESIGN.md compliance (read the actual files, not summarized)**
- `ShapePickerModal.css` uses only `--app-*`/`--space-*`/`--text-*`/`--weight-*` tokens — zero hardcoded
  colors, spacing, or radii.
- Co-located tests exist for every new component: `ShapePickerModal.test.tsx` present alongside
  `ShapePickerModal.tsx`; `PipelineDetailPage.test.tsx` extended with a new describe block;
  `pipelineService.test.ts` extended.
- Decision 4 (self-approved new backend endpoint) re-litigated on the shipped code, not the doc: agree
  it's justified — there is no way to turn `{shapeId, params}` into steps client-side without
  re-implementing every shape's business logic in TypeScript, the diff is small (~40 lines across 2
  existing files + 1 new wire-type pair), and it reuses the exact `ServiceResponse`/`ServiceError`
  pattern every sibling mutating route already uses.

**Live browser verification (Playwright, dev servers at :5575/:8482, logged in as the real dev user)**
1. **Both affordance locations** — confirmed "Start from a shape" present in the empty-state layout
   (0-step "Popover Test Pipeline") *and* in the "+ Add" row once a step exists.
2. **HEL-336 defect-pattern re-verification, done independently from scratch (not from the evaluator's
   claim)**: selected "Single row", filled only `Mode = "aggregate"` (the only client-side-required
   field per the generic params form — `Measures` is not `required: true` in the schema even though
   it's conditionally required server-side), left `Measures` **empty**, clicked "Add steps". Result:
   - `POST /api/pipeline-shapes/single-row/expand` returned `422` (confirmed via
     `browser_network_requests`).
   - The inline error `single-row shape: missing required field 'measures' (expected a non-empty
     array of { fn, field, alias } objects) when mode is "aggregate"` rendered verbatim in the modal.
   - The modal **stayed open**; step count remained **0** (confirmed both visually and via
     `GET /api/pipelines/:id/steps` returning `[]`).
   - This is a genuine, fresh reproduction of the exact defect-pattern check the ticket named — not a
     rerun of the evaluator's script.
3. **Happy path**: filled `Measures = [{"fn":"sum","field":"amount","alias":"total"}]`, submitted.
   Modal closed, one "Group & aggregate" step card appeared, step count 1. Expanded the step: standard
   `StepCard` UI (Group by, Aggregations editor with alias/function/field controls, Preview data,
   Remove step) — indistinguishable from a hand-authored step.
4. **Provenance check (independent, via direct wire fetch, not just the UI)**:
   `GET /api/pipelines/531e0c3c-9bb7-4720-82d9-3682d9f38382/steps` returned
   `config: {"aggregations":[{"alias":"total","field":"amount","fn":"sum"}],"groupBy":[]}` — no
   `shapeId`, `sourceShape`, or any provenance field anywhere in the persisted config or wire response.
5. **Multi-step ordered seeding + append into a non-empty pipeline**: with the one existing step in
   place, opened "Start from a shape" again (now in the "+ Add" row), selected "Top N", filled
   `Measure=amount, Direction=desc, N=5`, submitted. Two new step cards appeared in the correct order
   — "Sort rows" then "Limit rows" — bringing the pipeline to 3 steps. Confirmed via
   `GET /api/pipelines/:id/steps`: `position: 0/1/2` = `aggregate`/`sort`/`limit`, in that exact
   order, with the existing step unmodified — direct proof of design.md Decision 3 (append, not
   replace).
   Expanded "Sort rows": sort key field correctly shows `amount`, direction `desc` — editable, matches
   the seeded values.
   Expanded "Limit rows": row limit field correctly shows `5` — editable.
6. **Generic params form / widget mapping**: confirmed `string` → text input, `integer` → numeric
   `spinbutton` (Top N's `N` field), `object[]` → textarea (Single row's `Measures`/`Conditions`),
   each field's `description` shown as helper text — exactly per design.md Decision 5.
7. **404 for unknown shape id** surfaced via direct fetch (see backend section above) rather than
   crashing or silently failing.
8. **Light/dark theme parity**: screenshotted the shape-list view and the params-form view in both
   themes. Both render cleanly with opaque surfaces, hairline borders, and scarce accent usage
   (asterisk on required label, primary "Add steps" button) — no tinting, no unstyled/broken regions.
9. **Mobile breakpoint (430px)**: modal renders cleanly, shape list remains scrollable/usable, no
   layout breakage.
10. **No unexpected console errors**: the only console entries across the entire session were the
    network-status lines I intentionally triggered (422 from the empty-Measures test, 403 from a
    manual CSRF-header-omitted out-of-band fetch, 404 from the unknown-shape-id fetch) plus the
    pre-existing, expected 404 on `GET .../schedule` for a pipeline with no schedule set. No unhandled
    JS exceptions, no blank screens.
11. **Cleanup**: removed the test artifacts I created (the aggregate/sort/limit steps on "Popover Test
    Pipeline") via the UI's own "Remove step" affordance; confirmed via a final
    `GET /api/pipelines/:id/steps` that the pipeline is back to 0 steps.

**Acceptance criteria traced**
- "editor offers shape selection; picking a shape + filling params seeds the correct step cards" —
  ✅ traced to live evidence (items 2–5 above).
- "seeded steps are normal, editable, previewable steps (no special-casing downstream)" — ✅ traced
  (item 3, standard `StepCard`/`OP_TYPES` rendering + independent edit).
- "params form is driven by the catalog's params schema" — ✅ traced (item 6, generic `dataType`-keyed
  widget mapping, no per-shape hardcoding in `ShapePickerModal.tsx`).
- "Frontend tests cover shape selection → seeded steps" — ✅ traced (`ShapePickerModal.test.tsx`,
  `PipelineDetailPage.test.tsx` new describe block, both re-run and passing).
- "Follows DESIGN.md tokens/components; backward compatible" — ✅ traced (CSS token audit, additive-only
  diff, no breaking changes to existing step CRUD wire shapes).

### Non-blocking notes
- Two stray Playwright-screenshot PNG batches now sit at the **main repo root**
  (`/home/matt/Development/helio/*.png`, gitignored via `*.png` so they will not be committed): three
  pre-existing files from the evaluator's earlier UI-review session
  (`shape-picker-1440.png`/`-430.png`/`-768.png`) and four I generated during this review
  (`shape-picker-dark.png`, `shape-picker-light-list.png`, `shape-picker-light-form.png`,
  `shape-picker-mobile-430.png`). This is the known parallel-worktree/shared-Playwright-session hazard
  — the orchestrator should clear these from the repo root before delivery.
- `PipelineDetailPage.tsx` is 571 lines (pre-existing over the ~400-line soft-split threshold before
  this ticket; the ~30 lines added here are cohesive). Consider a follow-up extraction.
- `.pipeline-detail-page__shape-picker-btn` uses literal `padding: 8px 18px` / `--app-radius-md` rather
  than `--space-*` tokens — confirmed this exactly mirrors the pre-existing sibling
  `.pipeline-detail-page__add-step-btn` recipe (not a new violation). Candidate for a future
  token-normalization pass alongside its sibling.

### Verdict: CONFIRM

Every acceptance criterion is traced to real, independently-reproduced evidence — not the evaluator's
narrative. The ticket's named, explicit risk (the HEL-336 empty-default-picker defect pattern) was
re-created from scratch in a fresh browser session and disproven: the 422 surfaces verbatim, the modal
stays open, and no step is silently created. The self-approved backend-endpoint scope addition
(design.md Decision 4) holds up under re-litigation against the shipped code. No shape provenance leaks
into persisted step config. Append-not-replace, ordered multi-step seeding, generic params-form widget
mapping, and light/dark parity all hold. All automated gates re-run clean from scratch. No Change
Requests.
