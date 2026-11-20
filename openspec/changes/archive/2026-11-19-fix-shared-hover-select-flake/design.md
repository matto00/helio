## Context

See proposal.md - Why. Facts gathered at planning (from the CI logs listed in ticket.md):

- `playwright.config.ts` sets `fullyParallel: false`, so the whole spec runs on ONE worker in file order: touch dark,
  touch light, desktop dark, desktop light. This order is identical in the passing run (94a8ef292, tests
  104/105/109/112) and the failing runs (104/108/112/114). Spec order alone therefore does not explain pass vs fail;
  the module-level `touchMode` lead must be checked against that, not assumed.
- What does differ is runner speed, not neighbour identity: failing legs finished in ~12 m (119 passed in 12.2 / 12.0 /
  11.9 m) against 17.5 m for the passing leg; failing desktop dark took 18.2-18.9 s and light failed at 8.7-9.2 s, against
  32.6 s / 28.6 s passing. `hel1783-shared-dashboard-tabs` overlapped the desktop light test in BOTH: passing, test 112
  ran ~02:39:26-02:39:54.9 and the hel1783 owner registered at 02:39:39.75; failing, it overlaps likewise. Neighbour
  identity is therefore not the discriminator; the faster runner is the one that fails.
- **The failing "rest" read is the hovered paint.** All three failing logs print the `not.toEqual` operand as border
  `rgba(33, 29, 25, 0.2)`, which is light `--app-border-strong` (`theme.css:462-463`; rest is `--app-border-subtle`
  `rgba(33, 29, 25, 0.11)`). Only the `(hover: hover)` `:hover` rule (`inputs.css:30-35`) produces it; focus-visible
  and aria-invalid use other colours and `PipelineMobile.css:600/637` exclude the trigger. The rest read equals
  `DESKTOP_HOVER.light["3 Select trigger"]`; the hover read was correct. The trigger already matched `:hover` (or was
  mid-transition from it, `--app-transition` 0.16 s, `theme.css:148`) at the rest read (spec line 368).
- The failing test aborts on instance 3 (`.ui-select__trigger` in the step sheet) on its first `expect(...).not.toEqual`.
  Instances 1-2 already passed in that same test. Real failing-run traces exist: the
  `playwright-report-shard-2` artifacts of runs 44667845106 (main@beb94adfe) and 44664959871 (PR #1188, both
  attempts) each hold `test-results/.../trace.zip`, `backend.log` and `frontend.log`; they EXPIRE 2026-11-27. The
  passing run has no trace (`retain-on-failure`).
- Select hover CSS: `frontend/src/shared/ui/inputs.css` — `@media (hover: hover) { .ui-select__trigger:hover:not(:disabled)
  { border-color: var(--app-border-strong) } }`, with a `transition` on border/box-shadow/background. Feature overrides
  exist in `features/pipelines/ui/mobile/PipelineMobile.css` (the sheet is the phone layout at 390x844).
- The spec reads `rest` right after `inst.open(page)`, whose last pointer action is the click on `.spine-row__select`
  that opened the sheet. Whether the pointer then sits over the Select trigger (making "rest" already hovered) depends
  on sheet geometry and pointer position, which is a candidate the probe must confirm or eliminate.

## Goals / Non-Goals

**Goals:** a probe-confirmed root cause; a fix at the layer that is actually wrong; the desktop light and dark cases
stable with the CI shard neighbours; every existing assertion kept.

**Non-Goals:** HEL-1735's feature-stylesheet hover gating; shard re-weighting; CI worker changes; touching the touch
describe's assertions beyond what the root cause requires.

## Decisions

1. **Probe before fix (systematic-debugging law).** The executor first instruments the failing read — for instance 3,
   log the pointer position (from the last mouse action), `elementFromPoint` at that position, whether the trigger
   `:hover`-matches, `document.activeElement`, every running/pending animation and transition on the trigger
   (`el.getAnimations()` with property and currentTime), the trigger's `getBoundingClientRect`, and the full PAINT
   for rest and hover. **Step 0 (trace-first):** download all three failing-run artifacts (`gh run download <run>
   -n playwright-report-shard-2 -D .concertino/scratch/HEL-1790/ci-trace-<run>[-<attempt>]`), persist the three
   `trace.zip` files to `.concertino/runs/HEL-1790/evidence/` immediately, and extract for instance 3: the `openSheet`
   click point, the `control.hover()` point, the trigger's bounding box in the DOM snapshot at the rest read, and the
   timing between the click, sheet-visible check, `noAnimations` and the `paint` evaluate; record whether the click
   point is inside the trigger's box. The named cause must be consistent with this real-run evidence: a cause the CI
   trace contradicts is not confirmed even if a local forced guard reproduces it. Then reproduce locally (needed for
   discriminator (c), which no trace covers). Reproduction recipe, in order of preference:
   (a) run the CI leg's exact file set and order: `node scripts/e2e-shard.mjs plan 7` to obtain leg 2's files, then
   run that selection with 2 workers against a lane backend; (b) if it does not reproduce, add the concurrent
   neighbours alone (`hel1752-output-editor-footer-fit`, `hel1783-shared-dashboard-tabs`) with this spec, 2 workers;
   (c) vary CPU (e.g. CPU throttling via CDP `Emulation.setCPUThrottlingRate`) only to test a timing hypothesis the
   probe has already named. Lane `DEV_PORT`/`BACKEND_PORT` are exported for every run (`playwright.config.ts:9-18`).
   **Primary probe question:** why is the trigger hover-painted (or mid-transition from hover) at the `rest` read in
   light but not dark? **Completeness bar for "named root cause":** with probe output, the cause must account for
   (a) light fails 3/3 while dark passes 3/3 in the same runs; (b) instances 1-2 pass in the same test and only
   instance 3 fails; (c) the passing runs (94a8ef292, cfb6041bf) vs the failing ones (beb94adfe, PR #1188), e.g. via
   runner speed. A cause that explains the failing read but not these discriminators is not probe-confirmed. If local
   natural reproduction fails, a temporary CI-only diagnostics commit (printing the Decision 1 data on the real runner)
   is allowed and is removed before the fix commit. Rejected alternative: changing the test until CI goes green without a
   reproduction — that is exactly what the ticket forbids.
2. **Red probe committed first.** Once a probe reproduces the failure deterministically (or with a measured rate,
   stated), commit it — as a probe spec or as a deterministic red variant of the existing test — before the fix
   commit. Its output is persisted under `.concertino/runs/HEL-1790/evidence/`.
3. **Fix at the wrong layer only.** The observed failures contradict the product "hover does not paint" branch (the
   hover read was correct; the rest read was hovered), so that branch stands only if the probe produces new contrary
   evidence. If the test reads "rest" under a pointer that already hovers the control, or reads
   during a pending transition, fix the test so "rest" is read with the pointer provably off the control and "hover"
   after the transition provably ended (asserted, not slept). If instead a real mouse hover does not paint (product
   CSS), fix `inputs.css` (or the overriding feature stylesheet) with a red-first unit/e2e test, and add a spec delta
   (remove `skip_specs`). If that product fix would have to change hover gating in feature stylesheets beyond the
   Select trigger, STOP and raise an ESCALATION (HEL-1735 scope) instead of deciding.
4. **No weakened assertion.** The `not.toEqual(rest)` per instance and the final `toEqual(DESKTOP_HOVER[theme])` stay
   as written (strengthening is allowed, e.g. asserting `elementFromPoint` is inside the control before reading hover,
   or off it before reading rest). No retries, no `test.fixme`, no timeout increase unless the probe proves timing.
5. **Mutation proof.** Show the fix is load-bearing: with the fix reverted (or the probed condition re-imposed), the
   probe/test goes red; with it, green.

## Risks / Trade-offs

- [Local machine cannot reproduce CI timing] → use the exact leg selection and neighbours, then CPU throttling for a
  named timing hypothesis, then the CI-only diagnostics commit. A probe that FORCES the named condition counts as red
  only if it reproduces CI's exact signature (rest paint equal to the light hover values above), is labelled a
  forced-condition guard (not a reproduction), and the local natural-reproduction rate is stated (including 0/N).
- Candidates to test, not conclusions: Chromium's synthetic mouse move after layout/scroll changes (load-dependent
  timing, so `:hover` turns on under a pointer that never moved); `noAnimations` ignoring transitions not yet running.
- Instance 2 is `probeOnly`, but the desktop loop asserts `not.toEqual` for all six; a test fix keeps it that way.
- [Root cause is a shared-backend interaction with `hel1783`] → probe output names it; fix stays in this spec.
- [Fix hides a real product defect] → Decision 3's product branch and Decision 5's mutation proof.

## Planner Notes

- Fix preference: assert an observable precondition before the rest read (e.g. `elementFromPoint` at the last pointer
  position is outside the control and `el.matches(":hover") === false`, verified to be truthful on desktop) rather
  than an unasserted mouse move.
- Self-approved: test-first assumption with `skip_specs: true`, reversible per Decision 3.
- Lane DB `helio_hel1790` (driver C14); lane backend with `ANTHROPIC_API_KEY` exported empty; Playwright 2 workers.
