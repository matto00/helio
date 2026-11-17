# HEL-1711: Flaky e2e: HEL-1685 "Save & run that removes an Output requests no preview of it (item 7)"

## Description

`e2e/hel1685-draft-polish.spec.ts:252` ("HEL-1685 draft polish (live) › 1280x800: Save & run that removes an Output
requests no preview of it (item 7)") failed in CI (first on PR #1110 / HEL-1709, run 42753054625 attempt 1; a rerun of
the same commit passed). The assertion at line 283 failed: after Save & run removed the Output, the page still sent one
`POST /api/pipelines/<id>/preview?outputId=<removed output id>` within the 3 s window the test watches. The test expects
none.

This is the first time the test ran in CI for weeks (e2e setup was broken on ubuntu-latest 26.04 until #1110 pinned
ubuntu-24.04). One failure in two runs could mean a timing race in the test, or a real race where a preview is still
requested for an Output just removed by Save & run. Find out which before treating it as flaky.

## Acceptance Criteria

- The root cause is identified, and the failure is reproduced locally (e.g. `--repeat-each`), not assumed.
- Either the product race is fixed, or the test's wait is made deterministic. Not by widening the timeout.

## Orchestrator premise findings (from the CI trace — claims for the executor to confirm locally)

- Failing CI jobs found: run 43949524653 (main, e2e (3), job 133587986311 — trace downloaded to
  `/home/matt/Development/helio/.concertino/scratch/HEL-1711/trace3/`), run 43670793677 (job 132680140567), run
  43670787651 (job 132680123068). Run 43963094133 (dependabot #926) did NOT fail this test.
- In the 43949524653 trace, the "Remove step" click landed while the focused step card was still
  "Step 1 Filter rows" (the default selection), not Step 3 (Compute). The draft save removed the FILTER step and the
  CHART Output `70ce139d`; the Output the test watches (`outputIds[2]`, metric `b581d5f4`, on the compute step) was
  never removed, and its `POST /preview?outputId=` returned 200 from `settleSaved`'s legitimate refresh of the saved
  definition's Outputs.
