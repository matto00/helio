## Context

HEL-1118 renamed the live LLM-facing prompt string literals in `DashboardAuthoringPrompt.scala`
to say "Output" but left several doc comments, and — per re-enumeration in this ticket's
premise-validation evidence — did NOT touch `RefinementPrompt.scala`'s equivalent live prompt
strings, `AssistantSystemPrompt.scala`'s live tool-description copy, or
`WorkspaceAssistantTools.scala`'s tool-schema `description` copy. See proposal.md for the
owner's rename ruling and the HEL-1130 validation deferral.

## Goals / Non-Goals

**Goals:**
- Rename every LLM-facing / tool-schema-facing occurrence of "DataType"/"DataTypes" that refers
  to the retired DataType entity, to "Output"/"Outputs", across the four named files.
- Leave every occurrence that refers to a column's scalar data type, or to the
  `WorkspaceAssistantTools` wire enum value, untouched.
- Record a decision (rename/keep) and reason for every site touched by this ticket, on the
  ticket and in this document.

**Non-Goals:**
- Running before/after representative prompts to compare tool-call shape (HEL-1130).
- Renaming Scala identifiers/parameter names (`dataTypes: Vector[...]`, local `dt` bindings) —
  these are internal code, not prompt/tool copy the LLM ever sees; renaming them is a larger,
  unrelated refactor with no user/LLM-visible effect, out of this ticket's scope.
- Any change to tool names, JSON field names, wire enum values, or other wire contracts.

## Decisions

Per-site classification (file:line refers to current HEAD, re-enumerated — see
premise-validation.md for the full stale-vs-current line mapping):

| File | Site | Current text | Decision | Reason |
|---|---|---|---|---|
| DashboardAuthoringPrompt.scala | L48-50 (doc comment) | "One line per pipeline-output DataType... per-DataType grounding context... real data types" | RENAME (L48,49) "DataType"→"Output"; KEEP L50's quoted spec scenario title verbatim | L48/49 describe the retired entity; L50 quotes an existing spec.md scenario name verbatim — not ours to reword |
| DashboardAuthoringPrompt.scala | L57 `"no panel-capability data available for this data type"` | live prompt fallback text | RENAME → "...for this output" | Refers to the Output entity (`dt`), not a column type; missed by HEL-1118 |
| DashboardAuthoringPrompt.scala | L72 (doc comment) | "per-DataType grounding text" | RENAME → "per-Output" | Refers to the retired entity |
| DashboardAuthoringPrompt.scala | L52,56,107 | `dataTypes` param name, `c.dataType` field access | KEEP | Identifier (non-goal); `c.dataType` is a column's scalar type, different concept |
| RefinementPrompt.scala | L107-109 (doc comment) | "one line per pipeline-output DataType... a DataType not yet used" | RENAME → "Output" | Refers to the retired entity; ticket's originally-cited lines |
| RefinementPrompt.scala | L117 `"no panel-capability data available for this data type"` | live prompt fallback text | RENAME → "...for this output" | Same as DashboardAuthoringPrompt L57; not previously aligned |
| RefinementPrompt.scala | L118 `"- DataType id=...`" | live prompt entity line | RENAME → "- Output id=..." | Mirrors DashboardAuthoringPrompt L58, which already says "Output" |
| RefinementPrompt.scala | L120-121 `"Available pipeline-output data types:"` / "(none yet)" | live prompt header | RENAME → "Available pipeline Outputs:" | Mirrors DashboardAuthoringPrompt L60 |
| RefinementPrompt.scala | L112,116 | `dataTypes` param, `c.dataType` | KEEP | Same as DashboardAuthoringPrompt |
| AssistantSystemPrompt.scala | L7,9 (doc comment) | "per-DataType grounding data... no matching DataType" | RENAME → "Output" | Ticket's originally-cited lines |
| AssistantSystemPrompt.scala | L72 `"sources, DataTypes, pipelines,"` (find tool desc) | live tool description | RENAME → "Outputs" | LLM-visible tool description |
| AssistantSystemPrompt.scala | L74 `"For a DataType, the result..."` (get_resource desc) | live tool description | RENAME → "For an Output, the result..." | LLM-visible; article a→an |
| AssistantSystemPrompt.scala | L85 `"pipeline-output DataTypes. Use when..."` (propose_dashboard desc) | live tool description | RENAME → "Outputs." | LLM-visible |
| AssistantSystemPrompt.scala | L87 `"no existing DataType that can answer..."` (propose_pipeline desc) | live tool description | RENAME → "no existing Output that can answer..." | LLM-visible |
| WorkspaceAssistantTools.scala | L22 `Vector("dataSource", "dataType", ...)` | wire enum value | KEEP — hard boundary | Consumed by `WorkspaceResourceType.fromString`; renaming is a wire-contract break, explicitly out of scope |
| WorkspaceAssistantTools.scala | L27-28 (find tool `description`) | "data sources, DataTypes, pipelines," | RENAME → "Outputs" | Ticket-adjacent LLM-visible copy, same phrase as AssistantSystemPrompt L72 |
| WorkspaceAssistantTools.scala | L55 (get_resource tool `description`) | "a DataType's columns/sample rows/column stats" | RENAME → "an Output's columns/sample rows/column stats" | Ticket's originally-cited line; article a→an |

### Design-gate round 1 REFUTE — additional sites found (backend-wide re-check)

The design-gate skeptic found this ticket's original file list (matching the ticket body's own
4-file enumeration) was itself incomplete relative to the owner's general "LLM prompt and tool
copy" ruling. Backend-wide re-check found:

| File | Site | Current text | Decision | Reason |
|---|---|---|---|---|
| AssistantProposalToolSchemas.scala | L55, L451 | "an existing pipeline-output DataType id" / "for a DataType before proposing..." | RENAME → "Output" | Real `propose_dashboard`/`get_resource`-adjacent tool description sent to Claude; missed because this file wasn't one of the ticket's 4 named files |
| AssistantProposalToolSchemas.scala | L80 (doc comment) | "never a real DataType id" | RENAME → "Output id" | Comment, same entity |
| AssistantProposalToolSchemas.scala | L448 | "bound to EXISTING pipeline-output DataTypes" | RENAME → "Outputs" | Live `propose_dashboard` tool description |
| AssistantProposalToolSchemas.scala | L458-459 | "output DataType name" / "no existing DataType that can answer" | RENAME → "output name" / "no existing Output that can answer" | Live `propose_pipeline` tool description; "output name" (not a field reference — verified no `outputDataTypeName` field exists; `PipelineProposalSchema`'s own field is already named `outputs`, L256-259) matches existing terminology in the same file |
| DashboardAuthoringService.scala | L62 `EmptyWorkspaceMessage` | "the workspace has no pipeline-output data types yet" | RENAME → "no pipeline Outputs yet" | Doc comment at L67-68 confirms this and `degradeMessage` below become part of the "degrade-not-fail warnings" folded into grounding context — LLM-adjacent, not a wire value |
| DashboardAuthoringService.scala | L276 `degradeMessage` | `"Could not load panel capabilities for data type $outputId: $reason"` | RENAME → "for output $outputId" | Same warning-message path as L62 |
| RefinementGrounding.scala | L110 `degradeMessage` | same message, mirrors DashboardAuthoringService | RENAME → "for output $outputId" | Same reasoning |
| AssistantSystemPrompt.scala (revised) | L72/L74 (find/get_resource prose) | after rename, says "Outputs" while the only accepted wire value is still `"dataType"` (`WorkspaceResourceType.fromString`, unchanged) | ADD disambiguating hint, e.g. `"...Outputs (use resource type \"dataType\")..."` and `"For an Output (type \"dataType\"), the result..."` | Skeptic-flagged real behavior risk: renaming the prose without flagging the still-`"dataType"` wire value could make the model emit an invalid `type: "output"` that `fromString` rejects (returns `None`) — this is a functional risk, not merely cosmetic, so it is fixed here rather than deferred to HEL-1130 |
| WorkspaceAssistantTools.scala (revised) | L27-28, L55 tool `description` | same disambiguation | Add the same `(resource type "dataType")` hint alongside the L27-28/L55 renames | Same reasoning — this is the actual JSON-Schema-facing tool description, doubly important since it's what Claude's structured tool-call arguments are conditioned on |
| helio-mcp/src/tools/{read.ts,refinement.ts} | multiple (L5, L87, L100, L305 in read.ts; L50 in refinement.ts) | "DataType" meaning the retired entity | **KEEP for this ticket, filed as standalone follow-up HEL-1132** | Separate package (MCP server exposing tools directly to external agent clients, its own test suite/runtime), not one of the backend files this ticket's scope (see ticket.md's re-scope note) covers. helio-mcp/src/tools/refinement.ts:108 (the wire value) stays untouched regardless of HEL-1132's outcome. |

### Design-gate round 2 REFUTE — scope-boundary and verification fixes

Round 2 found the ticket.md/design.md/proposal.md helio-mcp exclusion rationale was internally
inconsistent (ticket.md said the rename applied "across the codebase" while design.md said the
ruling didn't cover helio-mcp) and that the round-1 revision's own verification task (a
whole-`backend/src/main` re-grep) was unworkable: that directory has ~380 "data type" hits, the
overwhelming majority being genuine column-scalar-type references, unrelated JSON wire field keys,
and stale/unrelated doc comments outside this ticket's blast radius. Fixed by:

- **Scope statement corrected** (ticket.md): the rename applies to the backend prompt/tool-copy
  surface for the assistant/authoring/refinement flows specifically — `services/assistant`,
  `services/proposals`, `services/patchsets`, `services/workspace`, `api/protocols/assistant` —
  not "the codebase." helio-mcp remains out of scope under that corrected statement (a distinct
  package, not one of those directories), consistent everywhere now, not because the owner
  separately blessed excluding it.
- **A full, closed audit of that bounded surface** (every `.scala` file under the 5 directories
  above containing `datatype`/`data type`, case-insensitive) turned up two more KEEP sites beyond
  the tables above, both verified against live code:
  - `RefinementEditShape.scala:270` — `"\"dataType\" is not a valid target.kind at all anymore"` —
    part of the live `propose_patch_set` tool `Description` (LLM-visible), but this is a
    deliberate, correct guard naming the wire enum value itself (telling the model NOT to emit
    `"dataType"` as an edit target) — KEEP, already correct.
  - `RefinementEditShape.scala:14` — doc comment listing `DataTypeProtocol` among sibling
    protocol names — `DataTypeProtocol.scala` no longer exists in the codebase (verified via
    file search); this is a pre-existing, unrelated stale-doc-reference bug, not prompt/tool copy
    about the retired DataType entity — KEEP, out of scope (not this ticket's defect to fix).
  - `AssistantToolExecutor.scala` (`WorkspaceResourceDetail.DataTypeDetail` matches/comments) —
    KEEP, identifier (non-goal, same as `dataTypes` param names elsewhere).
  - `WorkspaceContextBudget.scala:91` (`"dataTypes" -> typesPage`) — KEEP, JSON wire field key on
    `WorkspaceContextResponse`, not copy.
- **Task 1.4 and the design table now agree**: both say to add the `(resource type "dataType")`
  hint to `WorkspaceAssistantTools.scala` L55 (`get_resource`) as well as L27-28 (`find`) — see
  tasks.md for the exact replacement text.
- **New test coverage for the hint** (tasks.md 1.3/1.4): add assertions to
  `AssistantSystemPromptSpec` and `WorkspaceAssistantToolsSpec` that the find/get_resource
  descriptions still mention the literal string `"dataType"` after the rename — otherwise nothing
  regression-guards the disambiguation this round added.
- **Verification task narrowed and made exact** (tasks.md 1.8, replacing the unworkable 1.7): a
  single `grep -rniE "datatype" <the 8 touched files>` plus the closed audit above (not a
  whole-`backend/src/main` sweep) is what's actually checkable and complete for this ticket's
  bounded scope.
- **Minor wording fix**: "no pipeline-output Outputs yet" → "no pipeline Outputs yet" (drops the
  redundant "output"/"Output" repetition), matching `DashboardAuthoringPrompt`'s own "Available
  pipeline Outputs:" phrasing.

Test/fixture check (final): grepped `backend/src/test/**` for every touched string above, plus
`AssistantProposalToolSchemasSpec.scala` and `DashboardAuthoringServiceSpec.scala` specifically. No
spec currently asserts (positively or negatively) any of the renamed copy verbatim —
`AssistantSystemPromptSpec`'s one negative assertion (`should not include "data source, DataType,
pipeline"`) targets an unrelated, already-absent `propose_patch_set` phrase and is unaffected. Two
new positive assertions are added (see above) to regression-guard the wire-value hint; no other
test edits required by this rename.

## Risks / Trade-offs

- [Risk] Renaming live tool-description copy could shift LLM tool-selection/argument behavior
  in ways not caught until HEL-1130's validation runs. → Mitigation: scope strictly to the sites
  above; HEL-1130 is already filed and will run representative prompts before/after.
- [Risk] Missing a live-prompt occurrence during re-enumeration (as HEL-1118 did for
  RefinementPrompt.scala). → Mitigation: executor re-greps all 8 touched files for `[Dd]ata[Tt]ype`
  after editing and confirms only the KEEP sites above remain.
- [Trade-off] Not renaming Scala identifiers (`dataTypes` param, `dt` var) leaves internal code
  using different terminology than its own doc comments once those are renamed. Accepted as
  out-of-scope per Non-Goals — a pure identifier rename is a larger, behavior-preserving refactor
  better done as its own follow-up if wanted.

## Planner Notes

- Scope of "copy" interpreted as: doc comments describing prompt/tool behavior, prompt string
  literals actually sent to the LLM, and tool-schema `description` fields — not Scala
  identifiers. Self-approved; low risk, reversible, consistent with the driver's "copy only"
  instruction.
- `.openspec.yaml` sets `skip_specs: true` — this is copy-only, no spec-level requirement
  changes (prompt wording is not a documented API/behavior contract in `openspec/specs/`).
