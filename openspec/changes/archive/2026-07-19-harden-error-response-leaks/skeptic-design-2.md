## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Round-1 gap closed as claimed.** `proposal.md`, `design.md`, `tasks.md` were
  revised to add `ApiRoutes.scala:161` (`GET /api/auth/me`) and `:193`
  (`PATCH /api/users/me/update`) to the fix scope. Re-read both files directly:
  ```
  backend/src/main/scala/com/helio/api/ApiRoutes.scala:161:
    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
  backend/src/main/scala/com/helio/api/ApiRoutes.scala:193:
    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
  ```
  Both are genuine unconditional `500` echoes of `ex.getMessage`, matching
  design.md's description; `ApiRoutes.scala` has no `LoggerFactory` import
  (confirmed via `grep`), matching the plan's premise. `tasks.md` §1.3/1.4 now
  cover both. Sound as far as it goes.

- **Primary OAuth leak and HEL-299 reference pattern re-confirmed**
  (`OAuthRoutes.scala:134`, `PipelineRunStreamRoutes.scala`'s
  `LoggerFactory`/`log.error(msg, ex)` pattern) — unchanged from round 1, still
  accurate.

- **Independently re-audited the whole backend for the same leak class, not
  just the files the design already names.** Ran
  `grep -rn "getMessage\|getLocalizedMessage" backend/src/main/scala/com/helio/`
  (unscoped — not limited to `routes/` or `api/`) and traced every hit that
  could reach an HTTP response body. This surfaced a scope the revised plan
  still misses entirely: **the `services/` layer, which bridges to HTTP
  responses via `ServiceResponse.completeError`** (`backend/.../api/routes/ServiceResponse.scala`):
  ```scala
  case ServiceError.InternalError(m) => complete(StatusCodes.InternalServerError, ErrorResponse(m))
  case ServiceError.BadRequest(m)    => complete(StatusCodes.BadRequest, ErrorResponse(m))
  ```
  This is the *actual* universal bridge from service-layer errors to client
  response bodies in the CS2b-era codebase — a `ServiceError` constructed
  anywhere in `services/` with a raw exception message embedded reaches the
  client exactly as if a route file had called `complete(...)` directly. The
  design's audit methodology (grep `getMessage` inside `routes/` files, plus
  manually adding `ApiRoutes.scala`) is structurally blind to this bridge.

  Concrete instance, traced end-to-end:
  - `backend/src/main/scala/com/helio/services/PipelineService.scala:408-422`
    (`classifyDbError`):
    ```scala
    private[services] def classifyDbError(ex: Throwable): ServiceError = ex match {
      case e: PSQLException =>
        val msg = Option(e.getMessage).getOrElse(e.getClass.getName)
        if (msg.contains("violates foreign key constraint")) ServiceError.NotFound(msg)
        else if (msg.contains("violates check constraint")) ServiceError.BadRequest(msg)
        else ServiceError.InternalError(msg)
      case other =>
        ServiceError.InternalError(Option(other.getMessage).getOrElse(other.getClass.getName))
    }
    ```
    Called from `addStep`/`updateStep` (`PipelineService.scala:264,270,313,338`),
    which are invoked by `PipelineStepRoutes.scala:27,40` via
    `ServiceResponse.run(pipelineService.addStep(...))` /
    `ServiceResponse.run(pipelineService.updateStep(...))`. The `case other`
    catch-all (line 421) unconditionally puts **any** non-`PSQLException`
    throwable's raw message into a `500 InternalServerError` body sent to the
    client — structurally identical to `OAuthRoutes.scala:134`, and reachable
    on every DB-backed pipeline-step create/update call. The `PSQLException`
    branches (413-419) also leak raw Postgres exception text (which can
    include constraint/table/column names) into `404`/`400` bodies — under the
    design's *own* stated rule ("if any wraps an exception that can embed
    internal/infra detail... it is fixed"), this qualifies.

  - `backend/src/main/scala/com/helio/services/PanelService.scala:219`:
    ```scala
    panelRepo.batchUpdate(items, now).map(...).recover { case ex => Left(ServiceError.BadRequest(ex.getMessage)) }
    ```
    Reachable via `PanelRoutes.scala:32`
    (`ServiceResponse.run(panelService.batchUpdate(...))`). This wraps a DB
    write failure (not a `Try(json.convertTo[...])` deserialization/validation
    failure like the already-audited `SourcePreviewRoutes`/`DataSourceRoutes`/
    `SourceRoutes` arms) — i.e. a genuine backend-operation failure, not
    user-input validation, misclassified as a safe `400`.

  I confirmed this is not a fluke by checking the call graph in both
  directions (service method → route file → `ServiceResponse` call), not just
  grepping in isolation.

- **`ServiceResponse.scala` and its `completeError` bridge did not exist (or
  wasn't in scope) when `PipelineRunStreamRoutes`/`OAuthRoutes` were originally
  written** — those files complete responses inline, which is why the design's
  route-file-grep approach worked for them but not for the CS2b service-backed
  routes (`PanelRoutes`, `PipelineStepRoutes`, etc.), which don't contain a
  literal `complete(..., ErrorResponse(ex.getMessage))` call site — the leak is
  one hop upstream, in the service layer.

- **Everything else re-checked from round 1 still holds**: the three already-
  scoped `4xx` audit files, the test-feasibility analysis (override hooks +
  logback `ListAppender`), and the spec delta's coherence. No new issues found
  there.

### Verdict: REFUTE

### Change Requests

1. **Broaden the audit methodology, not just the file list.** The plan's audit
   approach (grep `getMessage`/`getLocalizedMessage` inside `routes/`-style
   files) is blind to the CS2b service-layer bridge
   (`ServiceResponse.completeError` in `backend/.../api/routes/ServiceResponse.scala`,
   which turns `ServiceError.InternalError`/`BadRequest`/etc. constructed
   anywhere in `services/` directly into HTTP response bodies). Update
   `design.md`'s audit description to explicitly include: grep the same
   patterns across `backend/src/main/scala/com/helio/services/` (and confirm
   `domain/` doesn't feed a `ServiceError` or response body anywhere it
   currently doesn't), then trace each hit to confirm whether it's reachable
   from a route via `ServiceResponse`.

2. **Fix `PipelineService.classifyDbError`** (`services/PipelineService.scala:408-422`,
   used by `addStep`/`updateStep`, reachable via `PipelineStepRoutes.scala:27,40`).
   At minimum the `case other =>` arm (line 421, unconditional `InternalError`
   from any non-`PSQLException` throwable) must be fixed to the HEL-299
   pattern (log server-side, generic body) — it's a `500` leak of the exact
   same class as the OAuth leak. The two `PSQLException` branches (413-419,
   which echo raw Postgres exception text into `404`/`400` bodies) must be
   explicitly classified in the audit note per the design's own risk rule.

3. **Classify (and likely fix) `PanelService.scala:219`**
   (`ServiceError.BadRequest(ex.getMessage)` on a `panelRepo.batchUpdate` DB
   failure, reachable via `PanelRoutes.scala:32`) — this wraps a genuine
   backend operation failure, not user-input validation, and should not be
   waved through with the same "likely-safe `4xx` validation" reasoning
   applied to the `Try(json.convertTo[...])` arms in the three already-audited
   route files.

4. **Add `PanelService.scala:254`** (`IllegalArgumentException` from patch
   validation) to the audit note for completeness even if it's classified
   confirmed-safe, since it matches the grep pattern and the AC requires
   *every* route/arm to be listed with a decision.

5. **Update `tasks.md`** to add explicit audit/fix tasks for the
   `services/` layer (mirroring §2.1-2.3, scoped to `PipelineService.scala`
   and `PanelService.scala`) and, if `PipelineService.classifyDbError` is
   fixed, a task adding a `LoggerFactory` logger to `PipelineService` and a
   regression test on the `addStep`/`updateStep` DB-failure path analogous to
   task 3.2.

6. **Non-blocking, carry over from round 1:** `tasks.md`'s `openspec validate`
   invocation should use positional syntax
   (`openspec validate harden-error-response-leaks --strict`), not `--change`.

### Non-blocking notes

- The OAuthRoutes and ApiRoutes fix design (logger + `ErrorResponse("Internal
  server error")`, mirroring `PipelineRunStreamRoutes`) is sound and correctly
  scoped for the arms it does cover.
- The three already-scoped `4xx` audit files
  (`SourcePreviewRoutes`/`DataSourceRoutes`/`SourceRoutes`) are still correctly
  counted and their classification reasoning looks right.
- Test approach (override hooks + logback `ListAppender`) remains feasible
  with zero new dependencies.
