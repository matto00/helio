## Context

`frontend/src/shared/ui/DataGrid.css` (lines ~409-424 and ~628-636 at base `3baa1ebf`) carries two
HEL-465 fixes that are structurally present but have no rendered effect, per the probe-confirmed
findings in this ticket (see `ticket.md`). `DataGrid.test.tsx` (lines ~1486-1538) has three Jest
tests covering these two rules, all of which only match CSS declaration text — they stayed green
through five final-gate rounds while both fixes were inert. Precedent for geometry-based e2e
coverage of a CSS-only fix already exists at `e2e/hel813-mobile-touch-target-floor.spec.ts` (uses
`getBoundingClientRect()` at real viewport widths, with `e2e/support/touchTargetProbe.ts` helpers)
and `e2e/hel520-focus-presence-guard.regression.spec.ts` (renders a focus ring and measures it).

## Goals / Non-Goals

**Goals:**
- Apply exactly the two specified CSS fixes (label-side clip constraint; `min-height`→`height`).
- Add Playwright geometry assertions that fail on the pre-fix tree and pass on the fixed tree, for
  both issues, in both themes, under the correct preconditions (pinned columns; coarse pointer +
  ≤430px viewport).
- Decide the disposition of the three existing "STATIC SOURCE" Jest tests without silently leaving
  dead, misleading coverage behind.

**Non-Goals:**
- Any change to pin/unpin logic, persistence, or `pinnedColumns` semantics.
- AC3 persistence verification (environmental block, out of scope per ticket).
- Fixing the pre-existing, unrelated gap where a sortable column's own `<th>` `text-overflow` rule
  never reaches `.sortable-th__btn`'s content (noted inline in DataGrid.css, not this ticket's bug).

## Decisions

**D1 (revised, skeptic-design-1.md CR1/CR2) — Label-side fix targets the label `<span>` inside
`.sortable-th__btn`, not the button itself.** Ground truth, corrected after the first design-gate
REFUTE: `SortableTh.css:4-15` declares `.sortable-th__btn { display: inline-flex; ... }` — no
`overflow`/`white-space`/`text-overflow` of its own (those cited in the ticket are computed/initial
values, not authored declarations), and it does NOT fill the header cell (`inline-flex` is
shrink-to-fit). `SortableTh.tsx:33-41` already wraps the label in an unclassed `<span>{children}
</span>`, sibling to the sort glyph — a label element already exists, it is merely unclassed.
`.sortable-th__btn` is a flex **container**; `text-overflow: ellipsis` must go on the element whose
own overflowing *inline* content is being clipped — the `<span>`, not the flex container around it.
Decision: (a) add a class (`sortable-th__label`) to that `<span>` in `SortableTh.tsx` — a one-line
JSX change, not "CSS-only" as originally framed; (b) give `.sortable-th__label` (scoped to
`.ui-data-grid__th--pin-reserve .sortable-th__btn > .sortable-th__label` so only a pinnable
`DataGrid` header is affected — `SortableTable.tsx`'s own `SortableTh` usage is untouched)
`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`; (c) also set
`min-width: 0` on `.sortable-th__btn` itself (scoped identically) as belt-and-braces for its own
shrink-to-fit `inline-flex` sizing against the `<th>`'s available width — the load-bearing
declaration for the ellipsis effect is the one on `.sortable-th__label`; this one on the button is
not a flex-item minimum-size fix (the button's parent is a `table-cell`, not a flex container, so
that specific mechanism does not apply here — corrected per skeptic-design-2.md non-blocking note).
Alternative considered (original D1): put the constraint directly on `.sortable-th__btn`
— rejected because `text-overflow` has no effect on a flex container holding a flex-item child; it
would hard-clip with no "…", contradicting this change's own spec delta ("the label ellipsizes").
Alternative considered: wrap the label in a *new* span — moot, the wrapper already exists.

**D2 (revised, skeptic-design-1.md CR3) — Do NOT add `max-width: calc(100% - var(--space-9))`
alongside the existing padding-right reservation; that double-reserves the icon's 48px.**
`DataGrid.css:414-424`'s `--pin-reserve` padding-right rules already subtract `var(--space-9)` (48px,
confirmed in `theme.css:51`) from the `<th>`'s content box. A percentage `max-width` on the label
resolves against that content box's width, which has *already* had the 48px removed — stacking both
would truncate labels ~48px earlier than the icon actually requires, a visible regression on narrow
pinned columns, not "harmless defense-in-depth" as originally framed. Decision: the label constraint
is `max-width: 100%` (no `calc()`), relying entirely on the pre-existing `<th>` padding reservation
for the icon's own space; keep that `<th>` padding-right rule exactly as-is (still the single source
of truth for the reserved width). Original D2's "harmless defense-in-depth" framing is retracted.

**D3 — `min-height` → `height` is a literal one-token change, same media query.** No new breakpoint,
no restructuring. The 44px control floor (`.ui-data-grid__pin-toggle-btn { min-height/min-width:
44px }`) is untouched — `height: 48px` only changes the row, never the control.

**D3 correction (owner-ruled, post-escalation, executor's HEL-1065 delivery) — `48px` itself was
insufficient; the value is `54px`, not `48px`.** The executor's own e2e assertion for AC2 ("the
pin-toggle button box and its computed focus-ring extent are fully inside the `<th>`") went red at
`48px`: the app's global `:focus-visible` rule (`theme.css`) is `outline: 2px solid ...;
outline-offset: 2px`, so the ring's full extent past the control's own box is `outline-width +
outline-offset = 4px` per edge — not the 2px this decision's original derivation ("44px control + a
small buffer for its outline-offset: 2px ring") budgeted. A 44px control centered in a 48px row only
had ~1.75-2.25px of margin per edge (confirmed asymmetric, not an even 2/2 split, via CDP-forced
`:focus-visible` + `getBoundingClientRect`), so the ring clipped by up to ~2.25px top and bottom even
though the control itself was fully unclipped. The naive fix (`52px` = 44 + 2 * 4) still measured a
~0.25px top-edge overflow live — the control's vertical centering inside the row is itself slightly
asymmetric in this browser's rendering, so the theoretical minimum doesn't land exactly. Escalated
rather than silently deviating from this decision's locked value or weakening the e2e assertion to
tolerate the clip; owner ruling: raise the value (not the tolerance) — the remaining clip is the SAME
`overflow: hidden` mechanism as the two original HEL-465 defects, just smaller, and an assertion
written to tolerate it is exactly how those two fixes shipped inert through five gate rounds. Raised
to `54px`, adding real margin past the theoretical minimum rather than re-deriving another
razor's-edge value; re-measured clean on both edges, both themes. The 44px control floor and
no-new-breakpoint/no-restructuring constraints from the original D3 both still hold — only the row's
own height literal changed.

**D4 (revised, skeptic-design-1.md CR4) — Keep the two "reserve exists"/"scoping" tests as-is, AND
keep the co-location guard inside the `min-height: 48px` test, just updated for the new property
name.** The existing test at `DataGrid.test.tsx:~1520-1538` asserts two separate things: (1) the
row's own height rule exists with the value `48px` — this is the CSS-declaration-text claim that
must go, since it says nothing about whether the effect renders; (2) `.ui-data-grid__pin-toggle-btn`'s
`min-height: 44px` control floor lives in the **same** media query as the row-height rule — a
same-media-query drift guard that is still a true, valuable structural fact independent of whether
the row rule is `min-height` or `height`. Original D4 mischaracterized this test as having "only
claimed the ineffective rule's text is present" — it also asserted the co-location invariant, which
survives the fix. Decision: update the row-height regex to match `height:\s*48px` (not delete the
test), keep the co-location assertion against `.ui-data-grid__pin-toggle-btn { min-height: 44px }`
unchanged.

**D4 correction (skeptic-design-2.md CR1) — the `padding-right` calc-value assertion at
`DataGrid.test.tsx:~1493` is KEPT, not dropped.** Round-2 review caught that the original D4 above
justified dropping it by citing "D2's stacked reservation is now explicitly rejected" — but D2
rejects the *label's own* `calc(100% - var(--space-9))`, not the `<th>`'s `padding-right`; D2
explicitly keeps that `<th>` rule "exactly as-is" as "the single source of truth for the reserved
width". Since D1/D2 now make the label's clip position depend entirely on that 48px reservation
existing, the assertion at `~1493` is the only automated guard against someone shrinking or dropping
it, and it remains true (not volatile) after this change. All three "reserve exists and is scoped"
Jest assertions — including the `padding-right` calc-value match — are kept unchanged. Only the
row-height *value* (`min-height: 48px` → `height: 48px`) and its wording are updated, per the
correction directly above.

**D5 (revised, skeptic-design-1.md CR5) — New Playwright coverage lives in `e2e/` as a new spec file
(`e2e/hel1065-pin-toggle-css-fixes.spec.ts`)**, reusing the `e2e/hel910-pipeline-to-dashboard-flow
.spec.ts:57,215-253` register-then-API-seed pattern (a fresh account owns zero Outputs today, so the
test must create its own): register a fresh user, then via the API create a data source → pipeline →
output → a Table panel bound to that output (mirroring hel910's seeding calls), choosing/generating
column data such that at least one column's label is long enough to genuinely truncate at the
panel's rendered width. Pin ≥3 leading columns via the pin-toggle UI control itself (clicking the
toggle in the running app — exercises the real interaction, not a seeded `pinnedColumns` fixture, so
the test also incidentally covers "pin via the actual control"). Then:
- Desktop context, both themes: measure `labelUnderPinIcon` (rendered bounding-box overlap between
  the truncating label and the pin icon) — must be `0`.
- A second context/page resized to a real ≤430px viewport with `hasTouch: true`/coarse-pointer
  emulation (matching `e2e/hel813-mobile-touch-target-floor.spec.ts`'s existing pattern — reuse
  `e2e/support/touchTargetProbe.ts`'s `measureBox` helper rather than reimplementing), both themes:
  measure the pin-toggle button's box and focus-ring extent (`rect ± outline-offset ± outline-width`)
  — both must be fully inside the containing `<th>`, and the button itself must be ≥44×44px.
- One desktop/fine-pointer assertion confirming the header row height is unaffected outside the
  coarse-pointer media query (the "Desktop/mouse viewport is unaffected" spec scenario).

**D6 (revised, skeptic-design-1.md non-blocking note) — Prove red-before-green, path-scoped stash.**
Before committing the CSS fix, the executor runs the new spec against the pre-fix worktree state
using `git stash push -- frontend/src/shared/ui/DataGrid.css frontend/src/shared/ui/SortableTh.tsx`
(path-scoped, so the new test file and any other in-progress work are NOT stashed away), run the
spec, confirm failure, `git stash pop`, confirm the spec then passes — satisfying the ticket's "prove
each new assertion goes red against the pre-fix tree" requirement. One-time manual verification
recorded in the PR description, not a permanent CI step.

## Gate-Chain Implications Checklist

Not applicable — this change touches no `.husky/**` file and no script invoked by
`.husky/pre-commit`. Only `DataGrid.css`, `DataGrid.test.tsx`, and a new `e2e/*.spec.ts` file are
touched.

**D7 (skeptic-design-1.md non-blocking note) — literal selector, so the scoping is provable.**
The label ellipsis rule and the button's `min-width: 0` are both scoped by the compound selector
`.ui-data-grid--<density> .ui-data-grid__table thead th.ui-data-grid__th--pin-reserve
.sortable-th__btn` (and its `.sortable-th__label` child), mirroring the existing per-density
`--pin-reserve` padding rules exactly — so `SortableTable.tsx`'s own `SortableTh` usage (no
`.ui-data-grid__th--pin-reserve` ancestor) is provably unaffected.

## Risks / Trade-offs

- [Playwright coarse-pointer/viewport emulation might not perfectly reproduce the live-browser
  measurement the ticket's own root-cause finding was based on] → mitigate by matching the ticket's
  exact stated viewport (≤430px) and pointer type, and by running the red-before-green check (D6)
  to confirm the assertion is actually sensitive to the fix, not just to the emulation setup.
- [Deleting/narrowing the two CSS-only Jest tests could look like reduced coverage] → mitigated by
  D4's rationale being recorded inline as a comment, and by the new e2e coverage being strictly
  stronger (can fail on rendered effect, not just text) for exactly the claims those tests dropped.

## Planner Notes

Self-approved: scoping the spec delta to `table-panel-column-pinning` (the existing capability)
rather than creating a new capability — these are refinements to an already-specified pin-toggle
affordance's rendering correctness, not a new capability. Self-approved: not adding a
`skip_specs: true` marker, since visually-observable behavior (label overlap, control clipping) is
genuinely being specified, even though it's a CSS-only implementation.
