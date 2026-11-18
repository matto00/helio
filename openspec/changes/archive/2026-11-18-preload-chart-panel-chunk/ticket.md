# HEL-1760: Preload chart code when a chart panel's data arrives (closes the hel1573-motion-grid-chart:104 CI gap)

## Description

Follow-up from HEL-1758 (PR #1158, merged as 9054da2a6).

HEL-1758 found why `hel1573-motion-grid-chart.spec.ts:104` flakes. Under CI load, the lazily loaded chart code finishes 1-1.5 s after the test's 5 s wait runs out. A 6 s delay on the chart chunk reproduces the exact CI error. The chart chunk is only requested about 1.7 s after the panel's data has arrived.

Users see the same gap as a late chart.

**Fix:** start loading the chart code as soon as a chart-kind panel is known, for example when its data or the panel list arrives. Don't wait until the chart component mounts. Do not lengthen any test timeout.

## Acceptance criteria

* Fails first: with the chart chunk delayed 6 s, the test is red before the change and green after. Record both runs.
* The test passes 40 out of 40 with `--repeat-each=40 --workers=2 --retries=0`.
* The initial bundle does not grow. Show build output before and after.
* Remove `hel1573:104` from the flake-candidate list.

## Driver context (claims to verify)

* Re-measure the ~1.7 s gap between data arriving and the chunk request (HEL-1758's evaluator measured ~0.5 s in the CI trace).
* The fix is an earlier preload of the chart chunk, NOT a longer timeout, sleep or retry.
* Frontend only: no Flyway migration, no model calls.
* The flake-candidate list is the driver's known-flake list in lane briefs (no in-repo list exists); its removal is a driver-side action, reported in the PR.

## Driver clarification of the driver-authored ACs (2026-11-18, not an owner ruling)

The driver wrote the two ACs below and clarified its own wording; this is not recorded as a human answer.

* **Forcing (AC 1).** The CI-shaped forcing (rows held late in the window plus a chunk delay calibrated to HEL-1758's
  trace) replaces the literal "6 s chunk delay" forcing. It must be red before and green after, both runs recorded.
  The literal 6 s run is also recorded as-is before and after, and the PR says plainly that it cannot discriminate.
* **Bundle (AC 3).** The requirement is that echarts and the chart chunk stay out of the entry. Small preload glue in
  the entry is acceptable. Report the exact raw and gzip delta; call it out if the glue exceeds about 1 KB gzip.
* **Gap.** Use the re-measured gap. If it is about 0.5 s rather than 1.7 s, the PR says the ticket text was wrong.
* **Flake list (AC 4).** The driver drops hel1573:104 from its known-flake list after merge if the 40/40 holds.
