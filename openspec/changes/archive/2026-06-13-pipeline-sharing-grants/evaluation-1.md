## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS

Issues:
- All six acceptance criteria are addressed:
  1. Owner can grant viewer/editor via the share UI — implemented in PipelineShareDialog, wired into PipelineDetailPage and PipelinesPage row actions.
  2. Viewer grantee can read pipeline + steps + runs + SSE stream; cannot mutate — enforced in PipelineService (findByIdShared + requireEditorAccess) and PipelineRunService (pipelineExistsShared).
  3. Editor grantee can mutate steps + trigger runs; cannot delete/transfer — enforced correctly.
  4. Cross-user no-grant → 404 — preserved via findByIdShared returning None.
  5. Test matrix (owner/editor/viewer/no-grant) — PipelineSharingAclSpec covers the full matrix; PipelineRepositorySpec adds the regression test.
  6. Frontend share dialog — PipelineShareDialog.tsx implemented.
- All tasks.md items are marked [x].
- Minor spec/code divergence: tasks 3.2 and 3.3 say delete/updateName use `findByIdOwned`, but both methods instead call `findByIdShared` with an inline owner comparison. Behavior is equivalent (grantees still get 403); `findByIdOwned` is implemented in the repo but goes unused in services. This is not a functional regression but leaves dead code and contradicts the class-level scaladoc in PipelineService.scala:61.
- No scope creep.
- No regressions to existing behavior detected — V39 drops the V35 all-commands `pipelines_owner` policy and replaces it; the drop is necessary and correct.

### Phase 2: Code Review — FAIL

Issues:

1. **Unused import: `ResourceAccess` in PipelineService.scala** (`backend/src/main/scala/com/helio/services/PipelineService.scala:40`). `ResourceAccess` is imported from `com.helio.domain` but only appears in a code comment (line 252). It is never used in a type annotation, pattern match, or value construction. Dead import per CONTRIBUTING.md "No dead code — no unused imports" requirement.

2. **DESIGN.md [mechanical] violation: hardcoded `#f87171` in PipelineShareDialog.css** (`frontend/src/features/pipelines/ui/PipelineShareDialog.css:58` and `:81`). Both `.pipeline-share-dialog__revoke-btn` and `.pipeline-share-dialog__error` use `color: #f87171` directly. DESIGN.md §3 states "No hardcoded hex/rgb/rgba in component CSS or TSX where a token applies." The error/danger intent color has token `--app-error` (`#ef4444` — same visual intent). The correct form is `color: var(--app-error)`. Note: `#f87171` is listed as a known pre-existing offender in other files (DashboardList.css, ActionsMenu.css, TypeRegistryPage.css), but those are pre-existing; introducing it in new code is a new violation.

3. **DESIGN.md [mechanical] violation: hardcoded `padding: 3px 10px` in PipelinesPage.css** (`frontend/src/features/pipelines/ui/PipelinesPage.css:207`, the `.pipeline-list-table__share-btn` rule). `3px` is not on the `--space-*` scale (which starts at `--space-1` = 4px). The nearest scale values are `--space-1` (4px) for the vertical and `--space-3` (12px) or `--space-2` (8px) for the horizontal. All margin/padding/gap must use a `--space-*` token per DESIGN.md §3.

4. **Dead code / spec divergence: `PipelineRepository.findByIdOwned` is never called from `PipelineService`** (`backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala:85`). Task 2.2 added the method; tasks 3.2–3.3 intended `delete` and `updateName` to use it. Instead both services call `findByIdShared` with an inline `ownerId` comparison. The method is unused in services, only referenced within the repo itself (line 198 is `dataSourceRepo.findByIdOwned`, a different repo). This makes `PipelineRepository.findByIdOwned` dead code from the service layer's perspective and contradicts the class-level scaladoc ("Owner-only mutation paths (delete, updateName) use findByIdOwned").

### Phase 3: UI Review — PASS

Observations:
- Happy path: Share button visible in pipeline list table and pipeline detail page header. Clicking either opens `PipelineShareDialog` with the correct title, description, and grant form (user ID input, role selector, "Grant access" button).
- Loading/empty states: "No grants yet." renders correctly when the permissions list is empty. The loading paragraph (`Loading…`) is present in the component for the pending state. No flash of empty content observed.
- Error state: Submitting an invalid user ID triggers a POST to `/api/pipelines/:id/permissions`, which returns 500; the dialog catches the error and renders "Failed to grant access. The user may already have a grant." in an `role="alert"` paragraph — visible and not swallowed.
- GET `/api/pipelines/:id/permissions` returns 200 and is called on dialog open.
- No console errors during any tested flow (the 500 from the invalid-UUID grant test is caught client-side).
- Keyboard: Escape key closes the dialog (native `<dialog>` behavior). Grant button disabled until user ID input is non-empty. ARIA labels on grantee user ID input, role selector, and revoke buttons are present.
- Breakpoints: dialog and share bar render without layout breakage at 768px and 1440px.
- Entry points tested: PipelinesPage row Share action and PipelineDetailPage header Share button both work.

### Overall: FAIL

### Change Requests

1. **Remove the unused `ResourceAccess` import in `PipelineService.scala`.** At `backend/src/main/scala/com/helio/services/PipelineService.scala:40`, remove `ResourceAccess,` from the `com.helio.domain` import block. The symbol is referenced only in a comment; it is not used in code.

2. **Replace hardcoded `#f87171` with `var(--app-error)` in `PipelineShareDialog.css`.** At lines 58 and 81 in `frontend/src/features/pipelines/ui/PipelineShareDialog.css`:
   - `.pipeline-share-dialog__revoke-btn { color: #f87171; }` → `color: var(--app-error);`
   - `.pipeline-share-dialog__error { color: #f87171; }` → `color: var(--app-error);`

3. **Replace off-scale `padding: 3px 10px` with `--space-*` tokens in the `.pipeline-list-table__share-btn` rule in `PipelinesPage.css`.** At `frontend/src/features/pipelines/ui/PipelinesPage.css:207`, change `padding: 3px 10px;` to `padding: var(--space-1) var(--space-2);` (4px 8px) or `var(--space-1) var(--space-3)` (4px 12px), whichever matches the design intent.

4. **Use `findByIdOwned` in `PipelineService.delete` and `PipelineService.updateName`, or remove the dead `findByIdOwned` method and update the scaladoc.** The current approach (`findByIdShared` + inline owner comparison) is functionally correct but diverges from the tasks spec (3.2, 3.3) and produces dead code. The preferred fix is to use `pipelineRepo.findByIdOwned(pipelineId, user)` in both `delete` and `updateName` directly — it makes the intent explicit and avoids the extra `findByIdShared` call. The scaladoc in `PipelineService.scala:61` already describes this correctly; the implementation just needs to match. If the current approach is intentionally preferred (e.g. to avoid the need for a separate findByIdShared for the 403 path), remove `findByIdOwned` from `PipelineRepository` and update the class-level doc to reflect the actual pattern used.

### Non-blocking Suggestions

- The `updateStep` and `deleteStep` methods call `findByIdInternal` before the pipeline-level ACL check. This is the correct approach (ACL is confirmed at pipeline level before the bypass write), and it is well-commented. No issue — just noting this for reviewers inspecting the flow.
- The `PipelineSummary.ownerId: String = ""` default is a safe fallback (all active code paths populate it), but could be confusing. Consider using `Option[String]` or a dedicated sentinel to make the uninitialized state explicit.
