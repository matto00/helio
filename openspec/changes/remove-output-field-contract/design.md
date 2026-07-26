## Context

`OutputContract` (`backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala`, HEL-391) is
`rowCount: RowCountContract`, `fields: Vector[OutputFieldContract]`, `description: String`. `fields` is a
dead field: every one of the five registered shapes declares `Vector.empty`, no backend code reads it, and
the frontend/MCP surfaces never render it. It structurally cannot be populated correctly since
`outputContract` is a static `val` with no access to `params`. The user has already decided against making
it param-aware; this change deletes it.

## Goals / Non-Goals

**Goals:**
- Remove `OutputFieldContract` and `OutputContract.fields` from the domain model, all five shapes, the
  catalog JSON protocol, `schemas/pipeline-shape-catalog.schema.json`, and the
  `pipeline-shape-registry` capability spec.
- Sweep `helio-mcp/` and `frontend/` for any type/code referencing `fields` in a catalog/output-contract
  shape and remove it.
- Zero behavior change: no shape's `expand`, validation, or row output changes.

**Non-Goals:**
- Making `outputContract` param-aware (explicitly rejected by the user).
- Any change to `rowCount`/`description` semantics or the panel-kind matching that consumes `rowCount`
  (HEL-399).

## Decisions

**Decision 1: Delete outright rather than deprecate.** `fields` has no consumers anywhere in the shipped
epic, so there is no migration/back-compat concern on the read side. The only "consumer" is the JSON wire
shape itself (`additionalProperties: false` in the catalog schema), which is being updated in the same
change. Alternatives considered: (a) leave `fields` in the Scala model but stop requiring it in the schema
— rejected, this just relocates the dead code instead of removing it; (b) deprecate with a comment for one
release cycle — rejected, YAGNI/dead-code removal doesn't need a soak period since nothing downstream reads
it (confirmed by the epic-wide sweep in the ticket).

**Decision 2: `additionalProperties: false` in the JSON schema means `fields` must be dropped from
`required` and `properties`, not just made optional.** The schema currently lists `fields` in
`outputContract.required`. Removing the emitting code but leaving `fields` as an optional schema property
would still validate against a payload that includes it, silently permitting drift back in. Drop the
property entirely.

**Decision 3: Treat every MODIFIED-requirement `outputContract = OutputContract(rowCount = ..., fields =
Vector.empty, description = ...)` spec line as needing a full delta edit, not a one-off.** The existing
capability spec encodes `fields = Vector.empty` as normative prose in six separate requirements (the shared
`OutputContract` requirement plus one per shape plus the catalog-endpoint requirement). All six move
together in this change's spec delta so the spec continues to describe the shipped type exactly.

**Decision 4: helio-mcp and frontend sweep is grep-verified, not assumed absent.** HEL-400's workspace
context snapshot and HEL-402/HEL-399's shape-picker/instantiate types are the two places most likely to
mirror the backend catalog response shape in TypeScript. The executor SHALL grep both trees for `fields`
in shape/catalog-adjacent types before declaring the sweep complete, since a stale TS field would not fail
the Scala build.

## Risks / Trade-offs

- [Risk] A frontend/MCP type silently keeps an unused `fields?: ...` field after this change (TS structural
  typing wouldn't fail to compile even if the backend stops sending it) → Mitigation: explicit grep sweep
  (Decision 4) plus evaluator/skeptic spec-drift check against the JSON schema.
- [Risk] Removing `fields` from `required` in the JSON schema without removing it from `properties` leaves
  a schema/code mismatch → Mitigation: Decision 2, verified by the schema-drift check mentioned in the
  ticket briefing.
- [Trade-off] None of substance — this is a pure subtraction with no new capability.

## Migration Plan

Single-PR change, no data migration (no Flyway involved — `OutputContract` is never persisted). Deploy
order is irrelevant since the field was never read by any client; a backend-first or frontend-first
partial rollout both leave the system in a valid state (old frontend ignoring a since-removed field it
never rendered; new frontend never expecting a field the backend no longer sends).

## Open Questions

None — scope, deletion decision, and consumer sweep boundaries are fully specified by the ticket and this
design.
