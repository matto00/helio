## 1. Shared measurement helper

- [x] 1.1 Create `e2e/support/touchTargetProbe.ts` with `measureBox`, `assertFloor`, `bisectHitExtent`
      (asserting `>= 44 - samplingStep` internally), `assertHiddenAtWidth`, and
      `sweepSurface(page, { selectors, exempt })` (design.md D2). `exempt` entries are excluded from the
      floor assertion, logged with reason/ticket, and cannot satisfy the non-zero visible-floored-match
      requirement on their own. `sweepSurface` fails when it matches zero visible *floored* candidates.

## 2. Steady-state CI guard spec

- [x] 2.1 Create `e2e/hel813-mobile-touch-target-floor.spec.ts`, following the `hel773`
      register-and-login pattern, parameterized over 430px and 768px.
- [x] 2.2 Cover the six surfaces enumerated in design.md D3: mobile nav sheet/command bar,
      settings page, toast/notification controls, empty-state CTAs, ui-select/actions-menu triggers,
      panel-list zoom/add controls. For surface 6: assert the zoom controls hidden at 430px via
      `assertHiddenAtWidth` (a separate assertion from the surface's `sweepSurface` call), and assert
      `.panel-list__add` via `sweepSurface` in the same pass so the surface still yields a real
      non-zero visible-floored match (design.md D3/CR5).
- [x] 2.3 Assert both-axis floors via `assertFloor`/`sweepSurface` on every floored control in 2.2.
- [x] 2.4 Add the `::after`-expander bisection assertions (mobile nav/command bar icon buttons + avatar
      trigger) via `bisectHitExtent`.
- [x] 2.5 Add the discriminating unfloored-control assertion (D4): pass the `input[type="color"]`
      swatch as a `sweepSurface` `exempt` entry on the settings surface, then separately `measureBox`
      it directly and assert it is below 44px, alongside a floored sibling control passing in the same
      sweep.
- [x] 2.6 Run the spec locally against dev servers; capture a clean PASS run's output as evidence.

## 3. Demonstrated-RED regression harness (evidence, not part of CI)

- [x] 3.1 Create `e2e/hel813-mobile-touch-target-floor.regression.spec.ts`, gated by
      `test.skip(!process.env.HEL813_REGRESSION, ...)` (design.md D1/CR3) so it is inert even if
      invoked directly, on top of the `testIgnore` added in task 4.3. For HEL-535's shape: measure the
      target control's floor via the shared helper and capture PASS (baseline, current source),
      temporarily rewrite the CSS to the above-base-rule `@media` inert shape, re-measure and capture
      FAIL (red), revert the file, re-measure and capture PASS again (design.md CR7 — full
      pass/mutate/fail/revert/pass sequence, not just a bare "goes red").
- [x] 3.2 In the same harness file, add the second case with the same three-point pairing: baseline
      PASS on a control that currently only carries `min-height: 44px`, temporarily add a fixed `width`
      below 44px, capture FAIL on the width axis, revert, capture PASS again.
- [x] 3.3 Run the regression harness locally with `HEL813_REGRESSION=1`; capture full console/output
      showing both cases' full pass/fail/pass sequences, then confirm `git status --short` is clean
      afterward (each case wrapped in try/finally so the revert runs even on assertion failure). This
      captured output is this change's required "demonstrated red" evidence for both AC bullets.
- [x] 3.4 Document in `e2e/README.md` and the PR body: what the harness does, the exact
      `HEL813_REGRESSION=1 npx playwright test e2e/hel813-mobile-touch-target-floor.regression.spec.ts`
      command to re-run it on demand, and why it is excluded from both the default `npm run e2e` run
      and the CI job (design.md D1/D5/Risks).

## 4. CI wiring

- [x] 4.1 Add an `e2e` job to `.github/workflows/ci.yml` per design.md D5: postgres service container,
      backend (`sbt run`) + frontend dev/preview server startup with health-waits, Playwright browser
      install, then `npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts` only.
- [x] 4.2 Push the branch, open the PR (or push to the existing PR branch), and capture the actual
      `gh pr checks` / `gh run view` output showing the new `e2e` job ran and passed — a YAML-validity
      review alone is not evidence a full-stack (postgres + `sbt run` + Vite + Playwright) job works
      (skeptic CR2). If the job is flaky/too slow to go green, surface that as a design finding rather
      than deferring verification.
- [x] 4.3 Add `testIgnore: ["**/*.regression.spec.ts"]` to `playwright.config.ts` so the regression
      harness is never picked up by a bare `npm run e2e` or the new CI job (design.md CR3).

## 5. Violation triage

- [x] 5.1 Run the steady-state spec (2.6) against current `main` state (not a fixed-up branch) to
      confirm what currently passes/fails.
- [x] 5.2 For any surface/control that fails against current state, file a follow-up Linear ticket per
      control/surface and add it as a `sweepSurface` `exempt` entry with that ticket id (per D2's
      exemption contract and the ticket's scope note) rather than fixing it inline.
- [x] 5.3 Record the full list of filed follow-up ticket ids (or "none — guard passes cleanly against
      current state") in the PR body.

## 6. Docs

- [x] 6.1 Note the new guard + its enumerated surfaces + explicit exclusions in the PR description
      (per the ticket's own requirement that scope be stated, not silently omitted).
