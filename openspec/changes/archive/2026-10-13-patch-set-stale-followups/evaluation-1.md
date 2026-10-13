## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `0d44ada1447f5e0c770c17cfe570427ff865c38c`. Diff base: `d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc`, resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — FAIL

All six in-scope ACs are implemented and tested. AC7 is the orchestrator's (HEL-1540). Constraints C1, C2 and C3 are honored:
- C1: no `helio-mcp/` or layout-version files in the diff.
- C2: every new spec is under 250 lines (117, 75, 116, 124, 48; the fixture is 194). The two oversized specs gained only the `updateSchemaInternal` call and its import.
- C3: `mutation-runs.md` exists, and I re-ran two of its rows (see Phase 2).

Issues (planning artifacts do not match what was implemented):
1. `tasks.md` 2.0 is ticked `[x]` but describes work that was not done: "Add required `alertRuleRepo` to `PatchSetApplyContext`/`build`, `PatchSetApplyService`, `PatchSetPreviewService` and every construction site". What was implemented is `OutputRepository.findVisibleAlertRuleIds`. The body of design.md D4 (the "alert rules:" bullet) still prescribes the `alertRuleRepo` collaborator. Only the trailing Implementation Notes record the deviation.
2. `tasks.md` 5.2 says "both themes checked against the running app". The orchestrator reports that the executor did not do this. I have now done it (Phase 3), but as written the line claims the executor produced that verification.
3. design.md D7 says the already-applied state uses the "existing `PageStatus`/inline error pattern". The implementation uses `EmptyState` (`PatchSetReviewPage.tsx:170-180`).

Verified claims:
- **(a) D4 deviation is equally caller-scoped. Acceptable.** `OutputRepository.findVisibleAlertRuleIds` (`OutputRepository.scala:195-202`) runs under `ctx.withUserContext(user.id)` with an explicit `ownerId === user` filter. That is exactly how `AlertRuleRepository.findAll` (`AlertRuleRepository.scala:57-62`) scopes its read, so a rule the caller cannot list is counted and never named. Pinned by `PatchSetPipelineDeleteImpactRoutesSpec` "count an alert rule the caller does not own without naming it". There is a precedent for `OutputRepository` reading the alert-rule table (`findAlertRuleDefinitionsInternal`). Only the artifacts are wrong (issue 1).
- **(b) Claim release rule and RLS: correct per D5.**
  - `PatchSetApplyOnce.run` claims after the stale check and before `applyResolved`.
  - The claim is released only on a `Left`, or on a `Right` with no `applicationId` whose every edit is `rolledBack`. An empty edit list (the first edit failed) counts as all rolled back and is also released.
  - The claim is kept on any `recreated`/`unrecoverable` outcome, on a failed Future, or on a `journalSuccess` failure (`flatMap` never runs).
  - `applyResolved` never returns `Left` after a write (`PatchSetApplyService.scala:145-155`).
  - The claim, release and attach writes all use `ctx.withUserContext` (`PatchSetApplicationRepository.scala:163-180`).
  - The V131 policy is V79's verbatim (`USING` with no `WITH CHECK`, which Postgres also applies to INSERT).
  - Not provable on the superuser dev/test DB (MISTAKES.md); the executor disclosed this.
- **(c) Assistant hand-off seam: correct by code trace.**
  - `executeProposePatchSet` returns `{...preview, proposalId}` as the tool-result string (`AssistantToolExecutor.scala:312-314`).
  - `ClaudeClient.scala:151` wraps that string verbatim in `ToolResult`.
  - `AssistantConversationRepository.scala:172-177` persists it as `{blockType:"tool_result", toolUseId, content:<string>, isError}`. That is exactly the shape `proposalExtraction.test.ts` feeds, and what `withMintedProposalId` parses.
  - `stampFingerprints` spreads `...patchSet`, so `proposalId` reaches the apply body (`PatchSetReviewPage.tsx:105`).
  - Caveat: the frontend "seam" test uses a hand-built fixture, not a repository-serialized one (see suggestions).

### Phase 2: Code Review — FAIL

Gates (my own runs, foreground, `nice -n 19`, `-J-Xmx3g`, 3 jest workers; in `WORKTREE_PATH`, CLEAN_WORKTREE unset):
- `sbt testOnly com.helio.api.routes.patchsets.* com.helio.domain.patchsets.* …PipelineStepRemovalRuleSpec …RlsPolicyGuardSpec com.helio.services.patchsets.*`: **569/569 passed.**
- `sbt testOnly com.helio.services.assistant.* com.helio.api.routes.assistant.* com.helio.infrastructure.persistence.pipelines.* com.helio.infrastructure.persistence.patchsets.* com.helio.api.routes.pipelines.* *FlywayNonSuperuserMigrationSpec *SchemaDrift* *JsonSchema*`: **1020/1020 passed.**
- Full `sbt testFull` was **not** run (it does not fit the 600 s foreground budget). These two targeted runs cover the touched packages.
- `npm run lint`, `typecheck`, `format:check`, `check:schemas`, `check:spec-structure`, `check:openspec`, `check:scala-quality`, `check:tokens`, `check:repo-integrity`: all exit 0.
- `npm test` (3 workers): **583 suites / 6991 tests passed.**
- `npm --prefix frontend run build`: exit 0.

Mutation spot-check, point (e). Run in a throwaway detached worktree at `0d44ada14`, which was removed afterwards:
- `mutation-runs.md` row 2 (`Allowlist("output")` drops `panelIds`, `alertRules`): **reproduced RED (4)**. All four output-delete cascade tests in `PatchSetStaleCascadeRoutesSpec` failed, exactly as recorded.
- Additional mutation not in the file (release becomes a no-op on a clean rollback): **RED (1)**, "release the proposalId when every applied edit rolled back cleanly". The release path has a non-vacuous test.
- Unmutated tests in the same run stayed green (14 passed).

Issues:
1. CONTRIBUTING.md:70 Imports & Qualifiers (inline FQN, mechanical rule; `check:scala-quality`'s regex misses both):
   - `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyService.scala:394`: `scala.util.Try(UUID.fromString(value))`.
   - `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetRoutesFixture.scala:120`: `slick.dbio.DBIO[_]`.

Everything else is clean:
- DRY: one removal rule (`PipelineStepRepository.removalOf`) and one Output projection (`outputsJson`) are shared by delete, preview and fingerprint.
- Tests are meaningful. Typing is sound.
- No dead code, no TODOs. Lenient `proposalId` decoding is confined to the format; the UUID check is on the apply path only, per CR3.

### Phase 3: UI Review — PASS

Tested on the running app (`start-servers.sh` on ports 6954/9861, which passed `assert-phase servers`) with the throwaway user `hel1522-eval-1791892197633@example.test` (id `1acca3d6-2872-4c0c-9a0f-9273ef2a3975`). The user was deleted afterwards by exact (id, email) through `buildUserDeleteSql`; 0 rows remain.

- Live wire: apply → 200; same `proposalId` again → 409 `{"code":"PATCH_SET_ALREADY_APPLIED","message":…}`.
- Happy path and re-entry: I pushed an already-applied create-only patch set (with its `proposalId`) as review-page route state. The page previewed it, and Accept & apply rendered the final state: `EmptyState` "This proposal was already applied" / "Ask for a new proposal to change anything else." with only a "Back to dashboards" CTA. There is no Apply or Re-preview control.
- Both themes rendered correctly, with tokens matching sibling empty states:
  - dark: ref=/home/matt/Development/helio/.concertino/runs/HEL-1522/evidence/.concertino/runs/HEL-1522/evidence/eval1-already-applied-dark-1280.png
  - light: ref=/home/matt/Development/helio/.concertino/runs/HEL-1522/evidence/.concertino/runs/HEL-1522/evidence/eval1-already-applied-light-1440.png
- Breakpoints 1440, 768 and 375: no horizontal overflow (`scrollWidth <= innerWidth`) and the CTA is visible.
  - 768: ref=/home/matt/Development/helio/.concertino/runs/HEL-1522/evidence/.concertino/runs/HEL-1522/evidence/eval1-already-applied-light-768.png
  - 375: ref=/home/matt/Development/helio/.concertino/runs/HEL-1522/evidence/.concertino/runs/HEL-1522/evidence/eval1-already-applied-light-375.png
  - 1100 was not separately captured.
- Accessibility: the CTA is a native `<button>` with accessible name "Back to dashboards" and `tabIndex` 0. Focus then Enter navigated to `/`.
- Console: one error, the browser's own network log of the expected 409 on `/api/patch-sets/apply`. There was no unhandled exception.
- Servers stopped with `stop-servers.sh` (STOPPED ports=6954,9861).

### Overall: FAIL

### Change Requests
1. `openspec/changes/patch-set-stale-followups/tasks.md` 2.0: replace the text with what was built, e.g. "Caller-scoped alert-rule visibility via `OutputRepository.findVisibleAlertRuleIds(ids, user)` (user context + owner filter, same scoping as `AlertRuleRepository.findAll`); no new `PatchSetApplyContext` collaborator (design.md Implementation Notes)". In `design.md` D4, rewrite the "alert rules:" bullet the same way so the decision body matches the code.
2. `tasks.md` 5.2: do not claim the executor checked both themes. Either reword to "component test; both themes checked against the running app by the evaluator (evaluation-1.md)", or drop the clause.
3. `design.md` D7: change "existing `PageStatus`/inline error pattern" to the shared `EmptyState` component actually used (`PatchSetReviewPage.tsx:170-180`). Alternatively, switch the component to `PageStatus` if that is the intended pattern. One of the two must change so they agree.
4. `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyService.scala:394`: add `import scala.util.Try` and write `Try(UUID.fromString(value)).isSuccess`.
5. `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetRoutesFixture.scala:120`: use the imported `slick.jdbc.PostgresProfile.api._` `DBIO` (or `import slick.dbio.DBIO`) rather than the inline `slick.dbio.DBIO[_]`.

### Non-blocking Suggestions
- **A successful apply can be reported as a 500** (`PatchSetApplyOnce.scala:356` and `:360`). A failure in `attachApplication` (after a fully successful, journaled apply) or in `releaseProposal` turns the result into a failed Future. The user then sees "Failed to apply" for an apply that succeeded, and a retry gets "already applied". Consider `.recover { case NonFatal(e) => log.warn(...); result }` on attach and release so the apply's own outcome is always what gets returned.
- **The hand-off "seam" test is hand-built.** `proposalExtraction.test.ts` hand-writes the tool_result block. A backend-side assertion that `AssistantConversationRepository`'s serialized `tool_result` for a `propose_patch_set` turn carries `content` as a JSON string with `proposalId` would pin the contract from the producer side. Today it holds only by code trace.
- **The UI copy drops the server's reassurance.** The page discards the server's "Nothing was changed" message; showing it, or adding "nothing was changed", would reassure the user.
- **Browser Back after the CTA reopens the review.** The CTA uses `navigate("/")` without `replace`, so Back re-renders the review with Accept enabled. Accepting again just 409s back to the same final state, so this is harmless, but `replace: true` would match the HEL-1458 success-path precedent.
- **Claim-table RLS remains unproven locally**, as disclosed. Keep it on the owner-verification list for the release that carries V131.
