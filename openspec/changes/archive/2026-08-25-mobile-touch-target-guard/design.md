## Context

Seven per-incident sub-44px fixes (HEL-745/747/314/319/535/548-spinoff/781) with no decreasing rate.
`DESIGN.md` §5 states a literal 44px min-height/min-width mobile floor (430/768 breakpoints) plus a
sanctioned `::after` hit-expander alternative with an `elementFromPoint`-bisection verification
requirement (HEL-772/HEL-777). The existing `frontend/src/shared/ui/*.css.test.ts` tests match
stylesheet source text/structure and are the documented, binding-to-avoid precedent: HEL-535 shipped an
`@media`-above-base-rule inert floor that such a test cannot see, because the string `min-height: 44px`
is present in source regardless of whether the cascade ever applies it at runtime.

There is currently no e2e/CI wiring for a full-stack Playwright run: `e2e/` specs (e.g. `hel773-*`,
`hel716-*`) are run on-demand via `npm run e2e` against `start-servers.sh`-launched dev servers, and
`.github/workflows/ci.yml` has no job that starts backend+frontend+DB and runs Playwright. "Runs in CI"
is a binding acceptance criterion here, so this change also adds that job.

## Goals / Non-Goals

**Goals:**
- A Playwright spec measuring rendered `getBoundingClientRect()` on both axes, at 430px and 768px, on
  an explicit set of covered surfaces.
- Fail (not pass) on zero visible matches per surface.
- At least one asserted-unfloored control (discrimination proof).
- `::after` hit-expander controls verified via `elementFromPoint` bisection with the DESIGN.md epsilon.
- A demonstrated-RED regression harness for (a) HEL-535's inert-`@media` shape and (b) a height-only
  floor on a fixed-width control — run once, evidence captured, not part of the steady-state CI gate
  (mutating real source to a known-broken shape is not something CI should do on every run).
- CI wiring so the steady-state guard spec actually runs on PRs/pushes to main.
- Explicit surface enumeration; explicit named exclusions.

**Non-Goals:**
- Fixing any newly-discovered violation inline (filed as a follow-up ticket instead, per the ticket's
  own scope note).
- Replacing the `*.css.test.ts` source-structure tests — they still catch a different, useful thing
  (that the token/rule exists at all); this change adds a second, independent runtime layer.
- Full-app surface coverage. Surfaces are named explicitly below; anything unlisted is out of scope.
- General Playwright/CI infra hardening beyond what this one job needs.

## Decisions

### D1 — Guard shape: one steady-state Playwright spec + a separate one-shot regression harness
`e2e/hel813-mobile-touch-target-floor.spec.ts` is the CI-run guard. A second file,
`e2e/hel813-mobile-touch-target-floor.regression.spec.ts`, intentionally patches known-good source into
each of the two known-bad shapes (inert `@media`, height-only-on-fixed-width) via a temporary,
self-reverting file mutation, re-runs the *same* measurement helper against the patched build, and
asserts red. This file is **not** added to the CI job (mutating source mid-run is not a steady-state CI
op) — it is run once locally by the executor, its output captured as this change's evidence, and its
existence + how to re-run it documented in the PR body. This satisfies "guard must be able to fail on
an inert cascade" without making CI itself mutate source on every run.

**Regression harness isolation (skeptic CR3):** `playwright.config.ts` has `testDir: "./e2e"` with no
`testIgnore`, so a bare `npm run e2e` would pick up the regression file and mutate real source by
default. `playwright.config.ts` gets a `testIgnore: ["**/*.regression.spec.ts"]` entry, and the
regression file itself additionally guards every test with
`test.skip(!process.env.HEL813_REGRESSION, "opt-in only - see e2e/README.md")` as a second, independent
layer (belt-and-suspenders: the config entry keeps it out of the default run; the env guard keeps it
inert even if invoked with an explicit path). Documented in `e2e/README.md` and the PR body: run via
`HEL813_REGRESSION=1 npx playwright test e2e/hel813-mobile-touch-target-floor.regression.spec.ts`.

**Green-before/red-after pairing (skeptic CR7):** each regression case captures three measurements of
the same control via the same helper - baseline PASS (before mutation), FAIL (after mutation), PASS
again (after revert) - not just a bare "goes red." This is what actually proves the guard's
*sensitivity* to the mutation rather than merely that the mutation broke something unrelated.

**Alternative considered:** synthesize the inert-floor/wrong-axis shapes as inline HTML fixtures
(`page.setContent`) instead of mutating real component source. Rejected: HEL-535's actual bug was a
specificity interaction between two real cascade layers in the real stylesheet — a synthetic fixture
risks re-implementing a simplified version of the cascade that trivially fails, proving nothing about
whether the guard would have caught the *actual* historical bug. Mutating a real, currently-passing
source file (then reverting it) is the only way to honestly reproduce "would this guard have caught
HEL-535."

### D2 — Measurement helper, shared between both files
A small helper module (`e2e/support/touchTargetProbe.ts`) exports:
- `measureBox(locator): { width, height, visible }` — visibility-gated `getBoundingClientRect()`.
- `assertFloor(locator, { minPx = 44 })` — fails on either axis, fails on `visible === false`.
- `bisectHitExtent(page, centerPoint, axis, samplingStep)` — `elementFromPoint` bisection for
  `::after`-expander controls; **asserts inside the helper** against `>= 44 - samplingStep` (skeptic
  non-blocking note: assert here, not in the caller, so no call site can reintroduce a literal `>= 44`).
- `assertHiddenAtWidth(locator)` — asserts a control is genuinely non-rendered (zero-area or
  `display: none` / not in the accessibility tree) at the current viewport, for controls DESIGN.md
  intends to be hidden rather than floored at a given width (e.g. HEL-781's zoom controls at 430px).
  Distinct from, and never satisfies, `sweepSurface`'s non-zero visible-match requirement below.
- `sweepSurface(page, { selectors, exempt = [] })` (skeptic CR1 — exemption contract) — runs
  `assertFloor` over every visible match from `selectors` **except** any element also matched by an
  `exempt` entry (`{ selector, reason, ticket? }`); every `exempt` entry is logged (reason + optional
  ticket id) in the run output so an allowlist skip is auditable from CI output alone. Exempt matches
  are asserted to exist (so an exemption for a control that silently stopped rendering isn't a
  false-quiet pass) but are **not** counted toward, and cannot on their own satisfy, the non-zero
  visible-floored-match requirement — a surface consisting only of exempt matches still fails.

Both the steady-state spec and the regression harness import this helper, so "the same measurement
logic goes red on the known-bad shape" is structural, not just asserted in prose.

### D3 — Covered surfaces (explicit enumeration)
At 430px and 768px, logged in as the seeded dev user (mirrors `hel773`'s register-and-login pattern):
1. Mobile nav sheet / command bar (icon buttons, avatar trigger — `::after`-expander controls per
   HEL-772/777).
2. Settings page controls (HEL-747).
3. Toast/notification dismiss + action controls (HEL-535).
4. Empty-state CTAs (Modal/EmptyState shared chrome — HEL-319/548).
5. `ui-select`/actions-menu triggers (HEL-314).
6. Panel-list zoom/add controls (HEL-781) — the zoom controls are asserted hidden at 430px via
   `assertHiddenAtWidth` (skeptic CR5: separate from `sweepSurface`, since they are expected-hidden at
   this width, not expected-floored), and `.panel-list__add` is asserted floored via `sweepSurface` in
   the same surface pass at 430px, so the surface still yields a real non-zero visible-floored match and
   is not vacuously satisfied by the hidden-check alone.

**Explicitly out of scope** (named per the ticket's requirement, not silently omitted):
- Desktop-only surfaces/breakpoints (auth `--control-lg`, dashboard-builder desktop chrome) — DESIGN.md
  states the 44px floor is mobile-only by design.
- Third-party-rendered chart internals (chart library's own SVG/canvas interaction targets) — not
  Helio-authored chrome, no DESIGN.md control-token applies.
- Any surface not reachable without data that doesn't exist in a fresh seeded account (e.g. a specific
  populated pipeline/report state) — covering those is follow-up scope, not blocking this guard.

### D4 — Discriminating (intentionally-unfloored) control
`input[type="color"]` accent/appearance-picker swatches are DESIGN.md's own named exemption. Per D2's
exemption contract, the swatch is passed as a `sweepSurface` `exempt` entry
(`{ selector: 'input[type="color"]', reason: "DESIGN.md-exempt color swatch" }`) on the settings
surface sweep, and the guard separately asserts the swatch's rendered size directly via `measureBox` and
confirms it is *not* 44px — proving both that the guard doesn't blanket-flag every small control and
that the exemption isn't silently swallowing a control that actually needs the floor.

### D5 — CI wiring
Add a new `e2e` job to `.github/workflows/ci.yml`: a `postgres:16` service container (matching
`embedded-postgres` used in backend tests, so behavior parity is closest to what's already trusted),
`sbt run` for the backend and a Vite preview/dev server for the frontend (mirroring
`scripts/concertino/start-servers.sh`'s health-wait shape, reimplemented as inline CI steps since that
script is a Concertino dev-loop tool, not meant for CI), `npx playwright install --with-deps chromium`,
then `npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts` — scoped to *this* new guard
spec only, not the full `e2e/` directory (the other existing specs were never CI-gated and making them
so is out of scope for this change; expanding CI's e2e job to cover them is a natural follow-up, not
bundled here).

## Risks / Trade-offs

- **CI runtime/flakiness.** A new full-stack (postgres+backend+frontend+browser) CI job is slower and
  has more moving parts than the existing unit-test jobs. Mitigated by scoping the CI-run job to only
  the one new spec file, and reusing the already-trusted `embedded-postgres`-equivalent service
  container shape from backend tests.
- **Regression harness source mutation.** Patching real component source, even temporarily and
  self-reverting, is inherently a little dangerous if the process is interrupted mid-mutation. Mitigated
  by running it via a script with a `try/finally`-style guaranteed revert and a `git diff --exit-code`
  post-check as a belt-and-suspenders confirmation that the working tree is clean afterward.
- **`elementFromPoint` bisection cost.** Bisecting hit extents is more expensive than a bounding-box
  read. Scoped to only the known `::after`-expander controls (mobile nav/command bar), not swept
  app-wide.

## Planner Notes

- Surface list (D3) is the orchestrator's own judgment call, grounded in the seven cited incident
  tickets plus DESIGN.md's own named exemption (D4) — self-approved as within-ticket-scope per the
  ticket's own proposed-approach section, which names the same surfaces.
- CI-scoping decision (D5, guard-spec-only rather than all of `e2e/`) is a scope-boundary judgment call,
  self-approved: broadening CI to the other six pre-existing specs is unrelated existing-debt cleanup,
  not part of this ticket's mechanism, and risks derailing this change on unrelated flakiness in specs
  this ticket didn't write.
