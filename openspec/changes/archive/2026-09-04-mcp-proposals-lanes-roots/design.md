## Context

HEL-911/912/913 shipped the multi-root, multi-lane graph in the engine, the editor, and
`POST /api/pipelines`. This change lifts the **agent-facing** half. A large fraction of the ticket's
literal wording is already satisfied upstream, and a smaller fraction is not representable at all in
the contract it must land in. Both findings are recorded here because planning this ticket from its
own text would produce the wrong plan in both directions.

### Ground truth established during planning

Every claim below was verified against the tree at `0f16b85d`, not inferred from ticket text.

**Already shipped upstream — do NOT rebuild:**

| surface | state | evidence |
|---|---|---|
| MCP `create_pipeline` accepting `roots[]` + `rootClientId` | shipped | `helio-mcp/src/tools/pipelines.ts:101`, `:46-58` |
| `lane`-kind `secondaryInput` `clientId` resolution at create | shipped | `PipelineService.scala:467-472`, `:560` |
| `add_root` / `remove_root` MCP tools + REST routes | shipped | `PipelineService.scala:771-886`; `mcp-pipeline-root-tools` spec |
| Request-address format `roots[<i>] › steps[<i>]` (R14) | shipped | `PipelineService.scala:1982-1985` (`rootAddress`/`stepAddress`/`outputAddress`/`joinAddress`), `PipelineServiceAddressFormatSpec` |
| `GET /api/pipelines/:id/analyze` per-root, per-lane projection | shipped | `PipelineAnalyzeProtocol.scala:197-203` (`sourceSchemas: Vector[RootSourceSchemaResponse]`) |
| Workspace context `pipelines[].roots[]` | shipped | `workspace-context-assembly` spec; `helio-mcp/src/context.ts:324`, `:449` |
| `PatchSetPreviewProjection` root-awareness | shipped, incidentally | `:261-271` — it reuses `CreatePipelineRequest` verbatim, so it inherited HEL-913's shape |

**The ticket's "9 correlated sites" list is stale — five of the nine are not on this surface.**
`PatchSetApplyRollback`, `PatchSetUndoInverse`, `PatchSetPreviewProjection`, `RefinementEditShape`,
and `PipelineShapeProtocol` neither define nor consume a proposal source. `PatchSetProtocol.scala:35`
and `PipelineProtocol.scala:55` only *mention* `PipelineProposalSource` in doc comments, as a
design-pattern reference. The real surface is the eight sites in §D1, three of which the ticket never
names. Task 1 re-derives this list mechanically and proves it with a grep returning zero.

**AC3's "MCP result cap" does not exist.** There is no response-size cap constant anywhere in
`helio-mcp/src`. The only cap in that tree is an unrelated 1000-row run cap
(`helio-mcp/src/helioApi.ts:109`, `types.ts:537`), which is `RunOutcome.truncated`, not a response
budget. AC3 is therefore written against a cap that was never real. D6 defines one explicitly.

**`analyze_pipeline_proposal` is the un-lifted sibling of `analyze_pipeline`.**
`PipelineAnalyzeProposalProtocol.scala:19-23` still carries singular `sourceName`/`sourceSchema`,
while its persisted-pipeline twin was moved to `sourceSchemas: Vector[RootSourceSchemaResponse]`.
The ticket never names this file; it is unavoidable once the proposal carries `roots[]`.

**A known single-root remnant, deliberately left alone.** `sourceSchemaDrift`
(`PipelineAnalyzeProtocol.scala:190-196`) is scoped to the lowest-positioned root only, flagged
in-code as out of HEL-913 task 7.2c's scope. It stays out of scope here too — widening it is a
behavior change to a shipped field with no acceptance criterion behind it. Named so a reviewer does
not read its absence as an oversight.

## Goals / Non-Goals

**Goals.** Lift `PipelineProposal` from a singular `source` to `roots[]` across schema, protocol,
service, assistant tool schemas, MCP validation, and review UI. Ground proposed Outputs at their own
node including rejoins. Add a patch-set create/delete op for `pipelineStep` (add/remove lane) with a
correct inverse. Add a concise `analyze_pipeline` mode under a stated byte budget. Add a compact lane
tree to workspace context. Prove the multi-root E2E on what it produces.

**Non-Goals.** Patch-set root ops (D3, follow-up). A `create` op for `output` (D3). The multi-root
editor (HEL-968). `get_workspace_context` concise mode (HEL-865's other half). Widening
`sourceSchemaDrift`. Templates, interactive panels, cross-filtering.

---

## Decisions

### D1 — The correlated surface, re-derived

The proposal-source surface is these eight, not the ticket's nine:

1. `backend/.../api/protocols/pipelines/PipelineProposalProtocol.scala` — `PipelineProposalSource`
   (`:20-28`), `PipelineProposal.source` (`:116`), `PipelineProposalApplyResponse.source` (`:132-137`),
   hand-written `pipelineProposalSourceFormat` (`:163-200`).
2. `backend/.../services/pipelines/PipelineProposalService.scala` — `:76`, `:96`, `:107`, `:119-158`,
   `:248-265`, `:275-338`, `:351-359`.
3. `backend/.../services/pipelines/PipelineService.scala` — `resolveProposalSourceSchema` (`:1190-1208`),
   `analyzeProposal` (`:1149`, `:1153`), `resolveInlineSourceSchema` (`:1221`).
4. `backend/.../services/assistant/AssistantToolExecutor.scala` — `requireVerifiedInlineSource`
   (`:224`), called at `:276` and `:300`. **Not named by the ticket.**
5. `backend/.../api/protocols/pipelines/PipelineAnalyzeProposalProtocol.scala` — `:19-23`, with the
   `analyze-proposal` route handler at `backend/.../api/routes/pipelines/PipelineRoutes.scala:43-52`,
   which decodes the same `PipelineProposal`. **Not named by the ticket**, and its capability
   (`pipeline-proposal-analyze-api`) is a **different route** from `pipeline-analyze-api` — the
   near-identical names are why both the file and its spec were missed on the first enumeration.
6. `backend/.../api/protocols/proposals/CombinedProposalProtocol.scala` — `:20`. **Not named by the
   ticket.**
7. `backend/.../api/protocols/assistant/AssistantProposalToolSchemas.scala` — `:220-237`, `:245`
   (`"required": [... "source" ...]`), `:258`.
8. `schemas/pipelines/pipeline-proposal.schema.json`, with `helio-mcp/src/tools/pipelineProposal.ts:58-63`,
   `:103`, `helio-mcp/src/tools/pipelineProposalValidation.ts`, and
   `frontend/.../proposalReview/PipelineProposalSummary.tsx:102`.

**Completeness is proved mechanically, never by tally.** After the change,
`grep -rn "proposal\.source\b\|PipelineProposalSource\b" backend/src frontend/src helio-mcp/src`
restricted to non-comment lines must return zero, and `\.source\b` on the proposal path must return
zero. A hand-kept count is exactly what produced the stale nine.

**One unremarked correction rides along, and is safe.** The canonical `pipeline-proposal-contract`
requirement "PipelineProposal schema shape" still lists `outputDataTypeName` as required. The real
schema dropped it in HEL-907 — `schemas/pipelines/pipeline-proposal.schema.json`'s `required` is
already `["pipelineName", "source", "steps"]`. The canonical text was therefore stale before this
ticket, and the MODIFIED block correcting `source` → `roots` corrects that drift as a side effect.
Named here so a reviewer does not read the dropped field as scope creep.

**"Correlated surface" (§D1) and proposal.md's Impact list are two different lists, deliberately.**
§D1's list answers "what consumes a proposal source" — the eight sites the `source` → `roots[]` lift
touches. proposal.md's Impact list additionally names `PatchSetApplyRollback`, `PatchSetUndoInverse`,
`PatchSetPreviewProjection`, and `RefinementEditShape`, which are touched for a **different** reason:
the new lane-edit patch-set feature (§D3, tasks 5.6-5.8). Both lists are correct; they are not
competing claims about the same file set. `PipelineShapeProtocol` appears in neither and is dropped
from Impact.

### D2 — `roots[]` reuses the proposal's own source element shape, not the create request's

Two candidate element shapes exist: `PipelineProposalSource` (`sourceId` | `type`/`name`/per-kind
`config`, includes `csv`, supports the `newConnector` draft) and `CreatePipelineRootRequest`
(`sourceId` | `type`/`name`/`sqlConfig`/`restConfig`/`staticConfig`, no `csv`).

**`roots[]` uses `PipelineProposalSource` unchanged, plus an optional `clientId`.** The change is
`source: X` → `roots: Vector[X]`. Rationale: the proposal contract has requirements resting on the
existing element shape — inline `csv`, the unresolved-`newConnector` draft
(`pipeline-proposal-contract` requirements at `:83` and `:111`) — that `CreatePipelineRootRequest`
does not carry. Adopting the create shape would silently drop two merged requirements. R6's "one
shape, not two" governs *create vs. `add_root`*, which are the same operation on the same resource;
a proposal is an un-applied artifact with its own longer-standing contract, and collapsing the two is
a separate decision with no acceptance criterion behind it.

Apply maps each proposal root onto the create path's root shape at the service boundary — the same
place `PipelineProposalService` already maps the singular source today, so this adds no new seam.

### D3 — Patch sets: lane-only, and `EditTarget` gains a parent id

`EditTarget` is `(kind, id)` (`PatchSetProtocol.scala:31`). No child resource has a `create` op
because a create request body carries no parent id — the real route takes it from the URL path — and
`EditTarget` has no field for one. `PatchSetProtocol.scala:25-29` states this verbatim for `output`;
`pipelineStep` has the same gap by the same reasoning (HEL-904 design D1). **This is the third ticket
to meet this limitation and the first to fix it.**

`EditTarget` gains `parentId: Option[String]`, required and non-blank for `op: create` on a child
kind, rejected on `update`/`delete`. `pipelineStep` gains `create`/`delete`. A lane is a
`pipelineStep` create naming an existing step as parent.

**Scope ruled `lane-only` (product ruling, 2026-09-04, escalation `lane-only`).** Patch-set
add/remove-**root** ops are a follow-up: roots already have first-class `add_root`/`remove_root` MCP
tools and REST routes from HEL-913, so a patch-set path is a second route to an existing capability,
not missing capability. The follow-up ticket must say so, or it reads as more urgent than it is.

**A canonical requirement asserts the gap as a permanent fact, and must move with it.**
`patch-set-apply`'s "Create is rejected pre-validation where no viable path exists" rejects
`pipelineStep` create *because* "no field on `EditTarget` carries the new step's parent pipeline id."
That premise is exactly what this change removes, so the requirement must be modified in the same
change — otherwise a merged spec forbids a path this change ships. This is the same defect class the
design gate found three times in the proposal capabilities, presenting here as a **missing** delta
rather than an incomplete one, which is why the sweep at task 6b.7 looks for the assertion's wording
rather than for a known file list.

**`output` create stays unimplemented, and the comment must say why in a sentence that stays true.**
`PatchSetProtocol.scala:25-29` currently explains `output`'s missing create op by pointing at exactly
the gap this change closes. Leaving it as-is would document a constraint that no longer exists.
Rewriting it is a **first-class deliverable of this change, not a side effect** (task 5.4): the new
comment must state that the parent-id gap is closed and that `output` create is unimplemented because
nothing here exercises it — an untested op being worse than a documented absence — not that it is
impossible.

### D4 — Grounding at a rejoin node

Proposal grounding today resolves one source schema and projects forward. Under lanes it must project
per node, and a rejoin node's input is both incoming lanes. The persisted-pipeline analyze path
already does exactly this (`pipeline-analyze-api`, "Rejoin schema is projected from both lanes"), so
grounding **reuses that projection** rather than reimplementing it against the un-applied proposal.
`PipelineAnalyzeProposalProtocol` moves to the same `sourceSchemas: Vector[RootSourceSchemaResponse]`
shape its persisted twin already uses, so the two cannot drift.

An Output whose mapped field exists only in a sibling lane that is never rejoined is an error naming
that node — the negative case that proves the projection is per-node rather than per-pipeline.

### D5 — Runtime graph path vs. request address (R5), and reusing R14's helper

Two addresses, both correct, neither replacing the other. The **request address** (`roots[1] ›
steps[3]`) addresses request-body slots pre-persistence; HEL-913 shipped it at
`PipelineService.scala:1982-1985` and its doc comment says "HEL-914 inherits this format rather than
defining a second one." This change **reuses those helpers**, widening `private[pipelines]` visibility
if a caller outside that package needs them — it does not build a second formatter. The **runtime
graph path** (`root:<rootId> > s1 > s4`) addresses persisted nodes and is what concise analyze and the
lane tree emit. A node reachable from several roots takes the path through its lowest-positioned root
(R3 tiebreak 2).

### D6 — The concise-mode byte budget is introduced here, because no cap exists

AC3 asks concise analyze to fit "the result cap." No such cap exists (see Ground truth). This change
introduces one named constant and asserts against it. Two tests, not one:

- concise on a 12-node / 40-column / 2-root graph is **within** the budget;
- **full mode on the same graph exceeds it.**

The second test is what makes the first mean something: without it, a budget set generously enough
that both modes pass would prove nothing, and the mode would be decorative. Both assert measured
serialized size, never a proxy. The spec delta states plainly that the cap is defined here rather
than referenced, since AC3's wording implies a cap that was never real.

### D7 — Wire-shape breaks are proved by decode, never by typecheck

`npm run typecheck` cannot catch a wire-shape break: the frontend's types are not compile-time-coupled
to backend JSON. That is precisely how HEL-913 shipped a broken create flow with every gate green and
why HEL-969 existed. This change alters the proposal wire shape and `helio-mcp`, so:

- **No green typecheck is admissible evidence that a consumer survived.**
- Every consumer of the changed shape is proved by a test that **decodes a real payload** produced by
  the backend shape — the MCP proposal handlers, the frontend review components, and the assistant
  tool schemas each get one.
- `check:schemas` strict parity means `pipeline-proposal.schema.json`, the Scala case class, and
  `AssistantProposalToolSchemas` change in the **same commit** or the gate fails.

### D8 — Proving AC1 on what it produced

AC1's plumbing is largely pre-shipped (see Ground truth), which is a reason to write the test
carefully, not a reason to write less of it. The E2E asserts the produced graph: both root ids in
request order, each parentless step's bound root, the join's resolved second input node, each
Output's node, and the workspace-context lane tree read back. A test asserting the call returned
`201` is not coverage.

### D9 — Delivery hygiene, stated as tasks

The last two runs in this epic were refuted on artifacts the delivery process itself created. Tasks
7.1-7.3 make these mechanical: after `openspec archive`, grep the repo for `mcp-proposals-lanes-roots`
and require zero hits; for every `MODIFIED` spec block, recover the original from `0f16b85d` and diff
it to confirm the body still describes what its title claims; declare one path per bullet in
`files-modified.md`.

## Risks

- **Blast radius of removing `source` outright.** Mitigated by D7's decode tests and `check:schemas`
  parity, not by typecheck. The removal is deliberate and matches the create path's shipped precedent.
- **`EditTarget` is a wire contract with existing consumers.** `parentId` is added as an optional
  field, so existing `update`/`delete` payloads decode unchanged; the new rejection is only for
  payloads that previously could not exist.
- **`Edit` construction sites are positional in many tests.** Any new field follows `outputPatch`'s
  precedent (`PatchSetProtocol.scala:56-63`): trailing and defaulted, so positional call sites compile.
