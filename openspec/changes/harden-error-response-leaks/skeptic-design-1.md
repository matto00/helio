## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket / proposal / design / tasks / spec delta read in full**
  (`openspec/changes/harden-error-response-leaks/{ticket,proposal,design,tasks}.md`,
  `specs/google-oauth-login/spec.md`).

- **Primary leak confirmed at the cited location.**
  `backend/src/main/scala/com/helio/api/routes/OAuthRoutes.scala:134`:
  `case Failure(ex) => complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))`
  — matches ticket/design exactly. No `LoggerFactory` currently imported in this
  file, matching design.md's claim.

- **HEL-299 reference pattern confirmed.**
  `PipelineRunStreamRoutes.scala` has `private val log = LoggerFactory.getLogger(getClass)`
  and `log.error(msg, ex)` (Throwable overload → stack trace). Design's "follow
  verbatim" decision is well-grounded.

- **Audit-sweep file list and counts confirmed** for the three files design.md
  names: `SourcePreviewRoutes.scala` (2 hits, both `400 BadRequest` arms from
  `Try(json.convertTo[...])` deserialization failures), `DataSourceRoutes.scala`
  (4 hits, same shape), `SourceRoutes.scala` (2 hits, same shape). These are all
  `4xx` client-input-validation arms wrapping spray-json conversion errors — the
  design's "likely confirmed-safe, but must classify" framing is reasonable.

- **Test feasibility confirmed.** `GoogleOAuthRoutesSpec.scala` already
  demonstrates overriding `exchangeCodeForTokenImpl`/`fetchGoogleProfileImpl` with
  `Future.failed(...)` to hit non-happy-path arms (used for the existing `502`
  test). The same technique trivially reaches the catch-all `Failure(ex)` arm by
  failing with an exception that doesn't satisfy `isUpstreamOAuthError`. Log
  capture is feasible without new dependencies: `ch.qos.logback:logback-classic`
  is already a compile-scope dependency (`backend/build.sbt:90`), so a
  `ListAppender`-based assertion is available in tests with no build changes.

- **`openspec validate harden-error-response-leaks --strict` passes** (ran it
  directly; note tasks.md §4.1 writes the command as
  `openspec validate --change harden-error-response-leaks --strict`, which is
  wrong syntax — `--change` isn't a valid flag, it's a positional arg. Minor,
  non-blocking, but worth a one-line fix so the executor doesn't stumble on it.)

- **Spec delta is coherent.** `specs/google-oauth-login/spec.md` (published) has
  no existing requirement covering the unexpected-`500` arm — only the `400`
  (deny/other-error/missing-state) and `502` (upstream) arms are specified. The
  `ADDED Requirement` in the change's spec delta is genuinely new, doesn't
  contradict the published spec, and the scenario is concrete and testable.

### Gap found — audit scope is materially incomplete

The ticket's AC #2 requires an audit note listing **every** route that puts an
exception message in a response body. Design.md's stated audit grep ("An audit
grep (`getMessage`/`getLocalizedMessage` in response bodies) surfaced three other
route files: `SourcePreviewRoutes`, `DataSourceRoutes`, `SourceRoutes`") is
demonstrably incomplete: it missed `backend/src/main/scala/com/helio/api/ApiRoutes.scala`
— the top-level route-composition file (per this repo's own CLAUDE.md:
"`ApiRoutes.scala` defines all REST routes and composes the sub-routers").

`ApiRoutes.scala` has **two** occurrences of the exact leak class the ticket
exists to fix — genuine `500 InternalServerError` arms (not `4xx` validation
arms like the three audited files), each echoing `ex.getMessage` straight to the
client:

- `ApiRoutes.scala:161` — `GET /api/auth/me`:
  ```scala
  case Failure(ex) =>
    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
  ```
  (wraps `userRepo.findById` / `userPreferenceRepo.getPreferences` — could
  surface DB/JDBC internals.)
- `ApiRoutes.scala:193` — `PATCH /api/users/me/update`:
  ```scala
  case Failure(ex) =>
    complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))
  ```
  (wraps `userPreferenceRepo.upsertGlobalPrefs` / `upsertDashboardZoom` — same
  risk.)

`ApiRoutes.scala` has no logger either (confirmed — no `LoggerFactory` import).
These two arms are strictly more severe than the three files the design already
scoped in (they're unconditional `5xx` echoes of arbitrary exception text, not
`4xx` client-validation text from a `Try(json.convertTo[X])`), yet the plan as
written would ship without touching them — directly undermining the ticket's own
premise ("this pattern recurs across the route layer, we fix the confirmed leak
and sweep the rest once") and leaving AC #2 unsatisfied (the audit note would not
list every route with the leak).

I re-ran the grep confirming this is not a fluke: `grep -rln "getMessage\|getLocalizedMessage" backend/src/main/scala/com/helio/` minus the `routes/` subdir surfaces `ApiRoutes.scala` as a hit, and a direct `grep -n` on that file shows exactly the two `InternalServerError` arms above, with no other matches.

### Verdict: REFUTE

### Change Requests

1. **Expand the audit scope to include `ApiRoutes.scala`.** Update
   `proposal.md` ("What Changes" / "Impact"), `design.md` (Context's file list and
   the audit-grep claim), and `tasks.md` (§2.1–2.3) to add
   `backend/src/main/scala/com/helio/api/ApiRoutes.scala:161,193` to the files
   under audit.
2. **Classify and fix `ApiRoutes.scala:161` and `:193`.** Both are `500`
   arms echoing `ex.getMessage`, structurally identical to the OAuth leak (not
   `4xx` validation text like the other three audited files) — under the design's
   own classification rule ("If any wraps an exception that can embed
   internal/infra detail... it is fixed to a generic body") these should be
   fixed with the same HEL-299 pattern (add a logger to `ApiRoutes.scala`, log
   `ex` with stack trace, return `ErrorResponse("Internal server error")`), not
   merely documented as safe.
3. **Add or extend a test** covering at least one of the two newly-scoped
   `ApiRoutes.scala` arms (e.g. `GET /api/auth/me` failure path), asserting a
   generic body and server-side logging, to satisfy AC #3's intent that the fix
   is regression-tested, not just the OAuth path.
4. **Minor (non-blocking if the above are fixed):** `tasks.md:19` gives an
   invalid `openspec validate` invocation (`--change` is not a valid flag; the
   change name is positional: `openspec validate harden-error-response-leaks
   --strict`). Fix so the executor doesn't have to rediscover this.

### Non-blocking notes

- The core OAuth fix design (logger + `ErrorResponse("Internal server error")`,
  mirroring `PipelineRunStreamRoutes`) is sound and directly verified against the
  reference implementation.
- The three already-scoped audit files (`SourcePreviewRoutes`, `DataSourceRoutes`,
  `SourceRoutes`) are correctly counted and their `4xx`/deserialization-error
  framing looks right on inspection — no objection to the planned "likely
  confirmed-safe, verify per-arm" treatment for those.
- Test approach (override hooks + logback `ListAppender`) is feasible with zero
  new dependencies; no objection there.
