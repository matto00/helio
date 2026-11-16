## Standing Constraints

- [C1] No live model spend beyond $3 total across all eval runs; stop and escalate instead of exceeding it.
- [C2] Never read or print any .env file; never pkill/pgrep/killall; quoted heredocs only; jest 2 workers, nice -n 19.
- [C3] Probe before fixing: every taxonomy item's cause is confirmed by a recorded probe before its fix lands.

## 0. Probe and baseline

- [x] 0.1 Build the HTTP fixture seeder (D8; dev account, tier check first); replay the failing calls in an EmbeddedPostgres spec
- [x] 0.2 Write evidence/failure-taxonomy.md: each call's exact error, confirmed cause, and the design decision that fixes it
- [x] 0.3 Probe that analyzeNodes projects a configured lookup's added column at the lookup node; report if not
- [ ] 0.4 (after the runner, 1.14/1.15, test-only code) Fix the eval case set (Standings + 4) and run the baseline on pre-change code; write evidence/eval-results.md -- DEFERRED to HEL-1708 (owner ruling `skip-live-eval`, 2026-10-22): not run in this change; AC1/AC5 and live tool-schema acceptance unmeasured

### Backend

- [x] 1.1 get_resource(pipeline): populate laneTree; add ordered nodes with config, parent, root, outputSchema (D1)
- [x] 1.2 get_resource(pipeline): list all Outputs with kind, nodeStepId, fieldMapping; redact credential fields (D1)
- [x] 1.2a get_resource(dashboard) panels with outputId + outputPipelineId; get_resource(Output) pipelineId, nodeStepId (D1)
- [x] 1.2b New get_resource-only detail types; shared WorkspaceContext* types and workspace-context schema untouched (D1)
- [x] 1.3 find: token-based matching and ranking with whole-query fallback (D6)
- [x] 1.4 PipelineProposalService: full StepConfigValidation at propose time; authorable-only type list; Output-as-root error (D4)
- [x] 1.5 Patch sets: output create resolver; saved-step node schema (enabled flag, owner view); fieldMapping check (D2)
- [x] 1.5a Reject output create when its node/upstream steps are edited in the same set; backfill after forward walk (D2)
- [x] 1.6 Patch sets: target.ref and "$ref:" substitution for panel creates; undo inverse for output create (D2)
- [x] 1.7 Patch sets: panel create rejects target.parentId and panel-level fieldMapping/aggregation per D0 findings (D3)
- [x] 1.8 Tool schemas: authorable step enum, per-op config schemas, compute grammar examples, strict objects (D3)
- [x] 1.9 ClaudeClient.sendWithTools: per-response partition, first propose_* in block order runs, rest isError (D5)
- [x] 1.10 System prompt rewrite with the pipeline/Output/panel model, decision procedure and Standings example (D7)
- [x] 1.11 schemas/patch-sets/patch-set.schema.json and helio-mcp patch-set tool schema updated for output create/ref
- [x] 1.12 Reword HEL-670/914 texts: EditSchema, EditTargetSchema.parentId, RefinementEditShape, RefinementPrompt (D2)
- [x] 1.13 propose_dashboard / propose_patch_set tool descriptions state new vs existing dashboard (D3)
- [x] 1.14 Eval runner: Test/runMain HTTP client, gated on HELIO_ASSISTANT_EVAL=1; transcript isError counts (D8)
- [x] 1.15 Eval: fresh pinned restart (CLAUDE_MODEL, LOG_FORMAT=json); usage/model from JSON log by conversationId; abort guard (D8)

### Frontend

- [x] 2.1 features/patchSets types and preview rendering for an output create and a $ref-bound panel create

### Tests

- [x] 3.1 get_resource(pipeline) returns nodes, configs, per-node schemas and Outputs (real DB spec)
- [x] 3.2 find token matching: "Fantasy Football standings dashboard" finds "Standings"
- [x] 3.3 Propose rejects passthrough, empty lookup config and an Output id root with errors naming valid options
- [x] 3.4 Schema/registry parity; per-op example passes StepConfigValidation; removing a required key fails it
- [x] 3.5 Patch set output create + $ref panel: preview, apply, rollback on failure, undo; dangling ref; missing column
- [x] 3.5a Editor non-owner of source gets correct schema (owner view); upstream-edited node rejected; disabled step kept
- [x] 3.5b Workspace-context JSON unchanged for a fixture (shared types untouched)
- [x] 3.5c Rollback/undo of output create + bound panel removes the panel before the Output (pin order)
- [x] 3.6 One-propose-per-response: 4 in one response -> 1 runs; failed then corrected next hop -> runs
- [x] 3.6a get_resource(dashboard)/(Output) carry outputId/pipelineId/nodeStepId; update tests pinning output-create rejection
- [x] 3.7 Credential redaction of node configs covered by CredentialSurfaceEnumerationSpec
- [x] 3.8 Frontend preview rendering test for output create
- [ ] 3.9 After-eval on final code; evidence/eval-results.md before/after table with failed-call rate, calls per proposal -- DEFERRED to HEL-1708 (owner ruling `skip-live-eval`, 2026-10-22): not run in this change; AC1/AC5 and live tool-schema acceptance unmeasured
