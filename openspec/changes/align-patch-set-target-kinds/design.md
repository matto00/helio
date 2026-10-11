## Context

See proposal.md (Why). Current enumerations of patch-set target kinds (origin/main c58764338):

| Surface | Location | Values |
|---|---|---|
| Request schema | `schemas/patch-sets/patch-set.schema.json` `$defs.EditTarget.properties.kind.enum` | six (reference) |
| Preview-response schema | `schemas/patch-sets/patch-set-preview-response.schema.json` `EditPreview.kind.enum` | five (no `output`) — DRIFT |
| Backend decoder | `PatchSetProtocol.recognizedKinds` | six |
| Assistant tool schema | `AssistantProposalToolSchemas` `enumSchema(...)` (~:370) | six (literal copy) |
| Assistant tool description | `AssistantProposalToolSchemas.proposePatchSetTool` (~:534) | five — DRIFT |
| Refinement prompt skeleton | `RefinementEditShape.Skeleton` (:26) | five, no `parentId` — DRIFT |
| Frontend type | `frontend/src/features/patchSets/types/patchSet.ts` `EditTarget` | `dataType` + five, no `output`, no `parentId` — DRIFT |
| helio-mcp | `helio-mcp/src/types.ts` `EditTarget`, `tools/refinementSchemas.ts` zod enum | six (aligned) |

HEL-1311 solved the same problem for chart types: `ChartTypes.All` (backend), `CHART_TYPES` (frontend, MCP), and labelled GUARD tests on each side that walk `schemas/` and compare.

## Goals / Non-Goals

**Goals:** one list per side; every enumeration derived from or pinned to it; guards proven red by mutation.

**Non-Goals:**
- No new apply/preview capability (e.g. `output` create stays rejected; no new per-kind UI rendering — `PatchSetReview` renders `edit.kind` generically).
- Not adding `parentId` to the refinement prompt skeleton, and not changing the refinement prompt's separate claim that `pipelineStep` create is unsupported in refinement (behavioral prompt scope, not a kind-list drift) — reported as a follow-up candidate.
- Do not touch `PatchSetPreviewProjection*.scala` (concurrent lane HEL-1485).

## Decisions

**D1 — Backend single source `PatchSetTargetKinds`** (`backend/src/main/scala/com/helio/domain/patchsets/PatchSetTargetKinds.scala`, a new package mirroring `domain/panels/ChartTypes`): `All: Vector[String]` in schema order, `AllSet`, and a prose helper. `PatchSetProtocol.recognizedKinds`, the tool schema `enumSchema(All: _*)`, the `propose_patch_set` description (built with `All.mkString("/")`), and the `RefinementEditShape.Skeleton` kind line (`All.mkString(" | ")`) all read it. The skeleton change is LIMITED to the kind list (it gains `output`); no `parentId` line is added, because the same prompt states pipelineStep create is unsupported in refinement and whether refinement should offer it is an owner decision (follow-up, see Non-Goals). Alternative (codegen from schema at build time) rejected: no existing codegen pipeline; HEL-1311's runtime guard pattern is the established precedent.

**D2 — Frontend single source** `export const PATCH_SET_TARGET_KINDS = [...] as const` in `patchSet.ts`; `export type PatchSetTargetKind = (typeof PATCH_SET_TARGET_KINDS)[number]`; `EditTarget.kind: PatchSetTargetKind`; `EditTarget.parentId?: string`. `EditPreview.kind` deliberately stays `string` (response shape; not part of AC; the review UI renders it verbatim).

**D3 — helio-mcp**: export a `PATCH_SET_TARGET_KINDS` const from `refinementSchemas.ts`, feed `z.enum(...)` from it and type `types.ts` `EditTarget.kind` from it if that does not create an import cycle (otherwise leave the literal and pin both with the guard).

**D4 — Guards (labelled GUARD, HEL-1311 style)**, each walking `schemas/patch-sets/*.json`, collecting every property named `kind` that carries an `enum`, asserting the discovered count (expected 2 after this change) and that each equals that side's list:
- backend `PatchSetTargetKindsSchemaGuardSpec`: schema enums == `AllSet`; tool input-schema enum == `AllSet`; `proposePatchSetTool.description` names every kind as a WHOLE word (word-boundary match: `pipeline` is a prefix of `pipelineStep`); `RefinementEditShape` skeleton kind line names every kind (whole-word); the decoder rejects `dataType` and accepts every kind in `All` (decode round-trip).
- frontend `patchSetTargetKinds.guard.test.ts`: schema enums == `PATCH_SET_TARGET_KINDS`; plus a type-level assertion (compile-time) that `{kind: "output", parentId: "p"}` is an `EditTarget` and `"dataType"` is not (`// @ts-expect-error`), so tsc is the red for the type.
- helio-mcp guard: schema enums == MCP const.
Mutation evidence (drop a value from each side's list; drop/add one schema enum value; remove `output` from the description) recorded under `.concertino/runs/HEL-1459/evidence/`.

**D5 — Schema fix**: add `output` to `patch-set-preview-response.schema.json` `EditPreview.kind.enum`; correct stale description text there ("an `output` target kind is P1.4's job to add") and the five-shape lists in preview/apply response descriptions to mention OutputResponse. No existing spec validates preview responses against the schema, so ADD one unconditionally (new spec file, e.g. `PatchSetPreviewResponseSchemaSpec`, or inside the guard spec — never a `PatchSetPreviewProjection*` file): validate a real `output`-update preview response (obtained the same way `PatchSetPreviewRoutesSpec` does, or a response built with the real protocol writer) against the schema using `testsupport/JsonSchemaValidation`; it must fail before the enum fix and pass after.

**D6 — Fixtures**: `PatchSetReview.test.tsx` `kind: "dataType"` fixtures are `EditPreview` objects (`kind: string`), so the move to a live kind (e.g. `output`) is cosmetic hygiene only, not type-driven.

## Risks / Trade-offs

- [Prompt text changes alter model behavior] → Intended (AC); only adds `output` mentions that the tool schema already allowed.
- [A removed kind could survive in a schema `kind.const` (e.g. `patch-set.schema.json` if/then on `pipelineStep`)] → the backend guard also asserts every `kind.const` under `schemas/patch-sets/` is a member of `AllSet`.
- [Guard discovery by property name `kind` could catch an unrelated future `kind` enum in patch-sets schemas] → the count assertion fails loudly with the discovered paths, forcing a deliberate update.
- [Merge with HEL-1485] → disjoint files; re-sync with origin/main before PR.

**D7 — Schema-drift check reads the backend list.** `scripts/check-schema-drift.mjs` extracts the tool-schema kind enum by text (`enumSchema("...")`); once D1 made that call `enumSchema(PatchSetTargetKinds.All: _*)` it found no literals and failed. The script now resolves `PatchSetTargetKinds.All` from `PatchSetTargetKinds.scala` (and throws if that declaration's shape stops matching). Not a `scripts/concertino/` render target, so editing it here is allowed.
