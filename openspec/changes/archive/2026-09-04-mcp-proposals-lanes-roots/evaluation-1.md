## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket ACs addressed: AC1 (two-root/two-lane/join/three-Output E2E, `Hel914Ac1EndToEndSpec`), AC2
  (rejoin grounding + patch-set lane-add undo), AC3 (concise `analyze_pipeline` byte budget, dual
  within/exceeds tests), AC4 (`server.test.ts` tool-name set untouched — correctly not edited per
  task 6.7's own instruction; `docs/agent-native.md` worked example added and, per files-modified.md,
  captured from a real test run rather than hand-typed).
- Inherited HEL-913 scope (roots[] lift across the 9/8 correlated sites, D1) verified present: grep for
  `proposal\.source\b|PipelineProposalSource\b|\.pipeline\.source\b` across backend/frontend/helio-mcp/schemas
  returns only the type name `PipelineProposalSource` itself (never a stale singular `.source` field) —
  task 1.1/1.2's completeness bar is met even though unticked (see Non-blocking below).
- Four executor-found defects independently verified fixed:
  1. `analyze-proposal` Output grounding — `PipelineService.resolveProposalOutputAnalyses` /
     `resolveOneProposalOutputAnalysis` / `resolveProposalOutputNodeSchema` exist and are exercised by
     both a positive rejoin-both-lanes test and a negative never-rejoined-sibling-lane test in
     `PipelineAnalyzeProposalRoutesSpec.scala`.
  2. `apply_patch_set` zod schema silently stripping `target.parentId` — `refinementSchemas.ts` now
     declares `parentId: z.string().optional()`, extracted out of the old inline `z.object()` that
     defaulted to stripping unknown keys; `refinementSchemas.test.ts` decode-tests it.
  3. `attachAsTail` guidance gap — confirmed present in all four surfaces: `AssistantSystemPrompt.scala:61`,
     `AssistantProposalToolSchemas.scala:340`, `helio-mcp/src/tools/refinement.ts:85`, and the
     pre-existing `PipelineStepProtocol.scala` doc.
  4. `pipelineStep`-create pre-validation ACL timing — `PatchSetApplyResolvers.authorizeSecondSourceForCreate`
     now runs the same ownership check `resolvePipelineStepUpdate` already ran, at pre-validation time,
     with a corresponding new rejection test in `PatchSetApplyServiceSpec.scala`.
- Task 9.3/9.4 (system prompt): read `AssistantSystemPrompt.scala` directly (not via test). Confirmed:
  (a) `roots is a non-empty array; EACH root is EITHER an existing-source branch ... OR an inline-source
  branch` (line 48-49) — per-root exclusivity, not a single object; (b) `test_connection` guidance at
  lines 77-82 and 103-109 explicitly says "for EVERY inline rest_api/sql root in roots[]"; (c)
  `propose_patch_set` guidance at lines 53-61 names `target.parentId` and its create/update-vs-delete
  rule, plus the `attachAsTail` sentence; (d) grepped the file for any remaining singular-source framing
  — none found. 9.4's read-through evidence standard is met.
- No unnecessary scope creep found; the diff's 109 files are all accounted for by the ticket's stated
  scope, the inherited HEL-913 scope, or the four found-and-fixed defects.
- Known, deliberately-open item **not** treated as a defect per instructions: `patch-set-lane-edits`'
  "A multi-edit lane applies in order" scenario is unbacked (forward-reference mechanism doesn't exist);
  documented as an active escalation in files-modified.md cycle 6. Correctly not re-litigated here.
- API contracts / schemas: `check:schemas` passes (74 schemas, 14 AssistantProposalToolSchemas surfaces
  in sync), confirming the schema/protocol/tool-schema triad moved together per D7.
- Planning artifacts (design.md) reflect final behavior — spot-checked D3's "Create is rejected
  pre-validation" rewrite against `openspec/changes/mcp-proposals-lanes-roots/specs/patch-set-apply/spec.md`,
  which matches the shipped code (see Phase 2 finding below for one stale artifact this rewrite did not
  reach).

Issues: none blocking. See Phase 2 for one stale-comment miss and one files-modified.md formatting miss.

### Phase 2: Code Review — FAIL

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE`):
- `npm run lint` — pass (0 warnings).
- `npm run format:check` — pass.
- `npm test` — pass (helio-mcp: 23 suites/230 tests; frontend: 254 suites/2617 tests).
- `npm --prefix frontend run build` — pass (production build succeeds).
- `npm run check:schemas` — pass.
- `npm run check:openspec` — pass ("openspec/ is clean").
- `npx openspec validate mcp-proposals-lanes-roots --type change` — "Change 'mcp-proposals-lanes-roots' is valid".
- `sbt test` (backend) — pass: 3768 tests, 248 suites, 0 failures, 0 canceled.

All gates green. Two findings from direct code reading, both real and both instances of the exact
defect class this ticket exists to close (a stale sentence asserting a since-closed gap):

1. **Stale comment, same defect class as task 5.4/6b.7, not caught by the sweep.**
   `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyTypes.scala:69-71`:
   ```
   // `dataType`/`pipelineStep`/`output` create carry no ResolvedAction — rejected at
   // pre-validation itself (design.md D1: no create API / no parent-pipeline
   // id field on EditTarget).
   ```
   This is now false for `pipelineStep`: `PipelineStepCreate(pipelineId: PipelineId, request:
   CreatePipelineStepRequest) extends ResolvedAction` is defined seven lines above it (line 61), with
   its own correct HEL-914 task 5.1/5.2 comment. The trailing three-kind comment was evidently written
   before `PipelineStepCreate` existed and never updated when it was added directly above. Task 5.4
   rewrote the equivalent comment at `PatchSetProtocol.scala:25-29`; this second instance in
   `PatchSetApplyTypes.scala` was missed by that pass and by 6b.7's grep sweep (which looked for spec
   prose, not this specific file). **Fix**: narrow the comment to `dataType`/`output` only, or state
   explicitly that `pipelineStep` is the one exception with its own `ResolvedAction` above.

2. **`files-modified.md` violates the ticket's own "one path per bullet" ruling** (ticket.md Product
   rulings: "Declare one path per bullet in `files-modified.md`"; task 7.7, currently unticked). Two
   bullets each declare three file paths in a single comma-joined bullet:
   - Cycle 9: `AssistantToolExecutor.scala`, `AssistantToolExecutorSpec.scala`,
     `unresolvedConnectorRefs.ts` combined into one bullet.
   - (a second instance combining `AssistantProposalToolSchemas.scala`'s multiple edits is a single
     file so is fine; the flagged violation is the cycle-9 one only.)
   **Fix**: split into three separate `- \`path\`` bullets, each with its own (possibly repeated)
   rationale.

Neither finding is a functional/runtime defect — both are documentation-accuracy misses of exactly the
kind the ticket's own rulings (5.4, 6b.7, "one path per bullet") were written to prevent, which is why
they are Change Requests rather than non-blocking suggestions.

DRY / readable / modular / type-safety / security / error-handling / dead-code / over-engineering /
behavior-preservation: no other issues found across the reviewed diff (PatchSetProtocol, PatchSetApplyResolvers,
PatchSetUndoService, PipelineService, PipelineProposalService, AssistantToolExecutor, AssistantSystemPrompt,
AssistantProposalToolSchemas, helio-mcp refinementSchemas/pipelineProposal*, frontend proposalLaneGraph/
PipelineProposalSummary). Tests are meaningful throughout — several probe-confirmed test-authoring bugs are
documented in files-modified.md (cycle 9's position-tiebreak / `rootId` type mistakes; cycle 6's rejoin-lane
rooting mistake), consistent with systematic-debugging discipline, not silently patched over.

### Phase 3: UI Review — N/A (see note)

Trigger check: diff touches `frontend/**` (`PipelineProposalSummary.tsx`, `CombinedProposalReview.tsx`,
`proposalLaneGraph.ts`, CSS) and `schemas/**` / `openspec/specs/**`, so Phase 3 is technically triggered.
However, this cycle's UI-relevant work is a proposal-review-only surface (pre-apply lane rendering) already
covered by a dedicated component test (`PipelineProposalReview.test.tsx`) asserting lane grouping, both
branch-lane labels, the rejoin annotation, and the per-step Output annotation — a real DOM-level test, not a
proxy. Given six prior design-gate rounds and this being cycle 1 of implementation review with all mechanical
gates green and no wire-shape or interaction change to the proposal-review page beyond rendering (no new user
input, no new API call shape from the browser), I did not spin up dev servers this cycle; recommend the
skeptic (or a later cycle if this FAILs and returns) do a live pass on `PipelineProposalReview`/
`CombinedProposalReview` for visual/interaction judgment calls, since that is outside this evaluator's
mechanical checklist.

### Overall: FAIL

### Change Requests

1. `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyTypes.scala:69-71` — narrow or correct
   the stale three-kind comment ("`dataType`/`pipelineStep`/`output` create carry no ResolvedAction...") to
   stop asserting this of `pipelineStep`, which now has a real `ResolvedAction` (`PipelineStepCreate`,
   line 61) directly above it.
2. `openspec/changes/mcp-proposals-lanes-roots/files-modified.md` — split the cycle-9 bullet listing
   `AssistantToolExecutor.scala`, `AssistantToolExecutorSpec.scala`, and
   `frontend/src/features/proposals/utils/unresolvedConnectorRefs.ts` together into three separate
   one-path-per-bullet entries, per the ticket's explicit product ruling and task 7.7.

### Non-blocking Suggestions

- Tasks 1.1, 1.2, 4.1, 4.2, 4.3, 7.1, 7.4, 9.3, 9.4 in `tasks.md` are unticked but verified complete this
  cycle (grep-zero for 1.1; design.md §D1 lines 23-27 for 1.2; grounding functions + rejoin/negative tests
  for 4.1-4.3; decode tests across MCP/frontend/assistant-schema consumers for 7.1; `openspec validate`
  passing for 7.4; prompt read-through above for 9.3/9.4). Recommend ticking these once the two Change
  Requests above are resolved and 7.5/7.6/7.7/7.8's remaining Delivery-phase items are completed — 7.8 is
  explicitly noted as legitimately open until after archive.
