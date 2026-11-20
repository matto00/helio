## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD beb94adfe49759ebc8e180500130a032fdfac3b4 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/hel1675-hover-flake/HEL-1790`.
- **Config:** `playwright.config.ts:190-191` has `retries: 0` and `fullyParallel: false`; `:202` sets `workers: process.env.CI ? 2 : localWorkers()`. Confirmed.
- **Spec order and test ids:** passing run (`HEL-1790/pass-main-94a8.log`) has touch dark 104, touch light 105, desktop dark 109, desktop light 112. The three failing logs have 104/108/112/114. Confirmed.
- **Durations:** passing desktop dark 32.6 s and light 28.6 s. Failing: desktop dark 18.8 / 18.2 / 18.9 s, light fails at 9.2 / 8.7 / 8.8 s. Confirmed. Not stated in the design: the failing legs are much faster overall (119 passed in 12.2m / 12.0m / 11.9m, against 120 passed in 17.5m for the passing run). The slower runner is the one that passes.
- **Failure site:** all three failing logs show `Error: 3 Select trigger must differ from rest on hover` at `hel1675-shared-hover.spec.ts:374`. Confirmed.
- **Neighbour overlap claim — FALSE.** The design says the passing run has "`hel1752` overlaps, `hel1783` runs after". The passing log disagrees:
  - desktop light test 112 ends at `02:39:54.87` after 28.6 s, so it starts at about `02:39:26.3`;
  - `hel1783-owner-...` registers at `02:39:39.75` (log line 2006).

  So `hel1783` ran alongside the light test for about 15 s in the passing run too. It overlapped the light test in every run, passing or failing.
- **Decisive fact the design omits: the failing "rest" paint is the hovered paint.** Every failing log prints the `not.toEqual` operand: `{"backgroundColor": "rgb(239, 236, 230)", "borderTopColor": "rgba(33, 29, 25, 0.2)", ..., "color": "rgb(33, 29, 25)", ...}` (`e2e2-fail.log`; the same line is at `main-e2e2.log` +18 from 1976).
  - `theme.css:462-463` define light `--app-border-subtle: rgba(33, 29, 25, 0.11)` and `--app-border-strong: rgba(33, 29, 25, 0.2)`.
  - `inputs.css:12` gives a trigger at rest `--app-border-subtle`. Only the `(hover: hover)` `:hover` rule (`inputs.css:30-35`) sets it to `--app-border-strong`. `:focus-visible` uses `--app-focus-ring-color` plus a box-shadow. `aria-invalid` uses `--app-error`. `PipelineMobile.css:600/637` explicitly exclude `.ui-select__trigger`.
  - So the value read as "rest" is exactly `DESKTOP_HOVER.light["3 Select trigger"]` (spec lines 256-264). The hover read was correct. The rest read was taken while the trigger already matched `:hover`, or while it was still transitioning from `:hover`.
  - This fact is already in hand. It contradicts the "a real mouse hover genuinely fails to paint" product branch for the observed failures, and it narrows the probe to one question: why is the trigger hover-painted at the `rest` read (spec line 368) in light, but not in dark?
- **Mechanism plausibility:** the trigger's `transition` on border-color is `var(--app-transition)` = 0.16 s (`theme.css:148`; 0.01 ms under the overrides at `:315/:331`). `openPipeline` (`hel1582Phone.ts:207-217`) sets localStorage and does `goto`. The mouse position survives navigations. `openSheet` clicks `.spine-row__select`, which moves the pointer to that row's centre, and the sheet then opens over that point. The design's pointer-geometry candidate is consistent with the CI value.
- **Recipe tooling:** `scripts/e2e-shard.mjs plan [<count>]` exists (line 5, 415-418). `run <i> <n>` spawns `npx playwright test` with ambient env (lines 326-327), so `DEV_PORT`/`BACKEND_PORT` must be exported for the lane (`playwright.config.ts:9-18`, CON-165).
- **Scope / ACs:**
  - AC1 is covered by tasks 1.2-1.4.
  - AC2 is covered by 3.1.
  - AC3 is covered by 2.2 and Decision 4.
  - **AC4 ("CI on main is green") has no task.**
- **Placeholders:** none (no TODO/TBD). `skip_specs` with a reversal path is explicit and acceptable.

### Verdict: REFUTE

The investigation-first structure is sound: probe before fix, red committed first, a mutation proof, no weakening, and an escalation hook for HEL-1735. The revisions below are cheap. Without them, though, the executor starts from one false planning fact, ignores the strongest evidence already in the logs, and has no bar that stops a plausible but incomplete root cause.

### Change Requests

1. **Correct the neighbour fact (design.md Context, bullet 2).** `hel1783-shared-dashboard-tabs` overlapped the desktop light test in the passing run as well. Its owner registered at `02:39:39.75` while test 112 ran from about `02:39:26` to `02:39:54.87` (`pass-main-94a8.log`). Restate the real differentials:
   - runner speed: legs took 12m when failing against 17.5m when passing, and the light test failed at about 9 s against 28.6 s;
   - the exact overlap windows.

   Do not present neighbour identity as the discriminator.
2. **Record the failing rest value and its meaning (design.md Context, plus Decisions 1 and 3).**
   - The rest paint printed in all three failing logs equals `DESKTOP_HOVER.light["3 Select trigger"]`, with border `rgba(33, 29, 25, 0.2)` = light `--app-border-strong`. Only the `:hover` rule produces that value (`inputs.css:30-35`).
   - State in Decision 3 that the observed failures contradict the product "hover does not paint" branch. Keep that branch only if the probe produces new contrary evidence.
   - Make the probe's primary question explicit: why the trigger is hover-painted, or mid-transition from hover, at the `rest` read (spec line 368).
3. **Add a completeness bar for "named root cause" (Decision 1 / task 1.4).** The named cause must account for, with probe output, each of these:
   - (a) light fails 3/3 while dark passes 3/3 in the same runs;
   - (b) instances 1-2 pass in the same test, and only instance 3 fails;
   - (c) the passing runs at 94a8f/cfb6 against the failing beb94/PR runs, for example through runner speed or timing.

   A cause that explains the failing read but not these discriminators is not probe-confirmed.
4. **Tighten the forced-condition fallback (design.md Risks, bullet 1).** A probe that forces the pointer over the trigger before the rest read counts as red only if:
   - it reproduces CI's exact signature (rest paint equal to the hover values above);
   - it is labelled a forced-condition guard, not a reproduction;
   - the local natural-reproduction rate is stated, including 0/N.

   Otherwise the "red" is true by construction and proves nothing about CI.
5. **Cover AC4 with a task (tasks.md §3).** Add a task that:
   - pushes the branch and observes the PR's `e2e (2)` leg green, recording the run and job ids;
   - after merge, confirms main's `e2e (2)` green, or explicitly hands this to the delivery phase and names the check.
6. **Disambiguate "CI neighbours" (task 3.1).** Require at least one `--repeat-each` run over the full leg-2 file selection from `node scripts/e2e-shard.mjs plan 7`, at 2 workers, with lane `DEV_PORT`/`BACKEND_PORT` exported (not a bare `e2e-shard.mjs run`, which inherits ambient ports). Add the focused `hel1752`/`hel1783` set as a supplementary run. Report both counts.

### Non-blocking notes

- CI does produce `trace.zip` (the logs print an attachment path) but does not upload it. If local reproduction fails, a temporary CI-only probe commit that prints the diagnostics in Decision 1 would get the real runner's signal. Remove it before the fix commit.
- For the fix, prefer asserting an observable precondition before the rest read over a mouse move without an assertion: for example `elementFromPoint` at the last pointer position is outside the control, and `el.matches(":hover") === false`. Bear in mind the spec header warns that `:hover` matching can lie for touch. On desktop that warning should not apply, but verify it.
- `TICKET_TYPE: feature` in workflow-state.md, for a bug ticket. This is cosmetic unless downstream gating keys on it.
