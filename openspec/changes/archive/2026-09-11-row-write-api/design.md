## Context

`dataset_rows` (V106, HEL-1074) has `id`, `data_source_id`, `seq`, `data` (positional JSON array),
`created_at`, `updated_at`, `UNIQUE (data_source_id, seq)`, and forced RLS scoped through
`data_sources.owner_id`. **`seq` is 0-based** — V106's backfill, `insertDatasetSource`, and
`replaceDatasetRows` all assign `seq = idx` starting at 0; V106's own comment states this "lines up
with the 0-based row/column indexing every reader already uses". `DatasetRowValidator` (HEL-1076) is
a pure function already wired into `DataSourceService.createStatic`/`applyStaticRefresh`.
`DataSourceRoutes` composes under `ApiRoutes`'s `rateLimitDirective.rateLimit()` and PAT/session auth,
so new routes on the same class inherit both for free — no new wiring needed (verified:
`ApiRoutes.scala:792` mounts `DataSourceRoutes.routes` inside the already-rate-limited/authenticated
block).

`DataSourceRepository.replaceDatasetRows` (L359) already does the delete-then-insert + `dataset_schema`
+ `inferred_schema` + `updated_at` update in one `ctx.withUserContext(...).transactionally` action, but
takes **no row lock** — a refresh racing a concurrent write on the same source can collide on
`UNIQUE(data_source_id, seq)`. `inferred_schema` is derived from stored cell values
(`PipelineRowJson.staticColumnRuntimeType`, computed column-wise over all rows) and is kept in sync by
both `createStatic` and `replaceDatasetRows` — any write that changes cells without recomputing it goes
stale for pipelines/analysis that read it. No request-entity byte-size override exists in
`application.conf` — Pekko HTTP's default `max-content-length` (8 MiB) applies unmodified and already
comfortably covers 500 rows of the shapes `DatasetRowValidator` accepts.

## Goals / Non-Goals

**Goals:**
- Append and replace routes that reuse `DatasetRowValidator` verbatim.
- Correct `seq` assignment under real concurrent appends (not just sequential test calls).
- Atomic replace: any row failure leaves the prior set untouched.
- Response shape that gives HEL-1078 (id + updatedAt precondition) and HEL-1080 (grid) what they need.

**Non-Goals:**
- Per-row PATCH/DELETE (HEL-1078).
- Auto-run of downstream pipelines on write (HEL-1091 epic) — writes only touch `dataset_rows` and
  the source's `updated_at`.
- New rate-limiting policy — the existing per-`/api` directive already covers these routes.

## Decisions

### D1: One shared source-lock helper, used by append, replace, AND the existing refresh path
Add `DataSourceRepository.lockSource(id): DBIO[Unit]` — a `SELECT id FROM data_sources WHERE id = ?
FOR UPDATE` — and thread it through the start of **three** call paths: the new append action, PUT's
row-only replace, and the existing `replaceDatasetRows` (used by `applyStaticRefresh`), which today
takes no lock at all (change-request 1). This closes the refresh-races-append gap directly rather
than adding a second, unlocked write path alongside a locked one. All three compose the lock and the
write into **one** Slick `DBIO` chain under `ctx.withUserContext(...).transactionally`.
Alternative considered: optimistic (`INSERT ... ON CONFLICT DO NOTHING` + retry). Rejected — for a
variable-length row batch, retry-and-recompute-offset is materially more complex than a lock already
justified by "a writer must be able to edit the source" (ACL is per-source anyway, so a per-source
lock adds no new contention users would notice), and it does not solve the schema/count race the lock
also needs to close.

**round-2 correction (skeptic-design-2.md):** refresh and PUT do NOT share one "read stored schema,
validate against it" behavior — they have opposite schema semantics. Refresh **replaces** the
declaration (validates the incoming rows against the *new*, caller-supplied schema, then writes both).
PUT **never** touches the declaration (validates against whatever schema is current *at lock time*,
inside the transaction — not a copy read beforehand). `replaceDatasetRows`'s signature changes to make
this explicit and to stop discarding the row ids it generates (needed for D6's response):

```
def replaceRows(
    id:              DataSourceId,
    declaration:     Option[Vector[DatasetFieldDeclaration]], // Some = refresh (write this schema);
                                                               // None = PUT (read+keep current schema)
    rows:            Vector[Vector[JsValue]],                  // UNVALIDATED — see below
    updatedAt:       Instant,
    user:            AuthenticatedUser
): Future[Option[(DataSource, Vector[DatasetRowRow])]]
```

The **entire** sequence — `lockSource`, resolving the effective declaration (`declaration.get` for
refresh, or a fresh `SELECT dataset_schema ...` for PUT), `DatasetRowValidator.validate(effective
Declaration, rows)`, the delete-then-insert, the `inferred_schema` recompute (D3), and the
`data_sources` update — now happens **inside this one method's transaction**, not split across a
service-layer validate-then-call. A validation failure inside the transaction is surfaced as a
`Left`/typed failure the service maps to `BadRequest`, rolling back the transaction (no partial
write). This is what actually closes the race skeptic-design-2.md identified: a PUT racing a refresh
now either reads the refresh's new schema (if PUT's lock is granted second) or completes and commits
before the refresh's lock is granted (if PUT is first) — it can never silently write back a
schema/row combination from a stale pre-lock read.
`createStatic`/`applyStaticRefresh`'s existing call site is updated to pass `declaration = Some(...)`;
its pre-existing validate-before-call code is removed in favor of this method's own internal
validation, to avoid validating twice against two different possibly-inconsistent reads.

### D2: `seq` is 0-based everywhere, matching every existing writer
Append computes each new row's `seq` as `COALESCE((SELECT MAX(seq) FROM dataset_rows WHERE
data_source_id = ?), -1) + 1, +2, ...` inside the lock — so the first append to an empty source gets
`seq = 0`, matching `insertDatasetSource`/V106's backfill convention (change-request 3). `replaceRows`
(D1's renamed/restructured `replaceDatasetRows`) assigns fresh 0-based `seq` `0..N-1` on every
replace, whether invoked by refresh (`declaration = Some(...)`) or by `PUT .../rows`
(`declaration = None`) — one method, one `seq` convention, no second parallel replace path.

### D3: `inferred_schema` is recomputed on every write, not left stale
Both append and (the now-shared) replace path recompute `inferred_schema` over the **full post-write**
row set using the same `PipelineRowJson.staticColumnRuntimeType` column-wise computation
`createStatic`/`applyStaticRefresh` already use, keyed off the source's declared column `type`s and
every row's per-column cell values (existing rows + newly appended ones, read inside the lock).
Persisted in the same transaction as the row write (change-request 2). This is the one place append
must read existing row data (not just `MAX(seq)`): the cells feed the runtime-type computation exactly
as they do on create/refresh.

### D4: Non-dataset kind check happens in the service, before validation
`DataSourceService` methods check `source.kind == DataSourceKind.Dataset` first and short-circuit
with `ServiceError.BadRequest` for any other kind — mirrors the existing pattern in
`createStatic`/`applyStaticRefresh` for kind mismatches. This check does not need the lock (no write
is attempted), only the ACL-checked source lookup that already happens for every route.

### D5: Row-count limit reuses `staticMaxRows` (500), not a new constant — checked inside the lock
`DataSourceService.staticMaxRows` (currently 500, used by `createStatic`/`applyStaticRefresh`) is
reused unchanged for both routes. Per D1, the check itself runs inside the locked transaction against
a freshly read row count: append checks `existingCount + newRows.size`, replace checks the incoming
set's size. This closes change-request 1's third failure mode (two concurrent appends both passing an
outside-the-lock check and jointly exceeding 500).

### D6: Request/response shapes, pinned explicitly
**Request body** (both routes): `{"rows": [[<cell>, ...], ...]}` — positional arrays, one array per
row, cell order matching the source's declared column order, exactly the shape `DatasetRowValidator`
and `dataset_rows.data` already use (never object-keyed). Validator error row indices are relative to
this request body's `rows` array (0-based), independent of the source's existing row count.
**Empty-array semantics**, pinned per verb: `POST .../rows` with `rows: []` is rejected with
`400 Bad Request` ("at least one row is required") — an append that appends nothing is not a
meaningful request and silently succeeding would mask a client bug. `PUT .../rows` with `rows: []` is
accepted and clears the source to zero rows — "replace with the empty set" is a well-defined, useful
operation (explicit contrast with append, called out to avoid the two-implementers-diverge risk named
in change-request 5).
**Response body** (both routes): `{"rows": [{"id": "...", "seq": <int>, "updatedAt": "<iso8601>"},
...], "updatedAt": "<iso8601>"}` — per-row `id`, `seq`, **and `updatedAt`** (closes change-request 4:
HEL-1078's precondition is `WHERE id = ? AND updated_at = ?` on the row, not the source, per the v0.8
spec L126-127). Append returns only the newly appended rows; replace returns the full new set (small,
bounded by D5's limit). Row `data` is intentionally omitted from the response — HEL-1080 fetches rows
through the existing read path; echoing the request body back adds no new information for this
ticket's consumers and is left for that ticket to add if it turns out to need it.

### D7: Byte-size limit — the existing Pekko HTTP default, unmodified
No route-specific entity-size limit is added. `application.conf` sets no `pekko.http.server.parsing.
max-content-length` override, so Pekko HTTP's built-in default (8 MiB) already applies to these routes
identically to every other JSON body route in `DataSourceRoutes`, and comfortably covers 500 rows of
any shape `DatasetRowValidator` accepts (closes change-request 6 — verified no override exists, rather
than assumed).

## Risks / Trade-offs

- [Row lock adds latency under heavy single-source write contention] → Acceptable: dataset sources
  are single-owner by ACL; contention is bounded by one user's own concurrent submits (e.g. rapid
  counter clicks), not cross-tenant load.
- [`DELETE`-then-`INSERT` replace briefly empties the row set mid-transaction] → Not externally
  visible: forced RLS + the surrounding transaction means no other reader observes the intermediate
  empty state (Postgres read-committed readers outside the transaction see either the old set or the
  new one, never neither, once the transaction commits — no reader sees inside an uncommitted xact).
- [Adding `lockSource` to the existing `replaceDatasetRows`/refresh path changes behavior for an
  already-shipped caller (`applyStaticRefresh`)] → Low risk, net-positive: it only adds serialization
  against a genuine race that method already had (change-request 1); no observable behavior changes
  for the non-concurrent case, and it is covered by the same test suite HEL-1074/1076 already exercise
  for that path, plus the new refresh-races-append test this change adds.

## Migration Plan

No schema migration required — `dataset_rows` and its unique constraint already exist (V106). No
rollback plan beyond reverting the route/service code; no data is migrated.

## Planner Notes

- Reusing `staticMaxRows` (self-approved, not escalated): named for `static` historically but is
  really "max rows per dataset write", already the right value for datasets post-rename.
- `binary-ref` field type rows are accepted exactly as `DatasetRowValidator` already validates them
  (an object) — this ticket does not add file-upload handling; that is the form-panel epic's file
  field (out of scope here).
