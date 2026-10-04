## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 3ad650c98364f64bbd7438e5a258823c694e5bdc (base 6cda2a82 resolved live).

### What I verified (with evidence)
- Gate: own run of `cd backend && nice -n 19 sbt testFull` -> 5516 tests, 380 suites, 0 failed, 0 aborted, "All tests passed" (377 s). No flakes hit.
- Root cause fix: ApiRoutes passes `outputRepoOpt.orNull` into PatchSetPreviewService; both services build context via `PatchSetApplyContext.build` (all params required, `= null` default removed from case class and from PatchSetApplyService ctor).
- Second latent defect (MatchError) handled: `computeAfter` gains OutputUpdate/OutputDelete cases (no wildcard); Impact lists them explicitly (empty hint, decision recorded).
- Context-parity audit (design.md tables A/B/C): all 7 context fields, all null guards, all ResolvedAction x (kind, op) enumerated; my diff read agrees (only outputRepo was unwired; the :673 silent `boundOutputs: []` degradation was replaced by a typed rejection in resolvePipelineStepDelete).
- Parity test failability: PatchSetPreviewOutputContextSpec reflects over productElementNames/productIterator of the preview-built context; evaluator's mutation (preview passes null outputRepo) turned 8 tests red incl. parity, every-variant (scala-reflect sealed subclasses), write-free, step-delete parity, 2 ExistenceNotLeaked preview rows, 2 route tests. I read the tests; they assert 200 + Output-level diff, so they are red for both NPE and MatchError causes.
- Write-free: full public-schema per-table count + md5 across the whole (kind, op) matrix; evaluator's write-inserting mutation in project() went red.
- ExistenceNotLeakedRoutesSpec: output:update/output:delete exemptions removed (diff), OutputT target seeded with a real Output row, 4 new rows (apply+preview x update/delete) with `patchKinds`, stale-exemption guard passes in full run; foreign/absent id both yield the single constant "Output not found" from findOwnedOutput (404, byte-identical).
- No silent apply behaviour change: OutputService.mergeConfig/validateFieldMapping moved verbatim to companion (diff is a pure move; update/create call sites prefixed). PatchSetApplyService default removal is compile-enforced; 6 fixtures updated and compile. The only runtime change is in the no-DbContext case (null repo): previously NPE (500) / silent empty boundOutputs, now typed ServiceError.InternalError "Output repository is not configured" (HTTP 500, as before for NPE but with a clean message, and without under-reporting priorState). Documented and tested.
- HTTP semantics of the typed null-repo error: InternalError -> 500 is appropriate (server misconfiguration, not client fault), no resource-existence leak.

### Verdict: CONFIRM

### Non-blocking notes
- Red-first on unfixed main is not literally recorded: task 1.1 asks for the captured command + observed 500, but no such output is in the artifacts and the work is a single commit, so ordering cannot be shown. The null-outputRepo mutation (reproducing the original NPE path) plus tests that assert 200/diff are an adequate proxy; I did not re-run against pristine main.
- ApiRoutes still passes `.orNull` (no-DbContext path); acceptable given typed rejection.
- No UI changes; design-standard review N/A.
