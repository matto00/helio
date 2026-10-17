## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `faf36fc4b8f9535f8ad81e0d021cbbd4b6b9ab03` (cycle-2 commit on top of `877169c71`). The review base was
resolved live as `544bd79ea5879263fc05808ff15bee6cd7d6c430`. This cycle changed only backend files, a spec and
evaluation-1.md, and no frontend files. Cycle 1's frontend gates and UI verification still apply, and I re-ran the live
e2e for the editor/viewer behaviour.

### Fresh gate runs (evaluator's own)

| Gate | Result |
| --- | --- |
| `sbt testFull` (flocked, nice 19) | exit 0: 9,200 succeeded (+1 vs cycle 1, the new owner-scenario test), 0 failed, 4 canceled (`HELIO_MEASURE`-gated). All 8 `SourceScopedSampleRoutesSpec` cases passed, including "undecodable step → 404" |
| `check:scala-quality`, `format:check`, `check:openspec` | clean / exit 0 |
| Playwright `hel1648-*` + `hel1628-*` on the running app (start/stop via scripts/concertino) | 4/4 passed; teardown deleted 6 users |

Logs: `/home/matt/Development/helio/.concertino/scratch/HEL-1648/eval2-sbt-testFull.log`; persisted
`.../runs/HEL-1648/evidence/.concertino/scratch/HEL-1648/eval2-e2e.log`.

### Phase 1: Spec Review — PASS

- **CR4 resolved.** `specs/source-sample-api/spec.md` now states "the pipeline's owner or holds an `editor` grant" and adds the scenario "Pipeline owner samples a collaborator's secondary". `SourceScopedSampleRoutesSpec` covers it: A gets B's lookup source via `?pipelineId=P` with a schema-valid 200, and gets 404 without the scope.
- Every acceptance criterion from cycle 1 still holds. C1, C2 (editor-only) and C3 are honoured.

### Phase 2: Code Review — PASS

- **CR1 resolved.** `DataSourcePreviewRoutes.scala:79-80` filters with `isPlausiblePipelineId` and wraps the value in `PipelineId` at the route. `SourceSampleService.sample` now takes `Option[PipelineId]`. An empty or implausible value becomes `None`, which gives the same 404, and the full-suite negatives (empty, malformed `%00`) still pass byte-identically.
- **CR2 resolved.** There is an ACL-bypass justification comment at the `findByIdInternal` callsite.
- **CR3 resolved.** The lookup secondary is now A's source, so B's 200 runs through the scoped branch. `mutation-lookup-detection.log` (persisted) is genuinely red: "join, union and lookup SECONDARY" fails with `404 was not equal to 200`, and so does the owner-scenario test.
- **Required repositories.** `pipelineRepo` and `pipelineStepRepo` are now required constructor params. The production wiring at `ApiRoutes.scala:403` passes both, and the in-service `!= null` fallback is gone. `SourceSampleServiceSpec` passes `null, null` explicitly. Those tests exercise only the owner path, so that is acceptable.
- **`recover` narrowing: claim verified.**
  - `PipelineStepRepository.rowToDomain` (`:1435`, `:1439`) throws `IllegalStateException` on every decode failure.
  - `PipelineStepConfigCodec.decode` wraps the unknown-op `IllegalArgumentException` and any JSON parse error in a `Try`, so they surface through the `Failure(ex)` arm, which is also an ISE.
  - `executionOrder` has no throwing paths.
  - The undecodable-step negative still produces the byte-identical 404 (`assertDenied`, full suite green).
  - If some unrelated failure ever happened to be an ISE, it would only map to the fail-closed 404.
- **No 5xx for a caller without the grant proof.** The uses-check, the only place the narrowed `recover` applies, runs strictly after `findByIdShared` (grant proved under the caller's RLS) and the owner-or-editor test (`SourceSampleService.scala:84-95`). Before that point the only failure sources are DB errors in `findByIdOwned`, `findByIdShared` and `findGrantRole`. Those existed before this change, do not depend on data, and are the same for any caller, so they are no oracle.
- No new logging, and no `PipelineRunService` reference.

### Phase 3: UI Review — PASS

- No frontend change this cycle. Cycle 1's manual verification still applies: editor label in both themes at 1440, 1100, 768 and 360 with an accessible refresh button, and the viewer gets no label and makes no request.
- I re-ran the live e2e for the editor (desktop and phone, both themes, scoped refresh) and the viewer (no label, zero `/sample` requests) against this HEAD: it passed.

### Overall: PASS

### Non-blocking Suggestions

- `usePipelineDetailPage.ts` (440 lines) and `PipelineDetailHeader.tsx` (415) are over ~400 lines. Propose a split in the PR description (CONTRIBUTING).
- `SourceSampleLabel`'s `canRefresh` could key on `access === "yes"` alone, because the role already wins over a loading sources list.
- `ownS` (B's own union secondary) in the secondary test is seeded but never requested. Either assert it or drop it.
- C2 reminder: Delivery waits for the owner's recorded D1 answer.
