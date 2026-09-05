## Skeptic Report — design gate (round 6, skeptic-design-6.md)

### What I verified (with evidence)

All commands run in the worktree. Originals recovered with
`git show 0f16b85d:openspec/specs/<cap>/spec.md`.

**Scope item 1 — `pipeline-proposal-review-ui` / `Combined proposal review page` (MODIFIED).**
Compared against the original. Original body: "(source, steps, output DataType name)". Delta body:
"(its roots, steps including lane structure, and Outputs)" plus the every-root SHALL clause. The
`"$pipelineOutput"` sentinel sentence is carried verbatim. All three original scenarios are present
(`Reviewing a combined proposal`, `No proposal in router state (production)`) with a fourth added
(`... whose pipeline carries two roots`). Nothing still-true was dropped; prose is coherent; body
matches title. **OK.**

**Scope item 2 — same file / `Inline connector setup for an unresolved Connector reference`
(MODIFIED, script-transformed).** Diffed against the original line by line. The substitutions
"REST source step" → "REST root", "that step's" → "that root's", "A step whose `config.url`" →
"A root whose `config.url`" are all applied consistently; no half-substituted sentence. The
`PipelineProposalSource.config` / "no `restConfig` field — `restConfig` is a backend-only,
wire-serialized-as-`config` name" parenthetical survives intact and is still accurate (roots
elements are `PipelineProposalSource`). Scenario bodies were transformed too
(`pipeline.source.config` → `pipeline.roots[].config`; "whose REST source step's `config`" → "one
of whose REST roots' `config`"). All seven original scenarios are carried, plus a new
`Each unresolved root gets its own setup section`. One cosmetic residue only (note 1 below).
**OK.**

**Scope item 3 — `patch-set-contract` / `PatchSet schema shape` (MODIFIED).** Original kind list:
`panel`/`dashboard`/`dataSource`/`dataType`/`pipeline`/`pipelineStep`. Delta kind list:
`panel`/`dashboard`/`dataSource`/`pipeline`/`pipelineStep`/`output`. All three required changes are
present: retired `dataType` **dropped**, `output` **added**, `parentId` **added** as an optional
`target` field with a description. Both original scenarios carried, one added
(`A create edit carrying a parentId validates`). This also removes the pre-existing contradiction
with the canonical `patch reuses existing per-resource request shapes`, which already said `dataType`
was invalid. **OK.**

**Scope item 4 — `pipeline-proposal-apply` / `Full rollback on any mid-apply failure` (MODIFIED).**
Round 5's request is satisfied: "**every inline source this call created, across every root,
together with those sources' companion Outputs**", plus the explicit shared-cleanup-list paragraph
and a new scenario `A late failure on a two-root proposal rolls back both roots' created sources`.
It additionally repairs a dangling cross-reference the original carried (it pointed at
"Source-fetch failure creates a needs-attention pipeline, not a rollback", a title that does not
exist; now points at the real title). All original scenarios retained. **OK.**

**Scope item 5 — `pipeline-proposal-contract`, the two newConnector requirements.** The first
(`Inline REST source may propose a not-yet-existing Connector`) was transformed correctly: the only
delta from the original is "inline REST source needs" → "inline REST root needs"; scenarios are
per-`PipelineProposalSource` and remain true. The second is **not OK** — see Change Request 2.

**Security item.** Confirmed as required. `assistant-conversation-loop`'s delta rewrites the
requirement to "**any** inline (non-`sourceId`) `rest_api` or `sql` root" and adds the explicit
sentence "Every inline root SHALL be checked independently — a verified first root does not exempt
an unverified second." It carries the second-root scenario:
`An untested second inline root is rejected even when the first was verified` (two inline `rest_api`
roots, only the first tested → `isError` naming the second root), plus the positive twin
(`Every inline root tested successfully finalizes the proposal`) and a `propose_combined` variant
over `pipeline.roots`. The hole is genuinely closed, not tidied.

**Independent requirement-title diff (re-run, not accepted from the orchestrator).** For each of the
12 delta capabilities I ran `comm -23` over sorted `grep "^### Requirement:"` of the canonical spec
vs. the delta. `mcp-pipeline-lane-tools` and `patch-set-lane-edits` are new capabilities (no
canonical). `pipeline-proposal-analyze-api` carries every canonical requirement. I then accounted
for each uncarried requirement across the other nine. All are genuinely unaffected **except one**:
`assistant-conversation-loop` / `Every propose_* tool's guidance carries a concrete worked example`
— see Change Request 1. (Notable near-misses I checked and cleared:
`mcp-pipeline-proposal-tools`'s `sourceName`/`sourceSchema`/`outputDataTypeName` projection — the
delta *does* carry it, rewritten to per-root `sourceSchemas`; `pipeline-proposal-contract`'s
`Steps are an ordered type/config list` — still true, lanes are additive and covered by the ADDED
requirement; `patch-set-contract`'s `Edit targets reference existing ids...` — still true;
`pipeline-analyze-api`'s singular `sourceSchema` — stale from HEL-911/912, not made false by this
change.)

**String sweep, re-run independently:**
`grep -rn "proposal's \`source\`\|pipeline\.source\|sourceSchema\|sourceName\|the inline source\|created source" openspec/specs/`
The only proposal-scoped hits are inside requirements the deltas already carry
(`pipeline-proposal-review-ui:40,134`, `pipeline-proposal-apply:13,14,21,64,74,80`,
`pipeline-proposal-analyze-api:60,64`, `mcp-pipeline-proposal-tools:38,41`,
`assistant-conversation-loop:201`). Remaining hits are in unrelated capabilities
(`mcp-data-source-tools`, `data-source-acl`, `toast-emission-integrity`,
`sources/rest-source-authoring`, `rest-api-connector`) describing a real single-source create path,
not a proposal. No new instance from the string sweep.

**`openspec validate`:** `openspec validate mcp-proposals-lanes-roots --type change` →
`Change 'mcp-proposals-lanes-roots' is valid`, EXIT=0.

**Is the defect class closed? No — one further instance remains (CR1), plus one incomplete
transform (CR2).** Both were found by the title-diff/read methods above, not by the string sweep,
which is consistent with round 5's finding that the string sweep alone is insufficient. Note that
CR1 was reachable only by reading the *body* of an uncarried requirement and checking it against
ground-truth code — the title diff surfaces the candidate, it does not adjudicate it.

### Verdict: REFUTE

### Change Requests

1. **`assistant-conversation-loop` / `Every propose_* tool's guidance carries a concrete worked
   example` is made false by this change, has no delta, and no task covers the code it pins.**
   Ground truth, `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`:
   - `:213-227` — `PipelineProposalExample` is a JSON literal whose body is
     `{"pipelineName": ..., "source": {"type": "rest_api", ...}, "steps": [...], "outputs": [...]}`.
   - `:245` — `"required" -> JsArray(Vector("pipelineName", "source", "steps").map(JsString(_)))`.
   - `:258` — `CombinedProposalExample` likewise embeds a nested `"source": {...}`.
   And `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala:48-49,70,76,92,97`
   teaches the singular form ("propose_pipeline/propose_combined source is EITHER an existing-source
   branch ... OR an inline-source branch", "propose_pipeline(pipelineName, source, steps, outputs?)").
   The canonical requirement's own scenario `Each propose_* input schema exposes a decodable worked
   example` asserts every `examples` entry decodes to `PipelineProposal`/`CombinedProposal` via the
   same spray-json conversion `AssistantToolExecutor` applies, and its third scenario asserts the
   system prompt's shaping section is present; the requirement text itself names "pipeline source
   existing-vs-inline branch exclusivity". This change's own
   `pipeline-proposal-contract` delta requires `roots` and says "the reader SHALL reject a document
   carrying `source` rather than tolerating it as an unknown key". So after this change the pinned
   examples do not decode and the prompt guidance is wrong — the canonical requirement is false, and
   `AssistantProposalToolSchemasSpec` / `AssistantSystemPromptSpec` (both exist under
   `backend/src/test/scala/`) go red.
   Required: (a) add a MODIFIED `Every propose_* tool's guidance carries a concrete worked example`
   to `specs/assistant-conversation-loop/spec.md` restating the guidance in terms of `roots` and
   per-root existing-vs-inline exclusivity, and (ideally) adding a scenario that the pipeline worked
   example is multi-root; (b) extend task 2.3 — which today names only `PipelineProposalSourceSchema`
   and the `"required"` list — to also cover the `PipelineProposalExample` and
   `CombinedProposalExample` literals; and (c) add a task for `AssistantSystemPrompt.scala`, which
   no task in `tasks.md` names at all (grep for `AssistantSystemPrompt` in `tasks.md` returns
   nothing).

2. **`pipeline-proposal-contract` / `Structural validation accepts an unresolved newConnector draft`
   is declared MODIFIED but is byte-identical to the canonical text — the transform script missed
   it.** Evidence: extracting that requirement from both the canonical spec and the delta and
   diffing them yields no difference other than the following section header. Its body still says
   "SHALL treat **a step** whose `restConfig` carries `newConnector`" and its scenario says "whose
   only REST **step** carries `restConfig.newConnector`". Under this change a REST config lives on a
   `roots` element, never on a step (`steps` entries are `{type, config}` per
   `CreatePipelineStepRequest`), and the sibling requirement in the same file and the whole
   `pipeline-proposal-review-ui` delta were transformed to "root" precisely for this reason.
   Required: reword the requirement body and its scenario to "root" (and make the MODIFIED block
   carry an actual change, since a MODIFIED block identical to canonical is a no-op).

### Non-blocking notes

- `pipeline-proposal-review-ui`, scenario title `A legacy bare-URL step needs no inline setup
  section`: the scenario *body* was transformed to "REST roots" but the title still says "step".
  Cosmetic title/body mismatch; worth fixing while CR2 is being made.
- `pipeline-proposal-apply` / `Full rollback on any mid-apply failure` retains "data types" in its
  resource-count sentence ("sources, pipelines, pipeline roots, pipeline steps, data types"). That
  staleness is inherited from the canonical text and predates this change (DataTypes were retired by
  HEL-903/904), so it is not this delta's obligation — but it is one word from being correct.
