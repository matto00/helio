# HEL-1516 red-run record

Command for every run (from /home/matt/Development/helio/.claude/worktrees/bug/grantee-drift-preview-recheck/HEL-1516/backend):

    nice -n 19 sbt -J-Xmx3g "testOnly com.helio.services.pipelines.Hel1516GranteeDriftPreviewSpec"

Spec: /home/matt/Development/helio/.claude/worktrees/bug/grantee-drift-preview-recheck/HEL-1516/backend/src/test/scala/com/helio/services/pipelines/Hel1516GranteeDriftPreviewSpec.scala
(NOSUPERUSER NOBYPASSRLS service role, seeding/measuring on the privileged pool, throwaway @example.test users).

## 1. RED on unchanged main (spec + ExistenceNotLeaked comment only; no production change yet)

Defect cases (a) drift, (d) step preview seam R, (e) Output preview seam R, (f) S1 x2 and S2 are RED; guards (b),(g) and pin (c) pass by construction.
Observed (verbatim lines):

    [info] a grantee's analyze schema drift
    [info] - should [DEFECT, red on main] equal the owner's drift (non-empty) for an editor and for a viewer *** FAILED ***
    [info]   None was not equal to Some(SourceSchemaDriftResponse(Vector(SchemaFieldResponse("extra", "string")), Vector(), Vector())) (Hel1516GranteeDriftPreviewSpec.scala:257)
    [info] - should [GUARD, failable by M2] report NO drift to an editor or a viewer when the source schema is unchanged since the baseline
    [info] - should [PIN, no mutation] leave the owner's own drift unchanged
    [info] a step preview whose grant is revoked after the last ACL read (seam R)
    [info] - should [DEFECT, red on main] be refused 403 for an editor and for a viewer (non-AI closure), never executing *** FAILED ***
    [info]   editor got Right(RunResultResponse(Vector({"name":"alice","score":42.0}, {"name":"bob","score":37.0}),2,Map(b1be05b2-d22c-4ccf-b1aa-78f70521d391 -> 2),2,None,false,None,false,None,None,Vector())): false was not equal to true (Hel1516GranteeDriftPreviewSpec.scala:286)
    [info] an Output preview whose grant is revoked after the last ACL read (seam R)
    [info] - should [DEFECT, red on main] be refused 403 on the single-Output and the all-Outputs arm, step-bound and source-bound, never executing *** FAILED ***
    [info]   editor stepBound=true single=true got Right(PipelinePreviewResponse(Vector(OutputPreviewEntry(cd2f2412-e2ab-4b3b-b14f-681ab46f8a06,RunResultResponse(Vector({"name":"alice","score":42.0}, {"name":"bob","score":37.0}),2,Map(b733e3e0-8713-4008-86b2-fe74c5f81c96 -> 2),2,None,false,None,false,None,None,Vector()))))): false was not equal to true (Hel1516GranteeDriftPreviewSpec.scala:301)
    [info] a preview of a pipeline deleted mid-request
    [info] - should [DEFECT, red on main] answer a step preview 404 (S1), never executing *** FAILED ***
    [info]   got Left(UnprocessableEntity(DataSource not found for pipeline: d637e558-8a90-4c3f-95b8-b42909492d87)): false was not equal to true (Hel1516GranteeDriftPreviewSpec.scala:315)
    [info] - should [DEFECT, red on main] answer a single-Output preview 404 (S1), step-bound and source-bound, never executing *** FAILED ***
    [info]   stepBound=true got Left(UnprocessableEntity(DataSource not found for pipeline: fb26232f-401e-4913-9a85-8b6ab4104608)): false was not equal to true (Hel1516GranteeDriftPreviewSpec.scala:326)
    [info] - should [DEFECT, red on main] answer a step preview and a step-bound single-Output preview 404 'Pipeline not found' when deleted at the step-list read (S2) *** FAILED ***
    [info]   step got Right(RunResultResponse(Vector({"name":"alice","score":42.0}, {"name":"bob","score":37.0}),2,Map(207ff82c-f36c-4007-9b25-86a39a53aff9 -> 2),2,None,false,None,false,None,None,Vector())): false was not equal to true (Hel1516GranteeDriftPreviewSpec.scala:338)
    [info] live previews
    [info] - should [GUARD, failable by M5] still let a viewer preview a non-AI closure; deny a viewer an AI closure with zero model calls; allow an editor an AI closure
    [info] - should [PIN, no mutation] still let the owner and a live editor/viewer preview a step, a single Output and all Outputs
    [info] [hel1468-guard] ScalaTest summary: failed=6 aborted=0 unreadable=0
    [info] Tests: succeeded 4, failed 6, canceled 0, ignored 0, pending 0
    [info] *** 6 TESTS FAILED ***

## 2. GREEN after the fix

    [info] Tests: succeeded 10, failed 0, canceled 0, ignored 0, pending 0
    [info] All tests passed.

## 3. Mutations (each applied alone to the fixed code, run, then restored; `git diff` of src/main afterwards shows only the intended fix)

| Mutation | Change | Result (observed) |
|---|---|---|
| M1 | analyze baseline back to `pipelineRepo.findLastSourceSchema(pipelineId, user)` | RED: defect (a) `None was not equal to Some(SourceSchemaDriftResponse(Vector(SchemaFieldResponse("extra","string")),...))` (1 failed) |
| M2 | drift current schema read with `dataSourceRepo.findByIdOwned(primaryDsId, user)` | RED: defect (a) and guard (b): `Some(SourceSchemaDriftResponse(Vector(), Vector(name, score), Vector())) was not equal to None` (every baseline column "removed"); 2 failed |
| M3 | `NotAuthorized` branch of `guardedExecution` runs the execution (re-check skipped) | RED: (d) editor got Right(...), (e) editor stepBound single got Right(...), and guard (g) viewer AI closure executed; 3 failed |
| M4a | empty-roots branch always 422 (existence check dropped) | RED: (f) S1 step `got Left(UnprocessableEntity(DataSource not found...))`, S1 single-Output same; 2 failed |
| M4b | `PipelineGone` mapped to `Forbidden` | RED: (f) S2 `step got Left(Forbidden(Forbidden))`; 1 failed |
| M5 | step arm `requireEditor = false` | RED: guard (g) `viewer got Left(UnprocessableEntity(... analyzewithai ai-unavailable ...))` (viewer reached the AI step); 1 failed |

(c) is a labelled pin with no mutation. Raw outputs: mutation runs were captured by a scratch script; the observed lines above are copied from them.

## 4. Existing suites (fixed code, foreground, nice -n 19)

Run 1 (ExistenceNotLeakedRoutesSpec, Hel1503EditorRunGapsSpec, Hel1516GranteeDriftPreviewSpec, PipelineRunServiceSpec, PipelineRunEditorPersistenceSpec, PipelineAnalyze{AnalyzeWithAi,SchemaWarnings,ConciseByteBudget,GenerateText,UpsertSource,JoinCollision,ConvertFormat,CanRunRoutes,ProposalRoutes,Routes,Service}Spec, PipelineRunRoutesSpec, OutputRoutesSpec):

    [info] Suites: completed 18, aborted 0
    [info] Tests: succeeded 560, failed 0, canceled 0, ignored 0, pending 0

Run 2 (ApiRoutesPipelineRunGuardSpec, ApiRoutesSpec, DataSourceRoutesSpec, PipelineAclSpec, PipelineRunServiceUpsertSourceSpec, StepConfigInvalidRoutesSpec, UpsertTargetWritableRoutesSpec, PatchSetPreview{Routes,StepKindRoutes,Cumulative}Spec):

    [info] Suites: completed 10, aborted 0
    [info] Tests: succeeded 407, failed 0, canceled 0, ignored 0, pending 0

The full `sbt testFull` was not run locally (exceeds the 600 s foreground cap); left to CI.
