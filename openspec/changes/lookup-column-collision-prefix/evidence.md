# Evidence

## 1.1 RED on unmodified LookupStep/inferLookup (cmd: cd backend && nice -n 19 sbt "testOnly com.helio.domain.steps.LookupColumnCollisionSpec"; exit: TestsFailedException, 8 of 24 failed)
```
[33m[33m-- Warning: /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/build.sbt:210:8 [0m[0m
[33m210 |[0m        exclude([32m"org.slf4j"[0m, [32m"slf4j-log4j12"[0m)
[33m[33m    |[0m        ^^^^^^^[0m
[33m    |[0mAlphanumeric method exclude is not declared [33minfix[0m; it should not be used as infix operator.
[33m    |[0mInstead, use method syntax .exclude(...) or backticked identifier `exclude`.
[33m    |[0mThe latter can be rewritten automatically under -rewrite -source 3.4-migration.
[33m[33m-- Warning: /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/build.sbt:211:8 [0m[0m
[33m211 |[0m        exclude([32m"org.apache.logging.log4j"[0m, [32m"log4j-slf4j2-impl"[0m),
[33m[33m    |[0m        ^^^^^^^[0m
[33m    |[0mAlphanumeric method exclude is not declared [33minfix[0m; it should not be used as infix operator.
[33m    |[0mInstead, use method syntax .exclude(...) or backticked identifier `exclude`.
[33m    |[0mThe latter can be rewritten automatically under -rewrite -source 3.4-migration.
[33m[33m-- Warning: /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/build.sbt:213:8 [0m[0m
[33m213 |[0m        exclude([32m"org.apache.pekko"[0m, [32m"*"[0m)
[33m[33m    |[0m        ^^^^^^^[0m
[33m    |[0mAlphanumeric method exclude is not declared [33minfix[0m; it should not be used as infix operator.
[33m    |[0mInstead, use method syntax .exclude(...) or backticked identifier `exclude`.
[33m    |[0mThe latter can be rewritten automatically under -rewrite -source 3.4-migration.
[33m[33m-- Warning: /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/build.sbt:214:8 [0m[0m
[33m214 |[0m        exclude([32m"com.typesafe.akka"[0m, [32m"akka-actor_2.13"[0m)
[33m[33m    |[0m        ^^^^^^^[0m
[33m    |[0mAlphanumeric method exclude is not declared [33minfix[0m; it should not be used as infix operator.
[33m    |[0mInstead, use method syntax .exclude(...) or backticked identifier `exclude`.
[33m    |[0mThe latter can be rewritten automatically under -rewrite -source 3.4-migration.
[33m[33m-- Warning: /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/build.sbt:215:8 [0m[0m
[33m215 |[0m        exclude([32m"com.typesafe.akka"[0m, [32m"akka-stream_2.13"[0m)
[33m[33m    |[0m        ^^^^^^^[0m
[33m    |[0mAlphanumeric method exclude is not declared [33minfix[0m; it should not be used as infix operator.
[33m    |[0mInstead, use method syntax .exclude(...) or backticked identifier `exclude`.
[33m    |[0mThe latter can be rewritten automatically under -rewrite -source 3.4-migration.
[33m[33m-- Warning: /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/build.sbt:216:8 [0m[0m
[33m216 |[0m        exclude([32m"com.typesafe.akka"[0m, [32m"akka-slf4j_2.13"[0m)
[33m[33m    |[0m        ^^^^^^^[0m
[33m    |[0mAlphanumeric method exclude is not declared [33minfix[0m; it should not be used as infix operator.
[33m    |[0mInstead, use method syntax .exclude(...) or backticked identifier `exclude`.
[33m    |[0mThe latter can be rewritten automatically under -rewrite -source 3.4-migration.
[33m[33m-- Warning: /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/build.sbt:217:8 [0m[0m
[33m217 |[0m        exclude([32m"org.slf4j"[0m, [32m"slf4j-log4j12"[0m)
[33m[33m    |[0m        ^^^^^^^[0m
[33m    |[0mAlphanumeric method exclude is not declared [33minfix[0m; it should not be used as infix operator.
[33m    |[0mInstead, use method syntax .exclude(...) or backticked identifier `exclude`.
[33m    |[0mThe latter can be rewritten automatically under -rewrite -source 3.4-migration.
[33m[33m-- Warning: /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/build.sbt:218:8 [0m[0m
[33m218 |[0m        exclude([32m"org.apache.logging.log4j"[0m, [32m"log4j-slf4j2-impl"[0m)
[33m[33m    |[0m        ^^^^^^^[0m
[33m    |[0mAlphanumeric method exclude is not declared [33minfix[0m; it should not be used as infix operator.
[33m    |[0mInstead, use method syntax .exclude(...) or backticked identifier `exclude`.
[33m    |[0mThe latter can be rewritten automatically under -rewrite -source 3.4-migration.
[warn] multiple main classes detected: run 'show discoveredMainClasses' to see the list
[warn] /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/src/test/scala/com/helio/infrastructure/persistence/V114BackfillSignupEventsSpec.scala:100:9: A try without a catch or finally is equivalent to putting its body in a block; no exceptions are handled.
[warn]         try {
[warn]         ^
[warn] /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/src/test/scala/com/helio/api/routes/telemetry/ProductEventRoutesSpec.scala:45:28: The outer reference in this type test cannot be checked at run time.
[warn]   private final case class Repos(
[warn]                            ^
[warn] /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/src/test/scala/com/helio/services/auth/SecretFieldSpec.scala:10:20: The outer reference in this type test cannot be checked at run time.
[warn]   final case class FakeConfig(secret: String, other: String)
[warn]                    ^
[warn] /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala:232:28: The outer reference in this type test cannot be checked at run time.
[warn]   private final case class SeededPipeline(id: String, outputId: String)
[warn]                            ^
[warn] /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/src/test/scala/com/helio/services/workspace/WorkspaceSearchServiceSpec.scala:145:28: The outer reference in this type test cannot be checked at run time.
[warn]   private final case class SeededPipeline(
[warn]                            ^
[warn] /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/src/test/scala/com/helio/services/workspace/WorkspaceTeardownServiceSpec.scala:198:28: The outer reference in this type test cannot be checked at run time.
[warn]   private final case class SeededPipeline(id: String)
[warn]                            ^
[warn] /home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/src/test/scala/com/helio/testsupport/ProvenanceFixtures.scala:29:20: The outer reference in this type test cannot be checked at run time.
[warn]   final case class Built(pipelineId: PipelineId, sources: Vector[DataSource], roots: Vector[PipelineRoot])
[warn]                    ^
[warn] 43 deprecations (since 1.1.0)
[warn] 1 deprecation (since Akka HTTP 10.1.11)
[warn] 44 deprecations in total; re-run with -deprecation for details
[warn] 10 warnings found
[info] done compiling
[warn] multiple main classes detected: run 'show discoveredMainClasses' to see the list
WARNING: Unknown module: java.nio.channels.spi specified to --add-opens
[info] LookupColumnCollisionSpec:
[info] LookupStep.evaluate on a same-named column
15:27:32,073 |-INFO in ch.qos.logback.classic.LoggerContext[default] - Found logback-core version 1.5.38
15:27:32,074 |-INFO in ch.qos.logback.classic.util.ContextInitializer@56839ed1 - No custom configurators were discovered as a service.
15:27:32,074 |-INFO in ch.qos.logback.classic.util.ContextInitializer@56839ed1 - Trying to configure with ch.qos.logback.classic.util.DefaultJoranConfigurator
15:27:32,074 |-INFO in ch.qos.logback.classic.util.ContextInitializer@56839ed1 - Constructed configurator of type class ch.qos.logback.classic.util.DefaultJoranConfigurator
15:27:32,075 |-INFO in ch.qos.logback.classic.LoggerContext[default] - Could NOT find resource [logback-test.xml]
15:27:32,077 |-INFO in ch.qos.logback.classic.LoggerContext[default] - Found resource [logback.xml] at [jar:file:/home/matt/Development/helio/.claude/worktrees/bug/lookup-column-collision-prefix/HEL-1250/backend/target/out/jvm/scala-2.13.15/helio-backend/helio-backend_2.13-0.1.0-SNAPSHOT.jar!/logback.xml]
15:27:32,105 |-INFO in ch.qos.logback.classic.model.processor.ConfigurationModelHandlerFull - Scan attribute not set or set to unrecognized value.
15:27:32,107 |-INFO in ch.qos.logback.core.model.processor.ModelInterpretationContext@7352e37c - value "INFO" substituted for "${LOG_LEVEL:-INFO}"
15:27:32,107 |-INFO in ch.qos.logback.core.model.processor.DefineModelHandler - About to instantiate property definer of type [com.helio.logging.LogFormatPropertyDefiner]
15:27:32,112 |-INFO in ch.qos.logback.core.model.processor.DefineModelHandler - Setting property LOG_APPENDER=plain in scope LOCAL
15:27:32,112 |-INFO in ch.qos.logback.core.model.processor.ModelInterpretationContext@7352e37c - value "plain" substituted for "${LOG_APPENDER}"
15:27:32,113 |-WARN in ch.qos.logback.core.model.processor.AppenderModelHandler - Appender named [json] not referenced. Skipping further processing.
15:27:32,113 |-INFO in ch.qos.logback.core.model.processor.AppenderModelHandler - Processing appender named [plain]
15:27:32,113 |-INFO in ch.qos.logback.core.model.processor.AppenderModelHandler - About to instantiate appender of type [ch.qos.logback.core.ConsoleAppender]
15:27:32,115 |-INFO in ch.qos.logback.core.model.processor.ImplicitModelHandler - Assuming default type [ch.qos.logback.classic.encoder.PatternLayoutEncoder] for [encoder] property
15:27:32,129 |-INFO in ch.qos.logback.core.ConsoleAppender[plain] - NOTE: Writing to the console can be slow. Try to avoid logging to the 
15:27:32,129 |-INFO in ch.qos.logback.core.ConsoleAppender[plain] - console in production environments, especially in high volume systems.
15:27:32,129 |-INFO in ch.qos.logback.core.ConsoleAppender[plain] - See also https://logback.qos.ch/codes.html#slowConsole
15:27:32,130 |-INFO in ch.qos.logback.core.model.processor.ModelInterpretationContext@7352e37c - value "INFO" substituted for "${LOG_LEVEL}"
15:27:32,130 |-INFO in ch.qos.logback.classic.model.processor.RootLoggerModelHandler - Setting level of ROOT logger to INFO
15:27:32,130 |-INFO in ch.qos.logback.core.model.processor.ModelInterpretationContext@7352e37c - value "plain" substituted for "${LOG_APPENDER}"
15:27:32,130 |-INFO in ch.qos.logback.core.model.processor.AppenderRefModelHandler - Attaching appender named [plain] to Logger[ROOT]
15:27:32,130 |-INFO in ch.qos.logback.core.model.processor.DefaultProcessor@d7e6ca4 - End of configuration.
15:27:32,130 |-INFO in ch.qos.logback.classic.joran.JoranConfigurator@3c5f3821 - Registering current configuration as safe fallback point
15:27:32,132 |-INFO in ch.qos.logback.classic.util.ContextInitializer@56839ed1 - ch.qos.logback.classic.util.DefaultJoranConfigurator.configure() call lasted 56 milliseconds. ExecutionStatus=DO_NOT_INVOKE_NEXT_IF_ANY
[info] - should keep the left value and expose the looked-up value as right_<name> (lane and source kind) *** FAILED ***
[info]   List(Map("code" -> "A", "qty" -> 99)) was not equal to List(Map("code" -> "A", "qty" -> 5, "right_qty" -> 99)) (LookupColumnCollisionSpec.scala:87)
[info] - should keep the left value on an unmatched row, with null under right_<name> *** FAILED ***
[info]   List(Map("code" -> "Z", "qty" -> null)) was not equal to List(Map("code" -> "Z", "qty" -> 5, "right_qty" -> null)) (LookupColumnCollisionSpec.scala:94)
[info] - should rename several collisions independent of the order of columns, avoiding an existing right_<name> *** FAILED ***
[info]   List(Map("code" -> "A", "a" -> 10, "b" -> 20, "right_a" -> 3)) was not equal to List(HashMap("right_a_2" -> 10, "a" -> 1, "code" -> "A", "b" -> 2, "right_a" -> 3, "right_b" -> 20)) (LookupColumnCollisionSpec.scala:101)
[info] - should keep the key once when sourceKey == lookupKey and the key is requested (matched and unmatched) *** FAILED ***
[info]   List(Map("code" -> "A"), Map("code" -> null)) was not equal to List(Map("code" -> "A"), Map("code" -> "Z")) (LookupColumnCollisionSpec.scala:108)
[info] - should treat a requested lookupKey as an ordinary column when sourceKey != lookupKey *** FAILED ***
[info]   List(Map("sku" -> "A", "code" -> "A")) was not equal to List(Map("sku" -> "A", "code" -> "mine", "right_code" -> "A")) (LookupColumnCollisionSpec.scala:114)
[info] PipelineAnalyzeService.analyzeNodes lookup on a same-named column
[info] - should append the requested column as right_<name>, never replacing the input field *** FAILED ***
[info]   Vector("code", "qty") was not equal to Vector("code", "qty", "right_qty") (LookupColumnCollisionSpec.scala:120)
[info] apply/infer parity (runtime LookupStep.evaluate vs analyzeNodes)
[info] - should agree on the column set: no collision / lane-kind
[info] - should agree on the column set: no collision / source-kind
[info] - should agree on the column set: single collision / lane-kind
[info] - should agree on the column set: single collision / source-kind
[info] - should agree on the column set: several collisions / lane-kind
[info] - should agree on the column set: several collisions / source-kind
[info] - should agree on the column set: right_x on the left / lane-kind
[info] - should agree on the column set: right_x on the left / source-kind
[info] - should agree on the column set: right_x requested alongside x / lane-kind
[info] - should agree on the column set: right_x requested alongside x / source-kind
[info] - should agree on the column set: right_x on both sides / lane-kind
[info] - should agree on the column set: right_x on both sides / source-kind
[info] - should agree on the column set: key only / lane-kind
[info] - should agree on the column set: key only / source-kind
[info] - should agree on the column set: sourceKey != lookupKey, lookupKey requested / lane-kind
[info] - should agree on the column set: sourceKey != lookupKey, lookupKey requested / source-kind
[info] - should lane-kind: a renamed column is typed from the ORIGINAL requested name *** FAILED ***
[info]   Vector(SchemaField("id", "string"), SchemaField("cnt", "integer")) was not equal to Vector(SchemaField("id", "string"), SchemaField("cnt", "string"), SchemaField("right_cnt", "integer")) (LookupColumnCollisionSpec.scala:159)
[info] - should DOCUMENTED DIVERGENCE: empty left input -> nothing to collide with at runtime, analyze still renames *** FAILED ***
[info]   Vector("code", "qty") was not equal to Vector("code", "qty", "right_qty") (LookupColumnCollisionSpec.scala:164)
[info] Run completed in 983 milliseconds.
[info] Total number of tests run: 24
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 16, failed 8, canceled 0, ignored 0, pending 0
[info] *** 8 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.domain.steps.LookupColumnCollisionSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 1 s, cache 90%, 27 disk cache hits, 3 onsite tasks
```

Note: the collision-parity cases pass on main only because runtime and analyze overwrite consistently; they pin agreement, the collision cases above pin the new names.

## 3.2 Mutation: in JoinColumnNaming.resolveWithKey, `val chosen = candidates.find(...).get` replaced by `val chosen = col` (prefixing disabled in the shared core). Cmd: sbt testOnly LookupColumnCollisionSpec JoinColumnCollisionSpec. Result: lookup AND join red; file restored afterwards (verified by grep, git diff shows only the intended change).
```
[info] - should keep the left value and expose the looked-up value as right_<name> (lane and source kind) *** FAILED ***
[info] - should keep the left value on an unmatched row, with null under right_<name> *** FAILED ***
[info] - should rename several collisions independent of the order of columns, avoiding an existing right_<name> *** FAILED ***
[info] - should treat a requested lookupKey as an ordinary column when sourceKey != lookupKey *** FAILED ***
[info] - should append the requested column as right_<name>, never replacing the input field *** FAILED ***
[info] - should lane-kind: a renamed column is typed from the ORIGINAL requested name *** FAILED ***
[info] - should DOCUMENTED DIVERGENCE: empty left input -> nothing to collide with at runtime, analyze still renames *** FAILED ***
[info] - should keep the left value under the original name and surface the right value as right_<name> *** FAILED ***
[info] - should rename every colliding column, deterministically *** FAILED ***
[info] - should never overwrite a pre-existing right_<name> column on the left *** FAILED ***
[info] - should never land a rename on a real right-side column named right_<name> *** FAILED ***
[info] - should left join: a matched row carries both values; an unmatched row keeps the left value *** FAILED ***
[info] - should keep the left value and surface the right value as right_<name> *** FAILED ***
[info] - should project the left column unchanged and the right column as right_<name> *** FAILED ***
[info] - should project the renamed right column when the secondary source's schema is supplied *** FAILED ***
[info] - should agree on the column set: single collision / lane-kind / inner join *** FAILED ***
[info] - should agree on the column set: single collision / lane-kind / left join *** FAILED ***
[info] - should agree on the column set: single collision / source-kind / inner join *** FAILED ***
[info] - should agree on the column set: single collision / source-kind / left join *** FAILED ***
[info] - should agree on the column set: several collisions / lane-kind / inner join *** FAILED ***
[info] - should agree on the column set: several collisions / lane-kind / left join *** FAILED ***
[info] - should agree on the column set: several collisions / source-kind / inner join *** FAILED ***
[info] - should agree on the column set: several collisions / source-kind / left join *** FAILED ***
[info] - should agree on the column set: right_x pre-existing on the left / lane-kind / inner join *** FAILED ***
[info] - should agree on the column set: right_x pre-existing on the left / lane-kind / left join *** FAILED ***
[info] - should agree on the column set: right_x pre-existing on the left / source-kind / inner join *** FAILED ***
[info] - should agree on the column set: right_x pre-existing on the left / source-kind / left join *** FAILED ***
[info] - should agree on the column set: right_x pre-existing on the right / lane-kind / inner join *** FAILED ***
[info] - should agree on the column set: right_x pre-existing on the right / lane-kind / left join *** FAILED ***
[info] - should agree on the column set: right_x pre-existing on the right / source-kind / inner join *** FAILED ***
[info] - should agree on the column set: right_x pre-existing on the right / source-kind / left join *** FAILED ***
[info] - should agree on the column set: right_x on both sides plus x / lane-kind / inner join *** FAILED ***
[info] - should agree on the column set: right_x on both sides plus x / lane-kind / left join *** FAILED ***
[info] - should agree on the column set: right_x on both sides plus x / source-kind / inner join *** FAILED ***
[info] - should agree on the column set: right_x on both sides plus x / source-kind / left join *** FAILED ***
[info] - should left join with no match: right-only columns are absent from the unmatched row but still listed by analyze *** FAILED ***
[info] - should ragged left rows: the rename mapping is stable across rows (a column present in only some rows) *** FAILED ***
[info] - should DOCUMENTED DIVERGENCE: a column declared in the analyze schema but absent from every left row is not renamed at runtime *** FAILED ***
[info] Tests: succeeded 26, failed 38, canceled 0, ignored 0, pending 0
[info] *** 38 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.domain.steps.LookupColumnCollisionSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 2 s, cache 93%, 28 disk cache hits, 2 onsite tasks
```
