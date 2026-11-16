## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `da16d64b968f6f814b30205830bad69b4a519cf2` (commits 5b9b1437f, da16d64b9) against base
`8fff8eed1ca2b7ee8df6f70aade2a0fa9e76d3a7` (resolved live by `resolve-review-base.sh`).

Scope note from the orchestrator: tasks 0.4 and 3.9 (the live before/after eval, AC1 and AC5) did not run because the
lane backend's Anthropic key is rejected (401). That is escalated as an environmental blocker, so it is not counted
against the executor here. Spend was $0. No model call was made during this review.

### Gates (fresh, run by the evaluator in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | pass (0 warnings) |
| `npm run format:check` | pass |
| `HELIO_JEST_MAX_WORKERS=2 npm test` | pass: root 61 suites / 525 tests (includes `helio-mcp/src/tools/refinementSchemas.test.ts`); frontend 763 suites / 9373 tests |
| `npm --prefix frontend run build` | pass |
| `helio-mcp` `npm run typecheck` | pass |
| `npm run check:scala-quality` | clean (soft size warnings only; new `AssistantStandingsFixture.scala` is 271 lines) |
| `cd backend && sbt testFull` | **pass**: 683 suites, 9468 tests, 0 failed, 5 canceled (pre-existing env-gated), 951 s. The new suites ran: `ClaudeClientOncePerResponseSpec`, `PatchSetOutputCreateSpec`, `AssistantProposeErrorsSpec`, `AssistantStepSchemasSpec`, `AssistantEvalParsingSpec`, `AssistantPipelineReadsSpec`, `PipelineProposalServiceValidateSpec`. `AssistantEval` (a `main`, not a suite) was not discovered, as D8 requires. |

### Phase 1: Spec Review — FAIL

Checked items:
- ACs: taxonomy items 1-7 and 9 each have a code fix (prompt sections, strict schemas, reads, output create + `$ref`,
  one-propose rule, token find). AC3 (`get_resource(pipeline)` returns steps and per-node schemas) is tested in
  `AssistantPipelineReadsSpec`. AC4 (reject `passthrough`, empty lookup, Output-as-root, naming valid options) is
  tested in `AssistantProposeErrorsSpec`. AC1 and AC5 are deferred to the escalated live eval.
- Tasks: every `[x]` matches what was implemented. Only 0.4 and 3.9 are open, as stated.
- D1-D7: implemented as designed, with one exception (CR 1-2 below). D2 output create checks: the saved-step schema
  includes the disabled step (transparent), uses the owner's view, refuses an upstream step edit or a step create in the
  same pipeline, defers backfill until after the forward walk, rolls back the panel before the Output, and undo turns
  the create into a delete. D5 partitions in block order, with the rejections sharing one slot across all `propose_*`.
- Contracts: `schemas/patch-sets/patch-set.schema.json` gains `ref` (with the pattern) and an output-create
  `parentId` if/then. The frontend `patchSet.ts` gains `ref`. The helio-mcp zod schema keeps `ref`.
- Deliberate reversals: the HEL-814 GUARD ("accept an incomplete draft step") and HEL-1416 ("drafts stay accepted")
  are reversed for proposals only. This follows D4 ("full StepConfigValidation at propose time") and the skeptic's
  CONFIRM. The full backend suite shows no other consumer of `PipelineProposalService.validate` broken (first-run,
  templates, authoring, MCP/HTTP apply-proposal). The executor also added `ProposalStepRules.RequiredKeys` (non-empty
  `select.fields`, `sort.sortBy`, `filter.conditions` and so on), which is stricter than the bare registry. That is
  needed to make D3's "removing any schema-required key fails validation" parity true, and it is pinned by
  `AssistantStepSchemasSpec`. It is accepted as inside D3/D4. The PR must state it, because it also tightens the MCP
  and HTTP apply-proposal surface.
- CONSTRAINTS: C1 ($0 spent; the runner's ledger enforces $3). C2 is honoured by the runner (password from env only,
  never written; no `.env` read). C3: `evidence/failure-taxonomy.md` is present.

Issues:
1. D2 says every HEL-670/914 text that limited child creates to `pipelineStep` is updated. Two are not (CR 1, CR 2).
   One sits in the model-facing system prompt, the exact surface this ticket fixes.

### Phase 2: Code Review — FAIL

Mechanical CONTRIBUTING rules: no inline FQNs (`check:scala-quality` clean), and imports are at the top. I found no
`any`, no TODO/FIXME and no unused imports (lint and scalac are green).

Issues (each one is a Change Request below):
- `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala:55-57`: the prompt still says
  "target.parentId is REQUIRED for a create targeting a child kind (currently only pipelineStep ...)". Eight lines
  later, the appended sentence says "An output create also uses target.parentId". The model is given two
  contradictory statements in one paragraph, about the field (`target.parentId`) that caused 3 of the transcript's
  failures (taxonomy 2).
- `helio-mcp/src/tools/refinement.ts:90-95` (the `apply_patch_set` description) and
  `helio-mcp/src/types.ts:1203-1214` (`EditTarget`) still list the target keys as `{kind, id?, parentId?, fingerprint?}`
  with no `ref`, and say parentId is for "currently only pipelineStep". Task 1.11 and D2 say the helio-mcp patch-set
  tool schema is updated for output create and `$ref`. Only the zod schema was updated. An MCP agent reading the tool
  description cannot discover `ref` or output create, and the TS type no longer matches the wire contract in
  `schemas/patch-sets/patch-set.schema.json`.
- `backend/src/main/scala/com/helio/services/pipelines/ProposalStepRules.scala:13`: the doc cites
  `ProposalStepRulesSpec` as the proof that removing a required key is reported. No such spec exists. That proof
  lives in `AssistantStepSchemasSpec` ("make the validation fail, naming the key, when any required key is removed").
  A dangling reference on the exact claim the parity rests on.
- `frontend/src/features/patchSets/types/patchSet.ts:37-43`: `OUTPUT_REF_PREFIX` was inserted between the
  `/** One targeted edit ... */` JSDoc and `export interface Edit`. The `Edit` doc now attaches to the const, and the
  const ends up with two stacked doc blocks.

What was verified as correct (no action):
- Patch-set ordering: `resolveAll` checks the ref definition before resolving, and registers it after. Apply
  substitutes `$ref` from `createdByRef` only for an `OutputCreate` with a `newId`. A forward-reference ref is rejected
  (tested). Fingerprints are skipped for `OutputCreate`. Preview carries the referenced create's kind instead of
  reading a row.
- `rejectEditedOutputNodes` walks the saved parent chain with cycle protection. It rejects any `PipelineStepCreate` on
  the same pipeline (conservative, so preview and apply stay in agreement), and also a pipeline update or delete.
- Backfill deferral: `OutputService.create(backfill = false)` plus `backfillCreated` after success. The rollback test
  asserts no backfill.
- D5: `rejectedOncePerResponse` covers the different-tool case with one shared slot. `find` is never rejected.
  Next-hop proposes run.
- D6: the tokenizer, stop list, whole-query fallback and deterministic tie-break. The `WorkspaceSearchServiceSpec`
  no-match query changed from "find-52-nonexistent-query-xyz" to "zzqxnomatchzz", because the old one now shares
  tokens with the fixture's "find-52-real-dashboard". That follows from D6's any-token rule, not from a defect.
- D3 compute grammar: the function list matches `ExpressionParser` (abs, add_days, ceil, coalesce, concat, date_trunc,
  floor, if, length, lower, mod, round, seconds_between, substring, upper). The examples are executed by the spec, and
  both transcript inventions are shown to fail.
- D1: the new detail types are composed. `AssistantPipelineReadsSpec` asserts that the `assemble` JSON carries none of
  the `get_resource`-only fields (3.5b). Node configs go through `SecretRedaction` (exact key match).

### Phase 3: UI Review — PASS

Servers: `start-servers.sh ... 7071 9978 HEL-1639`, then `assert-phase.sh servers` gave PASS. The backend was freshly
started at 15:53:05, after the HEAD commit (15:34:56), so it was not a stale reuse. Stopped afterwards with
`stop-servers.sh`.

Flow exercised, logged in as the dev account: I seeded a static source, a pipeline (cast step, table Output), a
dashboard and a table panel over the API. I then opened `/patch-sets/review` with a patch set of {output create
`ref: wins` at the cast node, chart `xAxis: team, yAxis: wins`} + {panel create `config.outputId: "$ref:wins"`}.
- Happy path: preview rendered both pending creates, each with the new one-line summary. Accept & apply created Output
  `52836998...` (chart, at the cast node). The new panel's `config.outputId` was that real id, not `$ref:wins`.
  The dashboard rendered both panels in the same "Not run yet" state as the pre-existing table panel. Created Output
  rows are `materialized: false`. That is the same result as a REST-created control Output on the same never-run
  pipeline, so deferred backfill behaves like the REST path.
- Unhappy path: a dangling `$ref:nope` gave a visible "Couldn't preview this patch set" with
  `edit 0: $ref:nope does not name an earlier output create (refs: none)`. No blank screen.
- Console: no errors during the preview/apply flow. One 404 on `/api/pipelines/:id/runs/latest` appears on the
  dashboard for a never-run pipeline. It is pre-existing and also hits the untouched table panel.
- Accessibility: the summary is a plain `<p>` inside the existing dialog, and Reject / Accept & apply keep their names.
- Breakpoints 1440 / 1100 / 768 / 375: no horizontal overflow. Document `scrollWidth` equals the viewport; the summary
  `scrollWidth` equals its `clientWidth` (652/652 at 768 and 1100). At 375 the long step UUID and Output name wrap
  inside the card.
- Mechanical design: the new CSS uses `--text-sm` and `--app-text`, both defined in `theme/theme.css` for both themes.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1639/evidence/.eval-evidence/hel1639-preview-1440.png`,
  `/home/matt/Development/helio/.concertino/runs/HEL-1639/evidence/.eval-evidence/hel1639-preview-375.png`.
- Cleanup: deleted exactly the ids I created (2 panels, 3 Outputs, dashboard, pipeline, source), all 200/204.

Left to the skeptic (judgment): the summary line shows a raw step UUID ("at step bb6bedc4-...") rather than the step's
type or position.

### Overall: FAIL

### Change Requests
1. `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala:55-57`: change "REQUIRED for a
   create targeting a child kind (currently only pipelineStep — the id of the existing parent pipeline; ...)" to name
   both child kinds, e.g. "REQUIRED for a pipelineStep or output create (the id of the existing parent pipeline; ...)".
   Keep the appended "a panel create does NOT" sentence. The prompt must not contradict itself about `target.parentId`
   (taxonomy 2).
2. helio-mcp, per task 1.11 / D2:
   - `helio-mcp/src/tools/refinement.ts:90-95`: add `ref?` to the listed target shape
     (`{kind, id?, parentId?, ref?, fingerprint?}`). Say parentId is required for a `pipelineStep` or `output` create
     and is never used on a panel create (the dashboard is `patch.dashboardId`). Add one sentence on output create plus
     `"$ref:<ref>"` binding.
   - `helio-mcp/src/types.ts:1203-1214`: add `ref?: string` to `EditTarget` and correct its "currently only
     `pipelineStep`" doc.
3. `backend/src/main/scala/com/helio/services/pipelines/ProposalStepRules.scala:13`: replace the nonexistent
   `ProposalStepRulesSpec` with `AssistantStepSchemasSpec`, which is where the removed-key proof actually lives.
4. `frontend/src/features/patchSets/types/patchSet.ts:37-43`: move `OUTPUT_REF_PREFIX` and its doc above the
   `/** One targeted edit ... */` block (or below `interface Edit`), so that JSDoc attaches to `Edit` again.

### Non-blocking Suggestions
- **ACL-bypass comments (CONTRIBUTING "ACL triad").** New `*Internal` read callsites have no comment explaining why
  bypassing the ACL is safe: `WorkspaceSearchService.pipelineDetail` (`outputRepo.listByPipelineInternal`,
  `findConfigsByIdsInternal`; safe because the owner check is directly above) and
  `PatchSetOutputResolvers.rejectEditedOutputNodes` (`pipelineStepRepo.listByPipelineInternal`; safe because the
  editor check ran in `resolveOutputCreate`). The rule names `findByIdInternal` literally, but the same reasoning
  applies.
- **Null checks for test fixtures in production code.** `PipelineProposalService.scala:117` (`outputRepo == null`) and
  `PatchSetApplyService.scala:161` (`services.outputService != null`). Both have precedent in this codebase, but
  wiring the fixtures would be cleaner. The same line in `PipelineProposalService` also has `.recover { case _ => None }`,
  which turns a DB error on the Output lookup into "data source not found".
- **Owner-only lookups vs "an Output the caller can read".** Both the Output-as-root hint and
  `WorkspaceContextService.dashboardPanels`' `outputPipelineId` use `findByIdOwned`. An editor grantee therefore gets
  the generic "data source not found" or a null `outputPipelineId`. The spec scenario says "an Output the caller can
  read". This is defensible as tenant-safety, but either use the grant-aware read or narrow the spec wording to
  "owns".
- **Compute function list.** `AssistantStepSchemas.ComputeGrammar` lists the functions by hand. Generate the list from
  `ExpressionEvaluator.SupportedFunctions` so it cannot drift. Also, the grammar text appears twice (the compute config
  description and the `expression` property), and the per-op schemas are embedded in both `propose_pipeline` and
  `propose_combined`. That raises input tokens on every hop, which matters for the $0.30/case estimate and the context
  budget. Measure it in the live eval.
- **Credential-surface test.** The 3.7 entry in `CredentialSurfaceEnumerationSpec` is a source-text grep for
  `SecretRedaction.redact(PipelineStepConfigCodec.encode(`. It is a structural guard, not behaviour.
  `SecretRedactionSpec` covers the function itself.
- **Eval runner, fail-closed ledger.** `SpendLedger` silently treats an unreadable or corrupt ledger file as $0 spent
  (`Try(...).toOption ... getOrElse(Vector.empty)`). For C1, a ledger that exists but cannot be parsed should stop the
  run.
- **Eval runner, cleanup.** The runner does not delete the assistant conversations it creates, which leaves dev-DB
  residue. It also leaves no record of patch-set application journals.
- **Refinement and output create.** Refinement is told not to emit an output create, but its patch sets resolve
  through the same `resolveAll`, which now accepts one. If D2's "refinement does NOT gain output create" is meant as a
  hard rule, it is currently prompt-only.

### Anthropic tool-schema acceptance (reasoned risk read; not provable without a live call)

The risk is low. The documented restriction is that `input_schema` may not use `oneOf`/`anyOf`/`allOf` at the TOP
level. Here every tool's top-level `input_schema` is a plain `type: object` with `properties`/`required` (plus the
`examples` keyword the existing tools already ship in prod). The new `oneOf`s are nested: the step item schema inside
`steps.items`, and `SecondaryInput` inside a step config. Nested `oneOf` is ordinary draft 2020-12 and is widely used in
tools (for example, zod unions emit nested `anyOf`). The other keywords used (`enum`, `minimum`, schema-valued
`additionalProperties`, `additionalProperties: false`) are standard. Strict tool use is not enabled (no `strict` on
`ClaudeTool`), so strict-mode restrictions do not apply, and the API will not validate model outputs against these
schemas: the server-side decoders and `ProposalStepRules` remain the real enforcement.

Residual risks:
1. Schema size and token cost, not rejection (see above).
2. The `oneOf` variants omit `type: object` and `required: ["type"]`, relying on the parent. That is valid, but if the
   API's validator ever required each subschema to be self-typed it would be the first suspect.

D8 already makes the first after-run converse the acceptance check, and a 400 fails loudly.

### D8 runner compliance (as committed)
- `HELIO_ASSISTANT_EVAL=1` gate: yes. Exit 64 otherwise, before any network call.
- Abort guard: yes. Any case with no `assistant_tool_loop_outcome` telemetry stops the run, and the first case's
  `modelId` must equal the pin. A failed converse also aborts.
- $3 ledger: yes. It persists across runs in `HELIO_EVAL_DIR/eval-spend-ledger.json` and refuses the next case if
  spent + $0.30 > $3. See the fail-closed suggestion above.
- Exact-id cleanup: yes. Panels, then Outputs, dashboards, pipelines and sources are deleted by recorded id, including
  ids created by patch-set and proposal applies, in a `finally`. Conversations are not cleaned (suggestion).
- No password in files: yes. It comes only from `HELIO_EVAL_PASSWORD`. `writeRecord` writes no credentials, and
  `EvalHttp` logs no request bodies.
- Tier check first via `/api/auth/me` (beta/owner, else BLOCKER): yes.
