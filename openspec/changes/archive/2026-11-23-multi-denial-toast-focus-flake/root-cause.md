# HEL-1842 root cause

**Cause.** `buildDeniedPipelinesToast` (`frontend/src/features/pipelines/services/deniedPipelinesToast.ts`) sorts a
multi-denial toast's rows by `pipelineId` (deliberately: byte-identical coalescing message independent of response
order). Pipeline ids are server-generated random UUIDs, so which of "HEL-1172 Alpha" / "HEL-1172 Beta" renders first is a
coin flip per run. The spec hardcoded Alpha-first (`focus()` Alpha link, Tab -> Alpha run, Tab -> **Beta link**). When
Beta's id sorts lower, the DOM order is Beta, Alpha; Tab from Alpha's run then reaches `Dismiss notification`, so the Beta
link is `inactive`.

**Probe evidence.**
- CI error-context, both attempts of run 45281484916 (`ci-artifacts.txt`): list order Beta then Alpha, focus on
  `Dismiss notification [active]`, Beta id 0551b620 < Alpha id cb15cb7d.
- Local probe (`probe-order.txt`, `probe-run.txt`): row DOM order logged before the Tabs. 6/6 Beta-first runs failed at
  line 146, 2/2 Alpha-first runs passed. Red rate 4/12 unmodified, 6/8 with the read-only probe (`red-rate.txt`).
- Not timing, shard company, cold start or CPU: it reproduces warm with 2 workers and no throttle, and the failing/passing
  split is fully explained by id order.

**Product vs test (design D3).** Test defect. With real key presses a keyboard user always gets Tab in the rendered row
order (link, run, link, run), which is exactly what `run-to-update-affordance` promises ("reachable by Tab in row order");
nothing in the product drops, replaces or traps focus. The test asserted a row order the product never promised
(`sorted by id` is documented in `deniedPipelinesToast.ts` and its unit test, and is by design).

**Fix.** The spec derives the expected row order from the pipelines' ids (the product's documented sort) and asserts the
DOM order equals it, then runs the same real-Tab sequence first link -> first run -> second link -> second run. No waits.
A deterministic order for users (e.g. sorting rows by name) would be a product decision and is out of scope; noted as a
spinoff candidate.
