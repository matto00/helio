## Context

Backend ground truth confirmed by direct code inspection (see `ticket.md`'s premise-validation
summary):

- `DatasetRowValidator.validateRow` (`backend/src/main/scala/com/helio/domain/engine/DatasetRowValidator.scala:117-142`)
  only rejects rows LONGER than the declared schema outright. For a row no longer than the schema,
  each field position is checked independently, and a position is treated as "missing" whether it
  is ABSENT (short row) OR an explicit `null` (`missing = raw == JsNull`, line 123) — either way
  it is filled from that field's `default`, or left `null` if optional with no default, and only
  errors when the field is `required` with no `default`.
- `DataFieldType.CanonicalWireValues` (`backend/src/main/scala/com/helio/domain/model/model.scala:735-736`)
  is the single source of truth for the 7 valid column type strings: `string`, `integer`, `float`,
  `boolean`, `timestamp`, `string-body`, `binary-ref`.
- `frontend/src/features/sources/types/dataSource.ts`'s `CANONICAL_FIELD_TYPES` constant +
  `frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts` (HEL-1079) already
  establish this repo's pattern for keeping a TypeScript-side literal honest against
  `model.scala`'s Scala source, read directly by a Jest test at CI time. `helio-mcp` is a separate
  npm package with no dependency on `frontend/` — this pattern must be replicated locally in
  `helio-mcp`, not imported.
- `StaticColumnPayload` (`backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala:243-248`,
  used by `POST /api/data-sources/static`, i.e. `create_data_source`) is a plain
  `jsonFormat4`-derived format over `default: Option[JsValue]`; spray-json's generated
  `OptionFormat` collapses a present `"default": null` and an absent `default` key to the same
  `None`, so an agent cannot express "this field's default is explicitly `null`" at dataset
  creation. `DatasetFieldResponse` (schema GET) and `DatasetFieldDeclarationPayload`
  (`update_dataset_schema`) both correctly preserve this distinction via hand-rolled formats — only
  the creation intake path is affected.

## Goals / Non-Goals

**Goals:**
- Tool descriptions for `append_dataset_rows`/`replace_dataset_rows` state the real padding
  behavior for both short rows and explicit `null` positions.
- `create_data_source`'s explicit-null-default limitation is documented in its tool
  description so an agent doesn't assume it can express that combination.
- Valid column `type` strings are enumerated in the relevant tool descriptions from a guarded
  single source of truth in `helio-mcp`.
- Every change verified against a freshly started, built `helio-mcp` process talking to a real
  backend (not the session's frozen MCP client — see `reference_stale_mcp_client_trap`), as a
  non-superuser role (RLS is forced on dataset rows).

**Non-Goals:**
- Changing `DatasetRowValidator`'s actual validation/padding behavior — it is correct.
- Changing `StaticColumnPayload`'s wire format to support `Option[Option[JsValue]]` for creation-
  time defaults — a bigger, more invasive change disproportionate to a docs-tightening Low ticket;
  documented as a known limitation instead.
- HEL-1132 (helio-mcp's "DataType" terminology copy).

## Decisions

1. **Description fix, not a backend contract change (Finding 1).** Rewrite
   `append_dataset_rows`'/`replace_dataset_rows`' descriptions in `helio-mcp/src/tools/write.ts` to
   state: rows longer than the schema are rejected; for a row no longer than the schema, a missing
   trailing position OR an explicit `null` position is padded from that field's `default` (or left
   `null` if optional with no default); only a `required` field missing/`null` with no `default`
   (or a declared-type mismatch on a present non-null value) causes rejection. Alternative
   considered — making the backend reject short/null rows outright — was rejected: the padding
   behavior is intentional (declared, tested backend behavior; positional alignment allowing
   trailing-optional omission, and explicit-null-as-missing, are legitimate ergonomic choices), and
   changing it would be a behavior change with no reported problem driving it, well outside a
   docs-tightening ticket's scope.

2. **Document, don't fix, the creation-time explicit-null-default gap (Finding 2).** Add a note to
   `create_data_source`'s tool description: an explicit `default: null` on a column is
   currently indistinguishable from omitting `default` (both become "no default") when creating a
   dataset — to declare a field whose default is genuinely `null`, use `update_dataset_schema`
   after creation instead, which does preserve the distinction. Alternative considered — hand-
   rolling `StaticColumnPayload`'s spray-json format to mirror `DatasetFieldDeclarationPayload`'s
   `Option[Option[JsValue]]` idiom — was rejected for this ticket: it touches a widely-used payload
   type (also used by `applyStaticRefresh`) and would need its own design/test pass disproportionate
   to a Low-priority docs ticket; worth a follow-up ticket if an agent actually needs the
   combination.

3. **New `helio-mcp`-local canonical-types constant + drift-guard test (Finding 3).** Add a small
   constant (e.g. `CANONICAL_COLUMN_TYPES` or similar) in `helio-mcp/src/tools/` (or a shared
   `helio-mcp/src/` module used by the dataset tools), listing the 7 canonical wire values in the
   same order as `DataFieldType.CanonicalWireValues`, and a Jest drift-guard test — `helio-mcp`'s
   tests run under the repo-root `jest.config.cjs` (ts-jest, `NodeNext` resolution), invoked from
   the repo root, so the same repo-root-discovery approach
   `canonicalFieldTypesDriftGuard.test.ts` uses (walk up from `__dirname` until a directory
   contains `backend/`) works unchanged — that reads `model.scala` from disk and asserts the
   constant matches content+order, mirroring that test's exact regex approach (over
   `CanonicalWireValues`'s `Vector(...)` literal + `fromString`'s case table). Interpolate this
   constant into `create_data_source`'s, `get_dataset_schema`'s, and `update_dataset_schema`'s tool
   descriptions. Alternative considered — a runtime fetch of valid types from the backend at
   server-start — was rejected: MCP tool `description` strings are registered once at server
   startup before any API call is guaranteed possible, and a compile-time-guarded constant is
   simpler and consistent with the existing frontend pattern.

## Risks / Trade-offs

- The drift-guard test reads Scala source via regex (same approach the frontend guard already
  uses) — fragile to a large refactor of `model.scala`'s structure, but consistent with an already-
  accepted repo pattern, not a new risk introduced here.
- Documenting (rather than fixing) the creation-time null-default gap leaves a real, if narrow,
  capability gap for agents — accepted as an explicit, recorded scope decision (Decision 2) rather
  than silently ignored.
