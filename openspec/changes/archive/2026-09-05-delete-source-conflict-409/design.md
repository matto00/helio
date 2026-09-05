## Context

`DELETE /api/data-sources/:id` currently returns a bare 500 for a source that is a pipeline's sole
root. The root cause was **confirmed by probe before this design was written** (see `probe.md`),
and it is *not* the FK violation the ticket hypothesized.

### Probe result (ground truth, do not re-derive)

Against the dev Postgres, in `BEGIN ... ROLLBACK`, with `app.current_user_id` set exactly as
`DataSourceRepository.delete` -> `ctx.withUserContext` sets it:

```
DELETE FROM data_sources WHERE id = '244afb1e-95f0-4eb7-a12d-870bef80cece';

ERROR:  HEL-913: this delete would leave pipeline(s) [6ed5cef5-117b-44d4-9784-6268152bc4d9] with
        zero roots (R1 violation) -- remove the pipeline itself instead of its last root, or add
        another root first
CONTEXT:  PL/pgSQL function hel913_prevent_zero_root_pipelines() line 11 at RAISE
```

That is a plpgsql `RAISE EXCEPTION` — **SQLSTATE `P0001` (`raise_exception`)** — from
`V99__prevent_zero_root_pipelines.sql`. It is **not** a foreign-key violation (`23503`), and it
cannot be: both data-source FKs are `ON DELETE CASCADE` (`V22__pipelines.sql:4`,
`V98__pipeline_roots.sql:81`). The exception surfaces as a raw `PSQLException` from
`DataSourceRepository.delete` (a bare `table.filter(...).delete`, no error mapping), escapes
`DataSourceService.delete`, and `ServiceResponse.runNoContent` renders it as a 500.

This also explains the production signature: the trigger fires only when the cascade empties a
**still-existing** pipeline's roots, so only sole-root sources fail and every other source in the
same sweep deletes cleanly.

## Goals / Non-Goals

**Goals**
- Return a structured 409 naming the blocking pipeline instead of a 500.
- Log the underlying cause server-side; keep the client body non-leaky.
- Cover the path with a regression test demonstrated red before the fix.

**Non-Goals**
- Changing behavior for a source that is one of *several* roots (HEL-989 owns that).
- Making the `V99` trigger RLS-independent (HEL-974 owns that).
- Any database migration. None is required, and the shared dev Postgres has two concurrent runs
  (HEL-983, HEL-985) on it.

## Decisions

### Decision 1: Conflict scope is sole-root-only, not any-reference

**Decided by the product owner via escalation** (recorded `escalation.answered`, HEL-987).

The 409 fires exactly when the delete would leave a pipeline with zero roots. The alternative —
409 whenever *any* pipeline references the source, mirroring
`WorkspaceTeardownRepository.sourceDependentPipelineConflict` — was considered and **rejected**:
it would convert multi-root source deletes that succeed today into 409s, a breaking API change,
and it bundles a genuine product decision into a bug fix. The adjacent silent-panel-loss risk on
the multi-root path is filed as **HEL-989** (Medium) and is out of scope here.

Consequence for implementers: the dependent query MUST be a *sole-root* query
(`... GROUP BY pipeline_id HAVING count(*) = 1`, or equivalent `NOT EXISTS` on a sibling root),
**not** the teardown query, which matches any referencing pipeline. Reusing
`sourceDependentPipelineConflict` verbatim would silently implement `any-reference` and violate
this decision.

### Decision 2: Pre-check in the service, with a defensive error mapping behind it

Detect the conflict with an explicit query *before* issuing the delete, and return
`ServiceError.Conflict`. Rationale: it produces a good message naming the specific pipeline(s),
and it avoids relying on parsing driver exception text for the normal path.

But the pre-check and the delete are not atomic — a concurrent writer could remove the pipeline's
other root in between. So the delete call ALSO maps a raised `P0001` carrying the
`hel913_prevent_zero_root_pipelines` signature to the same `ServiceError.Conflict`. Two layers,
because the pre-check gives the good message and the mapping gives the guarantee. Neither alone
is sufficient: pre-check alone can still 500 under a race; mapping alone yields a worse message.

Match the raised exception on **SQLSTATE `P0001` plus the function/message signature**, never on
message text alone.

### Decision 3: Structured body, carried by a wrapper type — NOT by `ServiceError.Conflict`

**Revised after design gate round 1 (skeptic-design-1.md CR1), which correctly found the original
text specified an impossible carrier.**

The 409 body carries `resourceKind` / `resourceId` / `resourceName` / `reason` — the same four
fields as `TeardownConflictResponse` — plus a `message` field (see below), so a client can handle
this conflict and the teardown conflict uniformly.

`ServiceError.Conflict` is `final case class Conflict(message: String)`
(`services/ServiceError.scala:23`), and that variant set is deliberately a small closed set. Four
fields cannot travel in it. **Option (a) is chosen: a wrapper result type**, mirroring the
`AuthoringError` precedent exactly rather than only citing it:

- Introduce `DataSourceDeleteError(conflict: Option[DataSourceDeleteConflict], err: ServiceError)`
  in the sources service package, where `DataSourceDeleteConflict` carries the four fields.
- `DataSourceService.delete`'s signature changes from `Future[Either[ServiceError, Unit]]` to
  `Future[Either[DataSourceDeleteError, Unit]]`. This is a real signature change — update every
  caller.
- The route replaces `ServiceResponse.runNoContent` with a bespoke completion that pattern-matches
  exactly as `DashboardAuthoringRoutes.completeAuthoring` does: a `conflict = Some(c)` renders the
  structured body, a `conflict = None` renders the pre-existing bare `ErrorResponse(err.message)`
  unchanged (so 404/403 on this route keep today's shape). **Both branches** call
  `ServiceResponse.statusCodeFor(err)` — the status-code switch is never duplicated.

**Explicitly rejected: option (b)**, adding a new four-field `ServiceError` variant. It widens a
deliberately closed, HTTP-agnostic error set to carry one route's body shape.

**Explicitly forbidden: the third reading** the original text accidentally permitted — packing all
four fields into the `Conflict(message: String)` string. It satisfies the old wording literally
while violating the spec's field-level body assertions. Do not do this.

### Decision 3a: The body also carries a `message` field

From skeptic-design-1.md's non-blocking note, adopted as binding. `TeardownConflictResponse` is
exactly four fields, but generic clients — the frontend axios error path, and the MCP tool whose
failure filed this ticket — read `error.response.data.message`. A four-field-only body gives them
`undefined` and an empty rendered reason, which is a milder replay of the original complaint.

So the response body is the four teardown-compatible fields **plus** `message`, set to the same
human-readable text as `reason`. Additive: a client reading the teardown four still works
unchanged, and a generic client reading `message` gets something useful.

## Risks / Trade-offs

- **Risk: implementing `any-reference` by accident** by reusing the teardown query. Mitigated by
  Decision 1's explicit note and by a test asserting a multi-root source still deletes with 204.
- **Risk: the pre-check query reads through RLS.** It runs under `withUserContext` like the
  delete, so it sees the caller's own pipelines. A pipeline owned by *another* user cannot bind to
  this user's source under the existing ACL, so this is not a visibility hole — but the delete-time
  mapping in Decision 2 is the backstop if that assumption ever decays. This is the same class of
  trap `V40` and the `V99` header comment both document; it is why Decision 2 has two layers.
- **Trade-off: one extra query per delete.** Negligible against a single-resource DELETE.
- **Known, accepted, pre-existing: the backing file is deleted before the row.**
  `DataSourceService.delete` runs `deleteFileF` before `dataSourceRepo.delete`. The pre-check
  (Decision 2) MUST sit **before** `deleteFileF`, so the ordinary rejected delete no longer
  destroys the file — that is task 3.4. But Decision 2's race path is not covered: if the
  pre-check passes and the trigger then raises, the file is already gone while the row survives,
  leaving a source pointing at nothing. This is **pre-existing** — today's 500 leaves exactly the
  same wreckage — so it is not a regression introduced here and is not in scope. Raised by
  skeptic-design-1.md; recorded here rather than left silent. If it needs owning, it is a spinoff,
  not a fold-in.
