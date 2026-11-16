## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `eee4573653e4c3d03b78921e735bdad3ec047d6a` (one commit on top of cycle 1's `73e49f8a7`). The live-resolved base is
`fd7064f7d700e49a2f7dfc1f6a244aab02048fd2`. The working tree was clean. I read the cycle-2 delta in full (`git diff 73e49f8a7..HEAD`) and
re-checked the cumulative diff for C8 and frontend scope.

### Gate runs (fresh, by the evaluator)
- `nice -n 19 sbt -J-Xmx3g testFull`: `Total number of tests run: 9528`, `Suites: completed 692, aborted 0`,
  `Tests: succeeded 9528, failed 0, canceled 5`, `All tests passed.`, hel1468-guard `failed=0 aborted=0 unreadable=0`, exit 0. The
  log has 0 `*** FAILED` lines. It includes `SourceFetchBudgetSpec` and the updated `ProposalValidateRoutesSpec` 429 test.
- Root `npx jest --maxWorkers=3` (includes helio-mcp): 66 suites and 579 tests passed.
- `npm run lint` (exit 0), `format:check`, `check:schemas` (AssistantProposalToolSchemas in sync), `check:scala-quality` and
  `check:openspec` are all clean.
- There are still no `frontend/**` changes. `infrastructure/ai/` and `services/assistant/` main code are unchanged against the
  base. helio-mcp is unchanged since cycle 1.

### Verification of the executor's claims
- **CR1 (C12 PAT key): done.** `SourceFetchBudget.principalKey` = `user.tokenId.fold("user:<id>")("pat:<tokenId>")`, which is
  the same key and precedence as `RateLimitDirective` and `AuthDirectives` (tokenId is set only on PAT auth).
  - `SourceFetchBudgetSpec` covers three cases: a PAT caller is refused after the directive spent `pat:<id>`; a session caller
    draws from `user:<id>`; and a PAT caller's bucket is separate from the owner's session bucket.
  - Red-first evidence is `evidence/red-cycle2-CR1-pat-key.txt`: 2 of 3 failed on the old key, as expected.
  - The scaladoc and `C12-bounded.md` are updated.
- **CR2 (stale scaladoc): done.** The `PipelineProposalService.validate` and `dryRun` scaladoc now describe the current
  behaviour: inline roots go through `PipelineRootDryRun`, the fetch is charged at propose but not at apply, and the
  fetch-failure rule is stated.
- **CR3 (stale artifacts): done.** `C12-note.md` is marked SUPERSEDED. The inventory's slice-1 status section is retitled
  "SUPERSEDED by Final classification".
- **CR4 (double-charge pin): done.** The first `restPipeline` request now asserts `status should not be TooManyRequests`, with a
  budget of 1. A route also wrapped in `sourceFetchRateLimitDirective` would now fail this test.
- **Suggestion (b): done.** The new `PipelineStepOwnership` object takes only a `DataSourceRepository`:
  - `validateCrossOwnerRefs`, `upsertOwnershipCheck` and `resolveSecondarySourceSchemas` are moved verbatim (behaviour preserved,
    including the HEL-907/950/1100/1469 comments).
  - `PipelineCreateTransaction.validateStepCrossOwnerRefs`, `PipelineServiceSupport.resolveSecondarySourceSchemas` and
    `upsertOwnershipCheckF` delegate to it.
  - `PipelineCreateDryRun` calls it directly.
  - grep confirms no `new PipelineServiceSupport(null` or `new PipelineCreateTransaction(null` remains in main.
- **Suggestion (c): done.**
  - The budget is now required on `PipelineProposalService`, `PatchSetPreviewService` and `PatchSetApplyContext.build`
    (`sourceService` and `chargeFetches` too).
  - The new `buildUncharged` (apply and draft-definition contexts, `chargeFetches = false`) is the only main-code use of
    `SourceFetchBudget.default()`, so it is never consulted.
  - About 30 test construction sites were updated mechanically.
  - The production wiring in `ApiRoutes` is unchanged and still passes the shared budget.
- **SourceService `.map` nit and the parity-spec comment nit:** done.
- **Deferred, acceptable:**
  - Suggestion (a), a patch-set create with roots but no steps or Outputs, goes to HEL-1722. It is not a regression.
  - The write-path-only reject entries for the parity corpus were not added. That was non-blocking; the mutation proof still
    carries AC2.

### Phase 1: Spec Review — PASS
All four cycle-1 change requests are resolved, and C1-C12 are honoured in the diff (C12 now fully, PAT key included). Planning
artifacts reflect the final behaviour: tasks.md section 7, files-modified.md cycle 2, and the inventory with superseded markers.
- AC1-AC3 are met, as recorded in evaluation-1.md.
- **AC4 (live Sleeper check) remains UNMET LIVE.** It is proven only by the scripted replay in `AssistantColumnLoopSpec`, per the
  no-live-calls directive, and the PR must say so.

### Phase 2: Code Review — PASS
- The cycle-2 delta is small and behaviour-preserving apart from the intended C12 key fix.
- No dead code was left behind: the old bodies were removed and each moved function exists once.
- No new type escape hatches.

### Phase 3: UI Review — PASS
No UI change. The trigger (`ApiRoutes.scala`, `schemas/**`) still matches across the change, so I repeated the live check on HEAD
`eee457365`. Servers were started with `start-servers.sh` (7070/9977, `assert-phase.sh servers` PASS), and the dev session was
already signed in.
- `POST /api/pipelines/validate-proposal`: a good proposal returned 200 `{"valid":true}`. A `display_name` mapping returned 400 with
  apply's column message, `Available columns: name, wins`.
- `POST /api/proposals/validate` with the bad pipeline returned 400 with the same message.
- `POST /api/dashboards/validate-proposal` with an empty dashboard returned 200.
- The pipeline list was unchanged afterwards.
- The only console errors were the two deliberate 400s.
- Servers were stopped with `stop-servers.sh`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- HEL-1722 should explicitly carry the patch-set "roots only, no steps/Outputs" inline-create-check gap (evaluation-1 suggestion
  (a)), so the deferral is tracked rather than implied.
- The PR body must state:
  - AC4 is unmet live (scripted replay only);
  - the new propose-time egress (C11/C12) and the bucket it is charged to;
  - the disabled-step apply behaviour change;
  - the patch-set panel-update controls failure is now a resolve-time 400.
