# HEL-1503 red run

## Red against UNCHANGED main code (spec only; no production change applied)

Command: `cd backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.services.pipelines.Hel1503EditorRunGapsSpec"` -> exit 1

```
[info] an editor grantee's successful REAL run
[info] - should persist last_source_schema equal to the source schema the pipeline owner sees *** FAILED ***
[info]   None was not equal to Some([{"name":"name","type":"string"},{"name":"score","type":"float"}]) (Hel1503EditorRunGapsSpec.scala:206)
[info] - should store what the owner's own run stores when the primary root's source belongs to the editor (the owner cannot see it) *** FAILED ***
[info]   None was not equal to Some([]) (Hel1503EditorRunGapsSpec.scala:220)
[info] - should [regression pin] leave the owner's own run unchanged: the baseline is the owner-owned source's schema
[info] a pipeline deleted mid-submit (S1: at the access check)
[info] - should answer an owner's real run 404, never executing and writing no run row *** FAILED ***
[info]   got Left(UnprocessableEntity(DataSource not found for pipeline: 8b5d83d4-f45c-4348-8f76-078ed1d78746)): false was not equal to true (Hel1503EditorRunGapsSpec.scala:236)
[info] - should answer an editor's real run 404, never executing and writing no run row *** FAILED ***
[info]   got Left(UnprocessableEntity(DataSource not found for pipeline: 1bb3139d-7f71-41fe-aa6d-a88ea4d7c3ac)): false was not equal to true (Hel1503EditorRunGapsSpec.scala:245)
[info] - should answer owner and editor dry runs 404, never executing and writing no run row *** FAILED ***
[info]   owner got Left(UnprocessableEntity(DataSource not found for pipeline: 15baaf02-bfff-4f02-9e04-baa1b19316be)): false was not equal to true (Hel1503EditorRunGapsSpec.scala:255)
[info] - should keep the 422 for a pipeline that exists but has no root
[info] a pipeline deleted mid-submit (S2: after root resolution, before admission)
[info] - should answer an owner's and an editor's real run 404 -- never 403 or a server error -- without executing or writing a run row *** FAILED ***
[info]   owner got Left(Forbidden(Forbidden)): false was not equal to true (Hel1503EditorRunGapsSpec.scala:279)
[info] - should answer an owner's and an editor's dry run 404 without executing *** FAILED ***
[info]   owner got Right(RunResultResponse(Vector({"name":"alice","score":42.0}, {"name":"bob","score":37.0}),2,Map(73c06139-61df-4955-b208-66bf1c139696 -> 2),2,Some(282247e4-e6b1-4329-b21c-99b26f6d51e5),false,None,false,None,None
[info] admission
[info] - should hold a key-share lock on the pipeline row while the OWNER path waits for the advisory lock *** FAILED ***
[info]   Expected exception java.sql.SQLException to be thrown, but no exception was thrown (Hel1503EditorRunGapsSpec.scala:323)
[info] - should hold a key-share lock on the pipeline row while the GRANTEE path waits for the advisory lock *** FAILED ***
[info]   Expected exception java.sql.SQLException to be thrown, but no exception was thrown (Hel1503EditorRunGapsSpec.scala:323)
[info] a dry run
[info] - should be refused 403 for an editor revoked before it executes: nothing executes, no row is written *** FAILED ***
[info]   Right(RunResultResponse(Vector({"name":"alice","score":42.0}, {"name":"bob","score":37.0}), 2, Map("1867e575-cf2a-4e88-89ba-03794bcb98b2" -> 2), 2, Some("3eac0e13-4799-4d6e-b2c2-1d92b6fe51c0"), false, None, false, None, N
[info] - should [regression pin] still run and record a dry_run row for a live editor and for the owner
[info] [hel1468-guard] ScalaTest summary: failed=10 aborted=0 unreadable=0
[info] Tests: succeeded 3, failed 10, canceled 0, ignored 0, pending 0
[info] *** 10 TESTS FAILED ***
```

Labels: the 3 passing cases are truthful pins/unchanged behaviour on main ("[regression pin]" owner run, "[regression pin]" live dry runs, and "keep the 422 for a root-less pipeline"). The other 10 are genuinely red for the intended reason (baseline NULL / 422 / 403 / dry run executes / DELETE not blocked by a key-share lock).

## Mutations (production fix applied; one mutation at a time, spec re-run, mutation reverted)

Command per mutation: `sbt "testOnly com.helio.services.pipelines.Hel1503EditorRunGapsSpec"`; each run printed `[hel1468-guard] ScalaTest summary`.

## M1 owner-scoped baseline write on the editor branch
```
[info] - should persist last_source_schema equal to the source schema the pipeline owner sees *** FAILED ***
[info] - should store what the owner's own run stores when the primary root's source belongs to the editor (the owner cannot see it) *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=2 aborted=0 unreadable=0
```

## M2 findByIdInternal read instead of the owner view
```
[info] - should store what the owner's own run stores when the primary root's source belongs to the editor (the owner cannot see it) *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
```

## M3 drop the empty-roots existence check
```
[info] - should answer an owner's real run 404, never executing and writing no run row *** FAILED ***
[info] - should answer an editor's real run 404, never executing and writing no run row *** FAILED ***
[info] - should answer owner and editor dry runs 404, never executing and writing no run row *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=3 aborted=0 unreadable=0
```

## M4 map admission PipelineGone to Forbidden
```
[info] - should answer an owner's and an editor's real run 404 -- never 403 or a server error -- without executing or writing a run row *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
```

## M5a owner path without FOR KEY SHARE
```
[info] - should hold a key-share lock on the pipeline row while the OWNER path waits for the advisory lock *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
```

## M5b grantee path without FOR KEY SHARE
```
[info] - should hold a key-share lock on the pipeline row while the GRANTEE path waits for the advisory lock *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
```

## M6 skip the dry-run re-check
```
[info] - should answer an owner's and an editor's dry run 404 without executing *** FAILED ***
[info] - should be refused 403 for an editor revoked before it executes: nothing executes, no row is written *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=2 aborted=0 unreadable=0
```

## M7 dry-run PipelineGone mapped to Forbidden
```
[info] - should answer an owner's and an editor's dry run 404 without executing *** FAILED ***
[info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
```

## Green (all fixes applied)

`sbt "testOnly Hel1503EditorRunGapsSpec PipelineRunEditorPersistenceSpec PipelineRunRepositorySpec ExistenceNotLeakedRoutesSpec"` -> exit 0
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Tests: succeeded 134, failed 0, canceled 0, ignored 0, pending 0

## Full `sbt testFull` (exit 0)
```
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Total number of tests run: 7340
[info] Suites: completed 551, aborted 0
[info] Tests: succeeded 7340, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
```

## Cycle 2 re-run (comment/import edits + owner-path UUID compare)
`sbt "testOnly Hel1503EditorRunGapsSpec PipelineRunEditorPersistenceSpec PipelineRunRepositorySpec ExistenceNotLeakedRoutesSpec PipelineRunServiceSpec PipelineRunGuardIntegrationSpec"` -> exit 0
```
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Tests: succeeded 236, failed 0, canceled 0, ignored 0, pending 0
```
