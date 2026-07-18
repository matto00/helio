## Context

`PipelineRunStreamRoutes.scala:26-28` guards the SSE stream with `runService.pipelineExistsShared(pipelineId, user)`.
On `Failure(ex)` it returns `500` with `ex.getMessage` in the body. A 500 was observed once, on a valid pipeline,
during HEL-252's UI review — never root-caused. The chain under the guard is:

- `PipelineRunService.pipelineExistsShared` → `PipelineRepository.findByIdShared(id, Some(user))`
- `findByIdShared` runs `ctx.withSystemContext(...)` for the row lookup, then for non-owner callers
  `ctx.withUserContext(caller.id.value)(permTable.filter(... UUID.fromString(caller.id.value) ...))`.

The frontend consumer is `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` (used by StepCard /
pipeline detail); it must be inspected for what it actually sends (auth, reconnect behavior, Last-Event-ID).

Constraints: systematic-debugging Iron Law — no fix without a probe-confirmed root cause. Dev/CI Postgres connects
as superuser (BYPASSRLS), so RLS-policy failures (HEL-286 / V40 SECURITY DEFINER history) may only manifest under a
non-superuser role.

## Goals / Non-Goals

**Goals:**

- Reproduce the 500 with a live backend and capture the actual server-side exception + failing code path.
- Fix the probe-confirmed root cause: valid authorized request → `200 text/event-stream`; missing/unauthorized →
  `404`; never 500 for a valid request.
- Stop leaking raw `ex.getMessage` to clients on internal failure of the guard.
- Regression-test the previously-500ing path.

**Non-Goals:**

- SSE event semantics, registry, publish flow, frontend hook behavior (unless the probe implicates them).
- Broad RLS rework beyond what the confirmed root cause requires.

## Decisions

1. **Probe before fix (ordered matrix).** Start the worktree backend + dev DB, exercise the endpoint exactly as the
   frontend does, then widen deliberately rather than randomly:
   a. Happy path per auth mode (session cookie, PAT) on an owned pipeline.
   b. Pipeline states: never-run, running, completed, failed, deleted-mid-stream.
   c. Shared-grantee path (editor/viewer) — this is the only path that executes `UUID.fromString(caller.id.value)`
      and the `withUserContext` grant query; the owner path short-circuits on a string compare.
   d. Concurrent streams (several EventSource connections + a run posted).
   e. Non-superuser RLS context: create a non-BYPASSRLS role per the team's RLS repro notes and re-run (a)–(c);
      inspect V40 and the pipeline/resource-permission policies for interactions with `withSystemContext` /
      `withUserContext`.
   Instrument by logging the full stack trace at the `Failure(ex)` branch (probe logging may be temporary; the
   permanent form is Decision 3).
2. **Fix targets the confirmed cause only.** Plausible candidates identified from reading the chain — to be
   confirmed or eliminated by the probe, not assumed: `UUID.fromString` on a non-UUID grantee/caller id;
   RLS/session-context failure inside `withUserContext`/`withSystemContext` under a non-superuser role; transient
   DB/pool errors (HikariCP timeout) under concurrent load. The executor fixes whichever the probe confirms, at the
   layer where it belongs (repository/service), not by swallowing errors in the route.
3. **Route hardening ships regardless of probe outcome.** The `Failure(ex)` branch currently returns
   `ErrorResponse(ex.getMessage)` — an internal-detail leak. Change to: log the exception server-side (with stack
   trace) and return a generic 500 body. This does NOT mask the root cause — genuine internal errors still 500 —
   it only stops leaking internals and gives us permanent diagnostics. Follows the pattern used elsewhere in the
   route layer for unexpected failures.
4. **Regression coverage in ScalaTest route specs.** Add tests to the existing SSE route spec coverage:
   - the previously-500ing path (probe-confirmed scenario) now returns the correct 200/404;
   - a guard whose future fails yields a 500 without the exception message in the body (stub the service with a
     failed future — no need to reproduce the DB fault in-test).
   If the confirmed cause is RLS-only, the test stubs the repository failure mode at the service seam, and the RLS
   fix itself is verified by the documented non-superuser probe (CI cannot run non-superuser Postgres today —
   documented dev/CI parity gap).
5. **Fallback.** If, after the full matrix, the 500 genuinely does not reproduce: still ship Decisions 3 + 4
   (hardening + failure-path test), and post the full probe report (matrix, evidence, exonerated candidates) to the
   ticket instead of a root-cause fix.

## Risks / Trade-offs

- [500 may be environmental/transient (pool exhaustion during UI review)] → the matrix includes concurrency; if
  confirmed transient, fix at the pool/timeout layer or document with evidence rather than guessing.
- [RLS-only manifestation invisible in dev/CI superuser runs] → explicit non-superuser probe step (1e); if RLS is
  implicated, say so explicitly in the report and reference the HEL-286 history.
- [Deleted-mid-stream case may expose a different, second bug] → report separately; do not scope-creep the fix —
  spin off a ticket if non-trivial.
- [Generic 500 body could hinder future debugging] → mitigated by mandatory server-side stack-trace logging in the
  same branch.

## Planner Notes

- Self-approved: no new dependencies, no API-shape changes (error body of an internal-500 becomes generic — not a
  documented contract), no migrations expected unless the probe confirms an RLS policy defect (if a migration is
  needed, it is a narrow policy fix, not a rework).
- Session model overrides (user-directed): executor=opus, evaluator=sonnet, skeptic=sonnet.
- Probe evidence (curl transcripts, stack traces, matrix results) goes in the executor's report and the ticket
  comment — screenshots only to the session scratchpad, never the repo.
