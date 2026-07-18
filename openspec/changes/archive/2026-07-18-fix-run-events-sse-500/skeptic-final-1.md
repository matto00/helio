## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket / ACs re-read from `ticket.md`.** Probe-first mandate is explicit and binding; the ticket itself pre-authorizes the not-reproducible fallback ("Deliverable: root cause + fix + regression test, or (only if genuinely not reproducible after the widened matrix) a documented probe report").

- **Diff is minimal and scoped.** `git diff main...HEAD -- backend` = 2 files, 58 lines (`PipelineRunStreamRoutes.scala` +10/-1, `PipelineRunRoutesSpec.scala` +49). Single commit `55276e78`. No unrelated changes.

- **Route hardening matches the described fix exactly.** Read the diff directly: `Failure(ex)` branch now does `log.error(s"run-events access check failed for pipeline ${pipelineId.value}", ex)` then `complete(StatusCodes.InternalServerError, ErrorResponse("Internal server error"))` — no more `ex.getMessage` leak. Logger pattern (`private val log = LoggerFactory.getLogger(getClass)`, top-of-file import) matches the existing convention verified independently in `backend/src/main/scala/com/helio/infrastructure/GcsFileSystem.scala:4,68` and `LocalFileSystem.scala:5,78` — not a reinvented one-off.

- **Re-ran the full backend suite myself:** `sbt test` → `1391/1391 succeeded, 0 failed`. Matches executor/evaluator claims exactly.

- **Re-ran the targeted spec myself:** `sbt "testOnly com.helio.api.routes.PipelineRunRoutesSpec"` → 33/33 pass. Watched the raw output: the failure-path test genuinely exercises the hardened log line — `20:28:01.351 ERROR ... c.h.a.routes.PipelineRunStreamRoutes - run-events access check failed for pipeline 00000000-...-aa` appears exactly once, immediately before the "generic 500" test passes — i.e. the test is real, not a no-op assertion.

- **Verified the code claims in `probe-report.md` and `skeptic-design-1.md` against the actual source, not narrative:**
  - `PipelineRepository.findByIdShared` (`backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala:55-80`) — read directly. Confirmed: owner path is a plain string compare (`caller.id.value == ownerId`, no `UUID.fromString`); only the grantee branch runs `ctx.withUserContext(...)(permTable.filter(... p.granteeId === UUID.fromString(caller.id.value) ...))`. This exactly matches the probe report's claim about which branch is the prime suspect, and the new regression test (`...returns text/event-stream for a viewer grantee...`) genuinely exercises that exact branch (seeds a `resource_permissions` row with role `viewer`, asserts 200).
  - `V40__fix_rls_policy_function_recursion.sql` — read directly. Confirms the HEL-286 SECURITY DEFINER mutual-recursion history and the re-own-to-`helio_privileged` fix exactly as the probe report describes it. The probe's non-superuser finding ("V40 already fixes the HEL-286 recursion; grantee query resolves cleanly") is consistent with what this migration actually does.
  - `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` — read directly. Confirms `fetch` + `credentials: "include"` (session cookie only), no PAT header, no `Last-Event-ID`/reconnect loop, matching the probe report's frontend-consumer section verbatim.
  - 404-for-unauthorized (rather than 403) is the established codebase convention for ACL-guarded pipeline routes — spot-checked `PipelineAclSpec.scala`, which asserts `StatusCodes.NotFound` repeatedly for cross-user access. The ticket's "404/403" phrasing is satisfied by the existing, consistent pattern.

- **Residue check on the shared dev DB (the specific risk called out in the brief).** Queried Postgres directly:
  - `select * from pg_roles where rolname = 'hel299_probe_rls'` → 0 rows (temp non-superuser role was in fact dropped).
  - `select * from users where email like '%hel299%'` → 0 rows (probe's temp grantee/2nd user removed).
  - `select * from resource_permissions where grantee_id in (select id from users where email like '%hel299%')` → 0 rows.
  - (Unrelated residue from other tickets — e.g. `hel287-*@example.com` users — exists in the shared DB but predates this change and is out of scope.)
  - No stray screenshot files at repo root or worktree root (`find . -maxdepth 1 -iname "*.png"` → empty).

- **Quality gates:** `npm run check:scala-quality` → clean (43 pre-existing soft line-count warnings; `PipelineRunRoutesSpec.scala` was already over its 250-line soft budget at 603 lines on `main` before this change added 49 more — not a new violation introduced by this diff). `npm run check:openspec` → single expected "complete but not archived" hygiene note (archiving is a later workflow step, matches the stated bypass justification).

- **Design-gate consistency.** `skeptic-design-1.md` (round 1, CONFIRM) pre-approved the exact fallback path used here (Decision 5: ship hardening + regression test + documented probe report if genuinely not reproducible) — the shipped work followed the approved plan, not a unilateral scope reduction invented post-hoc.

- **No UI changes** — diff touches only `backend/`. Per the gate instructions, section 4 (UI/design judgment) is skipped; the evaluator's smoke-test of the SSE consumer (StepCard "Run pipeline" end-to-end, 200 + run completion, 0 console errors) is a reasonable secondary check but not the crux of this gate.

### Verdict: CONFIRM

The probe report meets the bar the human set: a genuine ordered matrix (9 live-curl rows spanning auth mode, pipeline state, grantee path, and concurrency) plus a real non-superuser `NOBYPASSRLS` role probe of the exact `resource_permissions`/`pipelines_select` query path — not an assertion that RLS is fine, but a demonstrated query result under a real non-superuser session, cross-checked here against the actual V40 migration content. Every claim in the probe report and evaluation was independently re-verified against the running test suite and the real source files, not taken on the executor's or evaluator's word. The shipped hardening closes a genuine internal-detail leak, the regression tests exercise the real suspect code path (not a synthetic stand-in), cleanup left zero residue in the shared DB, and the diff is minimal, CONTRIBUTING-compliant, and matches the pre-approved design fallback exactly.

### Non-blocking notes

- `OAuthRoutes.scala:134` still does `complete(StatusCodes.InternalServerError, ErrorResponse(ex.getMessage))` (same leak pattern this ticket fixed, different route) — correctly out of scope for HEL-299 (non-goal: "Broad RLS rework beyond what the confirmed root cause requires" / route-scoped fix), but worth a follow-up ticket if the team wants the leak pattern closed project-wide.
- The evaluator's report notes it did not itself re-run the failure-path test against a reverted route file to reconfirm the "red-before" state; I did not either (would require modifying code, which is outside a read-only skeptic's remit). This is low-risk given the assertion (`body should not include secret`) is unambiguous and the pre-hardening code obviously would have failed it, but it's a residual gap in strict red/green documentation, not a blocker.
