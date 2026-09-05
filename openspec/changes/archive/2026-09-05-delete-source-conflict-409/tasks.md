## 1. Reproduce (red first)

- [x] 1.1 Re-run the probe in `probe.md` yourself against the dev Postgres to confirm the
      `P0001` / `hel913_prevent_zero_root_pipelines` root cause still holds on this branch. Do not
      take it on faith, and do not re-derive the refuted FK theory.
- [x] 1.2 Write a backend test that calls the delete path for a source that is a pipeline's sole
      root and asserts **409** with the structured body. Run it and **capture the red output**
      (it must fail as a 500 / unhandled exception before any fix). Paste that red run into the
      commit or the change dir — a test that was never seen red is not a regression test.
- [x] 1.3 Write the two control tests: a source that is one of several roots deletes with 204, and
      an unreferenced source deletes with 204. These guard Decision 1 against an accidental
      `any-reference` implementation.

## 2. Repository

- [x] 2.1 Add a sole-root dependent query to `DataSourceRepository` returning the blocking
      pipelines' `(id, name)` for a given source id. It MUST match only pipelines for which this
      source is the **only** root. Do **not** reuse
      `WorkspaceTeardownRepository.sourceDependentPipelineConflict` — that one matches any
      referencing pipeline and would silently implement the rejected `any-reference` scope.
- [x] 2.2 Run it under `ctx.withUserContext(user.id.value)`, consistent with the existing
      `delete`.

## 3. Service

- [x] 3.1 Introduce the wrapper carrier (design Decision 3, option (a) — NOT
      `ServiceError.Conflict`, which is `Conflict(message: String)` and cannot hold four fields):
      `DataSourceDeleteConflict(resourceKind, resourceId, resourceName, reason)` plus
      `DataSourceDeleteError(conflict: Option[DataSourceDeleteConflict], err: ServiceError)`,
      mirroring `AuthoringError`. Change `DataSourceService.delete` to return
      `Future[Either[DataSourceDeleteError, Unit]]` and update every caller.
- [x] 3.1a In `DataSourceService.delete`, call the sole-root query **before** `deleteFileF` (see
      3.4); on a non-empty result return the conflict with `reason` naming the blocking
      pipeline(s) by name and id. Do NOT pack the four fields into a message string.
- [x] 3.2 Add the defensive mapping behind it (design Decision 2): a delete failure whose cause is
      SQLSTATE `P0001` **and** carries the `hel913_prevent_zero_root_pipelines` signature maps to
      the same conflict. Match on SQLSTATE plus signature, never message text alone.
- [x] 3.3 Log the underlying cause once at WARN with the source id. Keep the client-facing body
      free of SQLSTATE, driver text, and the raw trigger message.
- [x] 3.4 The pre-check MUST run **before** `deleteFileF`, so a rejected delete no longer destroys
      the source's backing file. (The Decision-2 race path — pre-check passes, trigger then raises,
      file already gone — is pre-existing and explicitly out of scope; see design Risks.)

## 4. Route / protocol

- [x] 4.1 Replace `ServiceResponse.runNoContent` on this route with a bespoke completion
      mirroring `DashboardAuthoringRoutes.completeAuthoring`: `conflict = Some(c)` renders the
      structured body; `conflict = None` renders the pre-existing bare `ErrorResponse(err.message)`
      unchanged, so 404/403 on this route keep today's shape. BOTH branches call
      `ServiceResponse.statusCodeFor(err)` — never duplicate the status-code switch.
- [x] 4.2 The body is the four teardown-compatible fields (`resourceKind`, `resourceId`,
      `resourceName`, `reason`) **plus** `message`, set to the same text as `reason`
      (design Decision 3a — generic clients read `data.message`). Add the JSON format alongside
      the other source protocol formats.

## 5. Verify

- [x] 5.0 Assert the 409 body at FIELD level (`resourceKind`, `resourceId`, `resourceName`,
      `reason`, `message`) — not by substring-matching one blob of text. A field-level assertion is
      what makes the rejected "pack it all into the message string" implementation fail.
- [x] 5.1 All three tests from section 1 pass; re-confirm 1.2 was red before the fix.
- [x] 5.2 `sbt test` green, Scala code-quality gate green.
- [x] 5.3 Confirm **no migration was added** — `git diff --stat` must show nothing under
      `backend/src/main/resources/db/migration/`. The shared dev Postgres has concurrent HEL-983 /
      HEL-985 runs; if you believe a migration is genuinely required, **stop and escalate** rather
      than writing one.
