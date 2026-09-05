# Pre-fix RED evidence (HEL-868)

Captured by stashing the `SchemaInferenceEngine.scala` production change and running
`sbt "testOnly com.helio.domain.engine.SchemaInferenceEngineSpec"` against the old
(pre-fix) `PathAcc(dataType, nullable: Boolean)` implementation, with the new/inverted
tests already in place. Confirms all six new-behaviour tests are genuinely RED before
the fix (tasks 3.1, 3.6, 3.7 explicitly; the others fall out of the same probe run).

[info] - should mark field nullable when merely absent from some sampled objects (ABSENT encoding) *** FAILED ***
[info]   false was not equal to true (SchemaInferenceEngineSpec.scala:85)
[info] - should distinguish all three encodings (absent / explicit null / present-but-empty) in one test *** FAILED ***
[info]   false was not equal to true (SchemaInferenceEngineSpec.scala:106)
[info] - should mark a field nullable when it is present in only 1 of 100 sampled rows *** FAILED ***
[info]   false was not equal to true (SchemaInferenceEngineSpec.scala:118)
[info] - should infer IntegerType (not StringType) for a field that is integral in some rows and absent from the rest *** FAILED ***
[info]   false was not equal to true (SchemaInferenceEngineSpec.scala:131)
[info] - should infer StringType (not widened) for a field that is a string in some rows and absent from the rest *** FAILED ***
[info]   false was not equal to true (SchemaInferenceEngineSpec.scala:144)
[info] - should mark stats.rec nullable and player_id non-nullable on the live mixed-position Sleeper fixture *** FAILED ***
[info]   false was not equal to true (SchemaInferenceEngineSpec.scala:364)
[info] Total number of tests run: 59
[info] Tests: succeeded 53, failed 6, canceled 0, ignored 0, pending 0
[info] *** 6 TESTS FAILED ***
