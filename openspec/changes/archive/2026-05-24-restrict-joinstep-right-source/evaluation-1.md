## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS

Issues:
- All 7 tasks.md items marked [x] and implemented
- AC1 (new step/update with cross-user right-source → 404): covered by addStep and updateStep JoinConfig branches
- AC2 (existing pipelines still evaluate — runtime uses findByIdInternal): unchanged; findByIdInternal remains in PipelineRunService, design correctly documents "pre-flight + runtime internal" choice
- AC3 (cross-user test → 404): PipelineStepRoutesSpec "POST with join type and cross-user right-source returns 404"
- AC4 (owner test → 201): PipelineStepRoutesSpec "POST with join type and own right-source returns 201"
- AC5 (HEL-272 coordination): no code changes needed; noted as defense-in-depth follow-up
- No scope creep; ApiRoutes.scala change is one-line wiring
- No API contract changes required (same 404 response shape already in use)
- OpenSpec tasks.md reflects final implementation

### Phase 2: Code Review — PASS

Issues:
- CONTRIBUTING.md compliance: inline FQN `java.util.UUID.randomUUID()` in seedDataSource was present but caught and fixed in the second commit before push. Final HEAD is clean.
- DRY: joinCheckF extracted identically in addStep and updateStep — acceptable given the two call sites live in different code paths with different context. A private helper would be possible but is not required at this scale.
- Readable: existence-not-leaked semantics and HEL-278 attribution commented at both call sites. Good.
- Modular: dataSourceRepo threaded as constructor param (not a global or singleton). Correct.
- Security: findByIdOwned enforces owner_id = ? — correct ACL triad choice for a mutation pre-flight. No 403/existence leak.
- Error handling: Left(ServiceError.NotFound(...)) surfaces correctly through the route layer to 404 HTTP.
- Tests: two integration tests with real embedded Postgres — cross-user 404 and owner 201. Meaningful.
- No dead code, no unused imports, no leftover TODOs.
- Behavior-preserving: PipelineAclSpec and PipelineAnalyzeRoutesSpec updated only to fix constructor arity; no semantic change.
- File size: PipelineService.scala is 326 lines (within the ~400 warn threshold).

### Phase 3: UI Review — N/A

ApiRoutes.scala changed (one-line PipelineService constructor wiring), but no frontend files changed. The JoinStep ACL is a backend-only enforcement; the frontend pipeline builder does not need changes for this ticket. Phase 3 skipped per the E2E feasibility check.

### Overall: PASS

### Non-blocking Suggestions
- The joinCheckF pattern is duplicated across addStep and updateStep. At ~12 lines each, a private helper `checkJoinSourceOwnership(typedConfig, user): Future[Either[ServiceError, Unit]]` would remove the repetition if a third call site ever appears. Not required for this ticket.
- The `seedPipeline` helper in PipelineStepRoutesSpec hard-codes owner_id to user 1 in the raw SQL; the HEL-278 cross-user tests work correctly because the test creates the right-source under a different owner, not a different pipeline owner. A comment noting that distinction would help future readers, but is not a blocker.
