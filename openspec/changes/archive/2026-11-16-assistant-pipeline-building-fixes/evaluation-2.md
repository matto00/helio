## Evaluation Report — Cycle 2 (evaluation-2.md)

This cycle reviews HEAD `4210ca7eb7419f7c9975c3cf3f861021ccd21aa2`. The delta is `da16d64b9..4210ca7eb`, on top of the
cycle-1 review. The base was resolved live by `resolve-review-base.sh` as `8fff8eed1ca2b7ee8df6f70aade2a0fa9e76d3a7`.

Tasks 0.4 and 3.9 (the live before/after eval, AC1 and AC5) are still pending the owner's API-key decision. They are not
counted this cycle. No model call was made, so spend is $0.

### Gates (fresh, run by the evaluator in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `HELIO_JEST_MAX_WORKERS=2 npm test` | pass: root 61 suites / 525 tests (includes helio-mcp); frontend 763 suites / 9373 tests |
| `npm --prefix frontend run build` | pass |
| helio-mcp `npm run typecheck` | pass |
| `npm run check:scala-quality` | clean (soft warnings only) |
| `cd backend && sbt testFull` | **pass**: 9472 tests, 0 failed, 5 canceled (pre-existing, env-gated), 978 s. That is 4 more than cycle 1, and the 4 new tests appear in the log by name, so they really ran. |

### Phase 1: Spec Review — PASS

All four cycle-1 Change Requests are resolved. Each fix was verified in the diff:

1. **System prompt contradiction.** `AssistantSystemPrompt.scala:56` now reads "REQUIRED for a create targeting a child
   kind (pipelineStep or output — ...)". It no longer contradicts the output-create and panel sentence that follows.
   A grep of `backend/src/main`, `helio-mcp/src`, `frontend/src` and `schemas` finds no remaining "currently only
   pipelineStep" text.
2. **helio-mcp wording and type.** In `helio-mcp/src/tools/refinement.ts`, `apply_patch_set` now lists `ref?` in the
   target shape. It also states that parentId is for a pipelineStep or output create and is never used on a panel
   create, and documents output create plus `"$ref:<ref>"`. In `helio-mcp/src/types.ts`, `EditTarget` gains
   `ref?: string`, and its parentId doc is corrected.
3. **Dangling spec reference.** `ProposalStepRules.scala:13` now cites `AssistantStepSchemasSpec`.
4. **Misplaced doc comment.** In `frontend/src/features/patchSets/types/patchSet.ts`, `OUTPUT_REF_PREFIX` moved above
   the `Edit` JSDoc, so that comment attaches to `interface Edit` again.

The cycle-1 non-blocking spec divergence ("an Output the caller can read" vs. an owner-only lookup) is now aligned.
Both the Output-as-root hint and `outputPipelineId` are grant-aware.

The constraints are honoured:
- **C1:** the ledger now fails closed.
- **C2:** no `.env` access, and the password comes only from the environment.
- **C3:** unchanged from cycle 1.

### Phase 2: Code Review — PASS

**`OutputReadAccess`: checked for existence leaks and RLS bypass**

- `outputRepo.findByIdInternal(id)` (system context) is used only to learn the Output's `pipelineId`. That value is
  returned only if `PipelineService.findSummaryById(pipelineId, user)` succeeds. That call goes through
  `PipelineRepository.findSummaryByIdShared` → `findByIdShared`. That function compares the row's owner with the
  caller in application code, and for anyone else queries `resource_permissions` for a grant row in the caller's user
  context. So the access decision rests on an explicit predicate, not on RLS alone. This matters because RLS does not
  run in dev or CI, where the superuser has BYPASSRLS.
- Anything else (unknown id, a stranger's id, a malformed id, or any thrown failure, through `.recover`) becomes
  `None`. The caller then produces exactly the same output as for an unknown id:
  - the root error stays `"roots[i]: data source not found"` (404);
  - the dashboard panel's `outputPipelineId` is null.
- Nothing from the internally-read Output row (name, owner, node, config) is ever surfaced. Only the pipeline id is,
  and only to a caller who can read that pipeline. There is no existence leak and no exposed RLS-bypassing read.
  - The only residual difference for an Output id that exists but is unreadable is a few milliseconds of extra
    latency (a second query). That is negligible, and it matches existing `findByIdShared` patterns.
- The tests prove it, and they ran in this suite:
  - `AssistantPipelineReadsSpec` "name the pipeline to its owner and to a grantee, and to nobody else, including after
    the share is withdrawn". It covers owner → Some, stranger → None, viewer grant → Some, grant deleted → None, and a
    malformed id → None.
  - `AssistantProposeErrorsSpec` "give the Output-as-root hint to a pipeline grantee ... and only to them". A stranger
    gets "data source not found", and a grantee gets the Output hint.
  - The existing cross-tenant test ("not reveal another tenant's Output") still passes.
- One minor point remains: the `null` guard for test fixtures was moved into `OutputReadAccess` rather than removed.
  This is non-blocking and has precedent in the codebase.

**ACL comments.** Comments justifying the bypass were added for the remaining `*Internal` callsites:
- `PatchSetOutputResolvers.rejectEditedOutputNodes`: safe because the owner/editor check already ran in
  `resolveOutputCreate`.
- `WorkspaceSearchService.pipelineDetail`: safe because of the owner-only filter in `getPipelineResource`.

Both justifications are accurate against the code.

**Eval runner**
- `SpendLedger` now throws `IllegalStateException` when a ledger file exists but is corrupt or has the wrong shape,
  instead of reading it as $0 spent. This is tested for both bad JSON and a non-array `entries`.
- The ledger is now constructed before fixture seeding, so a bad ledger stops the run before anything is written. The
  `finally` cleanup still runs.
- **Conversations as residue.** The executor's claim is verified: no assistant-conversation DELETE route exists. The
  conversation ids are recorded under `conversationsNotDeletable`, which is acceptable.

No new mechanical violations were found.

### Phase 3: UI Review — PASS

The only frontend change this cycle is the doc and constant move in `patchSet.ts`. The UI flow was re-smoked anyway,
because the change touches `frontend/**`:

- **Servers:** started with `start-servers.sh ... 7071 9978` and checked with `assert-phase.sh servers` (PASS). The
  backend started fresh at 16:38:55, after the HEAD commit at 16:29:33. Servers were stopped with `stop-servers.sh`.
- **Flow:** on `/patch-sets/review`, an output create (`ref: wins`) plus a panel create bound by `"$ref:wins"`
  previewed with both summary lines. Accept & apply created the chart Output `fc76970d...`, and the new panel's
  `config.outputId` is that real id.
- **Console:** no errors.
- **Cleanup:** every fixture id I created (panel, 2 Outputs, dashboard, pipeline, source) was deleted, each returning
  200 or 204.
- **Breakpoints:** the cycle-1 checks at 1440/1100/768/375 stand. The rendering code (`createSummary.ts`,
  `PatchSetReview.tsx/.css`) is unchanged since then.

### Overall: PASS

### Non-blocking Suggestions
These carry over from cycle 1 and remain optional:
- Generate the compute function list from `ExpressionEvaluator.SupportedFunctions`.
- Measure the tool-schema token growth during the live eval. The per-op schemas are embedded in both
  `propose_pipeline` and `propose_combined`, and the grammar text appears twice.
- The refinement flow is kept from emitting output creates by its prompt only; the resolver itself would accept one.
- The `null` collaborator guards for test fixtures (`OutputReadAccess`, `PatchSetApplyService`).
- The PR must state two things:
  - the stricter `ProposalStepRules.RequiredKeys` also tightens the MCP and HTTP apply-proposal paths;
  - the reversals of HEL-814 and HEL-1416.
