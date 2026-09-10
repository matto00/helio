## Why

The v0.8 "Interactive Data & Write-Back" design spec deliberately deferred one decision:
which store backs `dataset_rows` for the new writable `dataset` source kind, since
`StaticSource` rows are read today through a path the spec itself was unsure about.
The rest of the epic (write API, edit/delete API, management UI) is blocked on this
answer. This ticket produces that decision, backed by measurement, with no
implementation of the storage layer itself.

## What Changes

- Measure how `StaticSource` rows are actually stored and read today (code + live DB).
- Correct the ticket's own stale premise: the "DataType row vs. legacy config blob"
  framing predates HEL-904/909, which retired the standalone `DataType` concept —
  there is one physical store (`data_sources.config jsonb`), not two.
- Decide: new `dataset_rows` table vs. reuse of the existing blob column, evaluated
  against row-level addressing (required for HEL-1078's per-row edit/delete) and
  RLS enforcement under the non-superuser Flyway role (the standing prod trap).
- Write the decision as `design.md` in this change, with the measurement evidence
  inline, plus a `tasks.md` documenting that no code ships in this ticket.
- No spec-level behavior changes — nothing is added to or removed from the API
  contract by this ticket. `skip_specs: true` is set accordingly.

## Capabilities

### New Capabilities
(none — decision-only ticket, no behavior change)

### Modified Capabilities
(none)

## Impact

- No runtime code changes. Affects planning for HEL-1077/1078/1080 (all `blockedBy`
  this ticket) and the eventual Migration A in the v0.8 design spec.
- Read/documentation-only probes against the shared dev Postgres `data_sources` table.

## Non-goals

- Implementing the `dataset_rows` table, migration, or any write API — that is
  HEL-1077/1078/1080, explicitly out of scope per this ticket's AC.
