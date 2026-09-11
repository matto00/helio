## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `39576df8` (planning artifacts are uncommitted in the worktree: ticket.md, proposal.md,
design.md, tasks.md, specs/dataset-row-write-api/spec.md).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/row-edit-delete-precondition/HEL-1078`.
- **V106 schema** (`backend/src/main/resources/db/migration/V106__dataset_rows.sql`): `updated_at TIMESTAMPTZ NOT NULL`
  (not `timestamp`, which is what design.md D1 says); forced RLS `dataset_rows_owner` via an EXISTS join to
  `data_sources.owner_id`; `UNIQUE(data_source_id, seq)`.
- **`lockSource`** (`DataSourceRepository.scala:355-356`): `SELECT id FROM data_sources WHERE id = ? FOR UPDATE`,
  returns `DBIO[Unit]`. It does not fail or signal anything when the source is missing or foreign. It only
  locks the source row. It does not scope or look up any `dataset_rows` row.
- **`appendRows`/`replaceRows`** (`DataSourceRepository.scala:366-469`): both take one `updatedAt: Instant` for
  every row. Not-found is signalled by `datasetSchema...headOption == None` after the lock.
- **What precision writers actually use** (`DataSourceService.scala:744, 774, 794`): every row writer passes
  `Instant.now().truncatedTo(ChronoUnit.MICROS)`. The comment there says why: "Postgres' `timestamp` column
  stores microsecond precision, but JDK 21's `Instant.now()` carries nanosecond precision; without truncating,
  the in-memory value handed to `RowWriteResponse.fromDomain` disagrees with what a subsequent read ... returns"
  (this was HEL-1077's skeptic-final-1 CR1).
- **How `updatedAt` goes on the wire** (`DataSourceProtocol.scala:255-269`): `RowWriteRowResponse.updatedAt` is a
  `String` built with `r.updatedAt.toString`. I grepped `JsonProtocols.scala` and all of `api/` for an Instant
  formatter / `ISO_INSTANT` / `JsonFormat[Instant]` and found **none**. `Instant.toString` prints as many
  fractional digits as the value needs (3, 6 or 9), so a MICROS-truncated instant goes out with microsecond digits.
- **Row read paths:** `readDatasetRows` (`DataSourceRepository.scala:476-495`) returns `{columns, rows}` with the
  raw `data` arrays only. There is no row `id`, `seq` or `updatedAt`. The only `.../rows` routes are `POST`/`PUT`
  (`DataSourceRoutes.scala:116-128`). **No `GET` anywhere returns a row's id or updatedAt.**
- **`DatasetRowValidator.validateRow`** (`DatasetRowValidator.scala:117-140`): if a cell is `JsNull`, it is filled
  from the field's `default` when there is one. Otherwise a required field gives `"required"` and an optional one
  stays `JsNull`. A row shorter than the declaration is accepted (missing cells are read as `JsNull`). Only a
  longer row is rejected.
- **Conflict mapping:** `ServiceError.Conflict` exists (`ServiceError.scala:23`) and maps to 409
  (`ServiceResponse.scala:81`). Confirmed.
- **RLS harness:** non-superuser RLS specs exist (`RlsOwnerTablesSpec.scala`, `RlsSharingAwareTablesSpec.scala`),
  so the test in task 5.8 can be built.
- **Design spec** (`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md:125-127, 152-155`):
  it frames the precondition as "`WHERE id = ? AND updated_at = ?`" on a row identity. It does not give any
  ticket ownership of a read API that returns row ids. HEL-1080 (Linear, Backlog) is the grid UI, and its AC
  assumes rows can be read with identity but does not own a backend read endpoint.

### Verdict: REFUTE

Three of the load-bearing decisions (D1, D4, D5) do not match the code, and one of them would ship a
cross-source write bug.

### Change Requests

1. **D1 / proposal "What Changes": the conditional statement must be scoped to the source. As written, it
   allows cross-source writes.** Proposal and D1 both give the mutation as `WHERE id = ? AND updated_at = ?`.
   `lockSource(sourceId)` locks only the `data_sources` row. It does not constrain which `dataset_rows` row the
   UPDATE/DELETE hits. RLS only scopes by owner. So `PATCH /api/data-sources/A/rows/<rowId-of-B>` by an owner of
   both A and B would change B's row. It would do this under A's lock, without holding B's lock, while
   validating against A's schema and recomputing A's `inferred_schema`. That breaks the spec's own 404
   scenario ("belongs to a different source"). Required fix: make the predicate
   `WHERE id = ? AND data_source_id = ? AND updated_at = ?` everywhere (proposal, D1, spec requirement text,
   tasks 1.1/1.2). Add a same-owner, different-source test to task 5.6 that asserts 404 **and** that B's row is
   unchanged. The current 5.6 would pass against the buggy WHERE if it only tests a nonexistent id.

2. **D4 is factually wrong and gets the key requirement backwards.** D4 says `JsonProtocols`'s `instantFormat`
   uses `ISO_INSTANT` and emits no sub-millisecond digits, and that every writer sends millisecond instants.
   None of that is in the code. There is no Instant JSON formatter. The wire value is `Instant.toString`, and
   every writer truncates to **MICROS** (`DataSourceService.scala:744/774/794`). The conclusion ("safe") only
   holds if this change's new writers also truncate to MICROS. D4 never says so, and task 1.1/1.2's
   `newUpdatedAt` doesn't either. If an executor follows D4's millisecond reasoning, or passes a raw
   `Instant.now()` (nanoseconds), it recreates HEL-1077's CR1 defect: the PATCH response's `updatedAt` won't
   match the stored value, and the client's very next edit gets a spurious 409. Required fix: rewrite D4 from
   the real code. The column is TIMESTAMPTZ with microsecond storage, the wire is `Instant.toString`, and the
   parse is `Instant.parse`. Make `Instant.now().truncatedTo(ChronoUnit.MICROS)` a stated requirement for
   `patchRow`/`deleteRow`, and cite the existing sites. Also state how pre-V106 backfilled rows behave: their
   `updated_at` was copied from `data_sources.updated_at`, which older writers set untruncated, and Postgres
   rounded that to microseconds on store. Explain why a value the client got from a response or read still
   compares equal. Also fix D1's "Postgres `timestamp` column" wording to TIMESTAMPTZ.

3. **D5 and D1 contradict each other on DELETE, so the 404-vs-409 split can't be implemented as specified.**
   D1 says the 0/1 affected-row count from one conditional statement is "the ENTIRE precondition check" with
   "no separate `SELECT`". But a 0 count can't tell "row doesn't exist in this source" (404) from "row exists
   and is stale" (409). D5 then says a row lookup happens first "via the same RLS-scoped join `lockSource`
   already establishes indirectly". `lockSource` does no row lookup at all (see evidence), so that sentence
   describes a mechanism that doesn't exist. Task 1.2 (DELETE) has no existence step, yet task 1.3 requires a
   3-way result. Required fix: state the actual mechanism for both verbs. For example: after `lockSource`,
   re-read the source schema (as append/replace do; `None` means source 404). Then read the row with
   `WHERE id = ? AND data_source_id = ?` (0 rows means 404). Then run the conditional mutation (0 rows means 409).
   Or: on a 0-row mutation, run a follow-up existence probe. Then fix the D1 rationale to match (see CR4).

4. **The D1 "no separate read" rationale is wrong, and the spec's SHALL can't be met.** D2 requires PATCH to
   read the row's current `data` inside the transaction before the conditional update, because the merge needs
   it. The spec requirement says the write is applied "in a single conditional statement with no separate read
   before the write". That can't be true for PATCH. Once CR3 is fixed it isn't true for DELETE either. What
   actually closes the read-then-write race here is `lockSource`: every `dataset_rows` writer
   (`appendRows`, `replaceRows`/refresh, and now `patchRow`/`deleteRow`) serializes on the same `FOR UPDATE`.
   The conditional `updated_at` predicate is defense in depth plus the stale-client check. Required fix:
   rewrite D1 and the spec requirement text so they describe that real invariant. Something like: "the
   precondition is evaluated and the write applied inside one transaction holding the source's `FOR UPDATE`
   lock; the mutation statement itself also carries the `updated_at` predicate". Also list every writer that
   must take the lock, so a future writer that skips `lockSource` is recognisable as a regression.

5. **There is no read path for a row's `id`/`updatedAt`. D4 and task 5.9 depend on a `GET` that doesn't
   exist.** D4 says a client holds `updatedAt` "as READ BACK through a prior `GET`/`POST`/`PUT .../rows`
   response". No `GET` returns row identity, and `readDatasetRows` drops id/seq/updatedAt. Task 5.9 says
   "`GET`/read its `updatedAt` back through the API". The ticket describes the precondition as the row's
   "last-read `updatedAt`", and HEL-1080's grid must list rows with ids to PATCH/DELETE them at all. Required
   fix: make an explicit decision. Either (a) add `GET /api/data-sources/:id/rows` that returns
   `{id, seq, data, updatedAt}` per row to this change, with a spec requirement, OpenAPI entry and tests,
   because the precondition contract is only half-usable without it. Or (b) state explicitly that this change
   exposes row identity only through write responses, and name the ticket that owns the read endpoint (file a
   spinoff if none exists). In either case, rewrite task 5.9 to round-trip through a route that actually
   exists: e.g. the `updatedAt` string from a `POST .../rows` response goes into PATCH, and the PATCH
   response's `updatedAt` goes into a second PATCH/DELETE. That second hop is what catches the CR2 truncation
   bug.

6. **With `null` meaning "unchanged" for every column, an optional cell can never be cleared, and D2 doesn't
   confront this.** The spec says a `null` entry means "leave this column's current value unchanged" with no
   distinction between required and optional columns. So a grid user can't clear an optional cell back to
   null. The "required column cannot be cleared" scenario suggests an optional one could be, which is
   ambiguous. Required fix: decide and write down one of: (i) clearing an optional cell is unsupported in v0.8
   (named Non-Goal, with the grid consequence noted for HEL-1080); (ii) a distinct wire encoding for "clear",
   e.g. an object-keyed `{"set": {...}, "clear": [...]}` or a sentinel; or (iii) PATCH carries the full row,
   and `null` means null subject to the validator's required/default rules. Option (iii) also removes the
   merge-read ambiguity. The design's own Risks section says to escalate rather than guess. If the planner
   can't choose on its own authority, raise it as an ESCALATION.

7. **The merge semantics against the validator's default-filling are unspecified.** `validateRow` replaces any
   `JsNull` cell that has a `default` with that default, and it accepts a row shorter than the declaration.
   So (a) PATCHing column A on a row whose optional column B is stored `null` but now has a default will
   silently write B's default, and (b) `data[i].getOrElse(current[i])` in D2 will throw on a stored row that is
   shorter than the current declaration unless it uses `lift`. Required fix: define the merge as
   `current.lift(i)` padding, and say whether validator default-filling of untouched columns during PATCH is
   intended. Also say what a `data` array shorter or longer than the declaration does. The spec says "same
   length", but the validator accepts shorter.

8. **The response contract is ambiguous. Pin it down before implementation.**
   - PATCH: planner notes say "reuses HEL-1077's `{id, seq, updatedAt}` shape plus PATCH's merged `data`". HEL-1077's
     `RowWriteResponse` is `{rows: [...], updatedAt: <source>}` and deliberately omits `data`. Specify the
     exact JSON: is it wrapped in `rows: [one]`, does it include the source-level `updatedAt`, and is `data`
     included? Task 2.3 says "reuse `RowWriteResponse`'s per-row shape", which conflicts with the spec's
     "merged `data`".
   - DELETE: the spec says "200/204". Pick one, and if 200, give the body.
   - Malformed or missing `updatedAt` (body or query param) is unspecified. State that it's a 400 and that the
     check runs before any lock or write.
   - Spec DELETE requirement says "query parameter or request body field", but D3 decided query param. Make
     the spec normative on the query param.

9. **The precedence order is incomplete.** D5 puts the kind check (400) "before either" 404 or 409. But the
   existing service pattern (`DataSourceService.appendRows:767-781`) runs `findByIdOwned` first, so a missing
   or foreign source is 404 **before** the kind check. State the full order explicitly: source 404, then kind
   400, then request validation 400, then row 404, then precondition 409, then schema-validation 400. Also say
   whether a schema-invalid PATCH on a stale row returns 409 or 400. D2 says validation happens before the
   conditional update, which would make it 400 and leak nothing, but the spec should say so.

### Non-blocking notes

- `data_sources.updated_at` is bumped by patch/delete (D6), and `DataSourceRepository.update`
  (rename) writes it with untruncated `Instant.now()` (`DataSourceService.scala:562`). It isn't row-level, so it
  doesn't affect the precondition, but it's worth knowing.
- Task 5.10 (concurrent appends) is correctly framed as a real concurrent test. Require it to use a
  `Future.sequence` or barrier over two independent requests against the real DB, and to assert both seqs
  land and are distinct. `UNIQUE(data_source_id, seq)` combined with `lockSource` is the guarantee being
  proven.
- Audit events: `appendRows`/`replaceRows` emit `data_source.rows.append`/`.replace`. D-level text should say
  whether patch/delete emit `data_source.rows.patch`/`.delete`, for parity with the "no forked logic" AC.
- The `frontend/src/services/` task (4.1) is fine to keep, but it has no consumer until HEL-1080.
