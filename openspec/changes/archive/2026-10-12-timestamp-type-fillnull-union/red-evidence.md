# red-evidence (C1): TimestampNumberParitySpec on UNMODIFIED main code

Command: SBT_OPTS=-J-Xmx3g nice -n 19 sbt "testOnly com.helio.domain.engine.TimestampNumberParitySpec" (exit 1). Run side via InProcessPipelineEngine.executeTree.

```
[info] TimestampNumberParitySpec:
[info] fillnull mean/median after a cast to timestamp over epoch strings
[info] - should RED/run-side: the run writes a number into the null cell (mean)
[info] - should RED: analyze projects timestamp AND reports a step error naming the strategy and column (mean) *** FAILED ***
[info]   expected a validationError on the fillnull step (TimestampNumberParitySpec.scala:80)
[info] - should RED/run-side: the run writes a number into the null cell (median)
[info] - should RED: analyze projects timestamp AND reports a step error naming the strategy and column (median) *** FAILED ***
[info]   expected a validationError on the fillnull step (TimestampNumberParitySpec.scala:80)
[info] a lane-kind union with a timestamp vs numeric collision
[info] - should RED/run-side: the run mixes numbers and timestamp strings under ts (parent timestamp, secondary integer)
[info] - should RED: analyze reports a step error naming ts and both types (parent timestamp, secondary integer) *** FAILED ***
[info]   expected a validationError on the union step (TimestampNumberParitySpec.scala:101)
[info] - should RED/run-side: the run mixes numbers and timestamp strings under ts (parent timestamp, secondary float)
[info] - should RED: analyze reports a step error naming ts and both types (parent timestamp, secondary float) *** FAILED ***
[info]   expected a validationError on the union step (TimestampNumberParitySpec.scala:101)
[info] - should RED/run-side: the run mixes numbers and timestamp strings under ts (parent integer, secondary timestamp)
[info] - should RED: analyze reports a step error naming ts and both types (parent integer, secondary timestamp) *** FAILED ***
[info]   expected a validationError on the union step (TimestampNumberParitySpec.scala:101)
[info] - should RED/run-side: the run mixes numbers and timestamp strings under ts (parent float, secondary timestamp)
[info] - should RED: analyze reports a step error naming ts and both types (parent float, secondary timestamp) *** FAILED ***
[info]   expected a validationError on the union step (TimestampNumberParitySpec.scala:101)
[info] [hel1468-guard] ScalaTest summary: failed=6 aborted=0 unreadable=0
[info] Run completed in 1 second, 155 milliseconds.
[info] Total number of tests run: 12
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 6, failed 6, canceled 0, ignored 0, pending 0
[info] *** 6 TESTS FAILED ***
```

All 6 run-side tests pass (no lane/run error); all 6 failing tests are the analyze assertions ("expected a validationError ...").

## Cycle 2: two-collision union message (evaluation-1 CR1)

New test "RED: name every colliding field with both of its types in the one message" run against the
previous `.headOption` code (only the first collision named):

```
[info] - should RED: name every colliding field with both of its types in the one message *** FAILED ***
[info]   "union: field 'ts' is timestamp in this lane but integer in the secondary input, so the run would mix numbers and timestamps in one column. Cast one side so the types match." did not include substring "'ts' (timestamp vs integer)"
[info] Tests: succeeded 32, failed 1
```

Note: the cycle-2 red above was format-driven (the old message lacked the `'name' (a vs b)` form at all), so
it does not by itself prove every collision is named. The real proof is the `collisions.take(1)` mutation
(mutations.md, M5): with the new format but only the first collision, the test fails because
`'n' (float vs timestamp)` is missing.
