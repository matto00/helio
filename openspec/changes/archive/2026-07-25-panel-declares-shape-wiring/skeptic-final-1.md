## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**1. No new backend endpoint; composes the 5 pre-existing endpoints only.**
- `git diff main...HEAD --stat -- backend schemas openspec/specs` → empty (re-ran myself).
- Live network trace during the happy-path run (`browser_network_requests`) shows exactly:
  `GET /api/pipeline-shapes` → `POST /api/pipeline-shapes/:id/expand` → `POST /api/pipelines` →
  `POST /api/pipelines/:id/steps` → `POST /api/pipelines/:id/run`. No other endpoint touched.
- `ShapeInstantiateStep.tsx` imports only `createPipeline, createPipelineStep, expandPipelineShape,
  runPipeline` from the existing `pipelineService`.

**2. No Flyway migration; no persisted panel/pipeline → shape reference.**
- `backend/src/main/resources/db/migration/` still tops out at `V72__add_lookup_op.sql` (no new file).
- Backend diff is empty (see above) — no new column anywhere.
- design.md Decision 2 explicitly documents "no migration."

**3. `outputContract.fields` untouched.**
- `grep -rn "outputContract" backend/src/main/scala/` shows only the pre-existing `PipelineShape.scala` /
  `*Shape.scala` / `PipelineShapeProtocol.scala` / `PipelineShapeService.scala` occurrences — none of
  these files appear in `git diff main...HEAD`. `.fields` is never referenced or added.

**4. Shape-seeded steps carry no persisted shape link.**
- `ShapeInstantiateStep.tsx`'s step loop calls `createPipelineStep(pipelineId, expansion.kind,
  expansion.config)` — no `shapeId`/`shapeParams` argument exists in the call or in the (unchanged)
  backend `PipelineStep` model. Confirms the pre-existing HEL-402 constraint holds; this ticket adds
  nothing here.

**5. Binding sets `dataTypeId` only; `fieldMapping` stays unset.**
- Code read: `PanelCreationModal.tsx`'s `handleShapeInstantiateComplete` only calls
  `setSelectedDataTypeId(dataTypeId)`; `fieldMapping` never appears in the shape-instantiate path.
- Live evidence: independently re-ran `e2e/hel399-shape-instantiate.spec.ts` myself
  (`DEV_PORT=5572 npx playwright test e2e/hel399-shape-instantiate.spec.ts` → **1 passed**) — it asserts
  `POST /api/panels` response has `dataTypeId` truthy and `fieldMapping` = `{}` (0 keys). Confirmed
  independently, not taken from the evaluator's claim.

**6. HEL-336 defect-guard: failures are visibly surfaced, never swallowed.**
- Live manual repro (metric → Single row shape, mode=`not-a-real-mode`): submit produced a real
  `422` from `POST /api/pipeline-shapes/single-row/expand` and the modal showed, inline and verbatim:
  *"single-row shape: unknown 'mode' value 'not-a-real-mode'. Valid values: aggregate, filter"* — modal
  stayed open, no silent failure.
- Separately hit a **run**-stage failure live (stale CSV file for a leftover eval data source — an
  environmental artifact of this shared dev sandbox, not a code defect; confirmed root cause via
  `.concertino-backend.log`: `NoSuchFileException: /home/matt/.helio/uploads/csv/...csv`). This too
  surfaced inline (`"Pipeline execution failed"`, the verbatim backend message from
  `PipelineRunService.scala`) with a **"Retry run"** button. Clicking Retry re-issued only `POST
  /api/pipelines/:id/run` (confirmed via network log — expand/create/steps were not repeated), matching
  design.md Decision 5 exactly.
- Re-ran the e2e spec's own 422 assertion independently (see above) — also green.

**7. `ShapeParamsFields`/`buildShapeParams` extraction is behavior-preserving.**
- `ShapePickerModal.test.tsx` passes unmodified — confirmed via my own run of the full relevant test
  slice (`npx jest --testPathPatterns="ShapeParamsFields|ShapeInstantiateStep|DataTypeSelectStep|
  PanelCreationModal|useShapeOffering|panelShapes|ShapePickerModal"` → **8 suites / 101 tests pass**).
- Live click-through of the in-editor HEL-402 "Start from a shape" flow (`/pipelines/:id` →
  "Start from a shape" → Top N): form rendered identically to the pre-refactor widget contract — string
  (`Measure`), string (`Direction`), integer-spinbutton (`N`), string (`Ties policy`) — matching
  `widgetFor`'s dataType→widget mapping now shared via `ShapeParamsFields`. No console errors introduced.

**8. `--no-verify` bypass is justified; independently reproduced every gate.**
- `npm run lint` (root `eslint src --max-warnings=0`, run from `frontend/`) → clean, zero warnings.
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm run check:schemas` (repo root) → "schemas in sync... panel-type enums in sync... (7 surfaces)".
- `npm run check:scala-quality` (repo root) → "clean (64 soft warning(s))" — all pre-existing, none new
  (verified by diffing the warning list against files this branch does not touch — all `backend/src/test`
  files, no frontend).
- `npm run check:openspec` (repo root) → fails with exactly the claimed, expected reason: `change
  "panel-declares-shape-wiring" is complete (15/15) but not archived`. This is pre-archive state, not a
  hidden defect.
- Full frontend Jest suite: **137 suites / 1423 tests pass** (`npx jest --config jest.config.cjs`,
  matches the evaluator's claimed count exactly, reproduced from a cold shell).

**Acceptance criteria traced to evidence:**
- AC1 (shape offering + instantiate-and-bind): live-verified end to end (metric→Single row happy path
  via e2e re-run; table→Pivot/matrix + Top N cards confirmed live in both themes).
- AC2 (panel-type→shape mapping documented): `panelShapes.ts` (`PANEL_TYPE_SHAPES`) + design.md
  Decision 4; live-confirmed metric offers only "Single row", table offers "Pivot / matrix" + "Top N".
- AC3 (persistence decision documented): design.md Decision 2, no migration, verified empty backend diff.
- AC4 (tests): 101 new/changed unit tests + 1 e2e spec, all independently re-run and passing.
- AC5 (backward compatible): `DataTypeSelectStep.tsx` diff shows the shape section only renders when
  `offeredShapes.length > 0 || shapeCatalogError` — for panel types with no mapping (text/markdown/
  collection/timeline) nothing renders; no new backend column, so "nullable" is vacuously satisfied (no
  persistence was added at all, matching Decision 2).

**DESIGN.md spot-check:** `ShapeParamsFields.css`, `ShapeInstantiateStep.css`, and the
`PanelCreationModal.css` shape-card additions use only `--app-*`/`--space-*`/`--text-*`/`--weight-*`
tokens (one exception, `1px solid`, matches the codebase's existing 10-occurrence border-width
convention in the same file — not a token violation). Screenshots of the shape-card offering
(table-type) and the shape-instantiate form (pivot/matrix) confirmed clean in both dark and light theme
— consistent spacing rhythm, typographic hierarchy, and shared-component reuse (`TextField`, `Select`,
`InlineError`) with no hand-rolled controls or hardcoded colors.

### Verdict: CONFIRM

### Non-blocking notes
- Matches the evaluator's own non-blocking note: `PanelCreationModal.tsx` is now 433 lines, past
  CONTRIBUTING.md's soft ~400-line threshold. Worth a follow-up extraction of the shape-selection
  handlers into a small hook, but not blocking (soft budget, not a hard-fail).
- The stale/orphaned CSV file behind the shared dev sandbox's "Netflix" data source
  (`/home/matt/.helio/uploads/csv/292a0786-...csv` missing) is an **environmental** artifact of this
  long-lived multi-run worktree's shared uploads dir, unrelated to this ticket's code — flagging only so
  it isn't mistaken for a regression in a future run against the same worktree.
