## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Re-derived from the files themselves, not from design.md's claims.

- **CR1 (false basis for SortableTh.css) — FIXED.** `frontend/src/shared/ui/SortableTh.css:4-15`
  really is `display: inline-flex` with no `overflow`/`white-space`/`text-overflow` declarations;
  revised D1 now states exactly that ("computed/initial values, not authored declarations",
  "inline-flex is shrink-to-fit"). Matches ground truth.
- **CR2 (wrong target element) — FIXED, and the mechanism actually works.**
  `SortableTh.tsx:35` is still `<span>{children}</span>`, unclassed, sibling to the glyph at
  :36-40. D1 now (a) classes it `sortable-th__label` in TSX, (b) puts
  `overflow/text-overflow/white-space/min-width: 0` on the *span*, (c) drops the "CSS-only" framing.
  I traced the layout consequence: the span is a flex item of the inline-flex button, so
  `min-width: 0` + `overflow: hidden` is exactly what lets it shrink and ellipsize; the button's
  shrink-to-fit width resolves to the `<th>`'s available content width, so the ellipsis boundary
  lands at the content edge. `thead th` already sets `white-space: nowrap` (DataGrid.css:158-164),
  which the span inherits.
- **CR3 (double reservation) — FIXED.** `DataGrid.css:414-424` per-density
  `padding-right: calc(var(--space-N) + var(--space-9))` confirmed unchanged; revised D2 drops the
  `calc(100% - var(--space-9))` in favour of plain `max-width: 100%`, retracts the
  "defense-in-depth" framing, and names the `<th>` padding as the single reservation. Arithmetic
  now checks out: icon occupies 24-48px from the `<th>` right edge (`right: var(--space-6)` + 24px
  `--xs` control, DataGrid.css:~262-280); the label clips at ≥48px in, i.e. before the icon.
- **CR4 (co-location guard) — FIXED.** Re-read `DataGrid.test.tsx:1526-1537`: it does assert both
  `.ui-data-grid__pin-toggle-btn { min-height: 44px` and
  `.ui-data-grid__table thead th { min-height: 48px` inside the same matched media block. D4 and
  task 4.1 now update the row regex to `height:\s*48px` and explicitly retain the co-location
  assertion instead of deleting the test.
- **CR5 (e2e route) — FIXED.** `e2e/hel910-pipeline-to-dashboard-flow.spec.ts:54-61` registers a
  fresh account and :215-243 seeds dashboard → `/api/data-sources` → `/api/pipelines` →
  `/api/pipelines/:id/outputs`; D5/task 3.1 cite that pattern, require a genuinely-truncating
  label, require ≥3 columns pinned **through the real toggle UI**, and specify both themes plus the
  fine-pointer control assertion. Truncation is achievable because `.ui-data-grid--full
  .ui-data-grid__table` is `table-layout: fixed` (DataGrid.css:137-139) with `DEFAULT_COLUMN_WIDTH`,
  and `TableRenderer.tsx:673,682-683` does render `variant="full"` with `onPinToggle` wired.
- **D7 scoping** matches the real selector shape of the existing per-density
  `.ui-data-grid--<density> .ui-data-grid__table thead th.ui-data-grid__th--pin-reserve` rules.
- Tasks 1.1-5.3 trace to D1/D2/D3/D4/D5/D6/D7 and to both spec scenarios; the spec delta's
  "ellipsizes" wording is now satisfiable by the planned CSS (it was not in round 1).

### Verdict: REFUTE

Four of the five round-1 change requests are correctly and verifiably addressed. One (CR4's class of
defect — dropping a still-true guard on a stated rationale that does not hold) recurs in the
neighbouring assertion, and it happens to be the only automated guard on the value the whole
label-side fix now depends on.

### Change Requests

1. **D4/task 4.1 delete the `padding-right` assertion on a rationale that contradicts D2 — keep it.**
   Task 4.1 says "remove the `padding-right` calc-value assertion (~line 1493)", justified in D4 by
   "D2's stacked reservation is now explicitly rejected, so that specific value assertion would need
   constant revision as an implementation detail." That does not follow. What D2 rejected is the
   stacked `max-width: calc(100% - var(--space-9))` **on the label**; D2 states the `<th>`
   `padding-right` rule is kept "exactly as-is" and is now "the single source of truth for the
   reserved width". The assertion at `DataGrid.test.tsx:1493`
   (`/padding-right:\s*calc\(var\(--space-3\) \+ var\(--space-9\)\)/`) therefore stays true after
   this change and is not volatile — and since D1/D2 make the label's clip position depend entirely
   on that 48px reservation, it is the only check that would catch someone shrinking or dropping it.
   Amend D4 and task 4.1 to retain that assertion (the surrounding "reserve exists and is scoped"
   assertions are already being kept), or, if there is a real reason to drop it, state a rationale
   that survives contact with D2.

### Non-blocking notes
- D1(c)'s stated reason for `min-width: 0` on `.sortable-th__btn` ("a flex item's default
  `min-width: auto` prevents it shrinking") is misapplied to that element: the button's parent is a
  `table-cell`, not a flex container, so the button is not a flex item and its automatic minimum
  size rule is not what is at play. The declaration is harmless (and arguably still worth keeping as
  belt-and-braces), but the rationale should say "shrink-to-fit inline-flex sizing" instead, so a
  later reader does not delete the wrong one of the two `min-width: 0`s. The one that is genuinely
  load-bearing is the one on `.sortable-th__label`.
- Task 3.1's "at least one column label genuinely truncates" is best made deterministic rather than
  incidental (e.g. assert the truncating header's `scrollWidth > clientWidth` as a precondition
  before asserting `labelUnderPinIcon === 0`), otherwise a fixture drift silently turns the
  overlap assertion vacuous again — the exact failure mode this ticket exists to correct.
