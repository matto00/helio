# HEL-1701: e2e flake candidate: hel1583-glass-nav.spec.ts:554 failed on main (run 39830913828, e2e leg 6), passed on rerun

## Description

`e2e/hel1583-glass-nav.spec.ts:554` failed in e2e (6) on main run 39830913828, attempt 1, at 14c08def8 (HEL-1699's merge). A rerun of the failed jobs passed. HEL-1699 changes only CI caching and a lane-only backend start, so it is unlikely to be the cause. Still, this spec is not on the known-flake list and the rerun went outside the rerun allowance.

**Do:**

* Pull the failure trace and artifact from run 39830913828, attempt 1.
* Find the root cause (probe first; systematic-debugging law).
* Fix the race or the test, rather than adding the spec to the flake list.

Any related failure on another spec should be recorded here.

## Driver context (verified at Setup, see evidence/premise-validation.md)

- At 14c08def8, line 554 of `e2e/hel1583-glass-nav.spec.ts` is the test "a beta user reaches /chat in two taps: Open assistant, then Browse all conversations". HEL-1778 split the file; the same test body now lives in `e2e/support/hel1583-glass-nav.ts:549` and runs per theme from `e2e/hel1583-glass-nav-light.spec.ts` and `e2e/hel1583-glass-nav-dark.spec.ts`. The October failure and the 2026-11-24 failure are the same test.
- Fresh failure 2026-11-24: PR #1266 (one-file `infra/.env.deploy.example` change), run 45488894333, job e2e (2) 138781572966, dark theme, 1 failed / 136 passed. The final assertion `expect(g.tabs.filter((t) => t.current !== null)).toEqual([])` received the Dashboards tab with `current: "page"` after `await expect(page).toHaveURL(/\/chat$/)` had passed. Passed on one rerun. Log (CI env block stripped): main checkout `.concertino/scratch/driver/main-watch/pr1266-e2e2.txt`.

## Acceptance Criteria

1. Root cause found with a probe first (systematic-debugging law), with the probe output committed as evidence; CI trace/video artifacts for run 45488894333 job 138781572966 (and run 39830913828 attempt 1, if still retrievable) fetched and recorded, or their absence stated.
2. Red first: a failing run of the unmodified test, under named conditions (`--repeat-each` and/or CDP 4x/6x CPU throttling), recorded and committed as `.txt` before any fix.
3. The race is fixed at its root cause, in the app if a real user can see the wrong state, otherwise in the test. No retries, no larger timeouts, no flake-list entry, no weakened assertion.
4. After the fix: 40/40 runs of the test (both themes, 2 Playwright workers, `nice -n 19`) and 5/5 at 4x CPU throttling pass.
5. Mutation: reverting the fix turns the test (or a guard) red, recorded as `.txt`.
6. If the October :554 failure turns out to be a different test from the two-taps test, both are covered and the PR says so. (Setup established they are the same test.)
7. The PR's own CI passes this test without any rerun of it.
