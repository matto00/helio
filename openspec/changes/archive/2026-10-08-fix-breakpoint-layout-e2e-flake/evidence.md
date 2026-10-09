# HEL-1413 evidence

## Root cause (probe-confirmed): measurement race, test-side; product renders correctly

`settledRects` gated on `.panel-grid`'s CSS box width, which follows the viewport at once (forced layout, no
frame needed). RGL only gets the new width via ResizeObserver -> rAF -> setWidth -> commit, and
ResizeObserver callbacks and window `resize` events are delivered only in a rendering update. Under load the
rendering opportunity is late while the page main thread stays responsive, so two `page.evaluate` reads
150 ms apart both see the previous breakpoint's geometry and agree ("settled"). The grid -> phone-stack swap
(window 400) hangs off the same width delivery, so it has the identical race.

### Evidence
1. CI trace (main run 37850786693, failed 9795 ms): setViewportSize(1500) at t=32747; container poll passed
   at 32828-32884 (1212); first read 32891, second 33204 (the `evaluate` itself took 110 ms, the 150 ms wait
   took 271 ms -> a loaded runner); both reads at lg geometry. Screencast frames WERE being produced
   (first post-resize frame 32930, then every ~45 ms) and the frame at 33194 still shows lg-width cards;
   the frame at the end (33856) shows md geometry. So: not a hung page, not a product layout bug - RGL
   received the width late. Items stale were not only P8 (P2/P4/P6/P8 sit on the lg right edge: bad=4/8 in
   the probe reproduction below).
2. Natural lag measured with a passive probe (RO on `.panel-list__zoom-container`, `resize` listener,
   `performance.now()` from just before setViewportSize), 4 spinning `nice -n 19` busy loops + 4 workers,
   80 C-runs -> 160 md observations: ResizeObserver delivery lag p50 52 ms, p95 219 ms, max 545 ms;
   the `resize` event lagged identically (e.g. 514 ms) -> the delay is the rendering opportunity, not main
   thread blocking. In passing runs the first two reads at md ALREADY showed 4/8 items stale (4 bad) in every
   case; they passed only because RO delivery / the 200 ms RGL transition changed geometry between reads.
3. Deterministic reproduction of the exact CI signature: probe init script delaying every ResizeObserver
   callback by 900 ms: 4/4 runs fail with `C_lg_coords_everywhere light @1500 (md) P8 Divider right`,
   Expected <= 1478, Received 1876 (identical to CI), `bad=4/8`; 3 s later the same page reads `bad=0`
   (the product converges to correct md geometry -> product is correct, test measured too early).
4. Other CI occurrences (gh logs for PR #860 run 37831042947 / 37849903434 are NOT expired): attempt 1
   `A_lg_only light @1500 (md) P8 Divider right` 1876 vs 1478; 37849903434 attempt 1 the same for C;
   37831042947 attempt 3 failed `A_lg_only`, `C_lg_coords_everywhere` and `V_valid_with_gaps` with
   `light @400 (stack)` (reading-order mismatch: the desktop grid had not yet been swapped for the stack).
   So the flake is spec-wide (shared `settledRects`), always the first live resize in the light pass, in two
   forms (md overflow, stack order). The driver's "~11.5 s vs ~26 s" claim: failing durations 9.8-12.5 s on
   these attempts are consistent with an early-pass failure; I did not rely on the ~26 s figure.

### Candidates refuted
- Resize transition/animation: transitions are 200 ms, finish; getAnimations()=0 at end of every probe run;
  the injected-delay failure has no running animation (`anims=0`) and still fails; and the stale state
  persists with frames being produced (screencast).
- Font-load reflow: the stale geometry is exactly lg (1876), not a perturbed layout; no layout changes in
  probe read series other than the md convergence.
- RO timing as a product defect: it is real (late RO) but is RGL's designed ordering; the product converges.
- Real product layout bug for dividers: 3 s after the failing read bad=0; P2/P4/P6 stale as well, not just the divider.
- HEL-1392 remount/refetch: no remount in the series (same DOM nodes, item count 8 constant, RO attaches once);
  not implicated. HEL-1300 `isolateLivePage` is already applied at spec `beforeEach` (line ~370).
- rAF starvation alone: a single rAF is insufficient (RGL setWidth commits in a later task, and the effect
  derives cols one commit after width) - hence the wait below is on RGL's own processed-width report.

## Fix
- Product (observability only, no layout/behavior change, no requirement change, `skip_specs` kept):
  `DesktopPanelGrid` tracks the width RGL reports via `onWidthChange` (fired from RGL's width effect, the
  same batch that commits the new breakpoint/cols; item positions follow one effect flush later, when RGL's inner GridLayout syncs its layout state, which is why the transition wait and the stability loop after the poll stay) and exposes it as the CSS custom property
  `--panel-grid-processed-width` on the grid root. Unit test
  `DesktopPanelGrid.processedWidth.test.tsx` (red with the wiring stashed: 2/2 fail; green with it).
- Test: `settledRects` now waits for (desktop, container >= 768) the custom property to equal the expected
  container width then `settleTransitions` (5 s upper bound, not a settle window); for the phone stack,
  waits for `.panel-grid` to be gone. Tolerance (+-2 px), settle loop, no retries, no sleeps unchanged.

## Red -> green
- Natural rate: 0 failures in 182 C-runs locally (2 + 10 + 30 + 40 + 80, plus 10 each at CDP CPU throttle 6x and 16x; under up to
  4 busy loops + 4 workers; all 0). Local natural k/N0 = 0/182 -> Wilson upper 95% ~2%,
  p_low = 0. The design D3 sizing (N from p_low) is therefore NOT computable from a natural rate; stated honestly.
  Natural occurrence is measured instead from CI: >=8 failing attempts across 4 runs.
- Controlled red at the same contention (2 workers, no extra stress): pre-fix spec + 900 ms RO delay: 4/4 fail.
- Green: post-fix spec + 900 ms RO delay: 4/4 pass; + 2500 ms delay: 3/3 pass (the first post-fix attempt at
  900 ms failed 4/4 at `@400 (stack)`, which exposed the identical race on the stack swap; fixed).
- Post-fix natural stress (4 busy loops nice 19, 4 workers): 60/60 pass; whole hel1023 file 5/5; hel1028 + hel1080 17/17.
- Gates: lint, format:check, typecheck, check:e2e-types, npm test (476 suites / 4972 tests), frontend build all exit 0.

## Dev-DB residue
Each test registers a throwaway user (`hel1023-<ts>-<n>@example.test`; users cannot be deleted via the API) and its
`afterEach` deletes its own dashboard by exact id. Resolved read-only from the dev DB after the fact: 305 users
created 2026-10-08 15:30:39 to 16:22:40 (-07) matching that pattern, excluding the evaluator's 31 (listed in
`evaluation-1.md`, "Evaluator dev-DB residue"). Exact `id email created_at` per row: `dev-db-residue.txt` in this
directory. Attribution is by the pattern plus time window since the first run of this task, not per-run logs, so a
row from another concurrent lane in that window would be misattributed (none known). Leftover dashboards owned by
any `hel1023-%@example.test` user: 0. Nothing deleted.
