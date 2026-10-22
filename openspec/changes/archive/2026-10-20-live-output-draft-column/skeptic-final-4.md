## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed HEAD: `0d225e632641dba03a6c0f676f047f98e5569ded`. Scope: the delta `4eab42cde..0d225e632`. That is the clean origin/main merge `5a3fe8075`, the docs commit `9a21136d5`, and the code commit `0d225e632` (10 files, +113/-9, frontend only). Earlier rounds (skeptic-final-1..3) already covered the rest of the change.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/live-output-draft-column/HEL-1632`.
- **Read the diff of 0d225e632 in full** (`git show 0d225e632 -- frontend`).

**Is `noAnimation` on the shared ChartPanel/ChartRenderer sound and contained? Yes.**
- `ChartPanel.tsx`: `noAnimation = false` is the default. When it is false, the new `useMemo` returns `motionOption` (the existing `useChartEntranceMotion` output) unchanged, so dashboard charts are byte-for-byte unaffected.
- When it is true, it spreads `animation: false, animationDurationUpdate: 0` over the option. That is the same root-level mechanism the existing Motion "Off" branch of `applyChartMotion` uses (`utils/chartAppearance.ts:334`), so no new ECharts behaviour is introduced.
- The memo depends on `[noAnimation, motionOption]`, so it is no more rebuild-prone than before.
- `grep -rn noAnimation frontend/src` (non-test): the only consumer that passes it is `LiveOutputRender.tsx:60`. `ChartRenderer` only forwards it.
- Tests: `ChartPanel.noAnimation.test.tsx` covers both on and off, and `LiveOutputColumn.parity.test.tsx` asserts the live render passes it. The evaluator's M2/M3 mutations show both guards fail when the change is reverted.

**`memo(LiveOutputColumnView)`:**
- Its props come from `useIdleCoalesced`'s `shown` object (`shown.page/presentation/selectedStepId`, held identical between flushes) plus `layout/expanded/onToggle`, now stable via `useCallback` in `PipelineSpineLayout`. So the memo actually bails out.
- The new test proves the view's hooks do not run for 10 edits inside the quiet window, then run at most twice.
- The stable `onToggle` is unguarded by any test (evaluator M4). It is non-blocking because the phone placement passes no `onToggle`, and a regression would only cost performance, never correctness.

**`QUIET_MS` 120 → 250:**
- `useIdleCoalesced.ts` is otherwise unchanged and `MAX_WAIT_MS` 1500 still bounds a continuous burst.
- The test was rescaled to `QUIET_MS / 5`, so it still asserts no flush mid-burst.

**Gates, fresh:**
- `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npx jest --testPathPatterns='liveOutput|useIdleCoalesced|ChartPanel|ChartRenderer|PipelineSpine|useChartEntranceMotion'` → 21 suites, 194 tests, all passed.
- `npm run typecheck` → exit 0.
- `eslint --max-warnings=0` on the changed panel files and `src/features/pipelines` → exit 0.

**e2e, fresh, my own run:**
- `start-servers.sh` 7064/9971 → `PASS servers`.
- Ran `npx playwright test e2e/hel1632-live-output.spec.ts e2e/hel1631-draft-mode.spec.ts --trace retain-on-failure` under the flock with nice -n 19 and 2 workers → **27 passed (1.8m)**.
- Log: `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/skeptic4-e2e.log`.

| Test | Edit 1 | Edits 2-10 |
|---|---|---|
| hel1631 per-edit | 26.1 ms | 11.5-16.7 ms |
| hel1632 :259 step-count | 24.2 ms | 14.0-19.0 ms |

- hel1632 :259 input to live-output: 268.8-279.9 ms.
- These reproduce the evaluator's c5 log (25.0/11.2-15.4; 26.4/14.4-19.8; 268.8-279.0) within noise.

**UI and design judgment** (screenshots from my run, 1280 px, both themes):
- `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/live-1280-light.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/live-1280-dark.png`
- The static render is unchanged from round 3: same chart, "live" marker, Rows out tile with "-3 vs last run", and caption. Light and dark match.
- This commit changes nothing visible at rest, only motion and timing.

### The motion trade-off against DESIGN.md §10/§11

- **What diverges.** DESIGN.md §10's "Where it is applied" table, row "Chart refresh", says that under Full a same-shape refresh morphs its series in place. The live Output column now never morphs, even under Full.
- **Why it is acceptable.** The surface redraws on every coalesced draft edit, and a 280 ms morph starting about 250 ms after each edit would stack animation frames onto the next edit's handler. That is exactly the cost this cycle is cutting.
- **What §11 requires is untouched.** The changed-rows flash is a CSS wash on the preview table, not the chart, and is unaffected.
- **Effect on the user.** The live column settles about 270 ms after typing stops (about 320-350 ms throttled per the evaluator). There is no in-between flicker, and the "live" marker stays truthful.
- **Verdict on it.** A reasonable, one-prop reversible call with nothing building on it. Under the overnight rule it belongs in the owner's list, not in a REFUTE.

### CI budget risk

- The delta only removes per-edit work: there is no animation, the view does not re-render mid-burst, and the coalesced flush lands later and less often.
- In the :259 helper each edit waits for the live tile (2 s timeout), so the edits are serialised. A 250 ms quiet window cannot push the count measurement into an overlapping render, and about 280-350 ms is well under the 2 s timeout.
- Nothing here can add latency to the step-count measurement.
- The residual CI risk on the 50 ms budget is the one the evaluator described: an unattributed fixed offset of about one frame between hel1632 and hel1631. It predates this delta and this delta does not make it worse.

### Verdict: CONFIRM

### Non-blocking notes

1. **List the divergence for the owner.** List the live-column "no chart refresh morph under Full" as a deliberate divergence from DESIGN.md §10's "Chart refresh" row in the PR and owner list. Ideally add a one-line carve-out to that table, or a design.md note, so the binding doc and the code agree. Neither design.md nor tasks.md mentions `noAnimation` today.
2. **The stable `onToggle` is not guarded by a test** (evaluator M4). It costs performance only if it regresses.
3. **Reference-mark markLines may still animate.** `referenceMarksOption.ts` sets `animation` on the markLine/markArea objects themselves (`!prefersReducedMotion()`), so with root `animation: false` they may still animate on a live redraw. This is the same as the existing Motion "Off" path, so it is not a regression introduced here.
4. **The `MAX_WAIT_MS` caveat still applies.** The cycle-4 caveat (every new value cancels the pending idle callback) carries over, and it is more noticeable at QUIET 250.
