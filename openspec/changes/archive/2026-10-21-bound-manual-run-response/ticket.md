# HEL-1693: Manual run HTTP response renders the whole terminal frame at once (RunResultResponse jsRows), bypassing HEL-1660/1679 run memory bounds

## Description

origin_kind: followup
origin_ticket: HEL-1679 (PR matto00/helio#1083, merged as 77f46a5df)

HEL-1660 and HEL-1679 bound real runs:

* rows, live cells and text per node, with frame release;
* a post-walk price;
* snapshot writes in lazy batches capped by JSON size;
* `MaxRowRenderChars` of 2,000,000.

A manual run's HTTP response still builds `RunResultResponse(jsRows, ...)` (around `PipelineRunExecutor.scala:344`), which renders the whole terminal frame to JSON at once. Reproducers from HEL-1679: `fewrows-utf16-200` and `rowwidth-at-limit`. That spike sits outside the 192 MB per-run share (owner ruling 3 on HEL-1660).

**Fix:**

* Cap the rows returned to the client (the UI already reads at most a preview's worth).
* Stream the response, or price it against the run budget, the same way the snapshot write is.

Keep the response contract (`schemas/`) compatible, or version it.

## Acceptance Criteria

* A red-first heap measurement (bounded `-Xmx768m`, single CPU as certified in HEL-1679) of a manual run on both reproducers, and its peak at or under 192 MB after the fix.
* A mutation-checked guard.
* Response consumers unchanged, or updated with a seam test.

## Driver constraints (overnight mode)

* Escalate (emit-event.sh escalation --raise-only) rather than decide: product, scope, budget/extra cycles, prod data, classifier-denied actions, a response-contract change clients would notice, or a limit change not already ruled.
* Owner rulings in force from HEL-1660: 25% per-run share (192 MB of 768 MB heap); a run over a limit fails with a step error; clean failures accepted.
* Full e2e suite locally under the e2e lock before Delivery. No release.
