## Standing Constraints

- [C1] Systematic debugging: no fix before a probe-confirmed root cause; no added waits, raised timeouts, retries, or flake-list entries as the fix.
- [C2] Red first: the failing run is recorded and committed (as .txt) before any implementation code.
- [C3] No unrelated assertion in any spec is weakened; the two-taps test still asserts that no tab is current on /chat.

## 1. Evidence and reproduction

- [x] 1.1 Fetch CI artifacts for run 45488894333 job 138781572966 and run 39830913828 attempt 1 into the main checkout's `.concertino/scratch/HEL-1701/`; record what they show (tab state, DOM snapshot, page at failure) or their absence in `ci-artifacts.txt` in the change dir; verify no CI env block is in it (`grep -c CONNECTOR_MASTER_KEY` is 0)
- [x] 1.2 Reproduce on the unmodified test: `--repeat-each` on both theme spec files (2 workers, `nice -n 19`, lane DB), then CDP 4x/6x CPU throttling if warm does not fail; commit the red output and rate as `.txt` in the change dir before any fix

## 2. Root cause

- [x] 2.1 Add temporary probe instrumentation (per-frame/mutation log of pathname, each tab's aria-current, and whether /chat content is rendered) and capture a failing or slowed run's probe output; commit it as `.txt`
- [x] 2.2 Write `root-cause.md` in the change dir: the mechanism, the probe evidence, and the product-vs-test decision per design D3

## 3. Fix and guard

- [x] 3.1 Implement the minimal fix at the root cause; remove probe instrumentation; verify `git diff` adds no timeouts, retries or flake-list entries
- [x] 3.2 Mutation: revert only the fix, rerun under the red conditions, commit the red output as `.txt`; restore the fix
- [x] 3.3 Green rate: 40/40 two-taps runs across both themes (2 workers, `nice -n 19`) and 5/5 at 4x CPU throttling; plus N >= ceil(3/p) under the red conditions if p is low; commit outputs as `.txt` with the arithmetic

## 4. Regression

- [x] 4.1 Run both full glass-nav spec files (light and dark), typecheck, lint, and (if app code changed) the relevant jest tests; verify all pass
