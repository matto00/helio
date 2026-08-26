## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read all six artifacts in full from the worktree: `ticket.md`, `proposal.md`, `design.md` (44 lines), `tasks.md` (33 lines), `specs/audit-query-api/spec.md` (51 lines), `specs/audit-events-ui/spec.md` (41 lines), plus `skeptic-design-1.md` for the exact round-1 asks.

**Round-1 CR 1 (vacuous isolation proof) — ADDRESSED.**
`tasks.md:5` adds task 1.3: a `findPaged` test on "the existing non-BYPASSRLS `helio_app_test` role/harness that would fail red if RLS were bypassed", asserting the RLS-scoped path returns empty when the context user is B but filters target A's rows, "independent of the app-level actor filter's own contribution", and explicitly instructing not to rely solely on 2.4. Route-level 2.4 is retained (`tasks.md:12`), exactly as asked. Harness ground truth re-confirmed: `backend/src/test/scala/com/helio/infrastructure/persistence/audit/AuditEventRepositorySpec.scala:19-27` header documents the real `helio_app_test` (non-BYPASSRLS) + `helio_privileged` (BYPASSRLS) two-role topology and the vacuity hazard; `grep -l helio_app_test backend/src/test` confirms the role is live in that spec and 8 others. The named harness exists — this is not a task pointing at a fiction.

**Round-1 CR 2 (no deterministic sort) — ADDRESSED in all three places requested.**
- `design.md:17` (Decision 1): "Sort order is `ORDER BY created_at DESC, id DESC`", with the duplicate/skip rationale stated.
- `tasks.md:3` (task 1.1): "Sort `ORDER BY created_at DESC, id DESC` (deterministic tiebreak — design.md Decision 1)."
- `specs/audit-query-api/spec.md:24` Pagination requirement now mandates "ordered by creation time descending with a deterministic tiebreak on id", plus a new `Scenario: Stable ordering across pages` (:26-28) whose WHEN is identical timestamps and THEN is no row omitted or duplicated between consecutive pages. That scenario is falsifiable and would fail against a `created_at`-only sort.

**Round-1 CR 3 (actor column renders a useless UUID) — ADDRESSED with an explicit decision, not a deferral.**
`design.md:29` Decision 6a resolves to option (a)-plus: `actorUserId` is not rendered at all; the actor column is derived from `source` ("You (browser)" / "You (API token)" / "System"); `actorTokenId` appears only as a secondary monospace raw id, with the no-token-name-lookup consequence stated and `AuditEventResponse`/schema explicitly left unchanged from Decision 5 — so it does not silently contradict the wire contract (which round 1 warned option (b) would). Mirrored in `tasks.md:22` (4.1) and in the UI spec's requirement text (`specs/audit-events-ui/spec.md:8`), which binds "rather than displaying the caller's own raw user id".

**Round-1 CR 4 (UI pagination unspecified) — ADDRESSED as a recorded choice.**
`design.md:31` Decision 6b: first `Page.Default` page only (200 rows, newest-first), no next-page control in v1, with `total` shown as a "showing latest N of TOTAL" caption "so truncation is visible to the user rather than silent"; deferral labeled deliberate. Task 4.5 (`tasks.md:26`) is the corresponding implementation task round 1 asked for. UI spec adds `Requirement: First-page truncation is visible, not silent` (:18-23) with a scenario for "more events than one page holds". This is now a choice with a visible-truncation acceptance signal rather than an omission.

**Cross-artifact consistency re-checked (no new contradictions introduced).**
- Decision 6a's "no `actorUserId` rendered" does not conflict with Decision 5 / proposal.md's response shape — the field still ships on the wire, only its rendering is decided.
- `proposal.md`'s "Human-readable action/resource/actor/source/timestamp" and the ticket AC's same phrase are now satisfied by an explicitly defined meaning of "actor" rather than an ambiguous one.
- Every AC in `ticket.md` still traces to at least one task: isolation → 1.3 + 2.4; schema/spec → 2.3 + 5.3; frontend render + slice Jest + lint → 4.1-4.5, 3.3, 5.2; `sbt compile test` / `npm test` → 5.1-5.2. No task exceeds the ticket's scope; the three Out-of-scope items remain declared non-goals in both `proposal.md` and `design.md:13`.
- No `TODO`/`TBD`/"figure out later" placeholders remain in any artifact.
- Note: `next-report-number.sh` is absent from the worktree's `scripts/concertino/` (which carries only 4 scripts); I ran the repo-root copy at `/home/matt/Development/helio/scripts/concertino/next-report-number.sh`, which returned `READY number=2`. Not a guessed filename, and not a blocker for this gate.

### Verdict: CONFIRM

All four round-1 required revisions are substantively addressed in the artifacts — not merely acknowledged in prose but landed in the specific decision, task, and spec-scenario locations that make each one implementable and testable. The design is sound enough to implement.

### Non-blocking notes

- The UI spec requirement (`specs/audit-events-ui/spec.md:8`) still lists both "actor" and "source" as columns while Decision 6a derives actor *from* source — as literally written that is two columns showing the same underlying value. Harmless (task 4.1's `actor(=source)` shorthand implies one column), but the executor should not build a redundant duplicate column.
- Round 1's non-blocking note about `metadata` (raw `JsValue`) being echoed verbatim to the client was not picked up in `design.md`. Still not a cross-tenant leak (every row is the caller's own); still worth a one-line acknowledgement on record.
- Round 1's suggestion to also assert a valid PAT (not just a session cookie) can call the endpoint was not added to the API spec's auth scenarios. Given the PAT/UI distinction is central to Decision 6a's rendering, a PAT-authenticated request scenario would be cheap coverage.
- `design.md` Decision 6 (:27) still reads as a run-on; cosmetic only.
