## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold agent. Every conclusion below comes from the diff, the suite I ran myself, and rendered
geometry I measured myself in a browser pointed at `:5883`. Screenshots at
`/home/matt/Development/helio/skf2-0*.png`.

### Content self-authentication (before any observation)

The dev server serves THIS branch, proved by served bytes, not by port: the CSS module fetched
from `http://localhost:5883/src/shared/ui/DataGrid.css` carries
`const __vite__id = ".../worktrees/feature/in-panel-column-filtering/HEL-451/frontend/src/shared/ui/DataGrid.css"`
and contains `ui-data-grid__sticky-cell` (0 occurrences on `origin/main`). In the live document,
3 CSS rules matching `ui-data-grid__sticky-cell` / `ui-data-grid__filter-row` are in
`document.styleSheets`.

### Data variation (binding requirement)

Prior rounds used the 44-column `…ae5b18b6…` Sleeper Output. I deliberately used an Output no
prior round sampled: **`hel904-orphan-output-05d5dbab-…` "Projections 2026" — 82 columns, 1000
rows**, owned by `matt@helio.dev`. I created a fresh dashboard `SKF2-82col`
(`ad203213-2ced-4601-9ceb-9040840ea50f`) and a fresh `output` panel bound to it via the API.
Rendered table width **12,000px** inside a **581px** panel scroll viewport.

### What I verified (with evidence)

- **Gates.** `npm --prefix frontend test` run by me: **280 suites / 2914 tests passed**, exit 0.
  (Root `npm test`'s `jest --passWithNoTests` arm is vacuous in a worktree root — I ran the
  frontend project directly.)
- **CR3 of round 1 (badge + "Clear all" reachable at any scrollLeft) — CLOSED.** Measured at
  `scrollLeft = 3000`: `.ui-data-grid__filter-toolbar` rect `x = 297 → 453`, i.e. pinned to the
  scroll viewport's own left edge (`grid.x = 297`), fully visible; `Filters (1)` + `Clear all`
  both on screen. At `scrollLeft = 0` it sits at `x = 305`. The sticky-wrapper approach holds.
- **CR2 of round 1 (12,136px quick input) — the runaway width is gone.** Quick input now
  measures **191px** (`x = 309 → 500`), and is pinned at `x = 297` at `scrollLeft = 3000`.
  Visually it reads as an ordinary text control, comparable in size to the per-column inputs.
  (See non-blocking note 1 — it no longer spans the row, which is a taste call, not a defect.)
- **No collateral damage to truncation from `overflow: visible`.** Measured on live ordinary
  cells: every `thead tr:first-child th` still computes `overflow: hidden` with
  `scrollWidth 164 > width 160` (clipping active), and `tbody td` still computes
  `overflow: hidden; white-space: nowrap`. The overrides are correctly scoped to the three
  colSpan cells only. 75 resize handles present and unchanged; `table-layout: fixed` geometry
  intact.
- **Supersession (4.0f) — exactly one message, never two.** Live, on three distinct states:
  filtering+truncated → `"200 of 200 loaded rows match."` (one node, Load more present);
  filtered-empty → one `.ui-data-grid__empty` node only; unfiltered+truncated →
  `"Sort covers only the loaded rows."` only. `showLoadedScopeNote = rowsTruncated || filtering`
  behaves as the corrected rule states.
- **D6 persistence on data no prior round touched.** After typing a quick filter,
  `psql` shows `outputs.config = {"columnFilters": {"quick": "zzz-no-such-value"}}` on the
  82-column Output; after a full page reload the value re-seeded into the input and the chrome
  auto-expanded showing `Filters (1)`. "Clear all" wrote `{"columnFilters": null}`. Minimal
  patch, user-edit-only, flushes.
- **Per-column filter + accessible names.** `aria-label="Filter column game_id"`; typing `2026`
  there narrowed 200 → 0 rows correctly with the filtered-empty state.
- **Both themes.** Reproduced in real `helio-theme=dark` (not a hacked attribute) and in light.
  Filter chrome reads as the same system as the HEL-448 sort header — same `--app-surface-soft`
  band, same type scale, accent-on-active. No third variant introduced.
- **Console:** 0 errors, 0 warnings from the app (the only console entries were my own
  deliberate 400/403/404 API probes while creating the fixture panel).

---

### Verdict: REFUTE

One finding. It is the *same surface* round 1 refuted (CR1), and the fix improved it but did not
close it. Reproduced across a full page reload and in both themes, so it is not a measurement
artifact.

### Change Requests

1. **The filtered-empty disclosure is still clipped mid-word — and is now unreadable at EVERY
   scroll position, not just at `scrollLeft > 0`.** Measured live on the 82-column Output,
   panel scroll viewport `x = 297 → 878` (581px wide):

   - `.ui-data-grid__empty` renders as a **single 727px line** (`x = 309 → right = 1036`),
     height 18px — one line, no wrap. The user reads
     *"No rows match your filter in the 200 rows loaded so far. More rows may match — load m"*
     and the tail *"…ore to widen the search."* is cut (screenshots `skf2-04-empty.png` light,
     `skf2-06-dark-real.png` dark).
   - Because the content is now `position: sticky; left: 0` on `.ui-data-grid__sticky-cell`, it
     re-pins to the viewport's left edge at every scroll offset — measured at `scrollLeft = 3000`
     the `<p>` is `x = 297 → right = 1024`, still overflowing `gridRight = 878`. **Scrolling right
     no longer reveals the tail**, so the clipped text is now unreachable by any user action,
     where before the fix it was at least recoverable by scrolling.

   **Probe-confirmed root cause (measured, not inferred).** `getComputedStyle` on the live `<p>`
   returns `white-space: nowrap`, inherited from `.ui-data-grid__table tbody td`'s truncation
   rule. `da2d93cd` restored `overflow: visible` on `.ui-data-grid__empty-row` but **not**
   `white-space`, and additionally set `width: max-content` on `.ui-data-grid__sticky-cell`
   (`DataGrid.css:215-219`) — so the message can never wrap and is sized to its own unwrapped
   text. I confirmed the two are independent: forcing the wrapper to `width: 581px` live left the
   `<p>` at width 727 / height 54 (unchanged, still overflowing to `right = 890`), because
   `nowrap` alone prevents wrapping.

   **Scope — this is not an 82-column edge case.** The message's 727px width is independent of
   column count; any table panel narrower than roughly 740px clips it, which is the default
   dashboard-grid panel size (581px here at a 1600px viewport). The wider detail modal is why the
   loop kept missing it.

   **Why blocking.** `ticket.md`'s "Design obligations this ticket must answer" names the
   filtered-empty state as the sharpest one — the surface where honesty about sampling has to
   live — and the half being cut is the actionable remedy ("load more to widen the search").
   Shipping the flagship empty state with a sentence visibly severed mid-word, permanently, is an
   off-pattern result an experienced eye rejects, and it is precisely the CR raised last round.

   **Fix shape (small, no design re-open):** on `.ui-data-grid__empty-row`'s content, override
   the inherited `white-space` back to `normal` (specificity-boosted the same way the
   `overflow` override already is), and bound the sticky wrapper to the scroll viewport's width
   rather than `max-content` — the existing `useLayoutEffect` in `DataGrid.tsx` already measures
   `.ui-data-grid` with `getBoundingClientRect`, so a CSS custom property set alongside the
   sticky `top` offsets is the natural handle. Then re-measure that the `<p>`'s `right` is
   `<= grid.right` at `scrollLeft` 0 **and** at a large `scrollLeft`, on a panel-width (~580px)
   surface, not only in the detail modal. Note the same `nowrap`/`max-content` pair applies to
   the toggle row and quick row too — they happen to fit today (156px / 191px), so bounding
   should not regress them, but verify.

### Non-blocking notes

- The quick-filter input collapsing from full-bleed to 191px is a side effect of
  `width: max-content` on the shared wrapper, not a deliberate sizing decision. It looks fine,
  but if CR1's width bounding lands, decide explicitly whether the quick input should span the
  visible viewport (it reads more like a "filter everything" affordance at full width).
- Round 1's notes still stand and were not addressed: no `transition` and no `:focus-visible`
  rule on `.ui-data-grid__filter-toggle-btn` / `__filter-clear-all-btn` (their sibling
  `.panel-content__clear-filters-btn` has both); `readColumnFilters`' docstring is inaccurate for
  an array input; no call-site test guards `rowsTruncated` on `PanelCard.tsx` /
  `PanelDetailModal.tsx`.
- Dev-environment residue I created and did not remove: dashboard `SKF2-82col`
  (`ad203213-2ced-4601-9ceb-9040840ea50f`) with one panel bound to
  `hel904-orphan-output-05d5dbab-…`. That Output's `config` is back to
  `{"columnFilters": null}` (I cleared it through the UI), so no filter residue remains.
