# HEL-1489: After HEL-1316: centred rolling frames; route-level rolling-frame rejection tests; window editor duplicate input ids

## Description

These follow-ups came from HEL-1316 (matto00/helio#937, bc8ccac45), which added rolling_avg/sum/min/max/count with frameSize and frameUnit (rows|days).

1. **Centred rolling frames.** The owner chose trailing-only for HEL-1316 and left centred frames for later. Product calls are needed: how an even N centres, and the edges at the start and end of a partition.
2. **Route-level tests for rolling-frame rejection** on the patch-set apply and pipeline proposal write routes. The final skeptic proved live that invalid configs return 422 across 10 write surfaces, but no test pins the patch-set and proposal routes. Each new test must fail first under a mutation.
3. **Window editor input ids collide** when two window step cards are open: the frame-size input and the existing output-column input use hard-coded ids. This predates HEL-1316. Use `useId()`, as HEL-1465 did for lookup cards.
4. **Cosmetic:** misaligned `case` arrows at `WindowStep.scala:220`.

## Scope of this run (driver decision, owner asleep)

This PR delivers items 2, 3 and 4 only. Item 1 (centred rolling frames) needs owner product rulings (even-N centring, partition-edge handling) and is OUT OF SCOPE: it stays open on the ticket for the owner, and the ticket is kept open after merge.

## Acceptance Criteria

- AC2a: A route-level test sends invalid rolling-frame window configs through `POST /api/patch-sets/apply` for each of the three patch-set step-bearing edit kinds (pipelineStep create, pipelineStep update, pipeline create) and asserts 422, a message naming the frame problem, and that nothing was stored/changed.
- AC2b: A route-level test sends an invalid rolling-frame window config through `POST /api/pipelines/apply-proposal` and asserts 422, the frame message, and that no pipeline was created.
- AC2c: Invalid configs covered include at least: a non-integer `frameSize` (e.g. 7.5), an out-of-range `frameSize` (0 or > 1000), an unsupported `frameUnit`, and `frameUnit: days` with a multi-key or descending `orderBy`. A positive control on each route accepts a valid rolling config.
- AC2d: Each new test is shown red under a one-line mutation (recorded with output in the run evidence), and green again after reverting.
- AC3a: `WindowConfig.tsx` no longer uses any hard-coded DOM id; the offset, frame-size and output-column inputs (and their label `htmlFor`) use `useId()`-derived ids.
- AC3b: A frontend test that renders two window editors at once asserts every id is unique and each label resolves to its own input; it fails on the pre-fix code (red recorded) and passes after.
- AC3c: Accessible names of the window editor inputs are verified in the running app with two window cards open.
- AC4: The `case` arrows of the non-rolling function match in `WindowStep.scala` (~line 218-223) are aligned; no behaviour change.
