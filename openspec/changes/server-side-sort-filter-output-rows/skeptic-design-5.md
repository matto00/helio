## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

- Cold-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/output-routes-api/spec.md` in full, fresh (no prior-round context
  assumed).
- Re-traced every load-bearing code citation against the actual worktree, not
  taking design.md's prose at face value:
  - `OutputService.rows` (`backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:358-386`)
    — confirmed the `paged.total > 0` → `pipelineRunRepo == null` → heuristic
    three-way branch design.md D5 describes matches real code exactly.
  - `NodeSnapshotRepository.listRowsPaged` (`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:125-159`)
    — confirmed the existing `ORDER BY row_index ASC` / `OFFSET`/`LIMIT` shape
    and the `nodeFilter` fragment design.md's `hasAnyRow` sketch says it
    reuses.
  - `PublicDashboardRoutes.scala:95` — confirmed this is the unrelated
    `listRowsPaged` call site D5's amendment says must keep compiling
    unmodified; it does not pass a filter today, consistent with the design.
  - `idx_node_snapshots_pipeline_id` (`V94__outputs_model.sql:298`) —
    confirmed it exists, backing D9's "row selection is already indexed"
    claim.
  - `resetPanelPagination` (`panelsSlice.ts:112-114`) — confirmed it exists
    and (per a scan of its current call sites) has no caller yet, matching
    D4's "wiring its first real call site" claim.
  - CI Postgres version claim (D2 round 3's stated reason `pg_input_is_valid()`
    is unusable): `.github/workflows/ci.yml:304`'s `postgres:16` service is
    scoped to the **`e2e`** job only. The **`backend`** job (which is what
    actually runs `sbt test` — the verification command task 1.1 names) has
    no `services:` block at all; it runs against
    `io.zonky.test:embedded-postgres:2.0.7` (`backend/build.sbt:212`), whose
    POM (`~/.cache/coursier/.../embedded-postgres/2.0.7/embedded-postgres-2.0.7.pom`)
    pins `embedded-postgres-binaries.version` to **14.10.1** — confirmed by a
    resolved local cache hit for that exact artifact. So the citation backing
    D2 round 3's reasoning is factually wrong (the operative version for the
    actual `sbt test` verification path is Postgres 14, not 16), though I
    confirmed this does **not** change the resulting decision (PG14 also
    lacks `pg_input_is_valid()`, and none of the round-1/2/3 regex/cast
    behavior is version-sensitive between 14/16/18) — recording as a
    non-blocking citation-accuracy note, not a Change Request.
- Grepped `design.md` and `tasks.md` together for `IMMUTABLE`/`STABLE` to
  check the round-4 volatility fix actually propagated everywhere it needs
  to.
- Traced the full render path for a zero-row `usePanelData` result:
  `usePanelData.ts:118` (`rows = paginationEntry?.rows ?? []`) →
  `usePanelData.ts:156` (`noData`) → `usePanelData.ts:160`
  (`neverMaterialized`) → `PanelContent.tsx`'s `noData && neverMaterialized`
  branch (~347-370, "Not run yet") and plain `noData` branch (~371-377, "No
  data available") — both **precede** the `isOutputPanel` dispatch that
  mounts `OutputPanelContent`/`TableRenderer`.
  Then read `TableRenderer.tsx`'s existing filter-empty-state machinery
  (`emptyText`/`emptyAction`, ~627-655) — today's shipped HEL-451 behavior for
  "filter matches 0 of the loaded rows" is a **dedicated in-table state**
  ("No rows match your filter." + a "Clear filters" button), which only
  renders because `TableRenderer` mounts at all (client-side filtering never
  empties `paginationEntry.rows` itself — the raw loaded rows stay non-empty
  even when the filter matches none of them).

### Verdict: REFUTE

### Change Requests

1. **tasks.md 1.1 contradicts design.md's own round-4 correction on
   `safe_timestamptz`'s volatility category — an implementer following
   tasks.md literally reintroduces the exact defect round 4 just fixed.**
   `design.md` lines 82-89 (round-4 revision, triggered by skeptic-design-4's
   non-blocking note) explicitly changes `safe_timestamptz` from `IMMUTABLE`
   to `STABLE` ("its result for a zone-less input... depends on the session's
   `TimeZone` setting, which `IMMUTABLE` disallows depending on"), and the
   function body shown at design.md line 79 reads `$$ LANGUAGE plpgsql
   STABLE;`. `tasks.md` line 4-6 was never updated to match: it still reads
   `` `safe_timestamptz(text) RETURNS timestamptz` (`LANGUAGE plpgsql
   IMMUTABLE` with an `EXCEPTION WHEN OTHERS THEN RETURN NULL` guard...) ``
   — and explicitly instructs the implementer to build it "exactly as
   specified in design.md D2," while itself misstating what D2 says. This is
   a direct, mechanically-verifiable self-contradiction between the two
   documents that jointly govern implementation (confirmed via `grep -n
   "IMMUTABLE\|STABLE" design.md tasks.md` — tasks.md has zero occurrences of
   `STABLE`). Fix: update tasks.md line 4-6 to say `STABLE`, matching
   design.md verbatim.

2. **D4 (server-side filtering replaces client-side filtering of already-
   loaded rows) collides with the pre-existing, filter-unaware `noData` gate
   in `PanelContent`/`usePanelData` — D5's `hasAnyRow` fix only half-solves
   the resulting regression, and design.md never names the other half.**
   Today (HEL-451, client-side filter), a filter matching zero rows never
   empties `paginationEntry.rows` (the raw fetched page stays non-empty), so
   `PanelContent`'s top-level `noData` stays `false`, `TableRenderer` mounts,
   and the user sees a dedicated, tested empty state — "No rows match your
   filter." plus a "Clear filters" button (`TableRenderer.tsx` `emptyText`/
   `emptyAction`, ~627-655) — with the filter UI still visible and editable.

   Once this ticket ships (per D4/D1, the fetch itself now carries `filter`
   and the server returns only matching rows), a filter matching zero rows
   across the whole Output means `paginationEntry.rows` **is actually
   empty**, which flips `usePanelData`'s `noData` to `true` — a condition
   evaluated **before** `PanelContent` ever reaches the `isOutputPanel`
   dispatch that mounts `TableRenderer`. Two outcomes exist depending on
   `materialized`, and D5's fix only improves one of them:
   - Without D5's `hasAnyRow` fix: `materialized: false` →
     `neverMaterialized: true` → the actively-wrong "Not run yet" state
     (design.md already names and fixes this part, at line 283).
   - **With** D5's fix applied (the design's own stated end state):
     `materialized: true` → `neverMaterialized: false` → falls through to
     the generic `noData` branch → **"No data available"** (`PanelContent.tsx`
     ~371-377) — accurate as far as it goes, but it **replaces the entire
     table**, silently dropping the "Clear filters" button and the
     filter-specific messaging HEL-451 shipped and tested for exactly this
     scenario. A user who types a filter term that matches nothing now sees
     a generic empty-panel message with no in-panel way to see or clear the
     filter that caused it — a real UX regression relative to current
     production behavior, not merely a cosmetic wording gap. This is
     precisely the "interaction between decisions, not each in isolation"
     this round was asked to hunt for: D5 was written to fix `materialized`
     specifically, and design.md cites the correct downstream consumer
     (`PanelContent.tsx:348`, the `neverMaterialized` branch) but never
     traces one level further to the sibling `noData`-without-
     `neverMaterialized` branch that D4's architecture change newly makes
     reachable in the exact same scenario.

   Fix: design.md/tasks.md need an explicit decision for this case — e.g.
   `usePanelData`/`PanelContent` gaining a signal ("empty because a filter is
   currently active" — `activeFilter != null && rows.length === 0`) that
   routes to a filter-aware empty state (reusing or relocating
   `TableRenderer`'s existing "No rows match your filter."/"Clear filters"
   UX) rather than falling into the same generic `noData` branch used for a
   panel with no filter and no data at all. Whatever the resolution, it needs
   to be a named decision with a task and a verification step (a component
   test asserting a 0-match filtered fetch still offers a way to clear/edit
   the filter from the panel), not left to be discovered during
   implementation.

### Non-blocking notes

- D2 round 3's stated rationale for reverting `safe_timestamptz` to
  `plpgsql`/`EXCEPTION` cites `.github/workflows/ci.yml:304`
  (`postgres:16`) as "this repo's CI pins postgres:16." That line is scoped
  to the `e2e` Playwright job; the `backend` job that actually runs `sbt
  test` (task 1.1's own verification command) has no Postgres service block
  and instead uses `io.zonky.test:embedded-postgres:2.0.7`, which resolves
  to Postgres **14.10.1** (confirmed via the resolved POM in the local
  Coursier cache: `<embedded-postgres-binaries.version>14.10.1</...>`). The
  resulting decision is unaffected (PG14 also lacks `pg_input_is_valid()`,
  and none of the verified regex/cast behavior differs across 14/16/18), so
  this is not a Change Request — but the citation should be corrected to
  point at the actual constraint (`build.sbt:212`'s embedded-postgres
  version) rather than an inapplicable CI job, so a future reader doesn't
  inherit a citation that happens to support the right conclusion for the
  wrong reason.
