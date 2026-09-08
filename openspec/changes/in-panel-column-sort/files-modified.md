# Files modified — HEL-448 In-panel column sort

- `frontend/src/shared/ui/DataGrid.tsx` — `full`-variant sortable header, reusing `SortableTh`'s
  exact glyph set / `aria-sort` vocabulary / `.sortable-th__btn`/`.sortable-th__glyph` classes as an
  inline `<button>` (design D4: `SortableTh` itself can't be rendered directly — its `children` sit
  inside the `<button>`, which would swallow the resize `<span>`, and it exposes no `style` prop for
  the `appliedWidth` mechanism). Also exports `formatCell` (reused by `TableRenderer`'s `getValue`
  adapter) and imports `SortableTh.css` so the shared classes are guaranteed present even if no
  `SortableTh` happens to be mounted elsewhere on the page.
- `frontend/src/shared/ui/DataGrid.test.tsx` — new `describe("DataGrid — sortable headers (HEL-448)")`
  block: variant/`onSort`-presence gating, `aria-sort` values, click activation, native
  Enter/Space via the real `<button>`, resize/sort non-interference, shared-class reuse.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — full rewrite per design D6a: one
  pre-branch normalization (`usingPagination`/`usingRaw` → `naturalKeys`/`columns`/`normalizedRows`)
  feeding one `useSortedRows` call; the `getSortValue` D3 boundary adapter; the `UNSORTED_SENTINEL`
  (D2); the D7 owner-vs-current-user pre-check (`canWrite`); the D6 debounced, activation-only,
  flush-on-unmount persist (`handleSort`); the D9a truncation qualifier. Renamed the `panelId` prop
  to `outputId` (task 3.2) and added `ownerId`/`columnSort` props.
- `frontend/src/features/panels/ui/renderers/TableRenderer.css` — `.panel-content__load-more` to a
  column flex layout plus the new `.panel-content__truncation-note` rule (D9a), reusing the existing
  load-more button's type scale/token treatment.
- `frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx` — renamed existing `panelId`
  props to `outputId`; added `describe("TableRenderer — sort (HEL-448)")` (2.5a/2.5b proof tests,
  whole-loaded-set + merge-on-load-more, the D2 sentinel regression guard, the D6/3.3a/3.3b/3.4/3.4a
  persistence guards, D7 non-writable-Output guard, seeded-`columnSort` round trip, no-controls on
  the empty skeleton) and `describe("TableRenderer — truncation qualifier (HEL-448 D9a)")`.
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` — `TableOutputConfig` gains
  `columnSort?: SortState<string> | null` (design D5, named to avoid colliding with
  `TimelineOutputConfig.sort`), the flat-sibling-extension-point comment for HEL-451/465/469, and
  `readTableConfig`'s tolerant `readColumnSort` parse.
- `frontend/src/features/panels/ui/PanelContent.tsx` — passes `outputId`/`ownerId`/`columnSort`
  through to `TableRenderer` (previously `panelId={outputId}` only).
- `frontend/src/shared/ui/index.ts` — exports `formatCell` alongside `DataGrid`.
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.test.ts` — NEW (cycle 2, CR1):
  real coverage of `readTableConfig`'s `columnSort` parse — round-trip, absent-field default,
  unknown-column key parses fine (rendering source order is `useSortedRows`'/`TableRenderer`'s job,
  not the parse's), and every malformed shape (missing/non-string `key`, invalid/missing
  `direction`, non-object, `null`, array) degrading to `undefined` rather than throwing.
- `frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx` — (cycle 2, CR1) relabeled the
  seeding test from "3.1/3.6" to "3.1 (seeding)" now that 3.6's parse coverage lives in
  `outputConfigTypes.test.ts` against the real `readTableConfig`, not this component test (which
  only ever exercised the seeding half via a hand-built prop). (Final-gate cycle 1, CR1) added a
  mutation-failable regression guard: a rejected `updateOutput` (e.g. a legacy Output's 400)
  produces no unhandled promise rejection and leaves the on-screen sort undisturbed.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — (final-gate cycle 1, CR1) both
  `updateOutput` call sites (the debounced persist and the unmount-flush) now route through a new
  `persistColumnSort` helper that attaches a `.catch`, so a rejected config write (a legacy Output's
  merged-config-validation 400, or a stale-ownership 403) can never surface as an unhandled
  rejection. The swallow is deliberate and commented as such — design D7 mandates silent
  session-local degradation on a failed/unavailable persist, not a toast or error surface.
- `openspec/changes/in-panel-column-sort/tasks.md` — all 37 tasks checked off.
- `.concertino/runs/HEL-448/evidence/screenshots/*.png` — UI-cohesion evidence (task 5, 3b.6):
  dashboard-dark-post.png / dashboard-light-post.png (full page, small dashboard-grid panel with
  the sort affordance + D9a qualifier + Load more all visible together); panel-card-dark-post.png /
  panel-card-light-post.png (cropped to the panel card, scrolled to the truncation boundary at
  h=6/w=6 — the tightest, most truncation-prone grid size); list-table-sort-dark.png /
  list-table-sort-light.png (cycle 2, CR2) — the `/pipelines` list-table's `SortableTh` header (one
  column active/sorted, the rest neutral) saved for the cohesion comparison the evaluator's own
  capture was lost after review.
