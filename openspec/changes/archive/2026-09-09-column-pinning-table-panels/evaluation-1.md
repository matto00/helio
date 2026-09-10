## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `7bbc49d1` on `feature/column-pinning-table-panels/HEL-465`.
Gates re-run independently by the evaluator (not taken from the executor's report).
Phase 3 performed against the running app on `:5897`/`:8804` in **both** themes,
with real horizontal/vertical scroll, real pointer/keyboard, and real backend PATCHes.

### Phase 1: Spec Review — PASS

Issues: none blocking.

- AC1/AC2/AC3/AC4/AC5/AC6 all addressed; none silently reinterpreted. The one
  decision the ticket left open (pin-vs-order interplay) is decided and documented
  (design.md Decision 1, "leading contiguous run") and the shipped behaviour matches it.
- The design-gate correction (persistence on `TableOutputConfig` via `updateOutput`,
  **not** `panel.config`/`panelsSlice.ts`) is what actually shipped — verified against
  the live Output: `config.pinnedColumns` is a flat sibling of
  `columnOrder`/`columnSort`/`columnFilters`/`columnFormats`, never nested.
- Task items: 1.x, 2.x, 3.x, 5.1, 5.2 are checked and match the diff. 4.1–4.4 and
  5.3–5.5 are correctly left unchecked — the plan explicitly assigns them to the
  evaluator/skeptic. I executed them; results in Phase 3.
- No scope creep. The one out-of-plan edit (`elevationTokenGuard.css.test.ts`
  exception pin, and routing the pressed-state colour through `--app-accent-text`)
  is required to satisfy pre-existing guards, correctly disclosed in
  `files-modified.md`, and is the minimum needed.
- Spec deltas (`data-grid`, `table-panel-column-pinning`) match implemented behaviour,
  including the "explicit `[]` on clear" and "preserved by position, not identity" clauses.
- No backend/schema change; `Output.config` is an opaque blob. Correct.

### Phase 2: Code Review — FAIL

**Gates (all re-run by me, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set):**

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 299 suites / 3171 tests, plus helio-mcp 25/248 |
| `npm --prefix frontend run build` | PASS |

No backend files changed → `sbt test` not applicable.

**What is good:** `computePinnedOffsets` is pure, exported, and reuses the exact
`appliedWidth` fallback chain rather than re-deriving it — offsets provably cannot
drift from rendered widths, and I confirmed that live under resize. `pinnedCount`
degrades a non-contiguous input to a prefix instead of rendering a gap. The
count-based (not key-based) pin state is the right call for "preserved by position".
`persistPinnedColumns` genuinely mirrors `persistColumnSort`/`persistColumnFilters`
(same debounce, same `canWrite` gate, same deliberate swallow, unmount flush extended).
Tests are meaningful, not tautological — the `[]`-on-clear and reorder-by-position
assertions would each catch a real regression. Inline `left`/`z-index` is a sanctioned
use of `style={{}}` (genuinely dynamic per-column values, DESIGN.md §1).

Issues:

1. **[BLOCKING] DESIGN.md §5 "Icon-only buttons" — the pin toggle is a hand-rolled
   16×16 `<button>` with no `title` and no touch gate.**
   `frontend/src/shared/ui/DataGrid.tsx:869-888`, `frontend/src/shared/ui/DataGrid.css:218-251`.
   Three distinct violations of a binding standard, all measured on the running app:
   - **Hand-rolled instead of the shared `IconButton` primitive.** DESIGN.md:419-423:
     "Icon-only controls … use the shared `IconButton` primitive
     (`frontend/src/shared/ui/IconButton.tsx`) — **never a hand-rolled
     `<button className="...">` square**." design.md Decision 3 argues icon-button
     *vs. dropdown menu* but never evaluates `IconButton` at all, so the sanctioned
     exception (DESIGN.md:445-449, "a genuine, documented reason `IconButton`'s scale
     can't express") is neither claimed nor documented.
   - **Missing `title`.** Measured `title === null`. DESIGN.md:433-442 is
     **[mechanical]**: a visible tooltip and an accessible name are both the default
     expectation, and the hand-roll exception (DESIGN.md:447-449) says a hand-rolled
     icon control "must still carry **both** `aria-label` and `title`". This is not
     cosmetic here: the enclosing `<th>` already carries `title={col.header ?? col.key}`
     (`DataGrid.tsx:825`), so hovering the pin control currently shows the tooltip
     **"category"** — the column name, i.e. actively misleading about what the control does.
   - **16px control, no 44px expander.** Measured box `16×16`, real
     `elementFromPoint`-bisected hit extent `16.75×16.75`. `--space-4` is `1rem`/16px
     (`theme/theme.css:46`). That is below `IconButton`'s smallest size (`xs` = 24px,
     DESIGN.md:427-428) and carries no `.tap-expand-44`. This is **not** an inherited
     file-wide gap: `DataGrid.css:501-508` already has a `@media (max-width: 430px),
     (pointer: coarse) { … min-height: 44px }` block that HEL-451 added for
     `.ui-data-grid__filter-input` / `.ui-data-grid__filter-toggle-btn` /
     `.ui-data-grid__filter-clear-all-btn`; the new control simply was not added to it.
     Nor is `.ui-data-grid__filter-toggle-btn` a precedent for a hand-rolled *icon-only*
     square — it is a labelled `--control-sm` (28px) button. The sibling resize handle
     spans the full header height (`top: 0; bottom: 0`, `DataGrid.css:255-265`), so it
     is not a precedent either.

2. **[BLOCKING] Side effect inside a `setState` updater.**
   `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:419-431`. The reorder
   effect calls `persistPinnedColumns(...)` (a network PATCH) *inside* the
   `setPinnedCount((prevCount) => { … })` updater. React requires updater functions to
   be pure; `frontend/src/main.tsx:58` wraps the app in `React.StrictMode`, which
   double-invokes updaters in dev, so a reorder fires the PATCH twice. The updater form
   was clearly chosen to read `prevCount` without adding `pinnedCount` to the dependency
   array — a real constraint, but one solvable without breaking purity.
   *Evidence caveat, stated plainly:* I verified the code path and StrictMode's presence
   but could **not** trigger a live reorder to count the duplicate PATCHes — `columnOrder`
   is edited only from the pipelines Output-editor sheet
   (`features/pipelines/ui/outputEditor/OutputEditorSheet.tsx:228,295`), not from the
   panel surface, and a direct API PATCH to seed it returned 403. So the double-fire is
   demonstrated by construction, not measured. The purity violation itself is not in doubt.

3. **[non-blocking] Duplicated leading-run derivation.** `TableRenderer.tsx:99-107`
   (`leadingPinnedCount`) and `DataGrid.tsx:~262-272` (`pinnedCount`) are the same
   walk-the-prefix loop written twice. The doc comments explain *why* the two live in
   different components (`DataGrid` never sees `columnOrder`) and that reasoning is
   sound, but the shared, order-agnostic part — "how many leading entries of
   `columns` are in this key set" — is identical and could be one exported helper.
   Minor DRY, not worth blocking on.

### Phase 3: UI Review — PASS

Servers: `start-servers.sh` READY, `assert-phase.sh servers` → `PASS`.
Surface: an 82-column Table panel (75 rendered columns, `scrollWidth` 12000px).

All of AC1/AC2/AC4 — the criteria jsdom cannot reach — were verified against real
rendered geometry and real scroll, not from CSS text:

- **AC1 (freeze + horizontal scroll):** with one pinned column, `scrollLeft = 3000`
  left the pinned `<td>` at viewport x=297 (== the grid's own left edge) while the
  next column moved to x=-2543. Confirmed.
- **AC2 (cumulative offsets):** three pinned columns computed `left` 0/160/320 and
  held at x=297/457/617 under `scrollLeft = 5000` while column 4 went to x=-4223 —
  no overlap, no gap.
- **AC2 + HEL-253 (resize):** dragging the first pinned column's resize handle
  +100px moved siblings live during the drag (0/260/420) and after mouseup, with
  body-cell offsets matching header offsets exactly.
- **AC4 (separator, both themes):** non-inset trailing shadow present on the
  `--last` pinned header, filter, and body cells in both themes, resolving through
  the theme-aware token — dark `srgb(.949 .937 .914 / .35)`, light
  `srgb(.129 .114 .098 / .35)`. Screenshots taken in both.
- **Doubly-sticky corner cells (Decision 5):** at `scrollLeft=2000, scrollTop=60`,
  `elementFromPoint` at the centre of both the header corner cell and the expanded
  filter-row corner cell resolves to those cells themselves — nothing paints over
  them on either axis. Computed tiers observed exactly as designed: pinned
  header/filter `z-index: 3`, non-pinned sticky header/filter `2`, pinned body `1`,
  ordinary cells `auto`.
- **Decision 6 (panel-surface background):** pinned `<td>` resolves
  `var(--panel-surface-override, var(--app-surface))` to the panel's *actual*
  surface — `rgb(26,24,22)` in dark, `rgb(253,252,250)` in light, matching the card's
  own `--panel-surface-override: rgba(253,252,250,1)`. Not a hardcoded opaque fill.
  (An earlier apparent light-theme failure was my own artifact from flipping
  `data-theme` directly instead of going through `ThemeProvider`; re-tested via the
  app's real theme toggle, it is correct.)
- **AC3 (persistence):** pin state survived a full page reload and a
  panel-detail-modal open→close cycle, restoring 0/160/320 and `aria-pressed="true"`.
- **Decision 6 clear-to-`[]` end-to-end:** unpinning the first pinned column, then
  reloading, left nothing pinned — which the backend shallow merge could not have
  produced from an omitted key. This is the strongest available proof of the
  explicit-`[]` write, verified against the real `mergeConfig`.
- **Keyboard + accessible names:** the control is a real tab stop; `focus()` +
  `Enter` pinned the column and flipped `aria-pressed` false→true. Names are correct
  and consequence-aware: "Pin column category" / "Pin through column company" /
  "Pin through column date" when unpinned, "Unpin column category" when pinned, and
  the neighbour correctly reverts to plain "Pin column company" once one column is pinned.
- **AC6 regression sweep on the same surface:** sort on a *pinned* column works
  (`aria-sort` none→ascending); per-column filter on a pinned column works (200 rows
  → 0 on a no-match term, restored to 200 on clear); resize verified above; per-column
  formatting renders inside pinned cells (the pinned `date` column renders its em-dash
  empty treatment, and the `<td>` render call is byte-identical to `main`); density is
  unreachable from this surface as Decision 7 states.
- **Console:** 0 errors and 0 warnings across a clean reload plus a full
  pin/unpin/re-pin cycle. (Errors visible in the cumulative all-navigations log are
  HMR/`createRoot` artifacts from my own forced-style probing and earlier sessions;
  none recurred in the clean run.)
- **Breakpoints:** 1440 / 1100 / 768 / 375 all render without layout breakage and with
  no page-level horizontal overflow. Note at 375px the two pinned columns (320px) exceed
  the grid's 261px width, so the pinned region fills the panel and nothing scrolls into
  view — a direct consequence of the user's own pin choice, recoverable by unpinning,
  and consistent with how data grids generally behave. Recorded as an observation, not a defect.

Issues: none. (The pin control's size/tooltip problems are recorded once, under
Phase 2 change request 1, rather than double-counted here.)

### Overall: FAIL

The feature itself is correct: every rendered-behaviour criterion the orchestrator
flagged as jsdom-unreachable was verified against the running app and passed, in both
themes, with no regressions. The failure is confined to how the pin *control* is built.

### Change Requests

1. **Route the pin toggle through the shared `IconButton` primitive, and give it a
   `title` and a 44px touch target.** `frontend/src/shared/ui/DataGrid.tsx:869-888`,
   `frontend/src/shared/ui/DataGrid.css:218-251`.
   Preferred fix: replace the hand-rolled `<button className="ui-data-grid__pin-toggle-btn">`
   with `IconButton` (`variant="ghost"`, `size="xs"`, keep the existing `aria-pressed`
   and the existing `aria-label` text verbatim — the naming is correct and should not
   change), and pass a distinct shorter `title` (e.g. `title="Pin"` / `"Unpin"`) so the
   hovered tooltip stops resolving to the enclosing `<th title="category">`.
   If `IconButton`'s scale genuinely cannot work in a dense header row, that is
   permitted by DESIGN.md:445-449 — but then (a) record the reason in design.md
   Decision 3 rather than leaving it undocumented, and (b) the control must still carry
   **both** `aria-label` and `title`.
   Either way, add `.ui-data-grid__pin-toggle-btn` to the existing touch gate at
   `DataGrid.css:501-508` (or apply `.tap-expand-44`) so it reaches 44px on coarse
   pointers, as its filter-row siblings in the same file already do. Current measured
   hit extent is 16.75px.

2. **Move the `persistPinnedColumns` call out of the `setPinnedCount` updater.**
   `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:419-431`. State
   updaters must be pure; under `React.StrictMode` (`frontend/src/main.tsx:58`) this
   one is invoked twice and issues the PATCH twice. Suggested shape: keep a
   `pinnedCountRef` mirrored from `pinnedCount` (or read it via a ref updated in an
   effect), compute `clamped` from the ref at the top of the reorder effect, then call
   `setPinnedCount(clamped)` with a plain value and call `persistPinnedColumns(...)`
   in the effect body — outside any updater. Please also extend the existing reorder
   test (`TableRenderer.test.tsx`, "reordering columns re-derives and re-persists…")
   to assert the call **count**, not just `toHaveBeenCalledWith`, ideally rendering
   under `<React.StrictMode>` so the test can actually fail on a regression here —
   `toHaveBeenCalledWith` passes today whether it fires once or twice.

### Non-blocking Suggestions

- `TableRenderer.tsx:99-107` and `DataGrid.tsx:~262-272` duplicate the same
  leading-prefix walk. Consider exporting one helper from `DataGrid.tsx` and having
  `TableRenderer` call it; the ownership split the comments describe is preserved
  either way, since only the *caller* knows about `columnOrder`.
- The 375px case above (pinned region wider than the grid) may deserve a future
  affordance — e.g. capping the pinned run at some fraction of the container width,
  or surfacing an "unpin all" escape. Out of scope for this ticket; noted for the
  skeptic's judgment.

### Shared-component drift note (HEL-520 lane)

Checked as requested. This diff touches `frontend/src/shared/ui/DataGrid.tsx`/`.css`
and `frontend/src/shared/ui/IconButton.*` **only by not using the latter** — it adds
no shared-component changes of its own, so there is nothing here that would collide
with a concurrent focus-management/keyboard-navigation ticket. One forward-looking
flag: change request 1 asks this ticket to adopt `IconButton`, and it also adds a
third tab stop per column (accepted in design.md Decision 3, "3 stops × N columns …
flagged for the a11y pass"). On a 75-column table that is 225 header tab stops. If
HEL-520 is touching focus order or roving-tabindex behaviour in shared UI, these two
lanes will meet there — worth the orchestrator's attention at merge time, not a
defect in this diff.
