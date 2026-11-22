## Standing Constraints

## 1. Baseline and red (before implementation)

- [x] 1.1 Start lane servers (lane-private DB `helio_hel1806`, `ANTHROPIC_API_KEY` empty) and run all five `e2e/state-surface-contrast-guard-*.spec.ts` files on the unmodified tree; save titles and per-cell `[HEL-866 guard]` count lines as `evidence/01-baseline-*.txt`; verify the five runs pass (or record any listed flake)
- [x] 1.2 Write D1 (readiness wait) + D2 (measured assertion + log line; assert the refresh locator has count 1 before reading its doc id) in the 1440 `pipeline-detail` cell; apply M1 to `PipelineSpine.css`; run `routes-dense` in full; verify the dark `/pipelines/:id` cell fails naming the refresh button with ratio ~1.03; save as `evidence/02-red-M1-1440.txt` and commit it (with the test change, M1 reverted, `git diff -- frontend` empty)
- [x] 1.3 M3 (wait removed, sample delayed; intercept the request the spine card actually issues, confirmed from the client service or network, and show the button is disabled at stamp time so the failure is D2's not-stamped/not-probed path, not a timeout) and M4 (M3 + M1 + D2 removed) test-side mutations; verify M3 fails naming the button and M4 passes silently; save `evidence/03-M3-*.txt`, `evidence/04-M4-*.txt`; revert and commit the logs

## 2. Tidy

- [x] 2.1 Fix the stale header comment in `e2e/support/state-surface-contrast-guard.ts` to name both narrow part files; verify by grep that `state-surface-contrast-guard-narrow.spec.ts` no longer appears in `e2e/`
- [x] 2.2 Add the width-by-value lookup (throws on a missing width) and use it in both narrow part files; verify `npx playwright test --list` on both files lists the same titles as the baseline
- [x] 2.3 `--list`-only mutation checks (no servers): temporarily reorder `NARROW_WIDTHS` and confirm both files list identical titles; temporarily name a width not in the matrix (e.g. 1101) and confirm `--list` fails naming it; save `evidence/06-width-*.txt`, revert

## 3. Green and comparison

- [x] 3.1 Run all five files on the final tree; save `evidence/05-green-*.txt`; verify all pass and each 1440 `pipeline-detail` cell logs the `[HEL-1806 guard]` line in both themes
- [x] 3.2 Write `evidence/coverage-comparison.md`: title lists identical, per-cell sampled counts before/after with every difference explained
- [x] 3.3 Lint/format/typecheck the e2e files (`npm run lint`, `npx prettier --check` on changed files, e2e tsc if configured); verify zero warnings
