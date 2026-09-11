## ADDED Requirements

### Requirement: A single row can be replaced with an updatedAt precondition
`PATCH /api/data-sources/:id/rows/:rowId` on a `dataset`-kind source SHALL accept a request body of
the shape `{"updatedAt": "<iso8601>", "data": [<cell>, ...]}`, where `data` is the row's complete new
value: a positional array the same length and column order as the source's declared schema (not a
partial/sparse update — every column's new value is submitted, including columns whose value is
unchanged). The submitted `data` SHALL be validated against the source's currently-declared schema
using the same `DatasetRowValidator` contract append/replace already use, with no merge against the
row's previously-stored value. The write SHALL be applied only if the target row (a) exists under the
source named by `:id` and (b) has a current `updated_at` exactly matching the request's `updatedAt`;
the mutation statement's `WHERE` clause SHALL include the row id, the source id, AND the `updated_at`
value together, so a `rowId` belonging to a different source can never be matched regardless of the
supplied `updatedAt`. On success, the row's `updated_at` SHALL be advanced to the time of the write
(using the same microsecond-truncation convention every existing row writer uses) and the source's
`inferred_schema` SHALL be recomputed over the full post-write row set.

#### Scenario: A precondition-matching edit succeeds and returns the updated row
- **WHEN** `PATCH .../rows/:rowId` is called with the row's current `updatedAt` and a complete new
  `data` array
- **THEN** the response is `200` with the row's `id`, `seq`, advanced `updatedAt`, and the new `data`,
  and the source's `inferred_schema` reflects any changed value

#### Scenario: A stale precondition is rejected without applying the edit
- **WHEN** `PATCH .../rows/:rowId` is called with an `updatedAt` that does not match the row's current
  `updated_at`
- **THEN** the response is `409 Conflict` (naming the row id and both the expected and current
  `updatedAt`) and the row's stored data and `updated_at` are unchanged

#### Scenario: An edit that fails schema validation is rejected before the precondition is checked
- **WHEN** `PATCH .../rows/:rowId` supplies a `data` value that does not match its column's declared
  type, regardless of whether `updatedAt` matches
- **THEN** the response is a field-level `400` validation error and the row is unchanged; a stale
  precondition on an otherwise-invalid payload is never disclosed (validation is checked first)

#### Scenario: Clearing an optional cell with no declared default is a normal full-row edit
- **WHEN** `PATCH .../rows/:rowId`'s `data` array supplies `null` for an optional column that has no
  declared `default` and currently has a non-null value, with every other column carrying its
  intended value
- **THEN** the edit succeeds and that column's stored value becomes `null`

#### Scenario: A null for an optional column with a declared default stores the default, not null
- **WHEN** `PATCH .../rows/:rowId`'s `data` array supplies `null` for an optional column that HAS a
  declared `default`
- **THEN** the edit succeeds and that column's stored value becomes its declared default, per
  `DatasetRowValidator`'s existing null-fills-default behavior (this is not a way to force a `null`
  into a defaulted column)

### Requirement: A single row can be deleted with an updatedAt precondition
`DELETE /api/data-sources/:id/rows/:rowId?updatedAt=<iso8601>` on a `dataset`-kind source SHALL
delete the target row only if (a) it exists under the source named by `:id` and (b) its current
`updated_at` exactly matches the query parameter's value; the conditional delete statement's `WHERE`
clause SHALL include the row id, the source id, AND `updated_at` together, with the same
cross-source-scoping guarantee as `PATCH`. A missing or unparseable `updatedAt` query parameter SHALL
be rejected with `400 Bad Request` before any row lookup. On success, the source's `inferred_schema`
SHALL be recomputed over the remaining rows and the source's `updated_at` SHALL be advanced; the
response SHALL be `204 No Content`.

#### Scenario: A precondition-matching delete removes the row
- **WHEN** `DELETE .../rows/:rowId?updatedAt=...` is called with the row's current `updatedAt`
- **THEN** the response is `204`, the row no longer exists, and the source's `inferred_schema` is
  recomputed over the remaining rows

#### Scenario: A stale precondition is rejected without deleting the row
- **WHEN** `DELETE .../rows/:rowId?updatedAt=...` is called with an `updatedAt` that does not match
  the row's current `updated_at`
- **THEN** the response is `409 Conflict` and the row still exists, unchanged

#### Scenario: Deleting an already-deleted, nonexistent, or cross-source row returns not-found
- **WHEN** `DELETE` (or `PATCH`) is called for a `rowId` that does not exist under the source named by
  `:id` — already deleted, never existed, or belongs to a different source (including one owned by
  the same caller)
- **THEN** the response is `404 Not Found`, using the same not-found shape as other ACL-scoped
  lookups on this route family, and (for the cross-source case) the other source's row is unaffected

### Requirement: Row edit/delete routes enforce the same ACL and kind checks as row write, in a fixed
order
`PATCH` and `DELETE /api/data-sources/:id/rows/:rowId` SHALL apply checks in this order: (1) a
malformed/missing `updatedAt` is `400`, before any database lookup; (2) the source must exist and be
owned by the caller (`404` otherwise, RLS-enforced, never `403`); (3) the source's kind must be
`dataset` (`400` otherwise); (4) the target row must exist under this source (`404` otherwise); (5)
for `PATCH`, the submitted row must pass schema validation (`400` otherwise); (6) the precondition
must match (`409` otherwise). A request for a source or row owned by a different user SHALL receive
the same not-found shape as an ACL-scoped lookup elsewhere in this route family — never a
distinguishable "exists but not yours" response.

#### Scenario: Editing a row owned by another user returns not-found, not forbidden
- **WHEN** a caller calls `PATCH .../rows/:rowId` for a row belonging to a source owned by a
  different user
- **THEN** the response is `404 Not Found` (RLS-enforced), not `403 Forbidden`, and no row data is
  disclosed

#### Scenario: A non-dataset source rejects edit/delete cleanly
- **WHEN** `PATCH` or `DELETE .../rows/:rowId` is called for a source whose kind is not `dataset`
- **THEN** the response is `400 Bad Request` and the source/row are unchanged
