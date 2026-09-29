## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Spawn-cwd guard**: `pwd -P` = `/home/matt/Development/helio`; `assert-cwd.sh` returned
   `READY ambient=/home/matt/Development/helio branch=feature/output-filter-capability/HEL-1188`.
2. **HEAD/worktree state**: `git log --oneline -1` = `a4dbd83c HEL-1027 ...`; `git status` shows
   only the untracked `openspec/changes/output-filter-capability-contract/` dir — Execution has
   not started, so every source-code citation in design.md is checkable against this exact commit.
3. **Independently re-reproduced round 1's load-bearing live-Postgres claim (CR1)** rather than
   just trusting the narrative. Ran my own bench against the running local Postgres 18.4
   (`psql -U postgres -d postgres`, a fresh temp table, not round 1's session):
   ```
   CREATE TEMP TABLE skeptic_bench (id serial primary key, data jsonb);
   INSERT INTO skeptic_bench (data) SELECT jsonb_build_object('col', (n % 5000)::text)
     FROM generate_series(1, 200000) n;
   ANALYZE skeptic_bench;
   EXPLAIN (ANALYZE, BUFFERS) SELECT COUNT(*) FROM (
     SELECT 1 FROM skeptic_bench WHERE data ->> 'col' IS NOT NULL
     GROUP BY data ->> 'col' LIMIT 51
   ) t;
   ```
   Result: `Seq Scan on skeptic_bench (... actual rows=200000.00 ...)` feeding a `HashAggregate`
   that only then applies the `Limit` to `rows=51`. This independently confirms — from a second,
   freshly-built dataset, not a copy of round 1's — that the `LIMIT` trims *output*, never *scanned
   rows*, with no index on `data ->> 'col'`. Design.md D2/D7's corrected cost model
   (`O(columns x Output-row-count)` for `/filter-capabilities`, one full scan per named `eq`/`in`
   column for `/rows`) is accurate, not a restatement of the false round-1-draft claim.
4. **D3's `in`-cast gap (CR2) is now closed and internally consistent.** Re-read design.md D3's
   revision (lines 153-170), tasks.md 2.3, and tasks.md 7.5 side by side: all three now state the
   identical SQL form — `safe_numeric(data ->> $col) IN (safe_numeric($v1), ...)` /
   `safe_timestamptz(...)` for numeric/timestamp columns, plain bound-text `IN (...)` for
   string/boolean, each list element cast individually so one malformed element degrades to
   no-match without failing the others or the request. Task 7.5 explicitly requires the
   partial-malformed-`in`-list test. No contradiction between design.md/tasks.md on this point.
5. **Re-verified D1 from ground truth** (not taking round 1's characterization on faith): read
   `PipelineService.scala:1228-1331` directly. `capabilitiesAtNode` is keyed by
   `(pipelineId, stepId)`, resolves via `projectedSchemaAtNode` → `PipelineAnalyzeService.analyzeNodes`
   (pure schema projection from `dataSourceRepo.findByIdOwned(...).inferredSchema`), and never
   references `node_snapshots` anywhere in the method or its helpers. D1's "scope/rigidity/lifecycle
   mismatch" argument for not extending this endpoint is accurate and still sound.
6. **Re-verified D2/D3's ground-truth citations against current source**, read in full:
   `OutputRowsQuery.scala` (73 lines — matches design's line count), `NodeSnapshotRepository.scala`
   (305 lines — matches), confirming `nodeFilterFragment`, `sortCastExpr`
   (`safe_numeric`/`safe_timestamptz`), `quickTermFragment`/`filterWhereFragment` (bound `ILIKE`),
   `hasAnyRow` all match design's citations line-for-line. `OutputRoutes.scala`'s `rows` route
   (lines ~91-118) matches design's citation of where sort/filter shape validation happens.
7. **Re-verified D4's `PublicDashboardRoutes` claim**: read lines 60-95 directly — confirmed
   `outputRepo.findByIdInternal(outputId)` (not the sharing-aware `findById(id, user)`) followed by
   a direct `nodeSnapshotRepo.listRowsPaged` call, matching D4's "different ACL proof" claim
   verbatim.
8. **Re-verified D7's tier-1 caching mitigation is grounded in a real, already-existing mechanism**,
   not invented for this design: `grep`'d `latestSuccessfulCompletedAtInternal` — it is a real method
   on `pipelineRunRepo`, already used by `OutputService.materializedFor` and
   `PipelineRunService.submit` today. D7's proposal to key a future contract cache off this same
   timestamp signal names a concrete, already-wired data-version signal, not a hand-wave. Tier 2
   (materialized columnar projection) is explicitly the same escalation HEL-1027's own D9 already
   named for sort/filter, correctly cross-referenced rather than invented fresh.
9. **Confirmed V112 is still the next free migration number**: `ls backend/.../db/migration | sort
   -V` tops out at `V111__safe_cast_functions.sql`, which does define `safe_numeric`/
   `safe_timestamptz` as design.md claims.
10. **Confirmed the spec-amendment target (D9/ticket scope item 4) exists and matches the claimed
    pre-amendment content**: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`
    §3 ("Output controls & parameterized Outputs", line 243) currently describes the
    Refetch-vs-Recompute split with `{{var}}`-style pipeline-parameter recompute, exactly as D9
    describes the text it will amend.
11. **Confirmed `Page.MaxLimit = 500`** (`domain/model/pagination.scala:12`) exists as the named
    precedent D3 cites for the 100-entry `in`-list cap's "named ceiling, not unbounded" convention.
12. **Checked proposal.md's Impact section** — the round-1 non-blocking note (tighten the
    "O(columns)" framing to make the row-scan-per-column cost explicit) was also incorporated:
    "Cost is one full Output-row scan per Structured column ... not free, but bounded and one-time
    per load" — consistent with D7's corrected model, not the old glossed framing.
13. **Checked task 7.2's mutation instruction** — the round-1 non-blocking note (which of the two
    call sites to touch was ambiguous) was also tightened: it now says "hardcode a divergent
    ... literal at ONLY the `/filter-capabilities` call site (leaving the rows-endpoint's shared
    call untouched)."
14. **Confirmed no stale/uncorrected instances of the false "LIMIT bounds the work" claim remain**
    outside of context where it is explicitly being quoted-and-corrected (design.md D2's revision
    note, and skeptic-design-1.md's own evidence section, both clearly labeled as quoting the wrong
    claim being replaced).
15. **Spec delta re-checked against the archived HEL-1027 spec**: the archived
    `openspec/changes/archive/2026-09-28-server-side-sort-filter-output-rows/specs/output-routes-api/spec.md`
    sort/error scenarios are preserved verbatim in the new delta; the `filter` section is extended
    additively (new `ops` shape, new scenarios) without silently rewording any pre-existing
    requirement text.

### Verdict: CONFIRM

Both round-1 change requests are closed, verified against ground truth rather than taken on the
orchestrator's word:

- **CR1 (D7 cost model)**: independently reproduced on a freshly-built dataset — the corrected
  `O(columns x Output-row-count)` cost model is accurate, and "no new index" is now argued from
  that true cost (a per-Output, per-request column path can't be pre-indexed; a two-tier escalation
  path is named with tier 1 citing a real, already-existing invalidation signal
  `pipelineRunRepo.latestSuccessfulCompletedAtInternal`, and tier 2 correctly deferring to the same
  materialized-projection escalation HEL-1027's own D9 already named). Concrete enough to guide an
  implementer and a future ticket, not hand-waving.
- **CR2 (`in` value-side cast)**: design.md D3, tasks.md 2.3, and tasks.md 7.5 now state the
  identical SQL form and required test for numeric/timestamp `in` filtering, consistently.

Independently re-verified (not re-reviewed only where the diff touched) D1/D4's ground-truth
citations against the current `PipelineService.scala`/`PublicDashboardRoutes.scala`/
`OutputRowsQuery.scala`/`NodeSnapshotRepository.scala`/`OutputRoutes.scala`, the V111/V112 migration
numbering, the `docs/superpowers/specs/...` amendment target, and the `Page.MaxLimit` precedent —
all check out. No new issues introduced by the round-2 revision.

### Non-blocking notes

- Spec.md's new scenarios cover the top-level "a malformed range/equality value does not fail the
  whole request" case (`eq`/`gte`/`lte`), but there is no dedicated scenario mirroring tasks.md
  7.5's "one malformed element inside an otherwise-valid `in` list matches no row without failing
  the request or the other elements" case — the closest existing text is the generic "every `ops`
  value is compared using the same value-typed cast ... a malformed `ops` value degrades to 'no
  match' for that clause" sentence in the MODIFIED Requirement prose, which plausibly but not
  explicitly covers a single list element rather than the whole `in` clause. Not blocking (design.md
  and tasks.md already specify this precisely enough to implement and test correctly), but worth a
  one-sentence scenario addition for spec/test-authoring symmetry with the eq/gte/lte scenario
  already present.
