## Context

`PanelList.css` (`frontend/src/features/panels/ui/PanelList.css`) styles
`.panel-list__add` with `height: var(--control-sm)` (28px) and no mobile
floor. `EmptyState.css:219-228` established the convention this repo uses to
fix this class of bug: a `@media (max-width: 768px) { min-height: 44px }`
block placed AFTER the base rule. HEL-535's cycle-1 defect placed the same
kind of block BEFORE the base rule, so equal specificity left it inert while
a text-matching test (checking for the string, not the rendered effect)
passed — the direct reason this ticket mandates measurement-based
verification instead.

HEL-777 (merged e0048c3e, immediately prior on main) extended DESIGN.md's
Control-metrics section with an `::after` hit-expander pattern as an
alternative way to satisfy the 44px floor without growing the element itself
(useful when growing box height would break tight layouts). The ticket text
explicitly prefers the min-height floor here.

## Goals / Non-Goals

**Goals:**
- `.panel-list__add` >= 44px tall at 430px and 768px viewports, verified by
  `getBoundingClientRect().height`.
- Audit `PanelList.css`'s other interactive controls for the same gap and
  fix any found.
- Prove the verification probe discriminates (measure a control that should
  NOT be floored and confirm it stays below 44px).

**Non-Goals:**
- Building the mechanical guard (static CSS test / runtime sweep) the ticket
  raises as "worth considering" — see Decision 3 below for the scoping call.
- Any behavioral/layout change beyond the touch-target floor.

## Decisions

1. **Min-height floor, not an `::after` hit expander, for `.panel-list__add`.**
   The ticket states this preference explicitly, and the min-height approach
   is the established convention (`EmptyState.css`) this button already
   otherwise resembles (primary CTA-style button). An `::after` hit expander
   is HEL-777's answer for cases where growing the box itself is undesirable
   (e.g. dense icon rows); `.panel-list__add` is a header-level primary
   action with room to grow, so the simpler floor applies. Placed AFTER the
   base `.panel-list__add` rule (HEL-535 lesson) in the file's existing
   `@media (max-width: 768px)` block at `PanelList.css:162-171` (which
   already carries `.panel-list`/`.panel-list__header` layout rules — not the
   later HEL-774 `@media (max-width: 768px)` block at line 189, which only
   scopes `.panel-list__zoom-widget`'s bottom clearance), rather
   than opening a second identical media query — cheaper cascade, same
   effective floor, and it keeps this fix visually adjacent to the file's
   other mobile-width rules rather than orphaned next to the base rule.

2. **Sibling audit scope: `.panel-list__zoom-button` / `.panel-list__zoom-reset`
   are interactive (icon buttons) and render at 22px height AND 22px width
   (`.panel-list__zoom-button` is also `width: 22px`) with no floor on
   either axis.** DESIGN.md §5's touch-target floor is a 44px **min-height
   AND min-width** — a 22×44 target still fails half the requirement, so the
   fix floors both `min-height: 44px` and `min-width: 44px` on
   `.panel-list__zoom-button`/`.panel-list__zoom-reset`. This is REAL box
   growth (`min-height`/`min-width` on the element itself), not an `::after`
   hit-expander — so HEL-777's gap/tiling arithmetic (which governs
   invisible pseudo-element hit areas extending past a visually smaller box)
   does not apply here; the flex `gap: 2px` on `.panel-list__zoom-widget`
   remains the true minimum space between the now-larger rendered boxes, so
   there is no overlap risk. The capsule simply grows wider/taller to fit
   its now-44px children — a purely cosmetic widening of a `position: fixed`
   floating widget with no other layout depending on its size. They are NOT
   part of `.panel-list__header` — they belong to `.panel-list__zoom-widget`,
   hidden entirely below 430px (`@media (max-width: 430px) { display: none }`)
   and only visible in the 431–768px band, where they are genuinely
   touch-reachable, so they are in scope for the same floor under the
   ticket's "audit sibling header controls in the same file" instruction,
   read as "sibling controls in the same file" rather than literally
   restricted to `.panel-list__header`'s DOM subtree. `.panel-list__count`
   is a non-interactive badge (no click handler) and is out of scope.

3. **Mechanical guard (static CSS test / runtime sweep): out of scope for
   this ticket, recommend as a follow-up.** This is the seventh
   near-identical finding across 7 tickets over ~a month; a per-incident fix
   is clearly not converging, and the ticket itself flags this. But building
   a repo-wide guard (deciding what "interactive control" means
   mechanically, choosing static-CSS-parse vs. rendered-DOM-sweep, wiring it
   into CI) is qualitatively different work from a one-file bug fix, with
   its own design surface (false positives on decorative elements,
   flakiness of viewport-dependent DOM sweeps, etc.) — it does not fit this
   ticket's scope or budget. Recommend filing it as its own ticket; the
   orchestrator raises this as an escalation per the ticket's own
   instruction rather than silently expanding or dropping it.

## Risks / Trade-offs

- [Risk] Growing the zoom-widget buttons to 44×44 will visibly enlarge the
  pill-shaped zoom capsule (from a compact `padding: 3px` pill to one with
  much larger buttons) — a real, visible layout change, not just an
  invisible hit-area change. → Mitigation: this is an accepted, intentional
  trade-off (DESIGN.md §5 compliance over compactness); verify via
  screenshot at 431–768px that the capsule still reads as a coherent
  control and doesn't visually collide with `BottomNav` (already cleared via
  `--bottom-nav-height`, HEL-774) or run off-screen at its `bottom-right`
  fixed position. If the enlarged capsule looks broken, that is new
  information to bring back to the design gate, not something to route
  around with `::after` (HEL-777's gap/tiling arithmetic doesn't clear this
  capsule's `gap: 2px` either — see Decision 2 above).
- [Risk] Growing `.panel-list__add`'s height on mobile could shift the
  `.panel-list__header` layout (`flex-direction: column` below 768px) →
  Mitigation: the header already stacks vertically at this width, and the
  button is full-width-adjacent, not row-constrained; verify no visual
  regression via the evaluator's UI-review pass.

## Planner Notes

- Self-approved: including the zoom-widget's two icon buttons in this
  ticket's scope (Decision 2), since the ticket's own text says "audit
  sibling header controls in the same file for the same gap" and these are
  genuinely mobile-reachable interactive controls in the same file, even
  though they're not literally inside `.panel-list__header`'s markup.
- Correction (skeptic-design-1.md CR4): this ticket DOES have a spec delta —
  `specs/panel-list-mobile-touch-targets/spec.md` (a new capability,
  declared in proposal.md's Capabilities section) stating the touch-target
  floor as a testable requirement/scenario set. `specs/` is NOT empty and
  archive will run WITHOUT `--skip-specs` so this new capability spec is
  merged into `openspec/specs/` at Delivery.
