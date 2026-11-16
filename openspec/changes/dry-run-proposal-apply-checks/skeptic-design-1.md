## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD fd7064f7d700e49a2f7dfc1f6a244aab02048fd2 (planning artifacts untracked, no source changes yet).
B = backend/src/main/scala/com/helio.

### What I verified (with evidence)

Inventory and design claims I confirmed in the code:
- `PipelineProposalService.validate` (PPS:89) is `validateStructure` plus root ownership only, and `apply` (PPS:128) goes
  `validateStructure` -> `resolveAllRoots` (inline creates) -> `pipelineService.create`. Confirmed.
- The inline csv 422 lives in `resolveSource` (PPS:360-365). Confirmed.
- The column check runs only inside `PipelineCreateTransaction.buildOutputsAction` (PCT:214-258, via
  `validateOutputFieldMapping` -> `OutputFieldMappingCheck.validate` -> `OutputBindingSpec.validateFieldMappingColumnsExist`,
  OutputBindingSpec.scala:193). Confirmed. The message names the available columns.
- `PipelineProposalAnalyze` runs the same check but returns it as a 200 per-Output `validationError`. Confirmed.
- `createSql`/`createRest` pre-insert checks (checkQuery, validateConfigShape, checkConfigEgress; auth reject,
  connectorId xor url, toDomain, rejectBodyOnSafeMethod, checkConnectorKind, checkConnectorPending) are at
  SourceService.scala:80-200. Confirmed.
- `CombinedProposalService.validate` (l.50) runs no `ProposalLayoutSupport.validate`, no sentinel count and no non-sentinel
  `preValidateBindings`. Apply's dashboard phase runs them through `DashboardProposalService.apply` -> `validate`. Confirmed.
- `DashboardProposalService.validate` is apply's first step. `PanelCreateBuilder.buildForCreate` writes nothing and runs
  only inside `PanelService.create` -> `createPlaced`. Confirmed.
- `AssistantToolExecutor` calls `validate`/`preview` (l.259/282/306/327). A tool `Left` becomes `ToolResult(isError=true)`
  at ClaudeClient.scala:168, not l.132 as cited. The citation is off but the claim holds.
- helio-mcp `proposePipelineHandler` only computes warnings on the client side. There is no validate route and no MCP
  `propose_combined` (combinedProposal.ts registers only `apply_combined_proposal`). Confirmed.
- `PipelineCycleGuard.checkExistingGraphAction` exists (PipelineCycleGuard.scala:101), called at
  PipelineRepository.scala:410. The design leaves it to D0 and says plainly that it may stay apply-only.

Claims I refuted, or found that the design's mechanism does not actually produce parity:
1. **Rest root schema in analyze is not the schema apply uses.** D1.3 says "rest/sql -> the same live inferSchema analyze
   does". Analyze's bare-`url` branch (PipelineProposalAnalyze.scala, `EphemeralRestConfig(url, method, headers, body,
   bodyContentType, rootSelector)`) drops `queryParams` and `parameters`. Apply's `createRest` url branch
   (SourceService.scala ~l.175-200) carries both: it merges `splitUrl` query pairs with `config.queryParams` and sets
   `parameters`, then infers through the persisted Auto connector. A proposal with templated `parameters` or explicit
   `queryParams` can therefore produce a different schema, or fail to fetch, at propose time compared with apply. That
   breaks the "iff".
2. **Disabled steps: analyze and apply project different node schemas.** Analyze builds `NodeStepInput(..., enabled =
   req.enabled)`, and a disabled step passes its input through (PipelineAnalyzeService.scala:320). Apply's
   `createTransactional` builds `NodeStepInput` without `enabled`, so every step is treated as enabled (default `true`,
   PipelineAnalyzeService.scala:194). Take a disabled `select` that drops `x`, with an Output mapping `x` downstream:
   analyze passes it and apply rejects it. D1.7 says "`analyzeNodes` with the schemas from 3", but it never says whose
   node-input construction is used. D6 only proves that `outputMappingProblem` is shared, which is the last step. The
   node-schema derivation that decides the result would still be two copies.
3. **The fetch-failure rule changes apply's acceptance, not just its message.** Today a rest/sql fetch failure leaves
   that root with an empty schema, and apply fails only if some Output's column check fails against its own node
   (PCT `buildOutputsAction`). Otherwise apply succeeds with a recorded unrunnable run (PPS `finishPipeline`). D1's rule
   rejects whenever any Output has a `fieldMapping`. That over-rejects in two cases where apply succeeds today:
   - an Output with a mapping bound to a different, healthy root;
   - an Output whose mapped column is produced by a step (for example aggregate or compute) downstream of the failed
     root.

   Because D1 also makes apply call the dry run first, those applies now fail. That contradicts the spec's "accepts iff
   apply succeeds; only the message differs".
4. **The scope cut is understated and leaves the ticket's own bug open through `propose_patch_set`.** A patch-set
   `pipeline` create edit carries a full `CreatePipelineRequest` including `steps` and `outputs`. RefinementEditShape.scala
   l.269-275 offers it, with `"tag"/"steps"/"outputs" optional`. Its resolve (PatchSetPipelineResolvers.scala:95-150)
   runs only root ownership and `PipelineCreatePreflight.run`. The column check runs at forward-apply inside
   `createTransactional`. So an Output in a patch-set pipeline create that maps a missing column passes preview and
   fails apply, which is exactly the ticket's symptom. proposal.md and design.md Non-goals list only "step add/update
   and data-source edit". The pipeline-create edit is deferred only in inventory section 4, and the spec Requirement
   ("Pipeline, combined, dashboard and patch-set proposal validation SHALL run the same check functions apply runs ...
   only row-read checks excluded") contradicts that deferral. D1 steps 4-7 already take a `CreatePipelineRequest`, so
   covering this edit is a small extension, not a new design.
5. **The spec cannot be met if D1.6 ends up apply-only.** The spec's only allowed exclusion is "checks that need the
   pipeline run itself". D1.6 and D2 (sentinel controls) explicitly allow "record as apply-only with the reason". If
   either lands there, the parity requirement is violated as written.

Other checks:
- Placeholders: none of TODO/TBD type. D1.6 and D2 have explicit decision procedures (task 0.2). That is acceptable.
- Ambiguity: D2 calls for D3's checks on sentinel-bound panels. D3 defines `dryRunForCreate` as "buildForCreate minus
  nothing", but buildForCreate runs `rejectMissingOutput` against the DB, which fails for a sentinel or placeholder id.
  The design needs to say how the sentinel is handled (skip the existence check, or substitute).
- AC coverage: AC1 -> tasks 1.1-1.3. AC2 -> 4.1. AC3 -> 4.2. AC4 -> 4.2 as a scripted replay, reported unmet live per
  the driver directive. All covered, subject to the defects above.

### Verdict: REFUTE

### Change Requests

1. **D1.3, rest root schema parity.** The dry run's rest/sql root schema must come from the same config apply persists
   and infers from, not analyze's ephemeral config. Specify extracting `createRest`'s config build (url split +
   queryParams merge + parameters, and the connectorId branch's `toDomain`) into one pure function that both
   `createRest` and the dry run use. Then infer from that config without persisting a connector, for example through an
   ephemeral path extended to carry queryParams and parameters. Do the same for sql (`SqlSourceConfigPayload.toDomain` +
   `CreateSourceEnvelope`'s inference arguments). Add a parity corpus entry: a url root with `queryParams` or
   `parameters`.
2. **D1.7, make node-schema derivation shared.** Extract from `PipelineCreateTransaction.createTransactional` one pure
   function that builds the `NodeStepInput`s (from preflight's root indices) and returns each Output's node schema
   (`analyzeNodes` + the root-bound fallback). Both `createTransactional` and the dry run must call it. Sharing only
   `outputMappingProblem` is not parity by construction. Decide explicitly whether apply's current "disabled steps
   project as enabled" behaviour is kept (dry run matches it) or fixed (then both change together). Add a corpus entry
   for a disabled step upstream of an Output.
3. **D1 fetch-failure rule, preserve apply's acceptance exactly.** Evaluate the column check exactly as apply does,
   with an empty schema for each fetch-failed root. Reject only when that check fails. When it fails for an Output whose
   node descends from a fetch-failed root, substitute the clearer fetch message. Otherwise pass, so apply proceeds to
   its recorded unrunnable run as today. Update spec scenario "Parity with apply" accordingly. Add corpus entries: a
   failed root plus an Output on a healthy root, and a failed root plus a step-produced mapped column.
4. **Scope: patch-set `pipeline` create edits.** Either bring them into this change, by running D1 steps 4-7 (plus
   inline-root checks) in `PatchSetPipelineResolvers.resolvePipelineCreate`, which `resolveAll` shares for preview and
   apply, or state the deferral explicitly. If deferred, name it as a remaining path to the ticket's exact symptom in
   proposal.md and design.md Non-goals, carve it out of the spec Requirement, and put it in the task 6.3 follow-up. The
   current text does not acknowledge it outside the inventory. Recommended: include it, since it is the same bug and
   reuses D1.
5. **Spec, allowed exclusions.** Amend the first Requirement so its exclusion set is "the run, plus any check recorded
   in the apply-check inventory as apply-only with a reason (D1.6 cycle guard, D2 sentinel controls if so decided, and
   the deferred patch-set edits)". Alternatively, commit D1.6 and D2 to being dry-run, so the spec's "iff" is achievable
   as written.
6. **D2/D3 sentinel panels.** Specify how `dryRunForCreate` treats a `$pipelineOutput`-bound panel: which checks run
   (config decode, `validateCreatePanelRequest`, `validateConfig`) and which are skipped or substituted
   (`rejectMissingOutput`, controls), so that "buildForCreate minus nothing" is not read literally and fails every
   sentinel panel.

### Non-blocking notes

- Check order: apply resolves roots one at a time, all checks for a root before the next. D1 runs each check family
  across all roots before the next family. For proposals with several errors, the first message can differ. Iterating
  per root in D1 steps 1-3 would keep the messages identical.
- The ticket lists "slot eligibility" (type). Apply does not check type eligibility (OutputBindingSpec scaladoc), so the
  dry run does not need it for "never fails on apply". State that in the design so it does not look like a dropped item.
- D6's "test that the same function runs on both paths" needs a concrete mechanism. The parity corpus, plus a mutation
  showing that changing the shared function changes both, is more convincing than a structural assertion.
- ClaudeClient citation should be l.168, not l.132.
- `POST /api/proposals/validate` has no MCP consumer, because there is no MCP `propose_combined`. That is fine, but
  record it as HTTP-only.
- MCP and assistant `propose_*` now do a live connector fetch for inline rest/sql roots. Mention the latency and egress
  in the PR.
