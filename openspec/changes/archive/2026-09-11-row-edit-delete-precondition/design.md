## Context

HEL-1077 shipped `DataSourceRepository.lockSource` (`SELECT id FROM data_sources WHERE id = ? FOR
UPDATE`, RLS-scoped), `appendRows`, and `replaceRows`. `lockSource` locks only the `data_sources` row
— it does not look up or scope any `dataset_rows` row. `dataset_rows` (V106) has
`id, data_source_id, seq, data, created_at, updated_at TIMESTAMPTZ NOT NULL`, forced RLS via an
`EXISTS` join to `data_sources.owner_id`, and `UNIQUE(data_source_id, seq)`. Every existing row
writer (`DataSourceService.scala:744, 774, 794`) passes `Instant.now().truncatedTo(ChronoUnit.MICROS)`
— not milliseconds — because Postgres stores `TIMESTAMPTZ` at microsecond precision and JDK 21's
`Instant.now()` carries nanoseconds; skipping the truncation makes the in-memory value disagree with
what a subsequent read returns (this was HEL-1077's own skeptic-final-1 CR1). There is **no**
`JsonFormat[Instant]` anywhere in `JsonProtocols`/`api/` — the wire value is `r.updatedAt.toString`
(`DataSourceProtocol.scala:255-269`), parsed back with `Instant.parse`. `DatasetRowValidator
.validateRow` (`DatasetRowValidator.scala:117-140`) fills a `JsNull` cell from the field's `default`
when one exists, treats `JsNull` on a required field with no default as an error, and accepts a row
shorter than the declaration (missing trailing cells read as `JsNull`); only a longer row is rejected.
There is no `GET` route that returns a row's `id`/`seq`/`updatedAt` — `readDatasetRows`
(`DataSourceRepository.scala:476-495`) returns only `{columns, rows}` raw cell data. `ServiceError
.Conflict` already maps to `409` (`ServiceResponse.scala:81`); RLS-scoped not-found already returns
`404`, never `403`, across this route family (HEL-987 precedent); `DataSourceService.appendRows`
(`:767-781`) runs the ACL-scoped source lookup (404) before the kind check (400) — the same order
this change follows.

**Design-gate round 1 (skeptic-design-1.md) found the initial draft's D1/D4/D5 did not match this
code** — in particular, a `WHERE id = ? AND updated_at = ?` predicate with no `data_source_id` would
let an owner of two sources edit source B's row through source A's URL. This revision corrects all
nine change requests; see "Round-2 corrections" callouts below at each affected decision.

## Goals / Non-Goals

**Goals:**
- `PATCH`/`DELETE .../rows/:rowId` guarded by an `updated_at` precondition, scoped to the correct
  source, with no read-then-write race.
- Reuse `lockSource`, `DatasetRowValidator`, ACL/kind checks verbatim — no forked logic.
- `updated_at`/`inferred_schema` never left stale after a successful edit or delete.

**Non-Goals:**
- Bulk/multi-row PATCH or DELETE.
- Auto-running downstream pipelines on edit/delete (HEL-1091 epic).
- A row-listing `GET` endpoint (see proposal.md's Non-goals — filed as a spinoff at Delivery).
- Clearing an optional cell back to `null` via a sparse/partial update — see D2: PATCH is a full-row
  replace, so a caller wanting to clear an optional cell sends `null` for it explicitly in the full
  row it submits.

## Decisions

### D1: Source lock + row-and-source-scoped conditional predicate (round-2 correction: CR1, CR4)
`patchRow`/`deleteRow` first call `lockSource(sourceId)` — the same `FOR UPDATE` lock
`appendRows`/`replaceRows` already take — which is what actually serializes every writer to this
source's rows against every other (this is the real concurrency invariant; the `updated_at` predicate
below is the stale-client check on top of it, not a substitute for the lock). Every conditional
mutation statement this change adds is scoped `WHERE id = ? AND data_source_id = ? AND updated_at = ?`
— **always including `data_source_id`**, so a `rowId` belonging to a different source than the URL's
`:id` can never match, regardless of `updated_at`. (Round-1 draft omitted `data_source_id`, which
would have let an owner of two sources edit source B's row through source A's URL, under A's lock,
validated against A's schema.)

### D2: PATCH is a full-row replace, not a sparse/merge update (round-2 correction: CR6, CR7)
`{"updatedAt": "<iso8601>", "data": [<cell>, ...]}` — `data` is the row's complete new value, same
length/order as the source's declared columns, validated via `DatasetRowValidator.validate` exactly
as append/replace validate a row, with no merge against the row's current stored value. This removes
three round-1 problems at once: (a) it makes "clear an optional cell" well-defined — send `null` for
it, same as the validator already treats `null` on optional/defaulted fields; (b) it removes the
`current.lift(i)` merge-padding ambiguity entirely, since there is no merge; (c) it means validation
runs against exactly what the caller submitted, with no silent default-filling of columns the caller
didn't intend to touch. Trade-off, stated explicitly: a client must submit the full row (having read
it via a prior write response), not just the one cell it changed — acceptable because HEL-1080's grid
already holds the full row client-side to render it.

### D3: DELETE precondition is a query parameter, not a body
`DELETE /api/data-sources/:id/rows/:rowId?updatedAt=<iso8601>` — a `DELETE` with a body is legal HTTP
but poorly supported by some clients/proxies; a query parameter carries this route's one scalar value
more portably. A missing or unparseable `updatedAt` (query param for DELETE, body field for PATCH) is
a `400 Bad Request`, checked before `lockSource` is ever acquired (D7).

### D4: Precision — every new writer truncates to MICROS; the wire format is `Instant.toString`
(round-2 correction: CR2) There is no custom Instant JSON formatter in this codebase. The wire value
is `Instant.toString` (variable fractional digits), parsed back with `Instant.parse`. The column is
`TIMESTAMPTZ`, storing microsecond precision. Every existing row writer already truncates to
microseconds before use (`Instant.now().truncatedTo(ChronoUnit.MICROS)`,
`DataSourceService.scala:744/774/794`) specifically so the in-memory value used to build a response
matches what a subsequent read returns. `patchRow`/`deleteRow`'s `newUpdatedAt` MUST use the same
truncation — this is a stated requirement, not left to inference, because skipping it silently
reproduces HEL-1077's own already-fixed CR1 defect (the response's `updatedAt` would not equal the
stored value, so the client's very next edit gets a spurious 409). A precondition value the client
holds came from a prior write response (`POST`/`PUT`/`PATCH .../rows`), which is itself
MICROS-truncated by the same convention — so comparing it against the stored column value is safe
by construction, not by a claim about JSON formatting precision. (Round-1's D4 wrongly asserted an
`ISO_INSTANT`/millisecond-truncation convention that does not exist in this codebase — corrected here
from the actual call sites.)

### D5: 404-vs-409 mechanism, stated explicitly (round-2 correction: CR3)
Inside `lockSource`'s transaction: (1) re-read the source's `datasetSchema` column — `None` means the
source itself doesn't exist (404, same as `appendRows`/`replaceRows`); (2) read the target row via
`WHERE id = ? AND data_source_id = ?` — zero rows means the row doesn't exist under this source (404,
covers both "never existed" and "belongs to a different source"); (3) only once the row is confirmed
to exist does a mismatched `updatedAt` on the conditional mutation (0 affected rows) mean `409`. Step
2's read is real and necessary — for PATCH it also supplies the row's existence check before
validation runs; DELETE needs it too, since a conditional `DELETE` with 0 rows affected cannot by
itself distinguish "didn't exist" from "existed but was stale" (round-1 assumed it could). What "no
separate read before the write" (round-1's spec wording) actually meant, corrected: there is no
separate READ-MODIFY-WRITE cycle on the row's *data* — no code path reads a row's data, computes a
new value outside the transaction, and writes it back hoping nothing changed. The existence check in
step 2 is a lookup, not a data mutation basis, and happens under the same lock as the mutation itself.

### D6: Precedence order, fully stated (round-2 correction: CR9)
For both routes: (1) malformed/missing `updatedAt` → `400`, before any DB call; (2) source doesn't
exist or isn't owned by caller → `404` (existing ACL-scoped lookup, unchanged from append/replace);
(3) source kind isn't `dataset` → `400`; (4) row doesn't exist under this source (D5 step 2) → `404`;
(5) PATCH only: submitted row fails `DatasetRowValidator` → `400` (checked before the conditional
mutation runs — a schema-invalid PATCH on a stale row is `400`, not `409`: validation happens first
per this ordering, so precondition status is never disclosed for an invalid payload); (6) precondition
mismatch (D5 step 3) → `409`; (7) success.

### D7: `inferred_schema` recomputed after PATCH and DELETE, same computation as append/replace
Reuses the exact `PipelineRowJson.staticColumnRuntimeType` column-wise computation already inlined in
`appendRows`/`replaceRows` — read the full post-write row set inside the same transaction, recompute,
persist alongside the row mutation and the source's `updated_at` bump, in one `DBIO` chain.

### D8: Response shape, pinned (round-2 correction: CR8)
**PATCH success (200):** `{"id": "...", "seq": <int>, "updatedAt": "<iso8601>", "data": [<cell>, ...]}`
— the single edited row, including its (now full, post-replace) `data`, plus the source-level
`updatedAt`: `{"row": {...above...}, "sourceUpdatedAt": "<iso8601>"}`. This is a new response type
(`RowResponse`), not a reuse of `RowWriteResponse` (which wraps a `rows` array and omits `data` by
design, per HEL-1077 D6) — task 2.3 is corrected to introduce this new type rather than force-fit the
existing one. **DELETE success:** `204 No Content`, no body — nothing meaningful to return, and this
avoids inventing a body shape for a route that removes data. **Errors:** existing `ErrorResponse`
conventions unchanged; `409` body names the row id and both the expected and current `updatedAt` (no
row data disclosed beyond what the caller already sent).

## Risks / Trade-offs

- [`lockSource` on every single-row edit adds latency under heavy same-source concurrent editing] →
  Accepted, matches HEL-1077's already-accepted trade-off for append/replace; same single-owner
  contention argument applies unchanged.
- [PATCH requires the full row, not just the changed cell] → Accepted per D2; HEL-1080's grid already
  holds the full row to render it, so this adds no new round-trip for that consumer.
- [No row-listing `GET` in this change] → HEL-1080 needs one to know which `rowId`/`updatedAt` to
  send. Tracked as a Non-Goal + spinoff ticket (proposal.md), not silently left implicit.

## Planner Notes

- DELETE precondition as a query param rather than `If-Match`/`If-Unmodified-Since` headers
  (self-approved): simpler to test, consistent with this route family's existing lack of conditional
  headers.
- PATCH as full-row replace rather than a sparse/merge update (self-approved, per D2): removes a
  genuine product ambiguity (clearing an optional cell) the design-gate skeptic correctly flagged as
  needing an explicit decision rather than a guess; this is a reversible, additive API shape choice
  scoped entirely to this new route, not a breaking change to anything shipped.
- New `data_source.rows.patch`/`data_source.rows.delete` audit events, for parity with
  `.append`/`.replace` (non-blocking note from skeptic-design-1.md) — added to tasks.md.
