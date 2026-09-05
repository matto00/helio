# Tasks — HEL-914

`openspec` in this repo is **v1.10.0**. Validate with
`openspec validate mcp-proposals-lanes-roots --type change` (there is no `--change` flag on
`validate` in this version). Trust `openspec <cmd> --help` over any command written here.

## 1. Re-derive the correlated surface (do this first)

- [x] 1.1 Enumerate every site consuming a singular proposal source:
      `grep -rn "proposal\.source\b\|PipelineProposalSource\b\|\.pipeline\.source\b" backend/src frontend/src helio-mcp/src schemas`.
      Record the result in the change directory as the working list. Expect design.md §D1's eight
      sites; if the grep finds a ninth, it is real and in scope — the ticket's own list is stale and
      is not the authority.
- [x] 1.2 Confirm the five sites the ticket names but design.md §D1 excludes
      (`PatchSetApplyRollback`, `PatchSetUndoInverse`, `PatchSetPreviewProjection`,
      `RefinementEditShape`, `PipelineShapeProtocol`) carry only doc-comment mentions. If any turns
      out to carry real logic, add it to the list and say so.

## 2. Proposal contract: `source` → `roots[]`

- [x] 2.1 `schemas/pipelines/pipeline-proposal.schema.json`: replace the `source` property with a
      non-empty `roots` array whose items are the existing `PipelineProposalSource` `$def` plus an
      optional `clientId`. Update `required` to `["pipelineName", "roots", "steps"]`. Remove
      `source` entirely — no alias (design.md §D2).
- [x] 2.2 `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocol.scala`:
      `PipelineProposal.source` → `roots: Vector[PipelineProposalSource]`; add `clientId` to
      `PipelineProposalSource`; `PipelineProposalApplyResponse.source` →
      `sources: Vector[DataSourceResponse]`. Update the hand-written
      `pipelineProposalSourceFormat` and add a reader that rejects a payload carrying `source`.
- [x] 2.3 `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`:
      `PipelineProposalSourceSchema` → a `roots` array; `"required"` list `source` → `roots`.
      **Same commit as 2.1 and 2.2** — `check:schemas` enforces strict parity and will fail otherwise.
- [x] 2.4 `backend/src/main/scala/com/helio/api/protocols/proposals/CombinedProposalProtocol.scala`:
      follows `PipelineProposal` automatically; add a decode test proving the combined shape
      round-trips with two roots.
- [x] 2.5 `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProposalProtocol.scala`:
      singular `sourceName`/`sourceSchema` → `sourceSchemas: Vector[RootSourceSchemaResponse]`,
      matching the persisted-pipeline twin at `PipelineAnalyzeProtocol.scala:197-203` (design.md §D4).

## 3. Proposal apply and validation

- [x] 3.1 `PipelineProposalService.scala`: `validateSourceReference`/`resolveSource`/
      `validateSourceSelector`/`validateInlineSource` become per-root, iterating `roots` in order.
      Every root is ownership-checked; an unreadable root is a 404 naming that root.
- [x] 3.2 Resolve and create **every** root before any step is created. Bind each parentless step to
      the root its `rootClientId` names. A parentless step with no `rootClientId` on a multi-root
      proposal is a named `BadRequest` — never a silent default to `roots[0]` (R13/R3).
- [x] 3.3 Roll back the whole apply if any root fails to resolve, including sources created for
      earlier roots. Extend the existing rollback (`:351-359`) from one source to the created set.
- [x] 3.4 Resolve `lane`-kind secondary inputs and sibling `parentStepId`s from request-scoped
      `clientId`s, reusing the create path's fold rather than a second mechanism. A forward or
      dangling reference is a named rejection creating nothing.
- [x] 3.5 Error addresses reuse `PipelineService.rootAddress`/`stepAddress`/`outputAddress`/
      `joinAddress` (`:1982-1985`). Widen `private[pipelines]` only if the caller is outside that
      package. **Do not write a second formatter** (design.md §D5).
- [x] 3.6 `PipelineService.resolveProposalSourceSchema` (`:1190-1208`) and `analyzeProposal`
      (`:1149`, `:1153`): project per node across lanes, reusing the persisted-pipeline projection so
      a rejoin node's schema derives from both incoming lanes (design.md §D4).
- [x] 3.7 `AssistantToolExecutor.requireVerifiedInlineSource` (`:224`, called `:276`, `:300`): verify
      every inline root, not the first.

## 4. Grounding

- [x] 4.1 Ground each proposed Output against the schema projected at its own node.
- [x] 4.2 Test: an Output on a `join` node mapping a field contributed only by the join's `lane`-kind
      secondary input **is accepted**.
- [x] 4.3 Test: an Output mapping a field present only in a never-rejoined sibling lane **is
      rejected**, with the error naming that node. 4.2 without 4.3 does not prove the projection is
      per-node.

## 5. Patch sets — lane-only (product ruling; design.md §D3)

- [x] 5.1 `PatchSetProtocol.scala`: `EditTarget` gains `parentId: Option[String]`. Required and
      non-blank for `op: create` on a child kind; **rejected, not ignored**, on `update`/`delete`.
- [x] 5.2 Add `create`/`delete` support for `pipelineStep`. Any new `Edit` field is **trailing and
      defaulted**, following `outputPatch`'s precedent (`:56-63`), so positional construction sites
      in existing tests keep compiling.
- [x] 5.3 `schemas/patch-sets/patch-set.schema.json`: add `parentId` with the conditional
      required-for-create constraint, mirroring the existing `if`/`then` pattern.
- [x] 5.4 **Rewrite the comment at `PatchSetProtocol.scala:25-29`.** It currently explains `output`'s
      missing create op by pointing at the `EditTarget` parent-id gap — the gap 5.1 closes. The new
      comment must state that the gap is closed and that `output` create is unimplemented because
      nothing in this change exercises it, an untested op being worse than a documented absence.
      **This is a deliverable, not a cleanup**: leaving it documents a constraint that no longer
      exists. Verify by reading the final comment back and confirming every sentence is still true.
- [x] 5.5 Apply path: a `pipelineStep` create names its parent pipeline via `target.parentId`;
      pre-validation authorizes that pipeline for the caller (an unwritable parent refuses the whole
      patch set, per the existing `patch-set-apply` requirement at `:41`).
- [x] 5.6 Inverse: undoing an added lane removes every step the patch set created, the Outputs bound
      to them, and those Outputs' placements, reporting the placement count. Atomic — a partial
      teardown is a refusal.
- [x] 5.7 Refuse the undo when a step added later carries a `lane`-kind secondary input referencing a
      node the undo would delete, naming the referencing step (mirrors R7 phase 1.2).
- [x] 5.8 Inverse of a lane **deletion** restores the steps, Outputs, and placements.

## 6. MCP, workspace context, analyze, docs

- [x] 6.1 `helio-mcp/src/tools/pipelineProposal.ts:58-63`, `:103`: `source` → `roots` array.
- [x] 6.2 `helio-mcp/src/tools/pipelineProposalValidation.ts`: `computePipelineProposalWarnings`
      becomes per-root, reporting against the offending root's index, not the first.
- [x] 6.3 `helio-mcp/src/tools/combinedProposalHandlers.ts` follows.
- [x] 6.4 Concise `analyze_pipeline` mode: per-node `{ path, op, validationError }`, path in runtime
      graph form `root:<rootId> > s1 > s4`, error field **omitted** when absent. Opt-in; the default
      response is byte-identical to today.
- [x] 6.5 Introduce the named byte-budget constant (design.md §D6). **Two tests:** concise on a
      12-node / 40-column / 2-root graph is within budget; **full mode on the same graph exceeds it.**
      Assert measured serialized size, not a proxy.
- [x] 6.6 `WorkspaceContextService` + `helio-mcp/src/context.ts`: add the compact lane tree — per node
      its id, parent id, originating root id, op kind, and bound Outputs. No configs, no schemas, no
      sample rows. Participates in existing budget trimming; trimming is reported, never silent.
- [x] 6.7 `helio-mcp/src/server.test.ts:168-201`: update `EXPECTED_TOOL_NAMES` only if a tool name is
      added or removed. Changing `propose_pipeline`'s input shape does not change its name — do not
      edit this list for a shape change.
- [x] 6.8 `frontend/.../proposalReview/PipelineProposalSummary.tsx:102`: render `roots` and the lane
      structure via `computeLaneLayout` (`frontend/src/features/pipelines/state/laneLayout.ts:59`).
      `CombinedProposalReview.tsx` follows.
- [x] 6.9 `docs/agent-native.md`: worked multi-root example (Sleeper "projections ⨝ ADP"). Run it and
      paste real output — a documented example that was never executed is the defect class this epic
      keeps finding.
- [x] 6.10 Update HEL-865 to reflect that its analyze half is closed here and its
      `get_workspace_context` concise half remains open.
- [x] 6.11 **The `mcp-pipeline-proposal-tools` spec body rewrite is a deliverable, not an addition.**
      Three canonical requirements — `propose_pipeline assembles and validates without writing`,
      `analyze_pipeline_proposal projects the output schema without writing`, and
      `apply_pipeline_proposal applies atomically and surfaces guardrail errors verbatim` — are
      written entirely against the singular `source` and the singular created-source/`sourceSchema`
      response. Removing `source` outright makes every one of their scenarios false. The delta
      carries `MODIFIED` blocks rewriting all three; implement the tools to match those rewritten
      bodies, and confirm at 7.6 that no scenario still names `source`. Adding a new requirement
      alongside stale ones would merge a self-contradicting spec — the exact defect class that
      created this ticket.

## 6b. Spec-body rewrites are deliverables, not additions

The same defect recurred across three capabilities during the design gate: adding a new requirement
while leaving canonical requirements that go false. Each item below is an implementation deliverable
— the code must match the rewritten body — not a documentation chore.

- [x] 6b.1 `pipeline-proposal-contract`, requirement `Backend protocol round-trips the schema,
      tolerating absent optionals`: the protocol round-trips `roots: Vector[PipelineProposalSource]`,
      preserves root order, and **rejects** a document carrying `source` rather than tolerating it as
      an unknown key. A tolerant reader here would silently discard the caller's stated sources —
      the one place tolerance is wrong.
- [x] 6b.2 `pipeline-proposal-apply`, requirement `Structural pre-validation creates nothing on a bad
      proposal`: every guardrail (mutual exclusivity, inline-`csv` rejection, missing name/config,
      non-read-only SQL) applies **per root**, and a rejection names the offending root's request
      position via task 3.5's helpers.
- [x] 6b.3 `pipeline-proposal-apply`, requirement `Source-fetch failure is a structured, rolled-back
      error`: a **root's** inline source failing to fetch yields a blocked run naming that root;
      every failing root is named, not only the first. Keep the distinction the delta draws explicit
      in code: failing to **resolve** a root rolls the apply back (task 3.3), failing to **fetch**
      from a resolved root is a blocked run.
- [x] 6b.4 `pipeline-proposal-apply`, requirement `Non-mutating validation of a PipelineProposal`:
      `validate` ownership-checks every root, not only the first.
- [x] 6b.3a `pipeline-proposal-apply`, requirement `Full rollback on any mid-apply failure`: a late
      failure rolls back **every** inline source this call created across **every** root, plus their
      companion Outputs — not "the inline source" singular. Implement resolve-time rollback (task
      3.3) and late-failure rollback as two triggers over **one** accumulated cleanup list, never two
      separate notions of what to clean up: a divergence between them is invisible until it orphans a
      source. Test the two-root late-failure case explicitly; a single-root test cannot distinguish
      the two implementations.
- [x] 6b.4a `pipeline-proposal-analyze-api` (the `POST /api/pipelines/analyze-proposal` contract —
      a **different route** from `pipeline-analyze-api`, which is why it was missed): all five
      requirements are keyed on a singular `source`. `Dry analyze endpoint for a pipeline proposal`
      returns a source schema per root and projects across lanes including rejoins; `Inline source
      resolution reuses existing inference/guard calls` resolves each inline root and names the
      offending root's position; `An existing sourceId takes precedence over an inline source`
      applies per root independently; `Existing-source resolution is RLS-scoped` covers every root,
      leaking no schema for any root when one is unreadable; `Proposal analysis grounds each Output
      at its own node` grounds a rejoin-node Output against both incoming lanes.
- [x] 6b.4b `assistant-conversation-loop`, requirement `An inline REST/SQL source must be
      connection-tested before its proposal finalizes`: the connection-test gate applies to **every**
      inline `rest_api`/`sql` root independently. A verified first root must not exempt an unverified
      second — this is a security-adjacent gate, and per-first-element checking would be a real hole,
      not a cosmetic staleness. `propose_combined` applies the identical gate across
      `pipeline.roots`.
- [x] 6b.4c `pipeline-proposal-review-ui`, requirement `Pipeline proposal review page`: render every
      root, the lane structure, and the proposed Outputs. No root is presented as the proposal's
      single source. (The canonical text also still says "output DataType name", stale since HEL-907;
      the rewrite corrects it.)
- [x] 6b.4d `patch-set-contract`, requirement `Backend protocol round-trips the schema, tolerating
      absent optionals`: the reader tolerates an absent `EditTarget.parentId` at the **wire** level
      (it is absent on every update/delete), while the create-time requirement is enforced as a
      named validation error, not a decode failure. Writing omits an absent `parentId` rather than
      emitting `null`.
- [x] 6b.4e `pipeline-proposal-review-ui`, requirements `Combined proposal review page` and `Inline
      connector setup for an unresolved Connector reference`: the combined page renders every root of
      its nested pipeline proposal; connector detection runs per **root**, not per "source step", and
      renders one setup section per unresolved root, with Apply disabled until every one resolves.
      `pipeline.source.config` becomes `pipeline.roots[].config`.
- [x] 6b.4f `pipeline-proposal-contract`, requirements `Inline REST source may propose a
      not-yet-existing Connector` and `Structural validation accepts an unresolved newConnector
      draft`: both are per-root.
- [x] 6b.4g `patch-set-contract`, requirement `PatchSet schema shape`: the `EditTarget` field list
      includes the optional `parentId`. (The canonical list also still names the retired `dataType`
      kind and omits `output`; the rewrite corrects both, since an enumerated field list that is
      wrong is the same false-SHALL problem in miniature.)
- [x] 6b.6 `patch-set-apply`, requirement `Create is rejected pre-validation where no viable path
      exists`: remove `pipelineStep` from the pre-validation rejection list and add `output` in its
      place. The rejection's stated premise — that no `EditTarget` field carries the new step's
      parent pipeline id — is exactly what task 5.1 resolves, so leaving it would reject a path that
      now exists. This is the same class as 6b.1-6b.4, presenting as a **missing** delta rather than
      an incomplete one: `patch-set-apply` had no delta at all until this item.
- [x] 6b.7 Grep the canonical specs for any remaining sentence asserting that `EditTarget` cannot
      carry a parent id, or that a child-resource create is impossible for that reason. Every such
      sentence is false after task 5.1 and must be corrected or removed. Ties to task 5.4, which does
      the same for the equivalent claim in code comments.
- [x] 6b.5 Verification gate for this section: no scenario in `openspec/specs/pipeline-proposal-contract/`,
      `openspec/specs/pipeline-proposal-apply/`, `openspec/specs/pipeline-proposal-analyze-api/`,
      `openspec/specs/mcp-pipeline-proposal-tools/`, `openspec/specs/assistant-conversation-loop/`, or
      `openspec/specs/pipeline-proposal-review-ui/` names a singular proposal `source` field after
      archive. Run the same two property greps the design gate used, not a per-file read-through:
      (a) a singular proposal `source`/`sourceSchema`/`sourceName`/created-source; (b) any assertion
      that `EditTarget` cannot carry a parent id or that a child-resource create is impossible.
      **A string grep is not sufficient on its own** — the last instance found during the design gate
      was phrased in prose ("the inline source") and matched neither grep. Also run a
      **requirement-title diff**: for every capability with a delta, compare
      `grep -c "^### Requirement:"` between the canonical spec and the delta, and account for every
      canonical requirement the delta does not carry — either it is genuinely unaffected, or it is a
      missed instance. Both methods, every time. Prove it with a grep returning zero, not a read-through.

## 7. Verification (design.md §D7, §D8, §D9)

- [x] 7.1 **No green typecheck is admissible as consumer evidence.** Every changed-shape consumer gets
      a test that decodes a real payload: MCP proposal handlers, frontend review components,
      assistant tool schemas.
- [x] 7.2 AC1 E2E: one `create_pipeline` call builds a two-root, two-lane pipeline with a `join`
      rejoin and three Outputs; `place_outputs` places them; `get_workspace_context` reflects the
      graph. **Assert the produced graph** — both root ids in request order, each parentless step's
      bound root, the join's resolved second-input node, each Output's node, the lane tree read back.
      Asserting a `201` is not coverage.
- [x] 7.3 Completeness grep from 1.1 returns zero non-comment hits.
- [x] 7.4 `openspec validate mcp-proposals-lanes-roots --type change` exits zero.
- [ ] 7.4a Section 9 is complete, including 9.4's read-through evidence.
- [ ] 7.5 Full gates: `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`,
      `sbt test`, `helio-mcp` tests, `check:schemas`, `check:openspec`.
- [x] 7.6 Run 6b.5's grep. Then, for every `MODIFIED` spec block, recover the original from `0f16b85d`
      (`git show 0f16b85d:openspec/specs/<cap>/spec.md`) and diff it against the delta. The block must
      still describe what its title claims and must drop no scenario. `openspec validate` already
      catches dropped scenarios; it does not catch a body that stops matching its title.
- [ ] 7.7 `files-modified.md`: **one path per bullet.**
- [ ] 7.8 After `openspec archive`, `grep -rn "mcp-proposals-lanes-roots" .` outside the archive
      directory returns zero. Dangling forward pointers refuted the last two runs in this epic.

## 8. Follow-ups to file

- [x] 8.1 File patch-set add/remove-**root** ops. FILED AS HEL-977. State explicitly that roots already have
      first-class `add_root`/`remove_root` MCP tools and REST routes from HEL-913, so this is a
      second path to an existing capability, not missing capability — otherwise it reads as more
      urgent than it is.
- [x] 8.2 Note in that ticket that `EditTarget.parentId` (task 5.1) also unblocks an `output` create
      op, unimplemented here deliberately.

## 9. Assistant tool schemas and system prompt (round-6 findings)

The system prompt is the **only** consumer of this change's wire shape with no compile-time or
test-time coupling to it. It is prose handed to a model. After this change the proposal reader
rejects `source`, so an agent following its own system prompt would author proposals the backend
refuses **while every gate in this repo stayed green**. Design.md §D7's rule ("no green typecheck is
admissible as consumer evidence") applies here in its strongest form: there is no test that can go
red at all.

- [x] 9.1 `AssistantProposalToolSchemas.scala:245` — the `"required"` list `source` → `roots`
      (already covered by task 2.3; restated here so this section is self-contained).
- [x] 9.2 `AssistantProposalToolSchemas.scala:217` `PipelineProposalExample` and `:254`
      `CombinedProposalExample` — the worked-example literals embed `"source": {...}`. Rewrite both
      to carry a `roots` array. **Not covered by task 2.3**, which addresses only the schema and the
      required list.
- [x] 9.3 `AssistantSystemPrompt.scala` — **three** stale instructions, all of which must change:
      - `:48-49` — "propose_pipeline/propose_combined source is EITHER an existing-source branch
        ... OR an inline-source branch ... never both in the same call." Becomes a `roots` array
        whose branch exclusivity is stated **per root**.
      - `:70` — the `test_connection` guidance, "...a propose_pipeline/propose_combined call whose
        source is an inline rest_api/sql config". Singular. This is the **prose twin of the
        connection-test hole** closed in `assistant-conversation-loop`'s spec (task 6b.4b): it must
        require a successful test for **every** inline `rest_api`/`sql` root, or the prompt still
        teaches the behaviour the spec now forbids.
      - `:51-52` — `propose_patch_set` edit shape, taught as
        `{"target": {"kind": ..., "id": ...}, "op": ..., "patch": ...}`. Stale under the lane-only
        ruling: `target.parentId` is required for a child-kind `create` (task 5.1).
- [x] 9.4 **Verification for 9.3 cannot be a passing test.** Render `AssistantSystemPrompt.text`,
      read it, and confirm in the transcript that (a) it describes a `roots` array with per-root
      branch exclusivity, (b) its `test_connection` guidance covers every inline root, (c) its
      `propose_patch_set` guidance names `parentId`, and (d) it contains no instruction describing a
      proposal's source as a single object. Paste the relevant rendered lines as evidence. A green
      `AssistantSystemPromptSpec` is **not** evidence for this item — the prompt is a string, and a
      test asserting it contains some other substring will pass regardless of whether these four
      hold.
- [x] 9.5 `AssistantSystemPromptSpec.scala` and `AssistantProposalToolSchemasSpec.scala`: add
      assertions for 9.2 and 9.3 so the corrected text is anchored against future drift. These
      anchor the fix; they do not substitute for 9.4's read-through, because a test can only assert
      what someone already thought to check.
