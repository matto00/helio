## Context

`RootSourceSchemaResponse(rootId, sourceDataSourceName, sourceSchema)` lives at
`backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala:184-188`. Its
sibling per-root shape, `PipelineRootSummaryResponse(id, dataSourceId, dataSourceName)`
(`PipelineProtocol.scala:87`), names the same concept without the `source` prefix. This change aligns
them. The rename is mechanically trivial; the entire risk is consumer coverage on a wire field.

Ground truth gathered before planning (`.concertino/runs/HEL-975/evidence/premise-validation.md`):

| Consumer | Location | In scope |
| --- | --- | --- |
| Case class + spray-json format | `PipelineAnalyzeProtocol.scala:186` (+ its `jsonFormat3`) | yes |
| Backend route tests | `PipelineAnalyzeProposalRoutesSpec.scala:185, 255, 302, 452` | yes |
| JSON Schema (analyze) | `schemas/pipelines/pipeline-analyze-response.schema.json:37, 43` | yes |
| JSON Schema (analyze-proposal) | `schemas/pipelines/pipeline-analyze-proposal-response.schema.json:32, 38` | yes |
| helio-mcp type | `helio-mcp/src/types.ts:487-491` (`RootSourceSchemaResponse`) | yes |
| helio-mcp tests | `context.test.ts:135, 501`, `tools/pipelineProposalHandlers.test.ts:119` | yes |
| helio-mcp comments only | `helio-mcp/src/context.ts:321`, `helio-mcp/src/runPipelineTruncation.test.ts:23` | no code change; inside AC8's grep scope, classified as retired-scalar narration |
| Canonical spec | `openspec/specs/pipeline-analyze-api/spec.md:116` (per-root requirement) | yes |
| Canonical spec, stale singular-scalar mention | `openspec/specs/pipeline-analyze-api/spec.md:50` | no — names the scalar HEL-913 retired, not this per-root field |
| Frontend | zero hits under `frontend/src` | no — nothing to change |
| `PipelineSummary.sourceDataSourceName` | `PipelineRepository.scala` and the list/edit-flow specs | no — different concept |

## Goals / Non-Goals

**Goals.** One consistent per-root wire spelling; every consumer of the old key updated in the same
change; a test that proves the new key is on the serialized wire.

**Non-Goals.** A compatibility alias. A frontend change. Renaming the unrelated list-summary scalar. A
migration (none is needed; the field is derived at analyze time from a join, never persisted under this
name).

## Decisions

**D1 — Hard rename, no alias or dual-read window.** The old key is removed outright. Rationale: HEL-913
set exactly this precedent when it retired the singular scalar ("decision 11, no dual-read path"), the
product is pre-1.0 with no external API contract commitments, and an alias would reintroduce the very
two-spellings-for-one-concept problem this ticket exists to remove. *Alternative rejected:* emit both
keys for a deprecation window — this doubles the wire shape and has no identified consumer that needs
the grace period.

**D2 — helio-mcp is updated in the same change, and the PR calls the break out explicitly.** `helio-mcp`
types this field at `types.ts:490`, so the analyze response shape is reachable by an external/agent
client. A backend-only rename would leave a compiled MCP client reading a key the server no longer sends
and silently getting `undefined`. Because both live in this repo they can move atomically; the PR
description states plainly that this is a breaking wire change for any MCP client built from an older
`types.ts`. *Alternative rejected:* leave helio-mcp for a follow-up — that ships a knowingly-broken
client for the interval.

**D3 — Assert on *parsed JSON keys*, not on the decoded case class and not on substring containment.**
This repo has repeatedly shipped tests that pass with a field absent, because spray-json omits
`Option`/`None` on the wire and a decoded case class round-trip can be satisfied by a default.
`sourceDataSourceName` is a non-`Option` `String` here, so a missing key would in fact fail decoding — but
the existing assertions (`resp.sourceSchemas.head.sourceDataSourceName shouldBe ...`) go through
`entityAs[...]`, which proves only that *some* JSON decoded, not that the key is spelled as intended.

The obvious substring fix is worse than useless: **`dataSourceName` is a substring of
`sourceDataSourceName`**, so `responseAs[String] should include("dataSourceName")` passes unchanged
against the *pre-rename* wire. The assertion must therefore parse the body and inspect the entry's JSON
**field-key set**: it contains `dataSourceName`, it does not contain `sourceDataSourceName`, and the value
is a non-empty `JsString` (AC7 (a)/(b)/(c)). Task 3.3 additionally requires the assertion be demonstrated
red against the old spelling, with the observed failure recorded — an assertion never seen to fail is not
yet evidence.

`PipelineAnalyzeRoutesSpec.scala` — the spec for `GET /api/pipelines/:id/analyze` itself — is the natural
home for this assertion, in preference to the *proposal* routes spec.

**D4 — Rename the field only; leave the sibling `sourceSchema` field alone.** `sourceSchema` inside
`RootSourceSchemaResponse` is not a `source`-prefixed *data-source-name* and its sibling has no competing
spelling; renaming it is unrequested scope and would break more consumers for no consistency gain.

**D5 — Comments describing the *current* field are corrected; comments narrating the *retired scalar*
stay.** Several nearby comments mention the old identifier (`PipelineAnalyzeProtocol.scala:181`,
`PipelineProtocol.scala:103`, `WorkspaceContextProtocol.scala:125`, `pipeline-analyze-response.schema.json:17`,
`helio-mcp/src/types.ts:277` and `:503`, `helio-mcp/src/context.ts:321`,
`helio-mcp/src/runPipelineTruncation.test.ts:23`). Those narrating the *retired singular scalar* HEL-913
removed are historically accurate and MUST be preserved — they are AC8's enumerated permitted residue. Any
comment that describes the *current* per-root field's spelling must be corrected, or the file documents a
name it no longer has. D5 and AC8 are deliberately consistent on this point: AC8 is a classified grep, not
a literal zero-hit grep, precisely so that satisfying it never requires deleting true history.

## Risks / Trade-offs

- **Missed consumer — and the drift gate does NOT cover this field.** It would be natural to assume
  `npm run check:schemas` guards backend↔schema agreement here. It does not, and the plan must not credit
  it with coverage it lacks. `scripts/check-schema-drift.mjs:113-147` matches each `*.schema.json` to a
  case class **by the schema's `title`** and then diffs **top-level `Object.keys(schema.properties)` only**.
  The renamed field lives in `$defs.RootSourceSchema` — an untitled nested `$def` with no case-class
  counterpart in the gate's map — and additionally in the `$def`'s `required` array, which the gate never
  inspects at all. Renaming the Scala field while leaving **both** schema files untouched exits the gate
  green. Consequences for this plan: (i) the schema edits get a **direct, manual verification task**
  (task 4.4) rather than relying on a gate; (ii) AC8's classified grep, not `check:schemas`, is the real
  guard. This is a statement about the gate's actual coverage, not a request to change the gate — widening
  `check-schema-drift.mjs` to nested `$defs` and `required` arrays is genuinely useful but is unrequested
  scope here and belongs in its own ticket.
- **helio-mcp and the frontend are outside every automated gate.** Neither is seen by `check:schemas`,
  which is why AC8 greps `helio-mcp/src` and `frontend/src` directly and why helio-mcp's own typecheck and
  test run are explicit tasks.
- **AC8 permits classified residue, and that classification is load-bearing.** Because eight comment lines
  legitimately narrate the retired scalar (D5), AC8 cannot be a literal zero-hit check. Each residual hit
  must be classified as comment/description narration; a residual live declaration, wire key, or
  `required` entry fails AC8. Deleting accurate history to force a literal zero is explicitly disallowed —
  that is the exact bind HEL-969 hit and this ticket exists to unwind.
- **Breaking an out-of-repo MCP client.** Accepted and disclosed per D2; no versioned public API exists.
- **Shared dev Postgres.** No migration is written, so `flyway_schema_history` is untouched and the
  concurrent HEL-981/HEL-980 runs cannot collide with this one.

**D6 — Naming caution: three similarly-named types.** The helio-mcp interface carrying this field is
`RootSourceSchemaResponse` (`helio-mcp/src/types.ts:487-491`), mirroring the backend case class of the
same name. It is **not** `RootSourceSchema` — that is the *frontend* type at
`frontend/src/features/pipelines/types/pipelineStep.ts:490`, which deliberately declares only
`{ rootId, sourceSchema }` and omits this field entirely (HEL-969's resolution, whose comment points
forward to this ticket). The frontend type is out of scope and must not be edited here; re-adding the
field to it under the corrected name is the follow-up this change unblocks.
