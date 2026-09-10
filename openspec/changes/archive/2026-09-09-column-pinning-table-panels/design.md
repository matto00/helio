## Context

**Corrected after skeptic design-gate round 1 (REFUTE) — see `skeptic-design-1.md`.** The initial
draft targeted a `TablePanelConfig`/`panelsSlice.ts` persistence path that does not exist:
HEL-909 retired the bound `metric`/`chart`/`table` panel configs entirely. Table column state
(`columnOrder`, `columnSort` (HEL-448), `columnFilters` (HEL-451), `columnFormats` (HEL-469))
lives on the fetched **Output**, not the panel placement record —
`TableOutputConfig` in `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts`,
persisted via `updateOutput(outputId, { config: {...} })` from `TableRenderer.tsx`. That file's
own doc comment on `columnSort` already names this exact ticket:

> "HEL-451 (columnFilters), HEL-465 (pinnedColumns) and HEL-469 (columnFormats) should each land
> as their OWN flat sibling here too, never nested inside this field or a shared container."

This design now follows that directive. `DataGrid.tsx` (`full` variant) already renders a
`<thead>` with two sticky rows stacked vertically: a `position: sticky; top: 0` header row, and,
when filtering is expanded, a sticky filter-input row below it (`columnsRowTop`, a measured
inline `top`, not a z-index scale — `DataGrid.css` has **zero** `z-index` declarations today).
This change adds a second, independent sticky axis: `position: sticky; left: <offset>` on
selected leading columns, so a pinned column's header cell — and, when the filter row is
expanded, its filter-input cell — are sticky on **both** axes simultaneously. `DataGrid` itself
receives pre-ordered `columns` from its caller (`TableRenderer.tsx`'s `orderedColumns()`) and has
no `columnOrder` prop of its own; the leading-run derivation described below therefore happens in
`TableRenderer`, not inside `DataGrid`.

`columnWidths` (HEL-253) is session-local `useState` in `TableRenderer.tsx` — **not persisted**
(HEL-909 removed its persistence; see Decision 2 below). `columnOrder` (HEL-255) *is* persisted,
on `TableOutputConfig`. HEL-448 (sort), HEL-451 (filter), HEL-469 (formatting) have all landed
since this ticket was filed and share the same `<th>`/`<td>` markup this change touches; none of
them render anything sticky on the horizontal axis today, so there is no existing left-sticky
code to reconcile with — this is new interplay, not a merge conflict. `density` is never passed
from `TableRenderer.tsx` to the panel-surface `DataGrid`, so panel tables always render at the
default `full` density; density-parameterised offset math is real but only reachable today via
`OutputKindFields.tsx`'s preview surface, not the Table panel itself.

## Goals / Non-Goals

**Goals:**
- Freeze a leading, contiguous run of columns to the left edge of the `full`-variant `DataGrid`
  while the remaining columns scroll horizontally beneath them.
- Keep offset computation correct under column resize (HEL-253, session-local) and reorder
  (HEL-255, persisted).
- Persist pin state per-Output (`TableOutputConfig.pinnedColumns`), surviving modal close/reopen
  and reload.
- Coexist with sort (HEL-448), filter (HEL-451), and per-column formatting (HEL-469) with no
  regression to any of them (AC6).

**Non-Goals:**
- Right-edge pinning.
- Pinning on the `preview` variant (no horizontal scroll container exists there today; out of
  ticket scope).
- Changing `columnOrder`'s own semantics — pinning only reads order, never writes it.
- Persisting `columnWidths` (out of scope; accepted consequence documented in Decision 2).
- Density-parameterised behavior on the Table panel surface (unreachable today; see Decision 7).

## Decisions

### Decision 1: Pin is constrained to the leading ordered columns, not "pin sticks to the left regardless of order"

The ticket names this as the one decision it deliberately leaves open. **Chosen: pin is
constrained to the leading run of the current column order** — pinning column N also pins every
column ordered ahead of it; unpinning column N also unpins every column ordered after it that is
currently pinned. The pinned set is always exactly "the first K columns of `columnOrder`" for
some K. (Skeptic-confirmed sound; kept verbatim from round 1.)

Rejected alternative — "pinned columns render at the left regardless of order position" (i.e. an
independent pin list that can include non-leading columns, visually reordering the pinned ones to
the front while leaving `columnOrder` itself untouched): rejected because it creates two
simultaneous, independently-mutable orderings of the same columns (`columnOrder` and "visual
render order once you account for pinning"), which is exactly the kind of state a user can no
longer predict from the column-order UI alone. Constraining pin to a leading run keeps a single
source of truth for column order and makes the sticky-offset math a straight prefix-sum, rather
than a projection over two independently-ordered lists.

Consequence: the pin toggle on a non-leading column is effectively "pin up through here" — its
accessible name should say so (e.g. "Pin through <column>" once more than one column would be
newly pinned) rather than implying only that one column pins. Symmetrically, unpinning the
**first** pinned column always empties the whole pinned set — this is a primary path, not an
edge case (see Decision 6).

**Ownership split (skeptic CR5):** `DataGrid` has no `columnOrder` prop — it only ever sees
`columns` already ordered by its caller. So `DataGrid` takes `pinnedColumns` as **a prefix of the
`columns` array it is given** (it does not know or care about `TableOutputConfig.columnOrder`
directly) and renders sticky-left for however many leading entries of that array are named in
`pinnedColumns`. Leading-run derivation and re-derivation on reorder — "given the new
`columnOrder`, which keys remain a valid leading prefix, and does the persisted `pinnedColumns`
value need rewriting" — is `TableRenderer`'s responsibility (task 1.3), computed against
`TableOutputConfig.columnOrder` before either value reaches `DataGrid`.

### Decision 2: `columnWidths` is not persisted — pinned-column offsets on a fresh load use default widths, by design

`columnWidths` is local-only `useState` in `TableRenderer.tsx` (removed from persistence by
HEL-909; the file's own comment: "Local-only column widths (no longer persisted...)"). Pinned
offsets are computed from `columnWidths`, so after a reload a pin restores (it's persisted) but
any custom width the user set before reload does **not** — the offset for that reload is computed
against `DEFAULT_COLUMN_WIDTH` until the user re-resizes in the new session. This is accepted:
widths were already session-local before this ticket (AC3 in the ticket is about pin state
surviving reload, not width state, and width persistence is explicitly out of scope), and the
alternative (scoping width persistence into this ticket) is a materially larger change HEL-909
deliberately declined to carry. AC2's "custom widths" scenario is validated within a single
session (resize → pin → verify offsets), not across a reload.

### Decision 3: Pin toggle lives in the column header as an icon-button, mirroring the resize handle, not a dropdown menu

`DataGrid.tsx`'s `<th>` today holds: the sort button (HEL-448, wraps the whole header label) and
the resize handle (HEL-253, a separate focusable `<span role="separator">` at the trailing edge).
There is no existing per-column dropdown/menu anywhere in this table (filter and formatting are
both configured elsewhere — the filter row and the panel config editor, respectively — not from
the header). Adding a pin **icon-button** as a third, independently-focusable control in the
`<th>` (analogous to the resize handle: its own tab stop, its own `aria-label`) is more
consistent with the existing pattern than introducing the codebase's first per-column header
menu for one affordance. `aria-pressed` reflects pin state; the accessible name states the
column and, when pinning a non-leading column, that ordered siblings ahead of it will also pin
(Decision 1). Tab-order cost (3 stops × N columns) is accepted; flagged for the a11y pass.

**Corrected (evaluation-1.md CR1):** "icon-button" above does not mean hand-rolled — the round-1
implementation hand-rolled a 16.75px `<button>`, which both violates DESIGN.md §5's "never a
hand-rolled icon-only control without a genuine, documented reason `IconButton`'s scale can't
express" and fell well short of the 44px coarse-pointer touch-target floor its filter-row
siblings already carry. The control now renders through the shared `IconButton` primitive
(`variant="ghost"`, `size="xs"` — the 24px dense-row size, matching this header row's density),
widened to 44px under the same `(pointer: coarse)` media query as the filter toolbar buttons.
`aria-pressed` (added as a first-class `IconButton` prop, since no existing consumer needed a
toggle button before this ticket) and `aria-label` are unchanged from the original ruling above;
`title` is now explicitly SHORT ("Pin"/"Unpin") and distinct from `aria-label`, since `IconButton`
defaults `title` to `aria-label` and the enclosing `<th title={col.header}>`'s own tooltip would
otherwise show through, naming the column rather than the action. The pressed-state accent color
(`--app-accent-text`, a state `IconButton`'s ghost/secondary/danger variants don't cover) is
applied via the `className` passthrough, not a new `IconButton` variant.

**Corrected a third time (skeptic-final-3, BLOCKING, last round in budget):** the control was
still **plain inline flow content** in the `<th>`, after the header label — and
`.ui-data-grid__table thead th`'s `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
(required for `table-layout: fixed`, HEL-253) actively works against inline layout on any column
whose header text is long enough to truncate: the truncation point is computed from the padding
box, and inline content placed AFTER the (possibly very long, pre-truncation) label text gets
pushed past the cell's own right edge and clipped away entirely — measured live on a real
82-column table: 23/61 header cells (38%) had the button's box outside the cell,
`elementFromPoint` at its center resolved to a NEIGHBORING cell (unclickable), and it still took
keyboard focus with an invisible ring, since the whole control — ring included — was clipped.

The fix reuses `.ui-data-grid__resize-handle`'s own solution to this exact problem (HEL-253, same
`<th>`, below): `position: absolute` removes the control from inline flow entirely, so its
position no longer depends on how much of the header label survived truncation. Vertically
centered via `top: 50%; transform: translateY(-50%)` (not `top: 0; bottom: 0` — this control has
a FIXED 24px height from `IconButton`'s `size="xs"`, which stretch-or-center behavior under
`top`/`bottom` both `0` is less reliable than an explicit translate-centered offset), and offset
`right: var(--space-6)` (24px) from the `<th>`'s own right edge — far enough to clear the resize
handle's own ~8px hit area around the border with room to spare, so the two controls' click
targets never overlap. `.ui-data-grid__table thead th` is already `position: sticky` (a valid
containing block for an absolutely positioned descendant, exactly like the resize handle already
relies on), so no additional `position: relative` is needed. The selector is scoped to
`.ui-data-grid__table thead th .ui-data-grid__pin-toggle-btn` (not the bare class alone) for
specificity robustness against `IconButton.css`, which also declares properties at the
`.ui-icon-btn--xs` level — this rule must win regardless of either stylesheet's import/evaluation
order, not depend on one happening to load after the other.

This repo's own Jest coverage (`DataGrid.test.tsx`) can only assert the CSS declaration's SHAPE —
jsdom has no real text-metrics/ellipsis engine and no functioning `elementFromPoint`, so it cannot
reproduce "does this column's header actually truncate" or "is the button's box inside the cell"
at all. It is NOT proof the control stays clickable/focusable on a real truncating column; the
skeptic's own live `elementFromPoint` reproduction against the running app, on a column that
genuinely truncates, in both themes, is the only real evidence for that — matching how the
separator fix's own static-source guard (Decision 8) is scoped.

**Corrected a fourth time (skeptic-final-4, BLOCKING, last round in budget) — two distinct CSS-only
defects the round-4 fix itself introduced, both fixed without touching the `position: absolute`
mechanism above:**

- **CR1 — the header label paints underneath the icon.** `position: absolute` (round 4) stops the
  toggle from being pushed out of the cell, but reserves no SPACE for it — the header label (inside
  `.sortable-th__btn`, which the `<th>`'s own `text-overflow: ellipsis` never reaches, since that
  only applies to a DIRECT text child and a sortable column's label lives inside a wrapping
  `<button>`) kept rendering at full available width and painting underneath the icon on any column
  whose label is long enough. Measured live: 8/73 header cells bare, 28/75 once several columns are
  pinned — the feature's own normal state, not a corner case. Fixed with a `padding-right` on the
  `<th>`, scoped to `.ui-data-grid__th--pin-reserve` (applied in `DataGrid.tsx` exactly when the
  toggle renders: `pinnable && onPinToggle`), sized to `calc(<density's own right padding> +
  var(--space-9))` — the toggle's `right: var(--space-6)` offset plus its own 24px width, ADDED on
  top of (not replacing) each density's existing right padding. This does not give the label a
  polished ellipsis — `.sortable-th__btn` has none of its own, a pre-existing gap this ticket does
  not fix — it only relocates where the content hard-clips, from "under the icon" (wrong: reads as
  the icon floating over live text) to "before the icon" (correct: the icon never overlaps visible
  content).
- **CR2 — the 44px touch target clips inside a 35px header row on coarse pointers.** On the
  `(max-width: 430px), (pointer: coarse)` surface, the pre-existing 44px floor on the widened toggle
  collides with `position: absolute` inside the header row's own `overflow: hidden` — that row is
  only ~35px tall at this surface's density, so the 44px, vertically-centered control clips 5-9px
  top/bottom, splitting its `:focus-visible` ring into two disconnected bars. Skeptic probe-confirmed
  the root cause live: reverting the toggle to `position: static` grows the row to 61px on its own
  and the clipping disappears — the ROW's height, not the control, is what needed to change. Fixed
  with `.ui-data-grid__table thead th { min-height: 48px; }` inside the SAME media query that already
  sets the toggle's own 44px floor (not a new breakpoint) — 44px control plus a small buffer for its
  `outline-offset: 2px` ring. The control itself was not shrunk below 44px; that floor stays fixed
  per the skeptic's own instruction.

Both fixes' own Jest coverage (`DataGrid.test.tsx`) is STATIC SOURCE only — it can assert the CSS
declarations' shape and that the reserve class is applied/omitted correctly, but jsdom has no
text-metrics engine (cannot compute whether a label actually clips before or under the icon) and no
viewport/pointer-media emulation (cannot reproduce a real ≤430px/coarse-pointer render). Neither is
proof either defect is resolved on the real surface it lives on; the skeptic's own live measurement
on those specific surfaces (a genuinely-truncating column with several columns pinned; a real
≤430px/coarse-pointer viewport) is the only real evidence for that.

### Decision 4: Sticky offset computed the same way as the existing column-width fallback

Offset for a pinned column = sum of `columnWidths[key] ?? col.width ?? DEFAULT_COLUMN_WIDTH` for
every pinned column ordered ahead of it — reusing the exact fallback chain `DataGrid.tsx` already
uses for `appliedWidth` (HEL-253: `liveWidths ?? columnWidths ?? col.width ??
DEFAULT_COLUMN_WIDTH`), so pin offsets never drift from what the column is actually rendered at.
Offsets recompute whenever `columnWidths`, `pinnedColumns`, or the resize-live-width state
changes. Density recompute is **not** implemented for the Table panel surface — see Decision 7.

### Decision 5: z-index scale — new work, not an existing precedent

**Corrected (skeptic CR3):** `DataGrid.css` has zero `z-index` declarations today; the existing
header/filter-row layering is DOM order plus a measured inline `top`, not a z-index scale. This
introduces the grid's first explicit z-index scale, as new work, with **three** tiers covering
four cell categories (the doubly-sticky filter-row corner cell, omitted from round 1, is real:
when the filter row is expanded, a pinned column's filter-input `<th>` is sticky on both axes
exactly like the header corner cell):

- **`z-index: 3`** — doubly-sticky corner cells: header row × pinned column, and (when the filter
  row is expanded) filter row × pinned column. Highest, since these must stay visible above both
  a top-sticky row scrolling beneath them horizontally and a left-sticky column scrolling beneath
  them vertically.
- **`z-index: 2`** — singly-sticky-on-the-top-axis cells: header row (non-pinned columns) and, when
  expanded, filter row (non-pinned columns). The header and filter rows never spatially overlap
  each other (DOM order already separates them), so both sit at this one tier.
- **`z-index: 1`** — singly-sticky-on-the-left-axis cells: body rows, pinned columns.
- **unset (auto)** — ordinary scrolling cells.

### Decision 6: Panel-surface-matched backgrounds on pinned cells, and clear-to-empty MUST write `[]`

**New (skeptic CR4), corrected (skeptic round 2 CR1):** `tbody td` has no background today
(`DataGrid.css` sets border/color/truncation only). Sticky-left body cells need their own
background or scrolling content will visibly bleed through beneath them — but the round-1 fix
(`var(--app-surface)`, citing "the scroll container's own background") named the wrong token:
`background: var(--app-surface)` is set only on `.ui-data-grid--preview`
(`DataGrid.css:74-77`); the `--full` variant — the only variant pinning targets — has **no**
container background, and the file's own comment (`:52-54`) says the `full` variant's actual
background is "a user-customized panel appearance." `PanelCard.tsx`'s `getPanelCardStyle` sets
`--panel-surface-override` on every panel card from `buildPanelSurface(theme,
appearance.background, appearance.transparency)`, a tinted, potentially translucent color that is
**not** `--app-surface` whenever a user has customized the panel background, and not opaque at
all when transparency > 0.

Pinned `<td>` cells instead use the established in-repo idiom for "this panel's actual surface,
falling back to the app default" — the same pattern already used at 5 sites (`PanelGrid.css`,
`PanelContent.css`, `MarkdownPanel.css`, `CollectionRenderer.css`):
`background: var(--panel-surface-override, var(--app-surface))`. This paints the pinned cell to
match every other opaque-looking surface on that same panel (a translucent panel's other chrome
is equally translucent, so this is consistent rather than a regression of the user's opted-in
transparency); pinned `<th>` cells keep the existing `--app-surface-soft` header background
(already opaque, unrelated to panel appearance — header chrome is not user-customizable).

**New (skeptic CR6):** `Output.config` is merged server-side by `OutputService.mergeConfig`
(`backend/.../pipelines/OutputService.scala`), a shallow merge that leaves an omitted key's prior
value intact — the exact trap `columnFormats`' doc comment already flags. Under Decision 1,
unpinning the first pinned column empties the whole set — a primary path, not an edge case. The
persisted write for "no columns pinned" MUST send `pinnedColumns: []` explicitly, never omit the
key, matching the `columnFormats` clear-write convention. Covered by a Jest assertion (task 5.2).

### Decision 7: Density is unreachable from the Table panel today — scope the claim accordingly

**Corrected (skeptic CR7):** `TableRenderer.tsx` never passes a `density` prop to `DataGrid`, so
panel tables always render at `DataGrid`'s default `full` density; density only varies on the
`OutputKindFields.tsx` preview surface, unrelated to this ticket. The offset-computation function
(Decision 4) remains density-agnostic by construction (it only sums widths, never padding), so it
needs no density parameter to be correct — Jest coverage (task 5.1) exercises it at a single,
fixed density along with varying widths, not "across densities." AC2's "across densities" wording
is satisfied vacuously (there is exactly one reachable density on this surface); this is recorded
here rather than left as an unreachable test obligation.

### Decision 8: Visual separator uses a `::after` pseudo-element on the last pinned column's cells

**Corrected (skeptic CR8):** `DataGrid.css`'s existing scroll-edge affordance
(`--scroll-left`/`--scroll-right`) uses an **inset** shadow on the *scroll container itself*,
correct there because the shadow needs to read as "painted just inside the container's own
edge." An inset shadow on the last pinned `<td>`/`<th>` would paint inside that cell, not project
outward as a boundary against the scrolling region to its right.

**Corrected again (skeptic-final-1 CR1, BLOCKING):** the non-inset `box-shadow` this section
previously specified (`box-shadow: 4px 0 6px -4px color-mix(in srgb, var(--app-text) 35%,
transparent)`) resolved correctly in `getComputedStyle` but painted **zero pixels** in the real
browser, in both themes — `.ui-data-grid__table` is `border-collapse: collapse` (required for
the drag-resize feature, HEL-253's `table-layout: fixed`), and Chrome does not paint `box-shadow`
on table cells under `collapse`.

**Corrected a third time (skeptic-final-2 CR1, BLOCKING — last round in budget):** the
`border-right: 1px solid color-mix(in srgb, var(--app-text) 35%, transparent)` this section
previously specified as the fix for the above painted correctly **only at `scrollLeft: 0`** and
**vanished once the table scrolled**, in both themes — a different `border-collapse: collapse`
interaction than the box-shadow one: a collapsed table's cell borders are painted at the cell's
**static (unscrolled) layout position**, not at the sticky cell's current on-screen position, so
as the pinned cell's own box moves under horizontal scroll, the collapsed border stays behind at
its original spot. This was not re-verified against a real scrolled state before being called
fixed in round 2 — only at-rest sampling, which the collapsed-border mechanism happens to satisfy
trivially regardless of whether the fix is actually correct. `border-collapse: separate` (flipping
the table's own collapse mode) is the other probe-confirmed-working route, but it changes how
every other border in the table resolves — a materially larger blast radius than this ticket's
scope, so not taken either round.

The separator instead uses a `::after` pseudo-element on `.ui-data-grid__pinned-cell--last`
(`content: ""`, `position: absolute`, `right: 0`, full height, 1px wide, same `color-mix(in srgb,
var(--app-text) 35%, transparent)` token as `background`, `pointer-events: none`). This sidesteps
the collapsed-border static-position problem entirely: the pseudo-element paints as part of the
pinned cell's own content box (not the table's border layer), positioned at `right: 0` **inside**
that box — the cell's `overflow: hidden` never clips it, since it never leaves the box — and moves
WITH the sticky cell under scroll rather than staying pinned to a static layout position.
`.ui-data-grid__pinned-cell` is already `position: sticky` (the rule immediately above this one),
which is itself a valid CSS containing block for an absolutely-positioned child, so no additional
`position: relative` is needed. Verified live by the skeptic at a non-zero `scrollLeft` (600px) in
both themes, spanning the header row, the per-column filter row, and body rows — this is the
standard any future claim about this element's correctness must be held to; jsdom has no real
scroll/paint engine, so this repo's own Jest coverage can only assert the CSS declaration exists,
never that it renders correctly under scroll.

## Risks / Trade-offs

- **Doubly-sticky corner-cell correctness is the highest-risk surface** (per the orchestrator's
  brief — jsdom cannot observe `position: sticky`, computed offsets, or real horizontal scroll).
  Jest/RTL coverage (AC6) is scoped to the offset-computation function and persistence, exactly as
  the acceptance criteria specify; AC1/AC2/AC4 (freeze behavior, stacking under real scroll,
  visual distinctness) are Playwright-only and MUST be verified against the running app in both
  themes, not asserted from computed CSS text alone.
- Pin state and column order both depend on `columnOrder`; Decision 1's leading-run constraint
  means a reorder can silently change the pinned set's membership (by position, not identity).
  `TableRenderer` (task 1.3) must re-derive and re-persist `pinnedColumns` immediately on reorder
  so the stored value never drifts from the new `columnOrder` between edits.
- `columnWidths` non-persistence (Decision 2) is an accepted, pre-existing limitation this ticket
  does not fix — flagged explicitly so it is not mistaken for a new gap introduced here.
- No backend/migration risk: `Output.config` is an opaque JSON blob; this is a frontend-only
  change plus the existing `mergeConfig` shallow-merge behavior already in production (Decision
  6 documents how to write against it correctly, not a change to it).
