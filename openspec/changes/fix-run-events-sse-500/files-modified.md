# Files Modified — HEL-299

- `backend/src/main/scala/com/helio/api/routes/PipelineRunStreamRoutes.scala` — harden the SSE guard's `Failure(ex)` branch: add an slf4j logger, log the full exception + stack trace server-side, and return a generic `{"message":"Internal server error"}` body instead of leaking `ex.getMessage`. (Decision 3 — ships regardless of probe outcome.)
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` — two regression tests: (1) a viewer-grantee of an existing pipeline gets `200 text/event-stream` (locks the design-flagged suspect branch that runs `UUID.fromString` + the `withUserContext` grant query); (2) a guard whose future fails returns `500` with a generic body that does not include the exception message (verified failing before the hardening, passing after).

## Root-cause note (systematic-debugging Iron Law)

- **Root cause:** none confirmed — the 500 did not reproduce across the full widened matrix (owner/grantee × session/PAT, pipeline states, 25 concurrent streams, and a genuine non-superuser RLS probe). Every candidate from `design.md` Decision 2 was exonerated (see `probe-report.md`). No speculative fix was made.
- **Probe:** live `curl` against the worktree backend on port 8379 (9-row matrix) + a non-superuser `NOBYPASSRLS` role running the exact `findByIdShared` grantee query under RLS.
- **Probe output:** all valid requests returned `200 text/event-stream`; missing → `404`; unauth → `401`; the non-superuser grantee query returned `t` cleanly (V40's recursion fix holds). No `run-events access check failed` line was ever logged. Full transcript and verdicts in `probe-report.md`.
