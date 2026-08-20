## Skeptic Report — design gate (round 1 of this fold-in sub-run, skeptic-design-2.md)

This is a fold-in re-run of the design gate for HEL-750. Round 1 (DB `connectionTimeout` +
inside-`cors()` exception/rejection handling) already shipped to PR #403 (unmerged) and was
CONFIRMed at both gates. This review covers only the newly added fold-in scope: (3) extracting
`topLevelExceptionHandler`/`topLevelRejectionHandler` into `TopLevelErrorHandlers`, and (4) a
dedicated `corsRejectionHandler` outside `cors()` for disallowed-origin requests.

### What I verified (with evidence)

1. **Full revised artifact set read fresh**: `ticket.md` (incl. "Added scope (fold-in,
   2026-08-20)" + updated ACs 3/4), `proposal.md`, `design.md` (incl. new "Added scope" context
   block and Decisions D5/D6), `tasks.md` (task groups 4-6, all `[ ]` unchecked — correct, this is
   pre-execution), `specs/cors-error-handling/spec.md` delta (`MODIFIED Requirements`, new
   "Disallowed-origin request receives a clean, curated response" scenario).

2. **`openspec validate db-fail-fast-cors-headers --strict`** → `Change 'db-fail-fast-cors-headers'
   is valid`. Ran directly (not via `npx`, which failed with "could not determine executable to
   run" in this environment — `/usr/bin/openspec` is the working binary).

3. **`MODIFIED Requirements` heading matches the already-merged spec exactly.** Read
   `openspec/specs/cors-error-handling/spec.md` (round 1's merged output) — the requirement heading
   `### Requirement: Every response carries CORS headers, including unhandled exceptions and
   rejections` is byte-for-byte identical to the delta's heading, which is why `--strict` validation
   resolves the target correctly. Also confirmed no stale `hikaricp-pool-config` delta file remains
   in the change dir (`find openspec/changes/db-fail-fast-cors-headers -type f` shows only
   `specs/cors-error-handling/spec.md`), consistent with the round-1 note that capability being
   unchanged this round.

4. **Ground-truth-checked ApiRoutes.scala's current state (719 lines) against design.md's
   "Context"/"Added scope" claims** — all confirmed accurate:
   - `corsSettings` at line 451-453, `cors(corsSettings) { handleExceptions(topLevelExceptionHandler)
     { handleRejections(topLevelRejectionHandler) { ... } } }` at lines 500-502 — exactly matches
     round 1's already-shipped shape the design describes as the extraction/wrap target.
   - `topLevelExceptionHandler`/`topLevelRejectionHandler` at lines 473-497, private vals on
     `ApiRoutes`, using only `log` (`LoggerFactory.getLogger(getClass)`, line 127),
     `ErrorResponse`/`JsonProtocols`, and Pekko/spray-json machinery — confirms D5's claim that
     nothing but the logger, `ErrorResponse`, and framework types are closed over, so lifting them
     into a standalone `object TopLevelErrorHandlers extends Directives with JsonProtocols` (its own
     `LoggerFactory.getLogger(getClass)`) is mechanically sound with no `ApiRoutes`-constructor
     dependency.
   - `ErrorResponse(message: String)` in `backend/src/main/scala/com/helio/api/protocols/
     ResourceProtocol.scala:10` (JSON format `jsonFormat1` at line 26) — single-field shape,
     consistent with every planned reuse (`ErrorResponse("Internal server error")`,
     `ErrorResponse(s"CORS request rejected: ...")`).

5. **Independently verified the design's pekko-http-cors 1.1.0 technical claims against the actual
   resolved jar sources** (unzipped `pekko-http-cors_2.13-1.1.0-sources.jar` and
   `pekko-http_2.13-1.1.0-sources.jar` from `~/.cache/coursier`) — every specific claim checks out:
   - `CorsDirectives.scala`'s `cors(settings)` (lines 67-133 in the resolved source, matching the
     design's "96-133" citation for the rejection path) calls `reject(causes.map(CorsRejection(_)):
     _*)` directly inside its own `extractRequest.flatMap`, **before** ever entering the block
     passed to `cors(corsSettings) { ... }` — confirms a disallowed-origin request never reaches the
     `handleExceptions`/`handleRejections` pair nested inside `cors()`, so only an *outer* wrapper
     can intercept it. This is the crux of D6's placement decision and it is correct.
   - `RejectionHandler.default` (pekko-http `RejectionHandler.scala:312`) has a catch-all `case x =>
     sys.error("Unhandled rejection: " + x)` for any `Rejection` subtype (like `CorsRejection`) not
     covered by its explicit cases — confirms the design's specific claim that an unhandled
     `CorsRejection` throws a `RuntimeException("Unhandled rejection: ...")`.
   - `ExceptionHandler.default` (`ExceptionHandler.scala:75-80`) logs that `RuntimeException` via
     `ctx.log.error(e, ErrorMessageTemplate, message, InternalServerError)` (ERROR level, full
     throwable) and completes `InternalServerError` with **no CORS header attachment** (this happens
     outside the app's own `cors()` scope) — confirms the "ERROR-level stack-trace log spam +
     plain-text/no-CORS response" characterization in both `ticket.md`'s Added-scope item 4 and
     `design.md`'s Added-scope context is accurate, not hand-waved.
   - The library's own `CorsDirectives.corsRejectionHandler` (lines 147-154) completes with a bare
     `(StatusCodes.BadRequest, s"CORS: $causes")` tuple, not this project's `ErrorResponse` JSON
     envelope — confirms D6's stated reason for not reusing it.
   - `CorsRejection.Cause#description` (`CorsRejection.scala:48,56,65,73`) only ever echoes the
     request's own origin/method/header values back — confirms the no-leak claim used to justify
     including it in the curated response body under `error-response-safety`.

6. **AC-to-task traceability**: all 4 ACs in `ticket.md` map 1:1 — AC1/AC2 to round-1's
   already-`[x]`'d task groups 1-2 (unaffected, correctly left untouched); AC3 (companion-object
   split, no behavior change) to task group 4, with group 6.3 explicitly requiring "existing
   allowed-origin exception/rejection/success paths (task-group 3 coverage) are unaffected... full
   regression pass" as the behavior-preservation acceptance signal; AC4 (disallowed-origin clean
   response) to task group 5 + spec.md's new scenario + group 6.1/6.2/6.4. No AC left uncovered, no
   task beyond the ticket's stated scope.

7. **Test feasibility check**: read the existing round-1 test file
   `backend/src/test/scala/com/helio/api/ApiRoutesCorsErrorHandlingSpec.scala` (built on
   `ScalatestRouteTest` with a real embedded-Postgres-backed `ApiRoutes` instance and a
   poisoned-session-repo technique to force an unhandled exception without a real DB outage). The
   planned group-6 tests (disallowed-`Origin` → 403, no `Access-Control-Allow-Origin` header, no raw
   exception detail) are mechanically identical in shape to the existing tests in this file (just
   substituting a non-allowlisted `Origin` header) — not speculative or infeasible.

8. **Cross-checked the "Added scope" narrative in `ticket.md`/`design.md` against the actual
   round-1 `skeptic-final-1.md`** (the source of the two folded-in follow-ups) — the "720 lines,
   past CONTRIBUTING.md's ~400-line soft-split threshold" and "disallowed-origin `CorsRejection` gap
   ... ERROR-level stack-trace log spam + plain-text/no-CORS response for spoofed-origin/bot
   traffic" framings are faithful, non-distorted restatements of what that report actually said (its
   "Non-blocking notes" section, lines ~99-109) — no scope inflation beyond what was actually
   triaged and approved as fold-in.

9. **Verified CONTRIBUTING.md's actual file-size language**: "`~250 lines per source file`... `If a
   file you're editing crosses ~400 lines, propose a split in the PR description rather than adding
   to it`" and "File-size warnings (~250 lines per source, ~80 for aggregators) are informational
   only" (`check:scala-quality`) — the proposal's "~400-line soft-split threshold" characterization
   is accurate, and correctly treated as a legitimate (if non-mechanically-blocking) reason to
   extract, not an invented requirement.

### Verdict: CONFIRM

The revised plan is sound, internally consistent, and unusually well-grounded — every non-trivial
technical claim in `design.md`'s "Added scope" section (where `CorsRejection` is minted relative to
the existing handler scope, what Pekko's default rejection/exception handling does with an
unmatched rejection, what the library's own `corsRejectionHandler` would have done instead) checks
out against the actual resolved library sources, not just plausible-sounding narrative. D6's
placement (`handleRejections(corsRejectionHandler) { cors(corsSettings) { ... } }`, wrapping `cors()`
from the outside) is the only placement that can actually intercept a `CorsRejection`, and the
design explains why. D5's extraction is a genuine behavior-preserving move with an explicit
regression-test task (6.3) as its acceptance signal. No placeholders, no `TODO`/deferred decisions
that block implementation, no contradiction between `ticket.md`/`proposal.md`/`design.md`/
`tasks.md`, and every AC traces to a task and a spec scenario. `openspec validate --strict` passes.

### Non-blocking notes

- `proposal.md`'s "Modified Capabilities" section lists `hikaricp-pool-config: unchanged this round`
  alongside the actually-modified `cors-error-handling` — technically harmless (no delta file exists
  for it, `openspec validate` passes clean) but the "Modified" heading paired with "unchanged" reads
  as self-contradictory on a skim. Consider moving that line to a "Note" outside the Capabilities
  list in a future pass, purely for clarity.
- Task 6.4 ("Manually verify (or automate) that the disallowed-origin path no longer logs at `ERROR`
  with a stack trace") leaves the verification method open. That's a reasonable implementer choice
  (asserting on log level typically needs a test log appender, which may or may not be worth adding
  here), not a blocking ambiguity — but the executor should pick one concretely rather than skipping
  it silently.
- This worktree's rendered `scripts/concertino/` is still missing `next-report-number.sh`/
  `persist-evidence.sh`/`emit-event.sh` (same gap `skeptic-final-1.md` flagged). I resolved this
  review's report-numbering/persistence via the main-repo checkout's absolute script paths, per that
  report's own suggestion — still worth the orchestrator refreshing this worktree's script
  rendering.
