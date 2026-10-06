## Standing Constraints

- [C1] Test-count evidence must show zero aborted suites in both baseline and final runs; reconcile after = before - removed + added with every term named
- [C2] Keep ApiRoutes val declaration order; never let a plain val be read before its definition (no Some(null)); do not rework aiStepClient to reuse chatAccessService

### Backend

## 1. Baseline

- [x] 1.1 Run `nice -n 19 sbt testFull` on the untouched branch; record the ScalaTest totals (D8)

## 2. Services: null branches (D1, D2)

- [x] 2.1 `OutputControlsValidator`: add `require`; delete :56 branch; update scaladoc
- [x] 2.2 `WorkspaceContextService`: add `require`; delete :132 and :308 branches; rewrite comments
- [x] 2.3 `WorkspaceSearchService`: add `require`; delete :76 guard; rewrite comment
- [x] 2.4 `PatchSetApplyContext`/undo context: add `require`; delete resolver :637/:774 and `PatchSetUndoService:91`
- [x] 2.5 Delete `outputRepoUnavailable`/`OutputRepoUnavailableMessage` once unreferenced; fix `PatchSetApplyTypes` comment

## 3. Routes (D4, D5)

- [x] 3.1 `PublicDashboardRoutes`: required `outputRepo: OutputRepository`; collapse `None` arms; escalate if any caller relied on default
- [x] 3.2 `ApiRoutes`: convert all 16 `Option(dbContext)` sites + `outputRepoOpt` per D5; keep val order
- [x] 3.3 `ApiRoutes`: collapse consumers (`.orNull`, `.fold(reject)`, `for`, `aiStepClient` `None` arm); pass `Some(x)` to Option-typed downstream params
- [x] 3.4 Rewrite stale nullable-dbContext comments at every touched site

## 4. Cosmetic (D7)

- [x] 4.1 Re-indent `PipelineService.createTransactional` body; `git diff -w` shows no change for it

### Tests

## 5. Tests (D3, D6, D8)

- [x] 5.1 Give null-outputRepo fixtures a mock/real repo (workspace specs, `AssistantToolExecutorSpec` helper)
- [x] 5.2 Update `PublicDashboardRoutes` callers in specs to pass the repo directly
- [x] 5.3 Remove only null-repo-state tests (D6); record each with reason
- [x] 5.4 (Recommended) Add one `require`-fires test per D1 class
- [x] 5.5 Run `nice -n 19 sbt testFull`; record totals; reconcile `after = before - removed + added`
- [x] 5.6 Write the site-by-site table (file:line before -> action) into `files-modified.md` notes for the PR
