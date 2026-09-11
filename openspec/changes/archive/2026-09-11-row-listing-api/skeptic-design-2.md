## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `deb53526` + untracked `openspec/changes/row-listing-api/` (design.md, proposal.md,
tasks.md, specs/dataset-row-write-api/spec.md), re-read in full, against the real code.

### What I verified (with evidence)

- **CR1 (cursor=0) — fixed.** D2/D3, task 1.2, task 4.9 and a new spec scenario all accept `cursor >= 0`.
  Consistent with `appendRows` `maxExistingSeq (default -1L) + 1 + idx` (`DataSourceRepository.scala:392-394`).
- **CR3 (nextCursor absent + limit+1 probe) — fixed in design.md D2, task 1.3, 3.1, 4.8, 4.9, spec
  scenario.** 4.8 correctly asserts on the raw `JsObject` keys. BUT task 4.1 is stale (CR A below).
- **CR6 (SourceNotFound / one transaction) — fixed.** The cited pattern
  `table.filter(_.id === sourceId.value).map(_.datasetSchema).result.headOption` is real
  (`patchRow` :489, `deleteRow` :537), run under `ctx.withUserContext`. `data_sources` has FORCE RLS
  (`V35__rls_owner_only_tables.sql:40-41`), so a non-owner's lookup returns `None`. D7 now pins page
  query + COUNT in one `withUserContext` DBIO, with no lock.
- **CR7 (reuse RowResponseRow) — fixed.** `RowResponseRow(id, seq, updatedAt: String, data)` is at
  `DataSourceProtocol.scala:282`, format at :583. `schemas/sources/row-response-row.schema.json` exists.
  Frontend `RowResponseRow` is at `frontend/src/features/sources/types/dataSource.ts:205`.
- **CR8 (contract files) — fixed in tasks.md 3.1-3.3.** No OpenAPI file exists. Still stale in
  proposal.md (CR B below).
- **CR4 (D5) — D5 body fixed, and task 7.1 exists.** The route claim checks out:
  `DataSourceRoutes.scala:101-112` shows `path(DataSourceIdSegment)` has only `patch`/`delete`.
  BUT design.md's own Non-Goals still asserts the opposite (CR B).
- **CR5 (RLS test) — mostly fixed.** It now calls `listRows` directly, with a positive control, a
  privileged-pool contrast and a no-owner-predicate assertion. The expected negative outcome is
  under-specified (CR D).
- **CR2 — (a) fixed** (the concurrent-replace non-goal is in D2, Risks and a spec scenario). **(b) not
  fixed** (CR C).
- `Page.Default = Page(0,200)`, `Page.MaxLimit = 500` confirmed (`pagination.scala:11-12`).
  `findByIdOwned` (:152-158) is `withUserContext` plus an owner predicate. `readDatasetRows` (:593-601)
  is `withSystemContext`. No migration is needed.

### Verdict: REFUTE

All four items below are small text corrections. None of them reopens the architecture, which is
now sound.

### Change Requests

1. **(A) tasks.md 4.1 still says "`nextCursor` null on last page".** This contradicts D2, 1.3, 3.1
   and 4.8. Change it to "`nextCursor` absent on last page".

2. **(B) Leftover text contradicts the corrected D5 and CR8.**
   - design.md Goals/Non-Goals, last bullet: "Declared-schema delivery … (see D5) — HEL-1080
     already has a way to fetch a source's declared schema." This is the exact false premise D5 now
     retracts. Reword it to "not provided; tracked as a follow-up gap (D5, task 7.1)".
   - D5 says "see Non-Goals in proposal.md, restated here", but proposal.md's Non-goals has no such
     entry. Add one to proposal.md, or drop the cross-reference.
   - proposal.md Impact still lists "`schemas/`, `openspec/` OpenAPI spec". Replace it with the real
     targets: `schemas/sources/row-list-response.schema.json`, the spec delta, and
     `frontend/src/features/sources/{types/dataSource.ts,services/dataSourceService.ts}`. Add the
     "no OpenAPI file exists" note.

3. **(C) CR2(b) is unaddressed.** D2 still claims "(a) … a single-row append can only ever land on a
   page not yet fetched". This is false when rows at or above the caller's cursor are deleted
   concurrently.

   Example: the caller holds `nextCursor = c`, then rows `c..max` are deleted. The next append gets
   `maxExistingSeq + 1 <= c`, which is behind the cursor, so this caller never sees it.

   The true guarantee is narrower: every row that existed at the start of paging and was not deleted
   is returned exactly once, in `seq` order. This holds because keyset order on an immutable,
   unique `seq` is never renumbered by append, patch or delete. A newly appended row may or may not
   be seen.

   Rewrite (a) to say this. Also add one sentence noting that `patchRow` does not change `seq`
   (verified at `DataSourceRepository.scala:505-508`, which updates only `data`/`updated_at`).

4. **(D) Task 4.4's negative case has no pinned expected outcome, and as described it may never
   touch `dataset_rows` RLS.** Per D7, `listRows` first reads `data_sources.datasetSchema`. Under
   FORCE RLS on `data_sources`, a non-owner gets `None`, so the call returns `SourceNotFound` before
   the `dataset_rows` query runs. The `dataset_rows` `EXISTS` policy is then never exercised, even
   though the spec requirement names "the row-level security policy on `dataset_rows`". Pin both:
   - (a1) the direct `listRows` call as non-owner returns `SourceNotFound` (not `Right` with empty
     rows);
   - (a2) a raw `SELECT` on `dataset_rows WHERE data_source_id = <A's source>` as user B, on the same
     `helio_app_test` pool, returns 0 rows, while the privileged pool returns N. This proves the
     `dataset_rows` policy itself.

   Also fix a wording conflation. D7 calls the `datasetSchema` read "Step 2's ACL-scoped lookup
   (D6)", but D6 step 2 is the service's `findByIdOwned`, which has an owner predicate. State that the
   service does `findByIdOwned` (404/400), and that the repository's existence read has no owner
   predicate (which is what 4.4(d) asserts).

### Non-blocking notes

- tasks.md still ends with an empty `## Standing Constraints` heading (from round 1).
- Task 3.3 says to add "a service function" while naming only `types/dataSource.ts`. The service
  belongs in `services/dataSourceService.ts`, and 5.1 duplicates it. Merge 3.3 and 5.1, or split
  them cleanly.
- D3 says clamping matches the existing convention, but rejecting `limit <= 0` is a divergence from
  `DataSourceRoutes.scala:80-94`. Say so (from round 1).
- The spec delta's first requirement still says "cursor and/or offset". The design is cursor-only,
  so tighten it to "cursor".
- Task 4.6: drive the append through the real `appendRows` (from round 1).
