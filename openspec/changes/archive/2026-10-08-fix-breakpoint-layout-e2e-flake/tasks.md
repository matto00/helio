## Standing Constraints

- [C1] Do not loosen the geometry assertion/tolerance or add retries/sleeps unless the probe-confirmed root cause proves the tolerance itself is wrong; that is a coverage call -> escalate.
- [C2] Repro/measurement runs capped at 3-4 workers, nice -n 19; never pkill/pgrep/killall; Bash timeout 600000.
- [C3] If the root cause is a product layout bug, fix the product, not the test.
- [C4] Do not edit .github/workflows/ci.yml (HEL-1299 lane owns it).

## 1. Evidence from the failed CI run

- [x] 1.0 Also pull the PR #860 failing attempts (runs 37831042947 and 37849903434; earlier attempts via `gh run view <id> --attempt <n> --log-failed`, plus trace artifacts if still retained) and verify the driver's fail-fast timing claim (~11.5 s failing vs ~26 s passing) across every available attempt — state what a fast failure implies about which read failed (e.g. the first md read after the 1900→1500 resize). Note: the trace at 1.1 also shows the failing test ran 9.8 s on main.
- [x] 1.1 Inspect the CI trace (`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1413-artifacts/home/runner/work/helio/helio/test-results/trace-x` and `.../hel1023-breakpoint-layout--b0029-ATCH-on-view-at-every-width/trace.zip`): DOM snapshots around the 1900→1500 resize — the divider item's inline style/transform/width, the grid's width/cols, and the geometry of EVERY item (P1–P8), whether any had moved to md geometry, and running transitions if visible. Record findings in the evidence file.

## 2. Reproduce at a measured rate

- [x] 2.1 Start the worktree dev servers via the canonical script; run `C_lg_coords_everywhere` with `--repeat-each`, ≤4 workers, `nice -n 19` (optionally under capped CPU stress) and record N runs / k failures.
- [x] 2.2 Add a temporary probe (removed before commit) per design Decision 1(iii): timestamps for the ResizeObserver callback on `.panel-list__zoom-container`, the following rAF callback, and the width/breakpoint/cols RGL rendered with; the rect series of EVERY item; `document.visibilityState`; whether rAF fires during the stale window; running CSS transitions. Classify per design Decision 2 (product only if RGL had md width and an item stayed at lg; otherwise measurement race), and record the confirmed root cause plus the refutation of each other candidate (frame/rAF starvation, RO timing, transition, font reflow, product stale-render, HEL-1392 remount).

## 3. Fix at the root cause

- [x] 3.1 Product bug → fix in `frontend/src/`, add a regression guard that fails with the fix reverted (show the red), add the `breakpoint-layout-resolution` MODIFIED delta and drop `skip_specs`. Test race → per design Decision 2 option (a) reuse/extend `e2e/support/settleTransitions.ts` additively (frame + transition wait before the stability comparison), or option (b) a scoped product observability attribute plus a unit test; no tolerance change, no retries, no blind or tuned sleeps.
- [x] 3.2 Remove all temporary probes.

## 4. Red → green

- [x] 4.1 Re-run with the fix at N ≥ ln(0.05)/ln(1−p_low) runs (p_low = Wilson 95% lower bound on k/N₀), same contention; zero failures. State k, N₀, p_low, N, result. Also show the pre-fix red at the same contention.
- [x] 4.2 Run the full hel1023 spec and other grid-layout e2e specs touched by the change; frontend unit tests/lint/typecheck if product code changed.
- [x] 4.3 Record any dev-DB residue by exact id.
