## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `deb53526ea3b37e50cb7924d5cfd81b3f8e570ad` + untracked `openspec/changes/row-listing-api/`
(ticket.md, proposal.md, design.md, tasks.md, specs/dataset-row-write-api/spec.md), re-read in full.

### What I verified (with evidence)

- **Fix 1 (task 4.1): landed.** It now reads "absent from the JSON on the last page — never `null`".
  This agrees with D2, D6, 1.3, 3.1, 4.8 and the spec scenario "nextCursor is absent, never null".
  No `nextCursor … null` claim remains anywhere in the artifacts. (There is a doubled-token typo; see
  the notes.)
- **Fix 2 (stale claims): landed.**
  - design.md Non-Goals now says no route exposes the declared schema and that this is a tracked gap.
  - D5 now points at "the Non-Goals section above" (design.md's own). The proposal.md reference is
    gone.
  - proposal.md Impact lists no OpenAPI file and carries the "no OpenAPI file exists" note.
  - All four backend paths in Impact exist, as do `frontend/src/features/sources/types/dataSource.ts`
    and `schemas/sources/row-response-row.schema.json` (checked with `ls`).
- **Fix 3 (D2 stability claim): landed and correct.**
  - The claim is now "every row that existed at the start of paging and is never deleted during it is
    returned exactly once". The seq-reuse counterexample (a delete at or above the cursor, followed
    by a `max+1` append) is stated explicitly.
  - `patchRow` updates only `(data, updatedAt)`, confirmed at `DataSourceRepository.scala:505-508`.
    It never touches `seq`, so the "patch never changes seq" sentence is true.
  - The spec's append scenario covers appends only, so its unqualified "every row that existed at the
    start" holds.
- **Fix 4 (task 4.4 / D7): landed.**
  - (a) is pinned to `SourceNotFound` and correctly says it never reaches `dataset_rows`.
  - (b) is the owner positive control.
  - (c) runs a raw `SELECT` on `dataset_rows` as a non-owner under the non-BYPASSRLS role, pinned to 0
    rows, against the privileged pool, pinned to N rows. `dataset_rows_owner` exists as an `EXISTS`
    policy at `V106__dataset_rows.sql:51`.
  - (d) is the no-extra-predicate assertion.
  - `RlsOwnerTablesSpec.scala` exists at `backend/src/test/scala/com/helio/infrastructure/persistence/`.
  - D7 now separates the service-layer `findByIdOwned` (owner predicate) from the repository-layer
    RLS-scoped `datasetSchema` read (no owner predicate).
- `readDatasetRows` is still `withSystemContext` and is unmodified by this plan (D1, task 4.7).
  `RowResponseRow(id, seq, updatedAt: String, data)` is at `DataSourceProtocol.scala:282`, so D4's
  reuse holds.
- **AC coverage:**
  - Paging: D2, D3, 4.1, 4.6, 4.9.
  - ACL / 404: D6, D7, 4.2.
  - RLS / non-privileged pool: D1, 4.4.
  - Timestamp round-trip: D4, 4.5.
  - Wrong kind: 4.3.
  - Contract: 3.1–3.3, 5.1.
  - The driver's critical requirements 1–5 each map to a MUST task.
  - No AC is uncovered and there is no scope drift. The migration question is gated behind an
    ESCALATION in task 6.2.

### Verdict: CONFIRM

### Non-blocking notes (address during execution; none block implementation)

- **Spec RLS scenario wording (please fix in the delta during execution).**
  `spec.md` "A non-superuser, non-BYPASSRLS role cannot read another owner's rows through this
  route" has this THEN: "the row-level security policy on `dataset_rows` denies the read". Through
  the HTTP route that is not the mechanism. Per D7, the service's `findByIdOwned` 404s first, and
  below it the `data_sources` RLS hides the source, so `dataset_rows` is never queried.
  - The observable outcome (the same 404 shape) is correct.
  - The requirement-level claim (RLS itself denies, not only app code) is still proven, by 4.4(a)
    through `data_sources` RLS and 4.4(c) through `dataset_rows_owner`.
  - Reword the THEN to "row-level security (on `data_sources`, and on `dataset_rows` itself — task
    4.4) denies access…", or equivalent. The evaluator should not read the current text as
    requiring a route-level test that hits the `dataset_rows` policy.
- tasks.md 4.1 has a doubled token: "multi-page, `nextCursor` `nextCursor` absent…". The meaning is
  unambiguous.
- These items carry over from round 2 and are still unaddressed; all are minor:
  - tasks.md ends with an empty `## Standing Constraints` heading.
  - Tasks 3.3 and 5.1 overlap. The service function belongs in `services/dataSourceService.ts`.
  - D3's "matching the existing convention" glosses over the fact that `limit <= 0 → 400` diverges
    from the existing routes.
  - The spec's first requirement says "cursor and/or offset". The design is cursor-only.
  - Task 4.6 should drive appends through the real `appendRows`.
- 4.4(d) ("assert listRows's SQL has no owner predicate") has no stated mechanism. Slick
  `.statements` inspection or code review are both acceptable. Name the method in the test.
