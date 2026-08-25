# HEL-630: Large numeric values (>=100 chars via jsonb-to-text) cannot round-trip through DataTypeRowRepository

## Description

Discovered as a spinoff while building HEL-373's serialization-boundary test (per-column statistics in workspace context). Not caused by, or specific to, HEL-373 — it's a pre-existing gap in `DataTypeRowRepository`'s round-trip for any sufficiently large numeric Structured value, for any reason.

### Repro

1. Write a `JsNumber` of large magnitude (e.g. ~`1e308`) through `DataTypeRowRepository.overwriteRows`.
2. Read it back via `DataTypeRowRepository.listRows`.

PostgreSQL's `jsonb`-to-`text` cast canonicalizes large numeric literals to their full plain-decimal-digit expansion — e.g. `1e308` becomes a ~309-character digit string, not scientific notation. `listRows` re-parses that `text` column via spray-json's `JsonParser`, which has a hardcoded `maxNumberCharacters = 100` limit. Re-parsing throws `ParsingException: Number too long`.

Net effect: the application currently cannot durably store *and retrieve* any `float`/`integer` Structured value whose plain-decimal expansion exceeds 100 characters — a real ceiling well within the valid range of a Postgres `double precision` / JSON numeric column, not an exotic edge case.

### Why it wasn't fixed in HEL-373

CONTRIBUTING's refactor discipline: real but non-trivial bugs go to a spinoff ticket rather than an inline fix mid-cycle. HEL-373's own serialization-boundary test was relocated from a DB-backed spec to a pure-unit spec specifically to route around this (using the explicit "or the relevant response/columnStats slice" alternative in its own change-request text) — confirmed the first DB-backed attempt at that test both hit this exact parse exception and poisoned 8 unrelated tests in the same shared-embedded-Postgres spec file (via `WorkspaceContextService.assemble`'s all-DataTypes fan-out pulling in the poisoned row on every subsequent test).

## Suggested directions (not scoped/decided — pick one at triage)

* Raise spray-json's `maxNumberCharacters` limit (check for any other reason it's capped at 100 before raising it globally).
* Round-trip large numeric values as `text`/string at the repository boundary instead of relying on spray-json's numeric parser for the raw `jsonb::text` cast.
* Some other read-path canonicalization that avoids re-parsing Postgres's full plain-decimal expansion as a JSON number literal.

## Acceptance Criteria

- `DataTypeRowRepository.overwriteRows` followed by `listRows` round-trips a large numeric `JsNumber` value (well beyond the empirically-determined character-count boundary) to the exact same value, with no exception thrown and no precision/value corruption.
- The empirical boundary is determined and reported (verify the ticket's ">=100 chars" claim rather than assuming it).
- A boundary sweep is tested: just under, exactly at, and well over the boundary; negative large numbers; high-precision decimals.
- At least one small/ordinary numeric value continues to round-trip unchanged (proves the fix is not indiscriminate).
- A failing (red) test against current `main` is captured as evidence before the fix, demonstrating the actual defect (not just "no exception" — assert value equality).
- If the fix requires a storage-format or migration change (schema/column type change to `data_type_rows`, or any change affecting already-persisted prod rows), STOP and escalate to the human with a recommendation before implementing.
- Sibling numeric round-trip paths are checked for the same defect (pipeline row storage, metric layer, panel binding, MCP row reads) and findings reported — do not widen scope beyond `DataTypeRowRepository` without escalating first.

## Constraints (driver-supplied)

- Follow the HEL-671/HEL-639 house pattern for this data-integrity ticket class: assert exact VALUE equality on round-trip, not just "no exception"/"row exists".
- Escalate before any storage-format/migration change — that's the driver's call.
- Dev-DB is shared across worktrees — clean up fixtures and verify cleanup by querying, not by assuming.
