# Evaluation Report — HEL-180 — Cycle 1

## Verdict: PASS

---

## Acceptance Criteria Assessment

| Criterion | Status |
|---|---|
| `/pipelines/:id` route renders the detail page | PASS |
| Source selector bar loads from `GET /api/data-sources` | PASS |
| River view with ribbon SVG and step cards renders | PASS |
| Empty state shown when no steps | PASS |
| Steps can be added and removed (local state) | PASS |
| Footer bar with editable output name and Run button | PASS |
| Run button shows placeholder message | PASS |
| All listed tests pass | PASS |
| `/pipelines/:id` is inside `ProtectedRoute` | PASS |

---

## Test Results

- **PipelineDetailPage suite**: 8/8 tests pass
- **Full suite**: 400/400 tests pass, 39/39 suites pass
- **Lint**: 0 warnings (zero-warnings policy satisfied)

---

## Implementation Review

### Route & Navigation
- Route registered in `App.tsx:281` inside `ProtectedRoute` → `AppShell` — correct nesting.
- `PipelinesPage` navigates to `/pipelines/:id` via `<Link>` on each pipeline row.
- `PipelineDetailPage` renders a back breadcrumb (`← Data Pipelines / {name}`) as a `<nav aria-label="Breadcrumb">` at the bottom of the page.

### Source Selector Bar
- Fetches via `fetchSources` thunk (real `GET /api/data-sources`). Correctly guards with `status === "idle"` to avoid redundant fetches.
- Each source renders a split chip: toggle button (aria-pressed) + preview button. Preview expands a mock data table. The "+ Connect source" dashed button is present.

### River View
- Empty state ("Add your first transformation step") and add-step button are correct.
- `RibbonSegment` is a static decorative SVG with 4 bezier bands — matches ticket spec ("fixed decorative ribbon is acceptable").
- `StepCard` accordion: collapsed shows icon/label/rowCount/chevron; expanded shows config description, column diff chips (added/removed/changed), "Preview data" + "Remove step" actions. Expand state is local.
- `OpDropdown` renders all 6 op types from spec; closes on outside click.

### Footer Bar
- "OUTPUT" label, editable output name (button → input on click, autoFocus), 3 inferred schema chips, italic "inferred" label.
- Right side: step count, "Preview" ghost button, "Run pipeline ▶" CTA.
- `handleRunPipeline` calls `window.alert("Pipeline execution coming soon")` — matches placeholder spec.
- CSS uses `boxShadow` glow on run button (`0 0 16px rgba(249,115,22,0.3)`) as specified.

### Correctness of Tests
All 8 required test cases from the ticket are implemented and pass:
1. Route renders `PipelineDetailPage`
2. Back navigation link renders pointing to `/pipelines`
3. Source selector renders sources from store
4. Empty step state shows correct text
5. Adding a step adds a card and removes empty state
6. Removing a step removes its card and restores empty state
7. Output name field is editable (input appears on click)
8. Run pipeline click triggers placeholder alert

---

## Non-Blocking Suggestions

1. **Back nav placement** (`PipelineDetailPage.tsx:438`): The `<nav>` breadcrumb is rendered after the footer in the DOM, which may appear visually at the bottom of the page depending on CSS flex ordering. The design context specified the breadcrumb in the command bar or at the top. This is a UX/visual concern but not a functional defect — the test only checks for presence of a link to `/pipelines`, which passes.

2. **`stepCounter` module-level mutable** (`PipelineDetailPage.tsx:36`): The `stepCounter` is a module-level variable, so it persists across component mounts in tests. This is benign in production but could create ordering surprises in tests if step IDs were asserted. Not a functional issue given current test coverage.

3. **`makeStep` uses `Math.random()`** (`PipelineDetailPage.tsx:43`): Row counts are non-deterministic. Fine for a visual stub but worth noting if row count is ever tested.

4. **Source preview shows only when `previewing && active`** (`PipelineDetailPage.tsx:250`): If a chip is toggled inactive while previewing, the preview is hidden. This is reasonable UX behavior and matches the design ("When active, expands an inline data preview table").
