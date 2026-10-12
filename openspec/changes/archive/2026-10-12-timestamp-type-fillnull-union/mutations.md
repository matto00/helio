== M1 fillnull: flag every strategy (drop NumericFillStrategies check)
[info] - should report no error for forwardFill on a timestamp column *** FAILED ***
[info] - should report no error for mode on a timestamp column *** FAILED ***
[info] - should report no error for constant on a timestamp column *** FAILED ***
[info] Tests: succeeded 29, failed 3, canceled 0, ignored 0, pending 0
[info] *** 3 TESTS FAILED ***
== M2 fillnull: ignore the column type (flag any listed column present or not)
[info] - should report no error for mean on a integer column *** FAILED ***
[info] - should report no error for mean on a float column *** FAILED ***
[info] - should report no error for median on a integer column *** FAILED ***
[info] - should report no error for median on a float column *** FAILED ***
[info] - should report no D1 error for a listed column absent from the input schema *** FAILED ***
[info] - should name only the timestamp columns when a mean lists a timestamp and a numeric column *** FAILED ***
[info] Tests: succeeded 26, failed 6, canceled 0, ignored 0, pending 0
[info] *** 6 TESTS FAILED ***
== M3 union: flag any type difference
[info] - should report no error and keep the parent type for string vs timestamp *** FAILED ***
[info] - should report no error and keep the parent type for timestamp vs string *** FAILED ***
[info] - should report no error and keep the parent type for integer vs float *** FAILED ***
[info] - should report no error and keep the parent type for float vs integer *** FAILED ***
[info] - should report no error and keep the parent type for string vs integer *** FAILED ***
[info] - should report no error and keep the parent type for integer vs string *** FAILED ***
[info] - should report no error when the timestamp and numeric fields have different names *** FAILED ***
[info] Tests: succeeded 25, failed 7, canceled 0, ignored 0, pending 0
[info] *** 7 TESTS FAILED ***
== M4 union: flag the unresolved (source-kind) secondary
[info] - should KNOWN GAP (pinned): a source-kind secondary is not checked and keeps the parent type *** FAILED ***
[info] Tests: succeeded 31, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
== M5 union: keep the new message format but name only the first collision (`collisions.take(1).mkString`)
TimestampNumberParitySpec: Tests: succeeded 32, failed 1.
- should RED: name every colliding field with both of its types in the one message *** FAILED ***
  the message included "'ts' (timestamp vs integer)" but not "'n' (float vs timestamp)". Source restored afterwards.
== M6 save path: reject fillnull mean over a timestamp column at write time
Not mechanically applicable: `rawConfigProblem` is schema-free, so a write-time timestamp rejection cannot be expressed there; the guard pins that it accepts the config.
