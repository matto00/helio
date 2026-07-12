## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed: `DataGrid` primitive created at `frontend/src/shared/ui/DataGrid.tsx`
  (rows/columns, `variant`, `density`, `emptyText`, default cell formatting, `ColumnDef.render`);
  all five named surfaces migrated (`TypeDetailPanel`, `SourceDetailPanel`,
  `PipelinePreviewModal`, `StepCard`'s step-preview table, `SqlTab`'s schema-preview table,
  `TableRenderer`'s paginated + raw-rows paths); `PreviewTable.tsx`/`.css` deleted; DoD's four
  test categories (empty, full, preview, custom render) all present in `DataGrid.test.tsx` and
  mapped 1:1 to `specs/data-grid/spec.md` scenarios.
- No AC silently reinterpreted. Decision 6 (`PipelinePreviewModal`'s orphaned
  `.preview-table__empty` borrow) and Decision 7 (`TableRenderer` raw-rows → `rows`/`columns`
  conversion) were implemented exactly as specified in design.md, verified against the diff.
- All 16 tasks.md items verified against the diff — each maps to real, matching code changes (no
  task marked done without corresponding diff evidence).
- No scope creep: `openspec/changes` diff is limited to planning artifacts; `frontend/` diff is
  limited to the 5 named surfaces + the `DataGrid` primitive + directly-coupled CSS deletions.
  Minor observation (non-blocking, see suggestions): `InferredFieldsTable.tsx` and
  `StaticSourceForm.tsx` also share the `add-source-modal__fields-table` CSS class family but were
  correctly left untouched — these are editable form-tables (TextField/Select/checkbox per cell),
  analogous to the already-excluded `TypeDetailPanel`/`SourceDetailPanel` editable tables, not
  read-only previews. Reasonable exclusion, though design.md's Planner Notes didn't name them
  explicitly the way it named the other two exclusions.
- No regressions to existing behavior: full Jest suite (851/851) reruns clean; live-verified
  `panel-type-rendering` scenarios (bound/paginated, raw-rows, unbound-skeleton) and
  `pipeline-step-preview` scenario render identically to pre-migration behavior aside from the one
  acknowledged Decision-3 cell-formatting delta.
- No API/schema changes — correctly frontend-only; `check:schemas` clean.
- Planning artifacts reflect final implementation; `files-modified.md`'s deviation note (task 3.4,
  kept `.panel-content__table` instead of deleting) is accurate — verified `TableRenderer.tsx`'s
  retained aria-hidden skeleton still renders `<table className="panel-content__table">`, and the
  CSS rule remains referenced (`PanelContent.css` diff is empty — confirms zero unintended changes
  there).

### Phase 2: Code Review — PASS
Issues: none.

- **CONTRIBUTING.md compliance**: no inline FQNs found (`check:scala-quality` N/A here, frontend
  only); no file exceeds the ~250-line soft budget (`DataGrid.tsx` 105 lines, `TableRenderer.tsx`
  89 lines); imports are all top-of-file; no unrelated refactors — diff is exactly the 5 surfaces +
  primitive.
- **DESIGN.md [mechanical] compliance**: `DataGrid.css` uses only `--app-*`/`--space-*`/`--text-*`
  tokens throughout (`DataGrid.css:1-78` — no hardcoded hex/px for anything a token covers);
  `PipelinePreviewModal.css`'s new `.pipeline-preview-modal__empty` rule actually **improves**
  token discipline vs. the old `.preview-table__empty` it replaces (old rule used a literal `12px`
  margin; new rule uses `var(--space-3)`, verified via `git show 83ee240:.../PreviewTable.css`).
  BEM-ish naming (`ui-data-grid`, `ui-data-grid__table`, `ui-data-grid--preview`) matches the
  existing `shared/ui/` convention (`ui-empty-state`, etc., per design.md Decision 1). No new
  button styles, no hardcoded control heights, no translucent surfaces added.
- **DRY**: `deriveColumns`/`formatCell` in `DataGrid.tsx` correctly centralize logic previously
  duplicated across `PreviewTable.tsx`, `StepCard.tsx`, and `TableRenderer.tsx`.
- **Readable / modular**: `DataGrid.tsx` is a single well-scoped component; `TableRenderer.tsx`'s
  three render paths (paginated/raw/skeleton) remain clearly separated per design.md Decision 7's
  requirement not to collapse them.
- **Type safety**: `SqlTab.tsx`'s `inferredFields as unknown as Record<string, unknown>[]` is a
  justified double-cast (per design.md's documented Risk) — `InferredField` has no index
  signature so a direct cast would fail `tsc`; this is not an unjustified `any` escape hatch.
- **Tests meaningful**: `DataGrid.test.tsx`'s 10 tests map directly to
  `specs/data-grid/spec.md`'s scenarios and would catch real regressions (empty state, column
  derivation/override, variant/density defaulting+override, all three default-formatter branches,
  custom `render`). Existing suites for migrated surfaces needed no edits because they assert on
  role/text, not on the deleted CSS classes — confirmed via grep (no test file references
  `preview-table`/`step-preview-table`/`panel-content__table`/`add-source-modal__fields-table`).
- **No dead code**: re-grepped `frontend/src` for `PreviewTable` and all superseded CSS class
  names post-deletion — zero remaining references outside a code comment and archived
  `openspec/changes/archive/**` history.
- **No over-engineering**: `DataGrid`'s API surface matches exactly what the 5 call sites need; no
  premature density/sorting/virtualization scaffolding added (correctly deferred to later HEL-240
  tickets per non-goals).
- **Behavior-preserving**: `PipelineDetailPage.css` diff removes exactly the superseded
  step-preview-table rules and nothing else (kept `-loading`/`-error`); `PanelContent.css` diff is
  empty (deviation from tasks.md 3.4 correctly reasoned and executed — `.panel-content__table` is
  still consumed by the retained skeleton markup, confirmed via `TableRenderer.tsx:65`).

**Commit hygiene**: commit `df79958` used `git commit -n`. Independently reran all Husky-chain
checks fresh: `npm run lint` (clean), `npm run format:check` (clean), `npm test` (851/851),
`npm run build` (clean), `check:schemas` (clean), `check:scala-quality` (clean, pre-existing
soft-budget warnings only, unrelated to this change). The only failing check is
`check:openspec`'s "complete but not archived" hygiene rule, which is expected at this
pre-archive point in the ticket-delivery pipeline (confirmed by reproducing the exact same
failure independently). The commit body explicitly calls out the bypass and its reasoning, per
CONTRIBUTING.md's AI-collaborator rule. The cited precedent (HEL-293/295/296/297) is real,
confirmed via `git log`.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` (PASS, servers
already healthy). Live-verified via Playwright (logged in as matt@helio.dev), zero console errors
across every flow tested:

- **TypeDetailPanel preview**: `EvalChunkType` (26 rows) renders condensed `DataGrid` with sticky
  header, ellipsis truncation, scroll container. Empty state (`Test` type, no rows) renders
  "No rows have been written to this type yet. Run a pipeline that writes to this type to populate
  it." — exact preserved copy, no table element.
- **SourceDetailPanel preview**: `Regression CSV` source, explicit `headers` → `columns` mapping
  path (`a`, `b` columns) renders correctly after clicking Preview.
  Text/Markdown source correctly shows "Preview is not supported for ..." (pre-existing,
  unaffected by this change).
- **PipelinePreviewModal**: "not yet run" empty state (Decision 6) verified rendering with correct
  muted styling inside the modal (not unstyled/broken) — confirms the new
  `.pipeline-preview-modal__empty` class actually applies. After a Dry run, the modal's
  `DataGrid`-rendered rows (14 rows, wide-column horizontal scroll) render correctly.
- **StepCard step-preview table**: "Split text" step's `Preview data` renders a condensed
  `DataGrid` inline in the step card with real segmented rows.
- **SqlTab schema preview**: live-tested against the local Postgres dev DB (`SELECT id, title,
  type_id, content FROM panels LIMIT 5`) — Nullable column renders mixed "yes"/"no" values via
  `ColumnDef.render`, confirming the boolean → yes/no mapping works with a real mixed-nullability
  result set (not just uniform test data).
- **Table-type panel**: created a new bound table panel (`EvalChunkType`, 26 rows) — paginated-rows
  path renders full-density `DataGrid` inside the panel card with horizontal + vertical scroll.
  create-panel flow requires a data type selection at creation time, so the fully-unbound skeleton
  state wasn't reachable via a fresh panel; instead independently confirmed via
  `PanelContent.test.tsx` tests 2.2 (skeleton path, `.panel-content--table` + inner
  `<table>` present with no `rawRows`/`paginationRows`), 2.3 and 2.4 (raw-rows path, headers-omitted
  positional-fallback case and headers-provided case) — all pass in the fresh `npm test` run,
  exercising exactly the Decision 7 conversion formula.
- **No orphaned CSS**: re-grepped `frontend/src` for `preview-table`, `PreviewTable`,
  `pipeline-detail-page__step-preview-table`, `step-preview-empty` post-deletion — zero remaining
  references. `.panel-content__table` confirmed still used (kept correctly per the tasks.md 3.4
  deviation) — `PanelContent.css` diff is empty, and `TableRenderer.tsx`'s skeleton path still
  renders `<table className="panel-content__table" aria-hidden="true">`.
- **Light/dark parity**: toggled light theme on the dashboard with the new table panel — no
  contrast/token issues, no console errors.
- **Breakpoints**: resized to 1440/1100/768/375 on the pipeline detail page (DataGrid-bearing step
  preview) and the dashboard — zero console errors at any width. At 768/375 the pipeline detail
  page's sidebar does not collapse and causes horizontal overflow, but this is a pre-existing
  app-shell layout behavior untouched by this diff (confirmed: `PipelineDetailPage.tsx`'s layout
  markup and `App.css`'s sidebar rules are not part of this change's diff) — not a regression
  introduced by this ticket.

### Overall: PASS

### Non-blocking Suggestions
- Consider having design.md's Planner Notes explicitly name `InferredFieldsTable.tsx` /
  `StaticSourceForm.tsx` alongside the other two excluded editable-table surfaces, for future-
  evaluator clarity (they share a CSS class family with the migrated `SqlTab` table but are
  editable forms, not read-only previews — correctly out of scope, just not explicitly documented
  as such).
- Design.md Decision 3 asks that the one acknowledged cell-formatting visual delta be called out
  in the PR description — flag this as a reminder for whoever opens the PR (not yet created as of
  this cycle).
