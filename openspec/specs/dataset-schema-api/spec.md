# dataset-schema-api Specification

## Purpose
Exposes a dataset source's declared field schema (name/type/required/default) over the API so
downstream UIs can render typed columns and editors without inferring shape from row data.

## Requirements

### Requirement: Declared schema route for dataset sources
The system SHALL expose `GET /api/data-sources/:id/schema` for a `dataset`-kind data source,
returning its declared fields (`name`, `type`, `required`, `default`) as stored in
`dataset_schema`.

#### Scenario: Dataset source with a declared schema
- **WHEN** an authenticated owner requests the schema of a dataset source they own
- **THEN** the response is `200` with the declared field list, each field carrying its
  `name`, `type`, `required` flag, and optional `default` value

#### Scenario: Source is not a dataset kind
- **WHEN** the requested source exists but is not `dataset`-kind (e.g. `csv`, `rest`)
- **THEN** the response is `400` naming the source's actual kind, not a 500 or a silently
  empty schema

#### Scenario: Source not found or not owned
- **WHEN** the source id does not exist, or exists but is not owned by the caller
- **THEN** the response is `404`, matching the existing HEL-1002 not-found convention
  (indistinguishable from a genuinely nonexistent id)

#### Scenario: Existing source GET response is unaffected
- **WHEN** a client calls the existing `GET /api/data-sources/:id`
- **THEN** the response shape is unchanged — no new required field, no altered existing field

### Requirement: Declared schema write route for dataset sources
The system SHALL expose `PATCH /api/data-sources/:id/schema` for a `dataset`-kind data source,
accepting a full replacement field-declaration list (`name`, `previousName`, `type`, `required`,
optional `default`, and a request-level `confirmDrop` flag), reusing the same ACL and HEL-1002
not-found shape as `GET /api/data-sources/:id/schema` and `PATCH /api/data-sources/:id`. This route
does not modify `GET /api/data-sources/:id/schema`'s response shape in any way.

#### Scenario: Source not found or not owned
- **WHEN** the source id does not exist, or exists but is not owned by the caller
- **THEN** the response is `404`, matching the existing HEL-1002 not-found convention

#### Scenario: Source is not a dataset kind
- **WHEN** the requested source exists but is not `dataset`-kind
- **THEN** the response is `400` naming the source's actual kind

#### Scenario: Cross-owner edit denied at the database
- **WHEN** a caller who is not the owner attempts the edit, even bypassing the service-layer ACL
  check, with a raw query against `dataset_rows` under a non-superuser, non-BYPASSRLS role
- **THEN** the database's row-level security policy on `dataset_rows` itself denies the write (not
  merely `data_sources`' own policy denying an earlier existence check) — the app-layer 404 is
  defense in depth, not the only barrier — and the true owner's rows are unchanged afterward

### Requirement: Malformed field identity mapping is rejected structurally
The system SHALL reject, with `400`, a request whose `previousName`/`name` mapping is ambiguous:
a `previousName` naming no field in the current declaration, two payload fields sharing the same
`previousName`, two payload fields sharing the same `name`, or a rename target (`name`) that
collides with a field simultaneously being dropped.

#### Scenario: previousName names no existing field
- **WHEN** a payload field's `previousName` does not match any field in the current declaration
- **THEN** the response is `400` naming the invalid `previousName`

#### Scenario: rename target collides with a field being dropped
- **WHEN** a payload field renames an existing field to a name that is also the name of a
  currently-declared field omitted from the new declaration (i.e. being dropped)
- **THEN** the response is `400`, unconditionally, in every case — the caller must resolve the
  collision (e.g. drop first, then rename, in separate requests) rather than have it resolved
  implicitly

### Requirement: Empty dataset accepts any internally-valid declaration
The system SHALL allow any schema edit (add/remove/rename/retype/reorder fields, with or without
`required`/`default`) on a dataset with zero existing rows, since no row can be made invalid by the
edit — subject only to the declaration's own internal validity (e.g. a `default` value must satisfy
its own declared type, checked via the same validation `DatasetRowValidator.validateDefault` already
performs at create time, regardless of row count).

#### Scenario: Any structurally-valid edit on an empty dataset
- **WHEN** the dataset has zero rows and the caller submits a new field declaration list
- **THEN** the response is `200` with the new declaration and `rowsMigrated: 0`

#### Scenario: Invalid default rejected even on an empty dataset
- **WHEN** the dataset has zero rows and a submitted field's `default` value does not satisfy its own
  declared `type`
- **THEN** the response is `400` naming the field, regardless of row count

### Requirement: Rename and reorder never modify row data
The system SHALL allow, on a non-empty dataset, renaming a field (identified by `previousName`) and
reordering fields, in any combination, without altering any existing row's stored values — only their
position and the declaration's field names change.

#### Scenario: Rename field on non-empty dataset
- **WHEN** the caller renames a declared field (via `previousName`) on a dataset with existing rows,
  with no other change
- **THEN** the response is `200`, `rowsMigrated: 0`, and every existing row's stored values are
  unchanged (rename is metadata-only)

#### Scenario: Reorder fields on non-empty dataset
- **WHEN** the caller submits the same fields in a different order, with no other change
- **THEN** the response is `200`, every existing row's stored values are rewritten to the new column
  order (same values, new positions), and `rowsMigrated` equals the row count

### Requirement: Resubmitting an untouched field's existing default never backfills a pre-existing null
The system SHALL NOT apply a field's `default` to an existing row's `null`/absent value for that field
unless the field is genuinely being changed by the request (added, retyped, or its `required`/`default`
differs from the field's current declared value). Merely resubmitting a kept field's current, unchanged
`required`/`default` — as any full-replacement request naturally does for every field it isn't editing
— SHALL NOT cause a default to be backfilled into a pre-existing null in that column.

#### Scenario: Rename-only edit resubmitting an unchanged default does not backfill
- **WHEN** the caller renames one field (via `previousName`) and, as part of the required full
  declaration, resubmits a DIFFERENT field's existing `default` unchanged, and that different field has
  a pre-existing `null`/absent value in some existing row
- **THEN** that row's value for the unchanged field remains `null`/absent after the edit — it is not
  backfilled

#### Scenario: Retype-only edit resubmitting an unchanged required/default does not backfill
- **WHEN** the caller retypes a field with no other field changed, and a different, untouched field
  (same `required`/`default` as before) has a pre-existing `null`/absent value in some existing row
- **THEN** that row's value for the untouched field remains `null`/absent after the edit

### Requirement: Adding a field inserts a value at its declared position in every existing row
The system SHALL, when adding a field to a non-empty dataset, insert a value for that field at its
new position in every existing row's stored data: the field's `default` if one is supplied, else
`JsNull`. This holds regardless of where in the declaration the new field is positioned.

#### Scenario: Add optional field at an arbitrary position, non-empty dataset
- **WHEN** the caller adds a `required: false` field with no `default`, positioned anywhere in the new
  declaration, to a dataset with existing rows
- **THEN** the response is `200`, and every existing row has `JsNull` inserted at that field's new
  position — every other field's value remains readable at its own (possibly shifted) position

#### Scenario: Add field with a default, non-empty dataset
- **WHEN** the caller adds a field with a `default` value to a dataset with existing rows
- **THEN** the response is `200`, and every existing row has the default value inserted at that
  field's new position

### Requirement: Tightening a kept field to required needs a default when existing values are missing
The system SHALL, when a kept field (same name/type, via `previousName` or unchanged `name`) changes
`required` from `false` to `true` on a non-empty dataset, allow the edit unconditionally if every
existing row already has a non-null value for that field; otherwise require a `default` (used to
backfill only the rows currently `null`/absent for that field) and reject with `409` if none is
supplied.

#### Scenario: Tighten to required, all existing values already present
- **WHEN** a kept field's `required` is changed to `true` and every existing row already has a
  non-null value for it
- **THEN** the response is `200` and no row is modified

#### Scenario: Tighten to required, some rows null, default supplied
- **WHEN** a kept field's `required` is changed to `true`, some existing rows have a `null`/absent
  value for it, and a `default` is supplied
- **THEN** the response is `200`; rows that had `null`/absent are backfilled with the default; every
  other row's value for that field is unchanged

#### Scenario: Tighten to required, some rows null, no default
- **WHEN** a kept field's `required` is changed to `true`, some existing rows have a `null`/absent
  value for it, and no `default` is supplied
- **THEN** the response is `409` naming the field; no row is modified

### Requirement: Adding a required field requires a default on a non-empty dataset
The system SHALL reject, with `409`, adding a `required` field with no `default` to a dataset that
has at least one existing row, naming the missing-default reason. Supplying a `default` SHALL cause
existing rows to be migrated by inserting that default value at the field's new position.

#### Scenario: Add required field without default, non-empty dataset
- **WHEN** the caller adds a `required: true` field with no `default` to a dataset with existing rows
- **THEN** the response is `409` naming the field and explaining a default is required

#### Scenario: Add required field with default, non-empty dataset
- **WHEN** the caller adds a `required: true` field with a `default` value to a dataset with existing
  rows
- **THEN** the response is `200`, every existing row is migrated to include the default value for
  that field, and `rowsMigrated` equals the row count

### Requirement: Retyping a field is validation-only — no value conversion is performed
The system SHALL reject, with `409`, retyping a field when any existing row's non-null value for that
field does not already satisfy the new type under `DatasetRowValidator.validateValue`, naming the
count of incompatible rows. A `JsNull`/absent value is exempt (treated as missing, per the field's
`required`/`default` rules) regardless of the retype. When every present value already satisfies the
new type, the edit succeeds and every value is carried over **unchanged** — this route never converts
a value from one representation to another (e.g. retyping `integer` to `string` succeeds only for rows
whose stored value is already a JSON string; it does not stringify existing numbers).

#### Scenario: Retype with an incompatible existing value
- **WHEN** the caller retypes a field and at least one existing row's non-null value for that field
  does not satisfy the new type
- **THEN** the response is `409` naming the field and the count of incompatible rows; no row is
  modified

#### Scenario: Retype where every existing value already satisfies the new type
- **WHEN** the caller retypes a field and every existing row's non-null value for that field already
  satisfies the new type
- **THEN** the response is `200`, `rowsMigrated` equals the row count (a retype always counts as a
  migration under this route's single operational definition of `rowsMigrated`, even though no cell's
  stored bytes actually differ — see the `rowsMigrated` requirement below), and every row's value for
  that field is unchanged

#### Scenario: Retype a column containing null/absent values
- **WHEN** the caller retypes a field and some existing rows have a `JsNull`/absent value for it
- **THEN** those rows do not block the retype on account of that field — only present, non-null values
  are checked against the new type

#### Scenario: Retype combined with tightening the same field to required
- **WHEN** the caller both retypes a field AND changes its `required` to `true` in the same request
- **THEN** the retype check runs first (any incompatible existing value rejects the field with `409`
  naming the retype failure, independent of the required change); only once every value satisfies the
  new type does the required/default check from the "Tightening a kept field to required" requirement
  apply to the (possibly still-null) resulting values

### Requirement: `rowsMigrated` reflects the declaration diff, not a per-row byte comparison
The system SHALL report `rowsMigrated` as `0` if and only if the submitted declaration is identical to
the current one except for field name/`previousName` bookkeeping (every field maps to the same index,
same type, same `required`, same `default` — a pure rename with no reorder/retype/add/drop/required/
default change). In every other case (reorder, retype, add, drop, or any required/default change),
`rowsMigrated` SHALL equal the existing row count, regardless of whether any individual row's stored
bytes happened not to change.

#### Scenario: Pure rename reports zero
- **WHEN** the only change is one or more field renames, with no reorder/retype/add/drop/required/
  default change
- **THEN** `rowsMigrated: 0`

#### Scenario: Any non-rename-only change reports the full row count
- **WHEN** the submitted declaration differs from the current one in any way other than field naming
  (e.g. a reorder, a retype — even one where no value needed to change — an add, a drop, or a required/
  default change)
- **THEN** `rowsMigrated` equals the current row count

### Requirement: Dropping a declared field from a non-empty dataset always requires confirmation
The system SHALL reject, with `409`, dropping a declared field from a dataset with at least one
existing row unless the request sets `confirmDrop: true` — unconditionally, regardless of whether the
field's existing values happen to all be null. With `confirmDrop: true`, the field SHALL be removed
from the declaration and its value dropped from every existing row. Dropping a field from a dataset
with zero rows requires no confirmation.

#### Scenario: Drop field from non-empty dataset, no confirmation
- **WHEN** the caller submits a declaration omitting a currently-declared field, on a dataset with at
  least one row, without `confirmDrop: true`
- **THEN** the response is `409` naming the field and requiring `confirmDrop: true` to proceed; no row
  is modified — this holds even if every existing value in that column happens to be null

#### Scenario: Drop field from non-empty dataset, confirmed
- **WHEN** the caller submits the same omission with `confirmDrop: true`
- **THEN** the response is `200`, the field is removed from the declaration, that field's value is
  dropped from every existing row, and `rowsMigrated` equals the row count

#### Scenario: Drop field from an empty dataset
- **WHEN** the caller omits a currently-declared field from the new declaration, on a dataset with
  zero rows
- **THEN** the response is `200` with no `confirmDrop` required

### Requirement: A multi-field edit is rejected in its entirety if any field's edit is rejected
The system SHALL evaluate every field's edit independently and reject the WHOLE request, with `409`
listing every rejected field, if any one field's edit would be rejected on its own — no partial
application of a multi-field request.

#### Scenario: Multi-field edit with one rejected field
- **WHEN** a single request adds an optional field (allowed on its own) and also drops a field with
  data without `confirmDrop` (rejected on its own)
- **THEN** the response is `409` listing the dropped field's rejection reason, and no row is modified
  — the allowed part of the request is not applied

### Requirement: A final in-transaction check enforces the no-violating-row invariant
The system SHALL re-validate every migrated row against the new declaration, inside the same
transaction that writes it, before committing, and roll back the entire transaction rather than commit
any row that violates the new declaration. This check is pass/fail only — it SHALL NOT alter which
row content is persisted; the rows actually written are exactly the rows the migration itself produced,
never a value substituted by the validation check itself.

#### Scenario: Internal migration inconsistency is caught before commit
- **WHEN** the repository-level migration produces a row that does not satisfy the new declaration
  (an internal-consistency bug, not a caller-facing rejection already covered above)
- **THEN** the transaction rolls back and no partial write is committed, rather than a violating row
  reaching the database

#### Scenario: A successful rename/retype-only edit never backfills an untouched null cell
- **WHEN** a rename-only or successful-retype-only edit is applied to a dataset containing a
  pre-existing `null`/absent value in a column the edit does not otherwise touch
- **THEN** that cell remains `null`/absent after the edit — the final validation check does not cause a
  default to be silently backfilled into a cell the migration itself left untouched

### Requirement: Concurrent schema edit and row write cannot corrupt data
The system SHALL serialize a schema edit against concurrent row writes on the same source (reusing
the existing `lockSource` row-lock pattern), so no row write can complete against a declaration that
is simultaneously being replaced, and no migrated row can be left violating the new declaration.

#### Scenario: Schema edit races a concurrent row append
- **WHEN** a schema edit and a row append are issued concurrently (actually overlapping execution, not
  two sequential calls) against the same dataset source
- **THEN** the two operations are serialized (one completes fully before the other proceeds) and the
  final state has every row satisfying whichever declaration is current after both complete
