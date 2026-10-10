# HEL-1436 recorded mutation checks (task 1.9)

Each mutation was applied to CastStep.scala alone, the four cast specs run (sbt -J-Xmx3g testOnly), output recorded, mutation reverted (file restored byte-for-byte; final diff contains none).

## M1 write-only check moved into validateRawConfig (unsupportedTargetProblem added to validateRawConfig)
[info] - should GUARD: a stored legacy binary-ref cast lists, analyzes with no validationError, and is not gated (projection: CastStepSpec) *** FAILED ***
[info] - should GUARD: validateRawConfig, analyze stepConfigProblem and the run gate do not report a legacy target *** FAILED ***
[info] - should RED: legacy 'string-body' projects the input type unchanged with no validationError *** FAILED ***
[info] - should RED: legacy 'binary-ref' projects the input type unchanged with no validationError *** FAILED ***
[info] - should RED: legacy 'foo' projects the input type unchanged with no validationError *** FAILED ***
[info] - should GUARD (C5): the scheduler/auto-run gate reports no reason for it *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=6 aborted=0 unreadable=0
[info] Tests: succeeded 64, failed 6, canceled 0, ignored 0, pending 0
[info] *** 6 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.api.routes.pipelines.CastTargetWriteRoutesSpec
[error] 	com.helio.domain.engine.CastRuntimeParitySpec
[error] 	com.helio.domain.steps.CastStepSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 5 s, cache 90%, 27 disk cache hits, 3 onsite tasks

## M2 predicate shrunk to TimestampParsing.looksLikeTimestamp alone
[info] - should GUARD: timestamp keeps '2026-07-01 12:00:00' unchanged (original string, untrimmed) *** FAILED ***
[info] - should GUARD: timestamp keeps '1751371200' unchanged (original string, untrimmed) *** FAILED ***
[info] - should GUARD: timestamp keeps ' 2026-03-14 ' unchanged (original string, untrimmed) *** FAILED ***
[info] - should GUARD: date keeps '2026-07-01 12:00:00' unchanged (original string, untrimmed) *** FAILED ***
[info] - should GUARD: date keeps '1751371200' unchanged (original string, untrimmed) *** FAILED ***
[info] - should GUARD: date keeps ' 2026-03-14 ' unchanged (original string, untrimmed) *** FAILED ***
[info] - should GUARD: an integer-looking string is kept under timestamp (epoch, matching datebucket) *** FAILED ***
[info] - should GUARD: a Long epoch input yields its String form *** FAILED ***
[info] - should GUARD: buckets a space-separated and an epoch value to non-null dates *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=9 aborted=0 unreadable=0
[info] Tests: succeeded 61, failed 9, canceled 0, ignored 0, pending 0
[info] *** 9 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.domain.engine.CastRuntimeParitySpec
[error] 	com.helio.domain.steps.CastStepSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 5 s, cache 87%, 27 disk cache hits, 4 onsite tasks

## M3 kept value trimmed (str.trim)
[info] - should GUARD: timestamp keeps ' 2026-03-14 ' unchanged (original string, untrimmed) *** FAILED ***
[info] - should GUARD: date keeps ' 2026-03-14 ' unchanged (original string, untrimmed) *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=2 aborted=0 unreadable=0
[info] Tests: succeeded 68, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.domain.steps.CastStepSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 5 s, cache 84%, 27 disk cache hits, 5 onsite tasks

## M4 catch-all case _ => str in place of explicit case _ => v
[info] - should RED: 'string-body' passes the ORIGINAL value through (a Double stays a Double) *** FAILED ***
[info] - should RED: 'binary-ref' passes the ORIGINAL value through (a Double stays a Double) *** FAILED ***
[info] - should RED: 'foo' passes the ORIGINAL value through (a Double stays a Double) *** FAILED ***
[info] - should RED: a real run passes a non-String value through unchanged *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=4 aborted=0 unreadable=0
[info] Tests: succeeded 66, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.domain.engine.CastRuntimeParitySpec
[error] 	com.helio.domain.steps.CastStepSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 5 s, cache 87%, 27 disk cache hits, 4 onsite tasks
