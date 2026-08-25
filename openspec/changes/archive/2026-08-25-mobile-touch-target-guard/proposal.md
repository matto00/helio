## Why

Seven independent sub-44px mobile touch-target regressions have shipped (HEL-745, 747, 314, 319, 535,
548's spinoff, 781), each fixed per-incident, at a non-decreasing rate. `DESIGN.md` §5/§8 states the
44px floor; nothing enforces it. The existing `*.css.test.ts` text-matching precedent cannot catch this:
it let HEL-535 ship an inert `@media`-above-base-rule floor undetected, and structurally cannot catch
wrong-axis floors or vacuous (non-rendered) measurements, both hit by HEL-781.

## What Changes

- Add a new Playwright spec (`e2e/hel813-mobile-touch-target-floor.spec.ts`) that sweeps interactive
  controls on primary mobile surfaces at 430px and 768px, measuring rendered `getBoundingClientRect()`
  on both axes — never stylesheet source.
- The sweep fails if it matches zero visible candidates on any covered surface (no vacuous pass).
- At least one intentionally-unfloored control is asserted to stay unfloored, proving discrimination.
- Controls using the `::after` hit-expander pattern are verified via `elementFromPoint` bisection with
  the `>= 44 - samplingStep` epsilon (DESIGN.md's Control-metrics clause), not `getComputedStyle`.
- Two regression-harness unit specs (not part of CI's steady-state guard) that mutate known-good source
  into HEL-535's inert-`@media` shape and a wrong-axis-only shape, respectively, and assert the guard
  goes red against each — captured as this change's RED evidence.
- Known current violations (if any survive the sweep) are allowlisted with a filed follow-up ticket
  each, not fixed here.
- Wired into a new CI job scoped to this guard spec (no CI Playwright job exists today).

## Capabilities

### New Capabilities

- `mobile-touch-target-verification`: a runtime, rendered-geometry sweep that enforces the DESIGN.md
  44px mobile touch-target floor across primary surfaces, on both axes, discriminating real floors from
  inert/wrong-axis/vacuous ones, including `::after` hit-expander bisection.

### Modified Capabilities

(none — no existing capability's requirements change)

## Non-goals

- Remediating any newly-discovered violation (filed as a follow-up ticket instead).
- Replacing or removing the existing `*.css.test.ts` source-structure tests.
- Covering every surface in the app — surfaces are explicitly enumerated in `design.md`; anything not
  listed there is out of scope for this change.

## Impact

- New files: `e2e/support/touchTargetProbe.ts`, `e2e/hel813-mobile-touch-target-floor.spec.ts`,
  `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` (opt-in only, excluded from the default
  `npm run e2e` run via `playwright.config.ts`'s `testIgnore`).
- CI: no Playwright job exists in `.github/workflows/ci.yml` today. This change adds a new `e2e` job
  scoped to the one new guard spec (not a glob over all of `e2e/` — the pre-existing specs there are
  not currently CI-gated, and broadening that is out of scope for this change).
- No production code changes unless a demonstrated violation is fixed inline (unlikely per scope note).
