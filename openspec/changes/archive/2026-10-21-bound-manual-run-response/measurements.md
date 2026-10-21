# Measurements (HEL-1693)

## Method

`RunPathHeapSpec` (opt-in, `HELIO_MEASURE=1`), forked JVM `-Xmx768m` (`HELIO_TEST_JVM_XMX=768m`), SerialGC (`maxMemory` 742 MB: one CPU),
sbt pinned with `taskset -c 0` (Cloud Run `--cpu=1`), `nice -n 19`, one probe at a time under the sbt lock, `HELIO_RUN_HEAP_REPEATS` of 2 to 5.
After `submit` returns, the spec builds the response the route would (`HELIO_RUN_HEAP_RENDER`: `spray` = the pre-fix default marshalling,
`stream` = `RunResponseMarshalling.chunkedJson`, the routes' own definition, `none` = stop at `submit`) and drains every byte of the entity.
Sampled (two GCs, then used heap): by the background sampler every 150 ms, right after the response is built, on every 8th piece, and after the
last piece. Delta = max sample minus the heap before the run.

## Red (spray default marshalling; the pre-fix route behavior)

| Shape | Mode | Spray, MB per repeat | No render (`none`), MB |
|---|---|---|---|
| fewrows-utf16-200 | real (5) | 413.6, 362.6, 233.8, 237.9, 148.9 | 107.0, 102.0 |
| fewrows-utf16-200 | dry (5) | 147.0, 147.0, 148.5, 147.0, 147.7 | 80.2, 80.2 |
| rowwidth-at-limit | real (2) | 155.9, 118.7 | 152.1, 137.3 |
| rowwidth-at-limit | dry (2) | 63.2, 67.8 | 100.8, 55.4 |

Premise finding: only `fewrows-utf16-200` (real) is over 192 MB red-first. `rowwidth-at-limit` is NOT red: its body is 16 MB (50,000 rows),
so the render transient (about 3x the body) stays below the run's own walk peak, which already dominates (`none` baseline 152.1 / 137.3 MB).
The ticket's expectation that both reproducers spike past the share was half wrong. The design's stop condition (neither exceeds) was not met.

## Green (streaming marshaller)

| Shape | Mode | MB per repeat (5) |
|---|---|---|
| fewrows-utf16-200 | real | 104.4, 108.3, 84.4, 106.5, 109.4 |
| fewrows-utf16-200 | dry | 81.7, 95.1, 95.7, 95.0, 94.4 |
| rowwidth-at-limit | real | 158.9, 153.9, 139.4, 158.8, 155.7 |
| rowwidth-at-limit | dry | 52.9, 71.6, 95.6, 95.1, 95.6 |

Full spec (every shape, real and dry, 2 repeats): max over shapes 182.4 MB (`just-under-light@2600000` dry), bound 192.0; the spec's assertions pass.

## Mutation checks (each red, then restored)

- G1 printer equivalence: dropping the comma between array elements: `Tests: succeeded 2, failed 4`; rendering object keys without spray's escaping:
  `should equal compactPrint for every adversarial string ... *** FAILED ***`, `... nested arrays and objects *** FAILED ***`.
- G2 routes: run route reverted to `StatusCodes.OK -> result`: both run tests `*** FAILED ***` with `List() was empty` (RunResponseChunkedRoutesSpec.scala:36);
  apply-proposal and combined-apply routes reverted: `List() was empty (PipelineApplyProposalSpec.scala:34)` and `(CombinedApplyProposalSpec.scala:41)`.
- G3 heap: the body of `chunkedJson` swapped to spray's default: `fewrows-utf16-200` real 360.4, 231.9, 346.3, 167.7, 256.1 MB (max over shapes 360.4 > 192.0).
  The routes and the spec share that one definition, so this mutation also covers the route wiring.

## Notes

- Unverified evaluator claim, not acted on: Cloud Run's 32 MiB non-streamed response limit may not apply to chunked responses, so very large run bodies
  that failed in production before (e.g. a 53 MB body like `fewrows-utf16-200`) could now be delivered. No behavior was changed for it.
- Follow-up candidate: a row cap on the response needs an owner ruling (client-visible).
- Consumers: `helio-mcp` has no separate test script; its handler tests run inside the root `npm test` jest (524 tests), and the frontend jest suite
  (748 suites) ran in the pre-commit hook, both green.
