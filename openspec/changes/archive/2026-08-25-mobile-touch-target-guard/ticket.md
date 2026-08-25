# HEL-813: Mechanical guard for the 44px mobile touch-target floor (rendered-measurement, not text-matching)

## Description

This repo has now had **seven** independent sub-44px mobile touch-target findings: HEL-745, HEL-747, HEL-314, HEL-319, HEL-535, HEL-548's spinoff, and HEL-781. Each was fixed per-incident. The rate is not decreasing, so the per-incident fix is not converging — the next instance is a matter of time, and every one of them has reached a review gate (or production) before being caught.

`DESIGN.md` §8 states the floor. Nothing enforces it.

### Why the obvious implementation is a trap

The natural precedent is the existing static CSS tests — `frontend/src/shared/ui/EmptyState.css.test.ts`, `Skeleton.css.test.ts`, `IconButton.css.test.ts`, `inputs.css.test.ts`, `Modal.css.test.ts`, `toast.css.test.ts`. **Do not build this guard on that shape.**

Those tests match text/brace structure in the stylesheet source. That is precisely the test shape that let HEL-535 **ship an inert floor undetected**: its `@media` block was placed *above* the base rule, so equal specificity made the declaration inert at runtime while the text-matching test found the `min-height: 44px` string and passed. A presence-of-string assertion cannot fail on the failure mode we actually keep hitting.

HEL-781 hit two further variants that a source-text guard would also miss:

- **Wrong-axis floors.** `.panel-list__zoom-button` declares `width: 22px` as well as `height: 22px`. A height-only floor yields a 22x44 target that satisfies any `min-height: 44px` check.
- **Vacuous measurement.** HEL-781's own first-round verification task measured the zoom buttons at 430px, where they are `display: none` — a guaranteed pass that proves nothing. Any guard must assert it measured a *rendered, visible* element.

Related: HEL-777 documented that for controls using the sanctioned `::after` hit-expander instead of a `min-height` floor, `getComputedStyle(el, "::after").width` also cannot detect the real failure — overlapping expanders steal neighbours' taps while each computes a full 44px. A guard covering expander-based controls must bisect the real hit extent with `elementFromPoint`.

### Proposed approach

A **runtime, rendered-measurement sweep** — most likely a Playwright spec in `e2e/`, alongside the existing specs there — that:

1. enumerates interactive controls (`button`, `a[href]`, `[role="button"]`, form controls, and the app's own control classes) across the primary surfaces at mobile widths (430px and 768px at minimum);
2. asserts `getBoundingClientRect()` **on both axes** meets the floor;
3. skips non-rendered elements explicitly, and **fails if the sweep matched zero visible elements** on a surface — so the suite cannot pass vacuously;
4. includes at least one discriminating control that should *not* be floored, proving the probe distinguishes;
5. for any control using the `::after` hit-expander pattern, bisects the real hit extent with `elementFromPoint` per `DESIGN.md`'s Control-metrics clause, with the `>= 44 - samplingStep` epsilon.

Whatever the final shape, the binding requirement is: **the guard must be able to fail on an inert cascade.** If a proposed implementation would have passed HEL-535's original bug, it is the wrong implementation — verify this explicitly by reproducing that bug (move the `@media` block above the base rule) and confirming the guard goes red.

## Acceptance Criteria

- [ ] A guard exists that measures rendered geometry on both axes at mobile widths, not stylesheet text
- [ ] Demonstrated red: reintroducing HEL-535's above-base-rule `@media` placement (or an equivalent inert floor) makes the guard fail; evidence captured
- [ ] Demonstrated red: a height-only floor on a control that also declares a fixed `width` makes the guard fail
- [ ] The sweep fails rather than passes when it matches zero visible candidates
- [ ] At least one intentionally-unfloored control is asserted to stay unfloored (probe discriminates)
- [ ] Surfaces covered are enumerated explicitly, and anything deliberately out of scope is named in the ticket/PR rather than silently omitted
- [ ] Runs in CI

## Scope note

Fixing any *new* violations the guard uncovers is likely a separate ticket — land the guard against the current state (allowlisting known violations if necessary, each with a filed ticket), rather than letting an open-ended remediation sweep block the mechanism.

## Reference

- `DESIGN.md` §8 (accessibility baseline), §5 (control metrics, incl. the HEL-777 `::after` clause) — see lines 193-224 of DESIGN.md for the exact epsilon/bisection requirement.
- `frontend/src/shared/ui/*.css.test.ts` — the precedent to **avoid** for this purpose
- `e2e/` — existing Playwright spec conventions (naming: `helNNN-description.spec.ts`)
- Origin: final-gate escalation on HEL-781 (PR #425, merge `4ea106fa`)

## Orchestrator directives (from the delivery request, binding)

- MUST NOT be built on the `frontend/src/shared/ui/*.css.test.ts` text-matching precedent.
- MUST be a runtime, rendered-geometry sweep (Playwright, in `e2e/`), asserting `getBoundingClientRect()` on both axes at 430px and 768px minimum.
- MUST demonstrate RED for: (a) HEL-535's above-base-rule `@media` inert-floor bug, reproduced live and confirmed red, with captured evidence; (b) a height-only floor on a control that also declares a fixed width.
- MUST fail (not pass) when a surface sweep matches zero visible elements.
- MUST include at least one intentionally-unfloored control asserted to stay unfloored.
- Controls using the `::after` hit-expander pattern MUST be verified via `elementFromPoint` bisection with the `>= 44 - samplingStep` epsilon (DESIGN.md lines 215-223), not `getComputedStyle`.
- Any new violations the guard uncovers should be allowlisted with a filed follow-up ticket each, rather than blocking on an open-ended remediation sweep — land the guard against current state.
- Explicitly enumerate covered surfaces and name anything deliberately out of scope.
- Guard MUST run in CI.
