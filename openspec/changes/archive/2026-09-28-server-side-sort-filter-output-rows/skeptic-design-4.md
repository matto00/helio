## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Spawn-cwd guard:** `pwd -P` → `/home/matt/Development/helio`; `assert-cwd.sh` →
`READY ambient=/home/matt/Development/helio branch=feature/server-side-sort-filter-output-rows/HEL-1027`.
Proceeded normally.

**Fresh read of all artifacts:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/output-routes-api/spec.md` read in full, cold.

**Round-3 fix independently re-verified against a live database (not trusted from
prose).** Built the exact `safe_numeric`/`safe_timestamptz` function bodies from
design.md D2 verbatim in a scratch database (`skeptic_test_hel1027`, local Postgres
18.4 — the repo pins `postgres:16` for CI per `.github/workflows/ci.yml:304`, but
`plpgsql EXCEPTION`/calendar-validity behavior does not vary by that version delta,
and neither round 1-3 nor this round found any 16-vs-18 divergence relevant here):

```
CREATE FUNCTION ... succeeded with no error (both functions).

-- Six original cases, all match design.md's claimed outputs exactly:
2024-01-01T10:15                          -> 2024-01-01 10:15:00-08
2024-01-01T10:15+01:00                    -> 2024-01-01 01:15:00-08
2024-01-01T10:15:30+01:00[Europe/Paris]   -> 2024-01-01 01:15:30-08
01/31/2026                                -> 2026-01-31 00:00:00-08
2024-01-01                                -> 2024-01-01 00:00:00-08
garbage                                   -> NULL

-- Four calendar-invalid cases (round 3's target), all NULL, none throw:
2024-02-30  -> NULL
2024-13-45  -> NULL
9999-99-99  -> NULL
13/45/2024  -> NULL
```

Round 3's fix holds: no calendar-invalid input throws; all six round-1/2 cases are
unaffected by the `plpgsql`/`EXCEPTION` revert. Also independently checked
`safe_numeric`'s claimed pathological-input tolerance (`1e400`, a 70-digit integer,
`-42.5`, `abc`, empty string) — all resolve without error, consistent with D9's
claim that `safe_numeric` stays exception-free.

**D9 cost narrative checked against D2's actual function definitions:** consistent.
`safe_numeric` is plain `LANGUAGE sql`, no exception block, matches D9's "pays none
of the subtransaction overhead" claim. `safe_timestamptz` is `LANGUAGE plpgsql` with
`EXCEPTION WHEN OTHERS`, matches D9's "DOES pay it, once per row, for a
TIMESTAMP-column sort/filter specifically" claim. No inconsistency found.

**Spot-verified other design claims against real code** (fresh, not inherited from
prior rounds' narrative):
- `DataFieldType`'s five Structured + two Content cases (`backend/.../model.scala:670-683`)
  match D2/D3's category list exactly.
- `Output.schema: Vector[SchemaField]` (`model.scala:901-915`) and its surfacing via
  `OutputResponse.schema` (`OutputProtocol.scala:110`) confirm D2's "already exists,
  reused not invented" claim.
- `idx_node_snapshots_pipeline_id` (`V94__outputs_model.sql:298`) and
  `NodeSnapshotRepository.listRowsPaged`'s current `WHERE pipeline_id = ...` +
  shared `nodeFilter` fragment across count/data queries
  (`NodeSnapshotRepository.scala:125-159`) confirm D9's indexing claim and D5's
  "extend the existing shared-WHERE two-query shape" claim.
- `resetPanelPagination` (`panelsSlice.ts:112-114`) genuinely has zero call sites in
  frontend source (only its own test references it) — confirms D4's claim.
- `TableRenderer.tsx`'s real `handleSort`/`handleFilterChange` (lines 507-544)
  genuinely split into an unconditional first half
  (`toggleSort(key)`/`setFilters(next)`) and a `canWrite`-gated second half exactly
  as D4 round 2 describes — confirms the reconciliation is grounded in real code,
  not just prose.
- `OutputRoutes.scala:91-102`'s existing offset/limit parameter parsing and
  `OutputService.rows`'s `outputRepo.findById(id, user)` ACL gate running before
  `listRowsPaged` (`OutputService.scala:359-366`) confirm D1/D6's baseline claims.

### Verdict: REFUTE

### Change Requests

1. **D5's "`total` becomes the filtered count" silently breaks
   `OutputService.rows`'s existing `materialized`/`neverMaterialized` derivation,
   which uses `paged.total > 0` as a raw-existence proxy — untouched by any
   decision in design.md, unmentioned in spec.md, no task in tasks.md.**

   Ground truth (`backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:359-386`):

   ```scala
   case Some(output) =>
     nodeSnapshotRepo.listRowsPaged(...).flatMap { paged =>
       if (paged.total > 0)
         // Non-empty snapshot -- unambiguously materialized, no need to
         // consult run history.
         Future.successful(Right(OutputRowsResponse(..., materialized = true)))
       else if (pipelineRunRepo == null)
         Future.successful(Right(OutputRowsResponse(..., materialized = true)))
       else
         pipelineRunRepo.latestSuccessfulCompletedAtInternal(output.node.pipelineId).map { lastSuccess =>
           val materialized = lastSuccess.exists(t => !t.isBefore(output.createdAt))
           Right(OutputRowsResponse(..., materialized = materialized))
         }
     }
   ```

   Today, `paged.total > 0` is a correct proxy for "this Output has any data at
   all" because `total` is always the raw row count. The moment D5 ships,
   `paged.total` means "count under the current filter" whenever a filter is
   active. A filter that legitimately matches **zero** rows of an Output that
   genuinely has data (the ordinary, expected case for a specific-enough filter
   term — nothing malformed, nothing edge-case) now falls through to the
   `pipelineRunRepo` branch, which was written and is only correct for the
   genuinely-empty/never-run case.

   Frontend consequence, confirmed by reading the actual consumers (not
   inferred): `usePanelData.ts:156-162` computes `noData = rows.length === 0`
   (true for a 0-match filtered fetch) and
   `neverMaterialized = noData && paginationEntry?.materialized === false`;
   `PanelContent.tsx:348` renders a **distinct "never materialized / run this
   pipeline" empty state** when `neverMaterialized` is true, not the ordinary
   "no rows match" state. So whether a 0-match filter shows the correct "0
   results" UI or the wrong "this output was never run" UI now depends on the
   `pipelineRunRepo.latestSuccessfulCompletedAtInternal` heuristic
   (`lastSuccess.exists(t => !t.isBefore(output.createdAt))`), which has nothing
   to do with whether the filter matched.

   This is not merely a latent edge case: `NodeSnapshotRepository.listRowsPaged`
   (`NodeSnapshotRepository.scala:125-131`) is scoped by `pipelineId`/
   `nodeStepId`/`explicitRootId` — **it takes no `outputId` parameter at all** —
   so the same underlying `node_snapshots` rows can legitimately be visible
   through more than one `Output` row with a different `createdAt` (e.g. an
   Output recreated/re-pointed at an existing node/step without a fresh
   pipeline run since). For such an Output, an **unfiltered** request today
   short-circuits at `paged.total > 0` and correctly reports `materialized:
   true` — but the moment a filter is added that matches zero of those same
   real rows, the SAME Output would now report `materialized: false` via the
   `lastSuccess.isBefore(output.createdAt)` check, a direct, demonstrable
   inconsistency for identical underlying data depending solely on whether a
   filter happens to match zero rows. Even in the ordinary case where this
   heuristic still resolves to `true` by coincidence, the design change causes
   an unconditional extra `pipelineRunRepo` DB round-trip on every 0-match
   filtered request that D9 (which otherwise carefully reasons about the cost
   of this ticket's SQL changes) never accounts for.

   **Required revision:** `design.md` needs a decision (a D5 amendment, or a new
   D10) specifying that `materialized`/"has this Output ever produced data"
   is derived from a signal independent of the filtered total — e.g.
   `listRowsPaged` returns both the filtered `total` (for `hasMore`/count) and
   a separate raw-existence signal (a boolean, or the unfiltered count), and
   `OutputService.rows`'s `paged.total > 0` check at line 368 is changed to key
   off that raw signal, not the filtered one. `spec.md` needs a scenario
   covering "an active filter matching zero rows in an Output known to have
   data does not report `materialized: false`" (distinct from the existing
   "never materialized" case, which must still work for a genuinely-empty
   Output). `tasks.md` section 3 needs an explicit task for this, since it
   changes `OutputService.rows` in a way task 3.1 as currently scoped ("resolve
   sort/filter... returning a typed rejection... before ever calling
   `listRowsPaged`") does not cover.

### Non-blocking notes

- `safe_timestamptz`/`safe_numeric` are both marked `IMMUTABLE` despite
  `safe_timestamptz`'s result depending on the session's `TimeZone` setting for
  a zone-less input (e.g. `2024-01-01T10:15` resolves differently under a
  different `TimeZone`) — strictly a mislabel relative to Postgres's semantics
  for the `IMMUTABLE` category. Not upgraded to a Change Request because D9
  already rules out any functional index over these (the only place the
  mislabel could cause an actual incorrect-result bug via plan-time constant
  folding, and the argument here is never a query-time constant), so the
  practical blast radius is zero at this ticket's scope. Worth a one-line
  acknowledgment in D2 if the executor wants to close the theoretical gap, but
  not blocking.
