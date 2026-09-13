# HEL-1129: Tighten dataset MCP tool descriptions (row-length, explicit-null default, column types)

## Description

Non-blocking findings from HEL-1081 (PR matto00/helio#648), triaged by the batch driver as one standalone low ticket.

1. `append_dataset_rows`' description says short rows are rejected; the backend actually pads short rows. Make the description match real behaviour (or make the backend reject, if that was the intended contract — decide and record why).
2. `default: null` loses its explicit-null distinction on schema read-back. Decide whether that matters for agents; either preserve it or document it.
3. No tool description lists the valid column `type` strings, so agents have to guess. Enumerate them from the single source of truth, not a hand-copied list.

## Acceptance Criteria

- Each item fixed or explicitly documented, and tool descriptions verified against real backend behaviour via a fresh MCP process.

## Premise-validation corrections (orchestrator, Setup step 2)

Full evidence at `.concertino/runs/HEL-1129/evidence/premise-validation.md`. Summary:

1. CONFIRMED as stated — `DatasetRowValidator.validateRow` only rejects rows LONGER than the declaration; a short row has missing trailing fields filled from `default` or `JsNull` (subject to `required`). The `append_dataset_rows` description is factually wrong about short-row rejection.
2. CONFIRMED but more narrowly scoped than the ticket's title suggests: the explicit-null-default distinction is preserved correctly on GET /schema (`DatasetFieldResponse`'s hand-rolled format) and on `update_dataset_schema` intake (`DatasetFieldDeclarationPayload`, HEL-1124's `Option[Option[JsValue]]` idiom). It is genuinely LOST only at dataset-creation intake, via `StaticColumnPayload`'s plain `Option[JsValue]` (auto-derived `jsonFormat4` — spray-json's generated `OptionFormat` treats a present `"default": null` the same as an absent key). This only matters behaviorally for a field declared `required: true` with an explicit `default: null` (a present default, even `null`, is consulted before the `required` check in `DatasetRowValidator.validateRow`) — an agent cannot currently express that specific combination via `create_data_source`.
3. CONFIRMED — no dataset tool description enumerates the 7 canonical column types. Single source of truth: `DataFieldType.CanonicalWireValues` (backend/src/main/scala/com/helio/domain/model/model.scala:735-736). This repo already has a reusable pattern for keeping a TypeScript-side copy honest against this exact backend constant without hand-copying: `frontend/src/features/sources/types/dataSource.ts`'s `CANONICAL_FIELD_TYPES` + `frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts` (HEL-1079), which reads `model.scala` from a Jest test at CI time and asserts content+order match. `helio-mcp` is a separate package (no cross-package import of frontend code) — replicate the same constant + drift-guard-test pattern locally in `helio-mcp`.

Explicitly out of scope: HEL-1132 (helio-mcp's own "DataType" terminology copy) — separate, just-filed ticket, not folded in here.
