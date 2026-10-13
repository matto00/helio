## Context

Base: origin/main f63ab8365. Paths are under `frontend/src/` unless absolute. Evidence:
`.concertino/runs/HEL-1449/evidence/premise-validation.md`. Owner ruling for item 4 (2026-10-13, chat, recorded as
`escalation.answered` `scroll-hint`): add a vertical axis to `useScrollEdges`, show a top/bottom fade on the edit form,
update `elevationTokenGuard.css.test.ts`.

- `features/panels/ui/renderers/TableRenderer.tsx` (903 lines): imports L1-29, `TableRendererProps` L31-121, pure
  helpers L123-241 (`sortFilterDisabledReason`, collator, `deriveKeys`, `leadingPinnedCount`, `orderedColumns`,
  `UNSORTED_SENTINEL`, `getSortValue`), persistence L243-282 (`PERSIST_DEBOUNCE_MS`, three `persist*` fns calling
  `updateOutput`), `TableRenderer` L284-903. Only `TableRenderer` is exported; importers are `OutputPanelContent.tsx`,
  `pipelines/ui/outputHistory/HistoryRows.tsx` and four test files (by `./TableRenderer`). Tests `jest.mock` the
  `outputService` module by path, which still applies when the importer moves.
- Host hook runs: L310 `useState(widths)`, L319 `useAppSelector`, L322-468 (comment L322-336) row/column/filter/sort
  derivation ending in `useSortedRows`, L470-603 persist-timer refs + pin state + its two effects + the unmount flush
  effect (`[outputId]`, ends L603), handlers L605-694 (`handleSort` doc comment L605-611, `handleSort` L612,
  `handleFilterChange`, `handleClearFilters`, `handlePinToggle` closing `}` at L694), render L696-903 with three
  `useMemo` at L787-801. Two `eslint-disable-next-line react-hooks/exhaustive-deps` (L448, L577) move verbatim with
  their blocks.
- `shared/ui/useScrollEdges.ts` is horizontal-only (`left`/`right`/`overflowing`); consumers `DataGrid.tsx:520` and
  `SortableTable.tsx:82` read only those three fields. The edit form `.panel-detail-modal__content`
  (`detailModal/PanelDetailModal.binding.css:1`, `overflow-y: auto`) is the scroll container inside a fixed-height modal
  (`PanelDetailModal.css:8`, `min(680px, 90vh)`).
- `theme/elevationTokenGuard.css.test.ts` pins every inset scroll-fade `box-shadow` by exact file, text and count;
  DESIGN.md §(shadow) says the insets exist "in four distinct values across DataGrid/list tables/ConnectorsPage".

## Goals / Non-Goals
**Goals:** the five items of ticket.md AC1-AC5. **Non-Goals:** any behaviour change in the TableRenderer split; the
`act()` warnings; HEL-1440 item 3; files in the open merge-train PRs (none overlap, premise-validation.md).

## Decisions

**D1 — TableRenderer split (Commit 1, pure move).** New siblings in `renderers/`, bodies verbatim:
- (a) `tableRendererProps.ts`: L31-121; only `interface` gains `export `. Host imports it with `import type`.
- (b) `tableRendererModel.ts`: L123-241; a moved top-level declaration gains `export ` only if another module (host or a
  new hook) imports it; nothing else changes.
- (c) `tableRendererPersistence.ts`: L243-282 with the `updateOutput` import; same `export ` rule.
- (d) `useTableRows.ts`: `export function useTableRows(params)` whose body is L322-468 verbatim (the D6a/D10 doc comment
  L322-336 moves with the code it documents) plus a trailing `return { … }` of every identifier the host still reads.
  Called in its original slot, right after L320.
- (e) `useTablePersistedState.ts`: body L470-694 verbatim (sort/filter refs, pin state and both pin effects, the unmount
  flush effect ending L603, then the four handlers L605-694 with their doc comments), plus `return { … }` of what the
  host reads (`handleSort`, `handleFilterChange`, `handleClearFilters`, `handlePinToggle`, `pinnedKeys`, …). Called
  right after (d). Moving the flush effect WITH the refs it reads is required: HEL-1399 D2d's rule (no verbatim host
  code may keep a deps array omitting an identifier the host now receives from a hook) applies, and lint runs with
  `--max-warnings=0`. Moving the handlers too is behaviour-preserving: they are plain closures recreated every render
  exactly as before, now created inside the hook call at the same point of the same render.
- Size estimate (skeptic-design-1 CR3): removing a-c plus d (L322-468) and e (L470-694) leaves ~297 base lines; imports,
  two call sites and destructures add ~45, so the host lands near 340. New files: props ~95, model ~125, persistence
  ~45, `useTableRows` ~150, `useTablePersistedState` ~250.
- Parameters of (d)/(e) are named exactly as the identifiers their bodies use, so moved bodies need zero token changes.
- (f) Fallback only if any file is still ≥ 400 lines after (a)-(e): move the `emptyAction` JSX (L752-783) into a plain
  function `renderFilterEmptyAction({ … })` called in place (no component, so no tree layer). If still ≥ 400, stop and
  report; do not invent another seam.
- Rejected: extracting `DataGrid`/skeleton JSX as components (adds a tree layer); a barrel re-export.
- Every touched/new source file < 400 lines. Hook order unchanged by construction (each hook wraps a contiguous run in
  its original slot). `./TableRenderer.css` import stays in the host.

**D2 — Proofs for D1.** (i) Byte-identity: for every moved range and every host remnant, compare `git show
f63ab8365:<file> | sed -n 'a,bp'` with the new location, whitespace stripped (`tr -d '[:space:]'`) and permitted
additions stripped (import lines, `export ` prefixes, hook signatures + `return { … }`, the two call-site destructures,
D1f's argument list). Partition of base f63ab8365 (boundaries checked with `sed -n`): host L1-30 (imports, compared
after stripping import lines), a L31-122, b L123-242, c L243-283, host L284-321, d L322-468, host L469, e L470-694, host
L695-903 (blank separator lines belong to the block they close). The proof script asserts MECHANICALLY that these ranges
are sorted, non-overlapping and contiguous over 1..903 (an off-by-one fails the proof), and that each moved block's
first and last non-blank base lines appear, in order, in its new file. Record char counts + sha256 per block; any
non-identical block is a defect.
(ii) Hook-sequence transcript: base L284-903 vs branch host with (d)/(e) inlined; lists MUST be equal.
(iii) `npx tsc --noEmit --noUnusedLocals -p tsconfig.json` filtered to touched/new files: zero hits (lint has no
  unused-import rule). (iv) All four TableRenderer suites + `OutputPanelContent`/`HistoryRows`/`PanelCard*` suites pass
  with zero test-file edits. Transcripts persisted as evidence.

**D3 — Stale pointers (Commit 2, comment and reference-table text only).**
- Run `git grep -nE -e "PanelContent\.tsx|PanelDetailModal\.tsx|TableRenderer\.tsx:[0-9]"
  -e "components/(PanelDetailModal|DashboardAppearanceEditor|DashboardList)" -- frontend/src openspec/specs`, plus the
  "above"/"below" pointers the D1 move sent across files (e.g. base L335, L445, L497), and classify every hit `fixed` /
  `still-correct` (historical provenance stays) / `out-of-scope`. Known stale: `PanelCard.filterEmptyState.test.tsx:5`
  (`PanelContent.tsx:372`), `TableRenderer.test.tsx:1028` (production caller is `OutputPanelContent.tsx`), the HEL-909
  comment near `PanelContent.test.tsx:320-326` (re-derive what is stale), `ChartRenderer.tsx:14` (static importer is
  `ChartOutputPanel.tsx`), `PanelContent.css:238-239` (Spinner lives only in `TableRenderer.tsx`), and the
  "`PanelContent` withholds this component behind a skeleton" comments moved by D1 (that is `OutputPanelContent`).
- `openspec/specs/write-path-audit/spec.md` `### Source Locations` (non-normative reference table, outside every
  Requirement): re-point all 7 dead paths to their current files, each verified by `test -e`. A row whose target no
  longer exists in any form is removed and named in the report. Each row's Role text is re-checked against the new file
  and corrected if stale.
- Exit: the same grep restricted to the classified-stale strings returns zero hits, and a loop over every
  `frontend/src/...` path in that spec file prints no MISSING; both transcripts persisted.

**D4 — Test mock (Commit 3, the only test-body edit).** In `PanelDetailModal.chartTypeDefault.test.tsx` add
`getFilterCapabilities: jest.fn(() => Promise.resolve({ columns: [] }))` (the shape `OutputControlsEditor.tsx:56` reads)
to the `outputService` mock. Evidence: AggregateError/ECONNREFUSED console-error count before (expect 2) and after
(expect 0), no new `act()` warning beyond the 2 pre-existing ones, suite green, and a mutation (restore a `chartType:
"line"` default in `panelDetailChartState.ts`) red then reverted.

**D5 — Vertical scroll hint (Commit 4, owner ruling `scroll-hint`).**
- `useScrollEdges`: additive only. `ScrollEdgeState` gains `top`, `bottom`, `overflowingY`, computed in the same
  `measure` from `scrollTop`/`scrollHeight`/`clientHeight` with the same `> 1` tolerance. Existing fields keep their
  exact meaning (`overflowing` stays horizontal; doc comment says so). `measure` already sets a fresh object on every
  call, so render counts for existing consumers do not change. No signature change, no ref-type change (`useVirtualRows`
  reads the same `RefObject`).
- Mount timing (skeptic-design-1 CR2): the hook attaches listeners/ResizeObserver once, when its caller mounts. The edit
  `<form>` renders only when `modalMode !== "view"`, and `initialMode` defaults to `"view"` (`PanelDetailModal.tsx:40`;
  mobile never passes it), so a host-level hook call would never attach after view→Edit, the E key, every mobile open,
  or Save/Cancel→edit. Fix: a new component `detailModal/EditFormScrollArea.tsx` that owns the hook and renders the
  scroll area; it mounts and unmounts WITH the form, so the hook's mount-time setup always sees the real element. This
  adds one component layer inside the modal's edit branch only (C2 governs TableRenderer, not the modal); the form keeps
  its `id`, `className`, `onSubmit` and children unchanged.
- Content height changes: adding/removing a control or expanding a section resizes a direct child of the form (e.g. the
  `OutputControlsEditor` root), which the hook's existing child `ResizeObserver` already catches. A direct panel switch
  REMOUNTS the modal (both call sites key it by `panel.id`; `PanelDetailModal.panelSwitch.test.tsx:10`), so it
  re-measures on mount. The executor still verifies each case live; a stale case is fixed inside the hook with a
  red-first unit test.
- Rendering (skeptic-design-1 CR4): an inset shadow on the scroll container paints UNDER its children, and the Controls
  rows have an opaque `background: var(--app-surface)` (`OutputControlsEditor.css:26`) exactly at the bottom edge. So
  the fade is drawn on a separate overlay: `EditFormScrollArea` renders a `position: relative` wrapper (`flex: 1;
  min-height: 0; display: flex; flex-direction: column` so the form keeps today's `flex: 1` box) containing the `<form>`
  and an `aria-hidden` overlay `<div>` (`position: absolute; inset: 0; pointer-events: none; z-index: 1`) carrying
  `--scroll-top` / `--scroll-bottom` modifier classes from `edges.top`/`edges.bottom`. The overlay holds the inset
  fades, so they paint above the form's children: `inset 0 12px 12px -12px color-mix(in srgb, var(--app-text) 35%,
  transparent)` (top), `inset 0 -12px 12px -12px …` (bottom), and the combined form. Tokens only; `--app-text` makes it
  darken in light and lighten in dark.
- Visible means: with the form scrolled to the top over a Controls row at the bottom edge, a crop of the bottom 12px
  differs measurably from the same crop with the overlay class removed (record mean pixel delta), in both themes; and
  the overlay never blocks a click (click an Add control button under the fade).
- Non-overflowing layout is pixel-identical before/after (text panel edit form at 1440×900, both themes).
- `elevationTokenGuard.css.test.ts`: pin each new declaration (file, exact text, count, note). DESIGN.md's shadow
  paragraph is reworded for the three new vertical values (top, bottom, combined) on the edit-form overlay. If the fades
  live in a NEW CSS file, the guard's CSS-file count assertion is updated too (prefer the existing detail-modal
  stylesheet). `PanelDetailModal.mobile.css` is checked for a conflicting rule.
- Tests: `useScrollEdges.test.tsx` covers top/bottom/overflowingY (red before 4.1). A PanelDetailModal test STARTS IN
  VIEW MODE, stubs the scroll measurements (prototype getters) BEFORE toggling to edit, and asserts the bottom modifier
  class; it must be red against a mutation that calls the hook in the host instead of `EditFormScrollArea`. Live (4.3):
  desktop view→Edit, the E key, a mobile-width (390×844) open then Edit, add a control, a Controls section that finishes
  loading after the form opens, resize; before/after screenshots at 1440×900 and 1280×720, light and dark, output panel
  (0 and ≥ 3 controls) and a text panel, scrolled top and bottom.

**D6 — Dev-DB residue (no commit).** Using `e2e/support/db.cjs` (never printing or sourcing `backend/.env`): SELECT
existence for the 5 exact (id, email) pairs (ids/emails from the HEL-1399 evidence files named in
premise-validation.md); run `buildUserDeleteSql` over exactly the present ones; re-SELECT and record zero rows. Dev DB
only. The executor's own throwaway users (D5 live check) are deleted the same way.

## Risks / Trade-offs
- [`useScrollEdges` is shared] → additive fields only; DataGrid/SortableTable suites pass untouched. [Merge train] →
  origin/main merged in before the auditor; overlap re-checked then.

## Planner Notes

- Self-approved: module names/locations (all in `renderers/`, next to the host); D1f as the only fallback seam.
- Self-approved: all 7 dead write-path-audit rows (same defect, same table). Owner-ruled: D5 (`scroll-hint`); its
  12px/35% values mirror the existing family (self-approved).
