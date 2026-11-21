# HEL-1812 root cause: H1 (test race) CONFIRMED, H2 (UI derivation bug) REFUTED

## Mechanism
beforeAll appends a violating row to the checked source (arming a HEL-1093 auto-run that a blocked manual run does not
cancel) and then runs pipeline 1 successfully. The armed auto-run fires on the 30 s scheduler tick (observed phase :04/:34
of each minute) >= 5 s after the write, i.e. at an unfixed time that can fall between the grantee page's first
`panel-status` read (at `page.goto`) and `expectFact`'s first owner read. It finishes `failed` (blocked) and is newer than
pipeline 1's succeeded run, so the owner's latest-run view flips to "last run failed" at once. The grantee only learns of it
at its next 15 s poll, which lands ~0.2-0.3 s after the 15 s `expectFact` window closes (the window starts after the
East/Alpha visibility waits, slightly later than the grantee's first read). Result: "last run failed <> refreshed N seconds
ago" (`<>` is the test's own mismatch separator). The UI never shows two facts.

## Probe (scratch copy of the spec, `scratch/HEL-1812/hel1812-probe.spec.ts.txt`, not committed as a fix)
Logs per iteration: wall time, the owner's run-history (with triggerSource) for both pipelines, every grantee `panel-status`
body, and the rendered text. Logs: `scratch/HEL-1812/probe{1..5}.log`; red excerpt committed as `red-run.txt` (added in the follow-up commit; the first commit missed it because `*.log` is gitignored).
- Unforced repeats (probe1-3, 5): all passed; the checked pipeline's `auto-run` appears in owner history at :04/:34 ticks
  and the grantee converges at its next poll (confirms the lag exists but usually lands outside the window).
- Induced REAL mechanism (probe4, INDUCE=3: dataset write to the checked source timed so the tick-fired auto-run lands
  ~1 s before page.goto, no manual run): 2 of 3 runs FAIL with the exact CI message. Failing iteration:
  `expected="last run failed " rendered="refreshed 32 seconds ago" chk=[auto-run:failed@09:08:34,...]` repeated for the whole
  window, then the grantee's own poll returned `["failed@09:08:34", ...]` (converged ~0.2 s after the window closed).
  The one pass in probe4 was a run where the auto-run landed after the poll that matched (owner said "refreshed").
- H2 refuted: whenever a `panel-status` body reported the failed run as latest, the rendered fact was "last run failed";
  the stale text only ever corresponded to the previous (succeeded) body. No stale snapshot past a newer response.
- Pipeline 1 auto-run: after the viewer/editor tests' write + succeeded manual run, a 45 s settle (probe5, 2 repeats) showed
  NO auto-run in pipeline 1's history (cancelled by HEL-1739). Only the checked pipeline needs a settle.
- Run history exposes the auto-run as `triggerSource: "auto-run"` (PipelineRunService.AutoRun). The schema enum
  `schemas/pipelines/pipeline-run-record.schema.json` lacks it: follow-up candidate, not changed here.

## Spec check
No UI change: grantee freshness is by spec periodically polled (15 s); it can lag the owner by up to one poll. Not a defect.
