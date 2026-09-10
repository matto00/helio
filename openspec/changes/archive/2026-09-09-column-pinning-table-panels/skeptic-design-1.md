## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All commands run in the worktree at `7b872db9`, against the live tree — not the design doc's claims.

1. **`TablePanelConfig` does not exist anywhere in the codebase.**
   `grep -rn "TablePanelConfig" --include=*.ts --include=*.tsx frontend/src` → **zero matches.**
   `frontend/src/features/panels/types/panel.ts:6-15` documents why: HEL-909 (P1.6) retired the
   "bound trio" (metric/chart/table) panel configs. `columnWidths`/`density`/`columnOrder` "lives
   on the fetched Output itself (`GET /api/outputs/:id`, `outputConfigTypes.ts`), not on the
   placement record." `panelPayloads.ts:3-8` repeats this.

2. **Table column state persists on the Output, not on `panel.config`, and not via `panelsSlice`.**
   `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:175-190` persists via
   `updateOutput(outputId, { config: { columnSort: ... } })` / `{ columnFilters: ... }` from
   `pipelines/services/outputService`. `grep -n "columnWidths\|columnOrder" panelsSlice.ts` →
   **zero matches**; the slice handles title/appearance/text/markdown/image/divider/batch only.

3. **The codebase already prescribes where `pinnedColumns` goes — and names HEL-465 to do it.**
   `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:76-98`, the doc comment
   on `TableOutputConfig.columnSort`:
   > "HEL-451 (columnFilters), **HEL-465 (pinnedColumns)** and HEL-469 (columnFormats) should each
   > land as their OWN flat sibling here too, never nested inside this field or a shared container."

4. **`columnWidths` is local-only React state and is NOT persisted.**
   `TableRenderer.tsx:206-213`: `// Local-only column widths (no longer persisted — see the file's
   HEL-909 interface-parity note...)` / `const [widths, setWidths] = useState<Record<string, number>>({})`.
   `TableOutputConfig` (lines 76-98) has no `columnWidths` field.

5. **`DataGrid.css` contains no `z-index` at all.** `grep -in "z-index\|zindex" DataGrid.css DataGrid.tsx`
   → **NO MATCHES** (re-run twice, case-insensitive, whole files, per evidence discipline). Today's
   header/filter-row layering is pure DOM order; the filter row's `top` is an inline measured value
   (`columnsRowTop`, `DataGrid.tsx:392`, `:782`), not a z-index scale.

6. **`DataGrid` has no `columnOrder` prop.** `grep -in "columnorder" DataGrid.tsx` → **NO MATCHES**
   (re-run). Ordering is applied by the caller: `TableRenderer.tsx:95-100` `orderedColumns(naturalKeys,
   columnOrder)` feeds pre-ordered `columns` into `<DataGrid>` (`TableRenderer.tsx:509-521`).

7. **`density` is never passed to the panel-surface `DataGrid`.** `TableRenderer.tsx:509-521` passes
   no `density`. `grep -rn "density=" --include=*.tsx` → only `OutputKindFields.tsx:151`, two test
   files, and `TableDisplayFields.test.tsx`. Panel tables always render at `DEFAULT_DENSITY.full`.

8. **`tbody td` has no background.** `DataGrid.css:197-204` sets border/color/truncation only; the
   opaque background lives on the scroll container (`.ui-data-grid`, `:77 background: var(--app-surface)`)
   and on `thead th` (`:144 background: var(--app-surface-soft)`).

9. **Backend `mergeConfig` is a shallow merge.** `backend/.../OutputService.scala:274-282`:
   `existing.fields ++ patch.fields`, deep-merging only `mergeableSubObjects` (the four chart keys).
   An omitted key leaves the stale persisted value intact — the exact trap `outputConfigTypes.ts:94-98`
   flags for `columnFormats` ("A clear MUST write `{}`, never omit the key").

10. **Verified-correct design claims** (not everything is wrong): the `<th>` composition in
    Decision 2 is accurate (`DataGrid.tsx:724-768` — sort `<button>` wrapping the label, resize
    handle as a separate `role="separator"` `tabIndex={0}` span, no per-column dropdown anywhere);
    the `appliedWidth` fallback chain in Decision 3 is real (`DataGrid.tsx:703-707`,
    `liveWidths ?? columnWidths ?? col.width ?? DEFAULT_COLUMN_WIDTH`, `DEFAULT_COLUMN_WIDTH = 160`
    at `:57`); the scroll-edge inset shadow token in Decision 5 is real (`DataGrid.css:56-65`); the
    jsdom scoping of AC6-vs-Playwright is correctly reasoned; Decision 1's leading-run argument is
    coherent and well-justified on its merits.

### Verdict: REFUTE

Decision 1 (the ticket's explicitly-open question) is sound and I would confirm it as written. But
the persistence half of the plan targets a type and a module that do not exist, contradicts an
in-code directive that names this exact ticket, and rests on a `columnWidths` persistence that was
deleted by HEL-909. That is not a nit — Task Group 1 as written is unimplementable.

### Change Requests

1. **Retarget persistence from `TablePanelConfig`/`panelsSlice` to `TableOutputConfig`/`updateOutput`.**
   `TablePanelConfig` does not exist (Evidence 1); `panelsSlice.ts` has no column-config path
   (Evidence 2). Per `outputConfigTypes.ts:92-94`, `pinnedColumns` must land as its **own flat
   sibling** on `TableOutputConfig` — never nested in `columnSort` or a shared container. Rewrite
   proposal.md ("Impact"), design.md ("Context"/Decision 3), tasks 1.1/1.2/3.3, and the
   `table-panel-column-pinning` spec requirement "Pinned-column set persists on panel config"
   (retitle — it is Output config, not panel config). The persistence idiom to mirror is
   `persistColumnSort`/`persistColumnFilters` (`TableRenderer.tsx:175-190`) with its
   flush-on-unmount debounce (`:333-368`) and its **deliberate silent-swallow** of write failures
   (`:167-172`) and `canWrite` pre-check (`:214-218`) — not the `columnWidths`/`columnOrder`
   debounced-PATCH idiom the plan currently names, which no longer exists.

2. **Resolve the `columnWidths`-is-not-persisted contradiction in Decision 3 + AC2/AC3.**
   Decision 3 computes offsets from `columnWidths`, and AC3 requires pin state to survive reload —
   but column widths are local-only (Evidence 4), so after a reload pins restore while widths reset
   to `DEFAULT_COLUMN_WIDTH`. Design must state explicitly that persisted-pin offsets are computed
   against default widths on a fresh load and that this is accepted (it is defensible), or scope in
   width persistence. Silence here will surface as an AC2/AC3 dispute at the final gate.

3. **Remove the fabricated z-index precedent from Decision 4 and specify the scale from scratch.**
   `DataGrid.css` has zero `z-index` declarations (Evidence 5); "the filter row already layers under
   the header row" is false — that is DOM order plus a measured inline `top`. Decision 4 must
   introduce an explicit z-index scale as *new* work, state the concrete values, and account for the
   filter row as a **fourth** layer (pinned filter-row `<th>` cells are also doubly-sticky, exactly
   like the header corner cell — the current 4-level list omits them entirely).

4. **Add pinned-cell opaque backgrounds to the design.** `tbody td` is transparent (Evidence 8), so
   sticky-left body cells will show scrolling content bleeding through beneath them regardless of
   z-index. Name the token (`--app-surface`, matching the scroll container at `DataGrid.css:77`) and
   cover both themes. This is the single most likely visual defect in the change and no task covers it.

5. **Fix the ownership split between leading-run derivation and offset computation.** `DataGrid` has
   no `columnOrder` prop and receives pre-ordered `columns` (Evidence 6), so Decision 3's "straight
   prefix-sum over `columnOrder`" cannot happen inside `DataGrid`. State that `DataGrid` takes
   `pinnedColumns` as a prefix of the `columns` array it is already given, and that leading-run
   derivation/re-derivation on reorder lives in `TableRenderer` (task 1.3) against
   `TableOutputConfig.columnOrder`. Tasks 2.1/2.2 currently imply otherwise.

6. **Specify the clear-must-write-`[]` rule for unpinning to empty.** `mergeConfig` is shallow
   (Evidence 9) and an omitted key leaves the stale value — and under Decision 1, unpinning the
   first column empties the whole set, making clear-to-empty a *primary* path, not an edge case.
   Design must require writing `[]` (or `null`, consistently with `columnFilters`' normalize-to-null)
   and never omitting the key; add a Jest assertion for it under task 5.2.

7. **Correct the density claims.** `density` is never passed to the panel-surface `DataGrid`
   (Evidence 7), so panel tables are always `DEFAULT_DENSITY.full`. AC2's "across densities",
   Decision 3's density-recompute assertion, task 4.4, and task 5.1's density parameter are all
   testing a dimension unreachable from the Table panel. Either state that the offset function is
   density-parameterised for the `OutputKindFields` surface while the panel surface is fixed-density
   (and keep the Jest case as unit-level coverage only), or drop the density claims. As written,
   task 4.4 cannot be executed against the panel.

8. **Reconcile Decision 5's "inset shadow on the trailing edge".** The cited precedent
   (`DataGrid.css:56-65`) puts an `inset` shadow on the *scroll container*, where inset is correct.
   An `inset` shadow on the last pinned `<td>` paints inside that cell, not as a boundary against the
   scrolling region. Specify the actual declaration (a non-inset trailing shadow, or a right border)
   while reusing the `color-mix(in srgb, var(--app-text) 35%, transparent)` token as intended.

### Non-blocking notes

- Decision 1 is genuinely well-argued — the two-independent-orderings rejection is the right call,
  and the "Pin through <column>" accessible-name consequence is a good catch. Keep it verbatim.
- Decision 2's read of the existing `<th>` is accurate; adding a third tab stop per column is
  consistent with the resize handle. Consider noting the tab-order cost (3 stops × N columns) for
  the a11y pass.
- The ticket's premise-validation note corrected the `panelsSlice.ts` *path* but never checked its
  *contents* — worth recording as an instance of the "validate premise before building" trap.
