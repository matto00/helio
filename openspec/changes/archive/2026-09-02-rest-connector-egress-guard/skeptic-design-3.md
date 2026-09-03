## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope per the orchestrator: the two residual round-2 items plus any NEW inconsistency
the edits introduced. Settled ground not re-litigated.

### What I verified (with evidence)

**Item 1 — proposal.md Impact bullet (FIXED).**
`proposal.md` Impact now reads: `POST/PATCH /api/connectors` gains a 400-class rejection;
`POST /api/sources/infer` and every REST refresh/preview/pipeline-run fetch report on the
existing 502-class channel with the disallowed address named; `POST /api/sources/test`
reports 200 with `ok = false`, with an explicit pointer to design.md Decision 8.
Consistent with `specs/connectors/connector-management/spec.md` (400-class),
`specs/connection-test-endpoint/spec.md` (infer 502-class / test 200 `ok=false`),
and tasks 4.1–4.3.

**Item 2 — Decision 8's site count and the testRest/testSql exception (FIXED, citations accurate).**
- `grep -n "BadGateway" backend/src/main/scala/com/helio/services/sources/SourceService.scala`
  → code sites at 167, 189, 198, 279, 294, 322, 335, 342 (eight), plus line 338 which is a
  comment. Decision 8 lists exactly those eight and no longer says nine.
- `SourceService.scala:229-230` verified: `case Right(()) => Right(TestConnectionResponse(ok = true...))` /
  `case Left(err) => Right(TestConnectionResponse(ok = false, error = Some(err)))` — the ephemeral
  test path, outside the `BadGateway` mapping, as Decision 8 now states.
- `ConnectionTest.scala:24-25` verified (file is at
  `backend/src/main/scala/com/helio/services/sources/ConnectionTest.scala`): the two `case` lines
  mapping `Right(())`→`ok = true` and `Left(err)`→`ok = false, error = Some(err)`.
  Note: design.md cites this as bare `ConnectionTest.scala:24-25`; the path is correct once
  resolved, but the file is in `services/sources`, not `domain/connectors` — non-blocking.

**New inconsistency introduced by the Decision-8 carve-out (see CR 1).**
`specs/rest-api-connector/spec.md`, requirement "REST fetches refuse disallowed destinations",
enumerates the governed entry points as "a source refresh, a preview, a pipeline run, **a
connection test**, or a schema inference", and the very next paragraph then asserts
universally: "The refusal SHALL be reported on the same error channel the REST fetch paths
already use for a failed fetch (a 502-class upstream error)". For the connection-test entry
point that is false, and it directly contradicts `specs/connection-test-endpoint/spec.md`
("`test` reports it ... as a 200 response carrying `ok = false`"), proposal.md's corrected
Impact bullet, design.md Decision 8's stated exception, and task 4.3. Two spec files now
prescribe different observable behavior for the same endpoint. This is exactly the carve-out
that was propagated to proposal.md and design.md in round 2 but not to this spec file.

Nothing else changed by the round-2 edits introduced a further conflict: tasks.md 4.3/4.4
and the `outbound-egress-guard` and `connector-management` specs are consistent with the
corrected statement.

### Verdict: REFUTE

### Change Requests

1. `openspec/changes/rest-connector-egress-guard/specs/rest-api-connector/spec.md`, requirement
   "REST fetches refuse disallowed destinations": the 502-class reporting sentence is stated
   universally while the preceding sentence lists "a connection test" among the governed entry
   points. Carve out the test path so it matches Decision 8 and
   `specs/connection-test-endpoint/spec.md` — e.g. qualify the sentence to the fetch entry
   points (refresh, preview, pipeline run, infer), and add one clause stating that the
   connection-test entry points report the same refusal as a 200 with `ok = false` and the
   address named in `error`. Do not change the connection-test spec; it is the correct one.

### Non-blocking notes

- design.md:137 cites `ConnectionTest.scala:24-25` without a path; the file is
  `backend/src/main/scala/com/helio/services/sources/ConnectionTest.scala`. Adding the
  directory would save the next reader a `find`.
