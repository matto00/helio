## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- **Round-2 gaps closed as claimed.** Re-read `design.md`/`tasks.md`/`proposal.md`: the
  `services/` sweep (via `ServiceResponse.completeError`) and the `domain/` connector
  sweep are now both present and enumerated with specific file/line references
  (`PipelineService.classifyDbError`, `PanelService:219,254`, `PipelineRunService:146`,
  `SourceService` `BadGateway` arms, `SqlConnector`, `RestApiConnector`,
  `ContentSourceSupport`, `PdfTextSupport`, `PanelConfigCodec`, `PipelineAnalyzeService`,
  `InProcessPipelineEngine`). `tasks.md` §2/§3 mirror this with concrete tasks. The
  round-2 "audit methodology is blind to the ServiceResponse bridge" objection is
  resolved — the methodology now explicitly traces `services/`/`domain/` → route via
  `ServiceResponse`.

- **Independently re-ran the unscoped grep across the whole backend** (not trusting
  the plan's enumerated list):
  ```
  grep -rn "getMessage\|getLocalizedMessage" backend/src/main/scala/com/helio/
  ```
  Cross-checked every hit against design.md's candidate-surface list. All hits map
  to a covered task **except one confirmed-reachable, undocumented leak site**,
  detailed below. (Minor, non-blocking: `ContentSourceSupport.scala` and
  `PdfTextSupport.scala` are physically under `services/`, not `domain/` as
  design.md's "Enumerated candidate surface" section labels them — cosmetic
  mislabeling only, both are still listed in `tasks.md` §3.1, not a coverage gap.)

- **Traced `OAuthRoutes.scala:153`** (`isUpstreamOAuthError`, `Option(ex.getMessage)`)
  — this reads the message for pattern-matching only (`msg.contains(...)`), never puts
  it in a response body. Correctly out of scope.

- **Traced `PipelineStepRepository.scala:221` / `PipelineService.scala:207`**
  (`IllegalStateException(s"... failed to decode ...: ${ex.getMessage}", ex)`) — these
  construct a *new* exception message embedding the raw text, but that exception
  propagates up into `PipelineService.classifyDbError`'s `case other` arm, which
  `tasks.md` §2.1 already fixes generically. Transitively covered, not a separate gap.

- **Traced `LocalFileSystem.scala:114` and `SparkJobSubmitter.scala:94`** — upload-dir
  creation and background Spark job submission, respectively; neither return path was
  found to construct an HTTP response body with the embedded string in the code I
  read. Not flagging without stronger evidence of reachability (erring toward not
  inventing a spurious gap here).

- **Confirmed reachable, undocumented leak site — `PipelineRunService.scala`
  run-failure path (~lines 248–263), distinct from the site the plan cites.**
  `design.md`/`tasks.md` §2.5 cite only **`PipelineRunService:146`**, which is the
  `previewStep` occurrence (`Left(ServiceError.UnprocessableEntity("Pipeline execution
  failed: " + ex.getMessage))`, actually at line 147 in the current file — an
  off-by-one, forgivable on its own). But the identical pattern
  `"Pipeline execution failed: " + Option(ex.getMessage).getOrElse(ex.getClass.getName)`
  **also appears a second time**, in the run-execution failure handler:
  ```scala
  // PipelineRunService.scala:250-252
  val errMsg = "Pipeline execution failed: " +
    Option(ex.getMessage).getOrElse(ex.getClass.getName)
  publish(pidStr, RunStatusEvent("failed", errorLog = Some(errMsg)))
  ```
  This `errMsg` is *not* a stray internal value — I traced it to **three separate
  client-reachable channels**, none named anywhere in `design.md`, `proposal.md`, or
  `tasks.md`:
  1. **Live SSE stream.** `RunStatusEvent(errorLog = Some(errMsg))` →
     `PipelineRunRegistry.toSseBytes` (`PipelineRunRegistry.scala:40`:
     `event.errorLog.foreach(s => fields("errorLog") = JsString(s))`) → streamed
     verbatim to any client subscribed via `PipelineRunStreamRoutes`
     (`GET /api/pipelines/:id/runs/events`, the SSE endpoint). This is the *same
     file* the ticket cites as "the reference pattern to follow" (HEL-299 fixed its
     inline `Failure(ex)` catch-all at `PipelineRunStreamRoutes.scala:35` with
     `log.error(...)`) — but that fix only covered the route's own exception-catch
     arm, not this separate raw-text leak flowing through the SSE **data payload**
     it streams from the registry.
  2. **Cached run status.** `errMsg` → `CachedRunStatus.error`
     (`PipelineRunService.scala:165`) → returned verbatim as
     `RunStatusResponse.error` by `PipelineRunStatusRoutes.scala:31-38`
     (`GET /api/pipelines/:id/runs/:runId`). Confirmed the field is wire-serialized:
     `PipelineProtocol.scala:78`, `r.error.foreach(v => fields("error") =
     JsString(v))`.
  3. **Persisted run history.** `errMsg` → `pipelineRunRepo.updateRunTerminal(...,
     errorLog = Some(errMsg), ...)` (`PipelineRunService.scala:257`) → read back as
     `PipelineRunRecord.errorLog` in `PipelineRunService.history()`
     (`PipelineRunService.scala:188`) → returned verbatim via
     `PipelineRunHistoryRoutes` (`GET /api/pipelines/:id/runs`). Confirmed
     wire-serialized: `PipelineProtocol.scala:69`,
     `jsonFormat7(PipelineRunRecord.apply)` includes `errorLog`.

  All three are genuine, currently-live, unauthenticated-adjacent (session-cookie
  gated, but not admin-only) leak surfaces of raw exception text — structurally
  identical to the ticket's own `OAuthRoutes.scala:134` example — and none is named
  in the plan. An implementer following `tasks.md` §2.5 literally (single line
  reference "146") would fix the `previewStep` occurrence and never touch this one,
  leaving three response surfaces still leaking.

### Verdict: REFUTE

### Change Requests

1. **Add the `PipelineRunService.scala` run-execution-failure `errMsg` construction
   (current lines ~248-263) as its own explicit task**, distinct from the
   `previewStep` occurrence already covered. Update `design.md`'s "Enumerated
   candidate surface" and `tasks.md` §2.5 to name both occurrences by their actual
   current line numbers (the file has drifted; re-grep for
   `"Pipeline execution failed: "` to get current lines rather than reusing "146").

2. **Name all three downstream channels explicitly** in `design.md`/`tasks.md` so
   the fix (and its test) isn't limited to genericizing the string at its
   construction site without confirming every consumer is covered:
   - `PipelineRunRegistry.toSseBytes` / `PipelineRunStreamRoutes` SSE `errorLog`
     field (data-payload leak, separate from the exception-catch arm HEL-299 already
     fixed in that same file).
   - `PipelineRunStatusRoutes.scala:31-38` (`GET /api/pipelines/:id/runs/:runId`,
     `RunStatusResponse.error`).
   - `PipelineRunHistoryRoutes` via `PipelineRunService.history()`
     (`GET /api/pipelines/:id/runs`, `PipelineRunRecord.errorLog`).
   Since genericizing `errMsg` at its single construction point
   (`PipelineRunService.scala:250-252`) fixes all three consumers simultaneously
   (they all read the same string), one fix task suffices — but the audit note and
   task description must say so explicitly, both so the fix isn't scoped too
   narrowly (e.g. only patching the SSE route) and so `audit.md`'s re-grep-complete
   claim is actually true.

3. **Add a test task** (mirroring `tasks.md` §6) asserting at least one of these
   three surfaces (the cached-status endpoint is simplest to test without SSE
   plumbing) returns a generic `error`/`errorLog` value with no raw exception text
   after a stubbed run-execution failure, and that the detail is logged server-side.

### Non-blocking notes

- Everything else re-verified from round 2 holds: the `services/`/`domain/` sweep
  breadth, the FIX/CONFIRM-SAFE classification rule, the spec deltas
  (`error-response-safety`, `google-oauth-login`) are coherent and testable as
  written, and the already-scoped `4xx` route files remain correctly counted.
- The `domain/` vs `services/` labeling of `ContentSourceSupport.scala` /
  `PdfTextSupport.scala` in design.md's "Enumerated candidate surface" section is
  cosmetically wrong (both actually live under `services/`) but both are correctly
  captured in `tasks.md` §3.1 — worth a one-line correction, not blocking.
