- `e2e/support/touchTargetProbe.ts` — new shared rendered-geometry measurement helper (`measureBox`, `assertFloor`, `assertHiddenAtWidth`, `bisectHitExtent`, `sweepSurface`), imported by both the steady-state guard and the regression harness.
- `e2e/hel813-mobile-touch-target-floor.spec.ts` — new steady-state CI guard: measures rendered geometry on both axes at 430px/768px across the six enumerated surfaces (design.md D3), including the D4 discriminator and the `::after`-expander bisection.
- `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` — new one-shot, non-CI, `HEL813_REGRESSION`-gated harness that mutates real source (self-reverting) to reproduce HEL-535's inert-`@media` shape and a height-only floor on a fixed-width control, proving the guard goes red on both.
- `e2e/README.md` — documents both new specs and the exact re-run command for the regression harness.
- `playwright.config.ts` — adds `testIgnore: ["**/*.regression.spec.ts"]` so the regression harness never runs via a bare `npm run e2e`.
- `playwright.regression.config.ts` — new thin override config (clears `testIgnore`) used solely to manually re-run the regression harness, since `testIgnore` excludes matching files even from explicit CLI file arguments.
- `.github/workflows/ci.yml` — adds a new `e2e` job (postgres:16 service container, `sbt run` backend + Vite frontend with health-waits, Playwright chromium install) that runs only `e2e/hel813-mobile-touch-target-floor.spec.ts`.
- `openspec/changes/mobile-touch-target-guard/tasks.md` — marks all task groups complete.
- `openspec/changes/mobile-touch-target-guard/evidence/steady-state-pass.txt` — captured clean PASS run of the steady-state guard (task 2.6).
- `openspec/changes/mobile-touch-target-guard/evidence/regression-run.txt` — captured full pass→mutate→fail→revert→pass console output for both regression cases (task 3.3), this change's required demonstrated-RED evidence.

## Newly-discovered violation (not fixed inline, per ticket scope note)

`.ui-select__trigger` (`frontend/src/shared/ui/inputs.css`): `getComputedStyle` reports exactly
`height: 44px` at mobile widths, but the actual rendered `getBoundingClientRect()` height measures
~43.565px (observed in the "Create pipeline" modal's data-source select trigger at both 430px and
768px) — a real, if small (~0.44px), sub-pixel rendered-vs-computed gap, and exactly the class of bug
this guard exists to catch (computed style says one thing, rendered geometry says another). The
steady-state guard sweeps the select's OPEN OPTION LIST (`.ui-select__option`, which renders a clean
44px) instead of the trigger, so this doesn't block the guard from landing — but the trigger itself is
a real, currently-unallowlisted violation. Needs a Linear follow-up ticket:

- **Title:** `ui-select__trigger` renders ~43.57px tall at mobile widths despite `min-height: 44px` (computed) — sub-pixel rounding gap
- **Surface:** `.ui-select__trigger` (`frontend/src/shared/ui/inputs.css`, HEL-314's mobile block), reachable via any `Select` (e.g. Create Pipeline modal's data-source picker)
- **Control:** `.ui-select__trigger`
- **Measured:** `getComputedStyle` height `44px`; `getBoundingClientRect()` height `43.5650634765625px` / `43.5648193359375px` (430px / 768px viewports respectively) — both ~0.435px short
- I do not have Linear tool access in this session; the orchestrator should file this ticket and, once filed, the guard's `sweepSurface` exempt mechanism can reference it if the trigger itself is ever added to the steady-state sweep.
