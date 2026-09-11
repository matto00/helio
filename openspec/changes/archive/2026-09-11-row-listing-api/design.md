## Context

HEL-1078 shipped `patchRow`/`deleteRow` (`DataSourceRepository.scala`), guarded by an `updatedAt`
precondition, reusing `lockSource` (RLS-scoped `SELECT ... FOR UPDATE`). `dataset_rows` (V106) has
`id, data_source_id, seq, data, created_at, updated_at TIMESTAMPTZ`, forced RLS via an `EXISTS` join
to `data_sources.owner_id`, `UNIQUE(data_source_id, seq)`, and an existing composite index
`idx_dataset_rows_data_source_id ON dataset_rows(data_source_id, seq)` — this already supports an
efficient `WHERE data_source_id = ? [AND seq > ?] ORDER BY seq LIMIT ?` query with no new migration.
Every row writer truncates `updatedAt` to microseconds (`Instant.now().truncatedTo(ChronoUnit.MICROS)`)
before persisting; the wire format is `Instant.toString` (no custom `JsonFormat[Instant]`), parsed
back with `Instant.parse`. `readDatasetRows` (`DataSourceRepository.scala:593`) is a SEPARATE,
existing read path used only by the pipeline engine / Spark submitter / preview: it runs under
`ctx.withSystemContext` (the privileged, RLS-bypassing pool) because ACL is enforced earlier by
those callers' own ownership/ACL checks, not by RLS on this read. This ticket's new route is a
different consumer (an authenticated end-user, via HTTP, with no prior ACL check) and MUST run
under the caller's own RLS-scoped context (`ctx.withUserContext`), never `withSystemContext` — this
is the RLS gap the driver flagged (HEL-373 precedent) and the change's own AC #2.

The codebase already has a generic offset-based pagination convention (`domain/model/pagination.scala`:
`Page(offset, limit)`, `Page.Default = Page(0, 200)`, `Page.MaxLimit = 500`,
`PagedResult(items, total, offset, limit)`), used elsewhere for `findAll`-style listings. This design
deliberately does NOT reuse it for this endpoint — see D2.

`RowResponseRow` (HEL-1078, `DataSourceProtocol.scala:282`, `schemas/sources/row-response-row.schema.json`)
already has exactly the shape a listed row needs: `{id, seq, updatedAt, data}`. There is no
authenticated route today that returns a single dataset source's *declared* schema
(`DatasetFieldDeclaration`) — the only exposed schema is `inferredSchema` (runtime-inferred column
types), and there is no `GET /api/data-sources/:id` at all (only `PATCH`/`DELETE` exist on that path).

**Round-2 corrections** (skeptic-design-1.md REFUTE, all eight items addressed below): D3's cursor
validation, D2's concurrent-mutation stability claim, D2's `nextCursor` end-of-set wire shape, D5's
premise, task 4.4's RLS test, task 1.1's SourceNotFound semantics, D4's response type, and tasks
3.1–3.3's target files.

## Goals / Non-Goals

**Goals:**
- `GET /api/data-sources/:id/rows` returns a page of rows with `id`, `seq`, `data`, `updatedAt`,
  ordered by `seq`, plus enough information to know whether more rows remain and a total count.
- Runs under the caller's own RLS-scoped DB context; a 10k-row dataset never returns unbounded.
- Paging is stable under concurrent appends (AC #2 concurrency test) — never skips or duplicates an
  already-existing row.
- Reuses the existing ACL-scoped source lookup, 404/400 ordering, and kind check verbatim.

**Non-Goals:**
- Filtering/searching rows by cell value.
- Bulk export of a full dataset in one call.
- Any change to `readDatasetRows` or its three existing callers.
- Declared-schema delivery alongside this endpoint's rows (see D5) — no existing route exposes a
  dataset source's declared schema today; this is a known, tracked gap, not something already solved
  elsewhere (see D5 and Risks/Trade-offs).

## Decisions

### D1: New repository method `listRows`, entirely separate from `readDatasetRows`
A new `DataSourceRepository.listRows(sourceId, cursor, limit, user)` method, running under
`ctx.withUserContext(user.id.value)` (RLS-scoped), is added rather than extending
`readDatasetRows`. Reasons: (a) `readDatasetRows`'s three callers all need the FULL row set in one
shot under the privileged pool for internal processing — paging would be a regression for them, not
a feature; (b) `readDatasetRows`'s return shape (`JsObject{columns, rows}`) is a raw-cell
pass-through with no `id`/`seq`/`updatedAt`, used directly by `PipelineRowJson` parsing — changing
its shape would ripple through the pipeline engine, Spark submitter, and preview for no benefit to
them; (c) keeping the two paths fully separate makes "readDatasetRows is unaffected" (proposal
Non-goal, and the change's AC #4) true by construction, not by discipline.

### D2: Keyset (cursor-by-seq) pagination, not the existing offset-based `Page`/`PagedResult`
Query shape: `GET /api/data-sources/:id/rows?cursor=<seq>&limit=<n>` (both optional; no `cursor`
means start from the beginning; `cursor=0` is a valid value — see the round-2 correction below). The
repository query fetches `limit + 1` rows: `WHERE data_source_id = ? [AND seq > ?] ORDER BY seq ASC
LIMIT (limit + 1)` — using the existing `(data_source_id, seq)` index directly, no `OFFSET`. If
`limit + 1` rows come back, the extra row is trimmed and `nextCursor` is set to the last KEPT row's
`seq`; if `limit` or fewer rows come back, all are returned and `nextCursor` is **absent from the
response entirely** (round-2 correction to CR3 below — never a JSON `null`, since spray-json omits
`Option = None` fields rather than emitting `null`, and this endpoint's own AC #5 requires treating
absence, not nullness, as the wire signal). This `limit + 1` probe is what makes "no more rows
remain" exact at the boundary — a page that happens to end with precisely `limit` rows never
produces a `nextCursor` that only yields an empty page next.

**Round-2 correction (CR1): `cursor=0` is valid.** V106's backfill and both `appendRows`/
`replaceRows` number rows from `seq = 0`. The original draft rejected a `cursor` of exactly `0` as
invalid input; since `0` is a legitimate `seq` value (the first row's), this would have made
`nextCursor: 0` (a real, valid value emitted after a one-row-per-page first page) unusable on the
very next request. Validation is corrected to: `cursor`, if present, MUST be a non-negative integer
(`>= 0`); only a negative, non-numeric, or otherwise unparseable value is `400`.

**Round-2 correction (CR2, refined again in round 3): the precise stability guarantee.** The original
draft claimed "appended rows always land after existing ones" unconditionally, and round 2's fix
still overclaimed that a single-row append "can only ever land on a page not yet fetched" — false if
a row AT OR AFTER the caller's cursor is concurrently deleted: `appendRows` computes its new `seq` as
one greater than the source's CURRENT maximum at append time, so if the highest-`seq` row(s) at or
after the cursor were deleted first, a subsequent append can reuse a `seq` value AT OR BELOW the
caller's already-issued cursor — a row the caller's next request (`seq > cursor`) will never see. The
correct, precise claim: **every row that existed at the start of a paging session and is never
deleted during it is returned exactly once, in ascending `seq` order, regardless of concurrent
single-row appends.** This holds because (a) `deleteRow` never renumbers any OTHER row's `seq` — a
surviving row's `seq` never changes, so it can never be skipped or duplicated by the cursor; (b)
`patchRow` never changes a row's `seq` either (only `data`/`updated_at` — `DataSourceRepository
.scala:505-508`), so an edited row's position is equally stable. A row that is itself deleted during
paging is, correctly, never returned after its deletion — that is not a skip, it is the row no longer
existing. A newly appended row may land on an already-fetched page's cursor position only in the
narrow case just described (a concurrent delete freed up a low `seq` value); this is explicitly out
of scope for the "no skip, no duplicate" guarantee, which is stated only for rows present at the
START of paging. Paging is explicitly **not** guaranteed stable across a concurrent full replace
(`PUT .../rows` or a CSV refresh) — a replace atomically changes the entire row identity space,
renumbering everything from `0..N-1`. This is an accepted, explicit trade-off (see Risks/Trade-offs)
matching this ticket's own AC, which tests stability under concurrent single-row APPENDS specifically.

**Why not the existing offset-based `Page`/`PagedResult`?** `Page`/`PagedResult` is the right choice
for callers where the underlying set is effectively static per page-through (or staleness is
acceptable), because `OFFSET n` re-numbers every row after any concurrent insert/delete at a lower
position. For THIS endpoint the ticket's own AC requires paging stability specifically under
concurrent appends (mid-paging). A `seq`-keyset cursor is immune to that failure mode by
construction (per CR2 above), for the single-row-mutation case the AC actually tests. This is a
deliberate, self-approved divergence from the codebase's default pagination convention, recorded
here rather than left implicit.

### D3: Page-size cap — reuse `Page.MaxLimit` (500) as the ceiling, default 200
Rather than inventing a new constant, this reuses `Page.MaxLimit = 500` as the enforced ceiling and
`Page.Default.limit = 200` as the default when `limit` is omitted — the two existing pagination
tuning knobs, applied to this endpoint's own `limit` query parameter (not `Page`/`PagedResult`
themselves, which remain unused here per D2). A `limit` above 500 is clamped to 500, never rejected
with an error (matching the existing convention's own above-ceiling clamp-not-reject behavior) —
this alone guarantees the "10k-row dataset never returns unbounded" AC regardless of what the caller
requests. A `limit` that is non-numeric, negative, or exactly `0` IS rejected with `400 Bad Request`
before any DB call — this is a deliberate departure from `Page`'s own convention (which does not
document a floor), because a `limit` of `0` would return zero rows per page while still reporting
`nextCursor`/`total`, an infinite-loop trap for any caller paging in a `while (nextCursor != null)`
style; rejecting it outright is safer than silently coercing it to the default. `cursor`, if
present, must be a non-negative integer (`>= 0`, per D2's round-2 correction CR1 — `0` is a valid
`seq` value, not a sentinel for "unset"); a negative, non-numeric, or otherwise unparseable `cursor`
is `400 Bad Request` before any DB call, matching D6 below.

### D4: Response row shape reuses the EXISTING `RowResponseRow` type verbatim (round-2 correction: CR7)
Each listed row is exactly `RowResponseRow(id, seq, updatedAt, data)` (HEL-1078,
`DataSourceProtocol.scala:282`, `schemas/sources/row-response-row.schema.json`) — the original draft
wrongly proposed inventing a new type with identical fields. `RowResponseRow` already has `data`
(unlike `RowWriteRow`, which deliberately omits it), already uses the identical `updatedAt` wire
convention (`Instant.toString`, MICROS-truncated at write time, no custom formatter), and already has
an implicit `RootJsonFormat`. Reusing it means the round-trip into HEL-1078's `PATCH`/`DELETE`
precondition is guaranteed byte-for-byte by construction — literally the same type serializing the
same value the same way, not merely an equivalent one.

### D5: The source's declared schema is NOT included in this endpoint's response — this is a known,
explicit gap, not a solved problem (round-2 correction: CR4)
The original draft claimed HEL-1080 could fetch a dataset source's declared schema via "the existing
authenticated source GET" — **there is no such route.** `DataSourceRoutes.scala`'s
`path(DataSourceIdSegment)` block has only `patch`/`delete`; there is no `get`. Nor does any existing
response expose `DatasetFieldDeclaration` (the declared schema) — only `inferredSchema` (runtime,
observed column types) is ever returned, and it does not carry `required`/`default`/declared
`fieldType`. This ticket's own AC does not require exposing the declared schema, and this endpoint
adds none — the row-listing response carries only `id`/`seq`/`data`/`updatedAt` per row, matching
D4. **Explicitly out of scope for this ticket** (see the Non-Goals section above, restated here so
it is not silently assumed solved): HEL-1080's grid will need a way to fetch a dataset source's
declared schema, and none currently exists. This is recorded as a Risk below and should be raised as
a standalone follow-up ticket at Delivery (matching the exact precedent HEL-1078 set for THIS ticket
itself), not solved inside this change.

### D6: Checks run in the existing route-family order (D6 precedent from HEL-1078)
(1) malformed `cursor`/`limit` query parameter → `400`, before any DB call; (2) source doesn't exist
or isn't owned by the caller (ACL-scoped lookup, under `ctx.withUserContext`) → `404`; (3) source
kind isn't `dataset` → `400`; (4) success — page of rows, `nextCursor` (absent at end-of-set, D2),
`total`.

### D7: Two layers of existence check, exactly like `patchRow`/`deleteRow` — which layer does which
(round-2 correction: CR6, round-3 clarification)
There are TWO distinct 404 checks in this route family, at two different layers, and it matters
which is which:
- **Service layer** (`DataSourceService.listRows`, task 1.2): calls `dataSourceRepo.findByIdOwned(id,
  user)` — an explicit, APPLICATION-LEVEL query filtered by `owner_id`, the exact same call
  `appendRows`/`replaceRows`/`patchRow`/`deleteRow` already use for their own 404/kind-check. This is
  the check the HTTP route actually goes through, and it is why a non-owner's request 404s BEFORE
  any RLS policy on `dataset_rows` is ever consulted (relevant to task 4.4 below).
- **Repository layer** (`DataSourceRepository.listRows`, task 1.1): separately re-reads the source's
  `datasetSchema` column via `table.filter(_.id === sourceId.value).map(_.datasetSchema)
  .result.headOption`, under `ctx.withUserContext` (RLS-scoped) — the IDENTICAL pattern
  `patchRow`/`deleteRow` already use for their own internal `SourceNotFound`. Under RLS this query
  cannot distinguish "no such source exists at all" from "a source exists but RLS hides it" — and it
  should not try to: both cases collapse to the same `SourceNotFound` outcome, which is correct
  (HEL-1002: unauthorized and nonexistent return the identical shape). This is existing, accepted,
  intentional ambiguity-by-design in this route family, not a new problem this ticket introduces.
  This RLS-scoped repository-layer check is what task 4.4's RLS test calls DIRECTLY (bypassing the
  service's `findByIdOwned` filter) to prove RLS itself — not just the application-level owner
  filter — denies access to another owner's rows.

Once the source is confirmed to exist (service layer) and re-confirmed under RLS (repository layer),
the page query (`WHERE data_source_id = ? AND seq > ? ORDER BY seq LIMIT limit+1`) and the `total`
count (`SELECT COUNT(*) FROM dataset_rows WHERE data_source_id = ?`) run as two statements inside ONE
`DBIO` chain / one `ctx.withUserContext` transaction — same transaction, but **not** the same read
snapshot: `withUserContext` takes no isolation-level override, so this runs at Postgres's default
READ COMMITTED, where each statement within the transaction takes its own snapshot. A commit
landing between the page query and the `COUNT(*)` (e.g. a concurrent append or delete) can make
`total` reflect a different state of the table than the page just fetched. No row lock
(`lockSource`'s `FOR UPDATE`) is taken, since a listing read is not a writer and locking would
create needless contention against concurrent `PATCH`/`DELETE`/append/replace on the same source.
`total` reflects the count at the moment its own statement runs, not a value pinned for the
caller's whole paging session, and not even guaranteed consistent with the page fetched
immediately before it in the same request — a concurrent append/delete during paging (or between
the two statements) can change `total`. This is an accepted, stated trade-off (below), not a
defect: the AC's own concurrency requirement is about not skipping or duplicating SURVIVING rows
across pages (guaranteed by D2's cursor semantics), not about `total` staying fixed or
snapshot-consistent with any particular page.

## Risks / Trade-offs

- [`total` can change between page requests under concurrent writes] → Accepted (D7): the grid uses
  `total` for a progress indicator / "load more" affordance, not as a correctness invariant; row
  identity/no-skip/no-duplicate (the actual tested AC) is guaranteed independently by the `seq`
  cursor.
- [Diverges from the existing `Page`/`PagedResult` offset convention] → Accepted (D2): offset
  pagination's concurrent-mutation fragility is precisely the failure mode this ticket's own AC
  tests against; a cursor keyed on the already-unique, already-monotonic `seq` column is the
  cheaper-than-alternative, quality-bar-appropriate choice here, not a new general-purpose
  pagination primitive to migrate other listings onto.
- [No schema in the row-listing response, AND no existing route exposes the declared schema at all]
  → Accepted as an explicit, tracked gap (D5, round-2 correction: this is NOT solved by an existing
  route as the round-1 draft wrongly claimed). HEL-1080 will need a way to fetch a dataset source's
  declared schema; this ticket does not add one, matching its own AC scope. To be raised as a
  standalone follow-up ticket at Delivery (same precedent HEL-1078 set in filing THIS ticket).
- [Paging is not guaranteed stable across a concurrent full replace (`PUT .../rows` / CSV refresh)]
  → Accepted (D2 CR2): a full replace changes the entire row identity space; this ticket's AC tests
  stability under concurrent single-row appends specifically, not concurrent replaces.
