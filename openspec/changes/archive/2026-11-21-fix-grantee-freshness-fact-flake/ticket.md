# HEL-1812: Flake: hel1786-shared-dashboard-freshness:309 editor freshness shows "last run failed <> refreshed N seconds ago" (two facts) on main

## Description

Main CI run 44870053000 (commit 763c69f6f, 2026-11-21), job `e2e (1)` (136742317338), failed one test:

`e2e/hel1786-shared-dashboard-freshness.spec.ts:309` > "editor: freshness fact, invalid badge and run-finish refresh, through per-panel routes only"

```
Expected pattern: /^(refreshed|last run failed) $/
Received string:  "last run failed <> refreshed 17 seconds ago"
```

The editor's freshness line showed two facts at once. Either the UI can briefly render both a failed-run fact and a refreshed
fact (a real bug in the HEL-1786 freshness line), or the test reads the line while it is changing.

**Orchestrator premise correction (Setup, premise validation):** the `<>` is the test's OWN mismatch formatter in
`expectFact` (`${expected}<> ${await text()}`), not UI text. The failure means: for the whole 15 s `expect.poll` window, the
owner's view of the dashboard's latest run (`GET /api/pipelines/:id` for both pipelines) said "last run failed" while the
editor's freshness line read "refreshed 17 seconds ago". The UI rendered ONE fact that disagreed with the owner's view. The
work is unchanged: find why, by probe, and fix the UI or the test accordingly. Evidence:
`.concertino/runs/HEL-1812/evidence/premise-validation.md` (main checkout).

## Do

* Reproduce it. Repeat the spec on a loaded run, and probe the freshness line's state when the run-finish refresh lands.
* Find the root cause before changing anything (systematic-debugging law).
* If the UI can show both facts (or the wrong fact), fix the component and add a unit test for that state. If only the test
  is racy, make it wait on the settled state, not on time.

## Acceptance criteria

- [ ] The root cause is stated with probe evidence.
- [ ] The spec passes 20 times in a row locally, using 2 workers and `nice -n 19`.
- [ ] If it was a UI bug, a test that fails first.

## Driver constraints

- Do NOT weaken the assertion to accept both strings (or either fact regardless of the owner's view) without a root cause.
- If the UI can disagree with the owner's view beyond the documented periodic poll, decide from the HEL-1786 spec
  (`openspec/specs/dashboard-grantee-access/spec.md`, "Grantees see the dashboard freshness line" / "Grantee panels refresh
  when a run finishes") which fact should win; if the spec does not settle it, escalate.
- Frontend/e2e only expected; no migration.
