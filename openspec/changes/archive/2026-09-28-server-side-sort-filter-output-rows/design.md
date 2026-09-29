## Context

`GET /api/outputs/:id/rows` (`OutputRoutes.scala:91-102` → `OutputService.rows` →
`NodeSnapshotRepository.listRowsPaged`) already does `ORDER BY row_index ASC` / `OFFSET` / `LIMIT`
in SQL under `ctx.withSystemContext` (RLS-bypassing), gated ONLY by `OutputService.rows`'s prior
`outputRepo.findById(id, user)` sharing-aware ACL check. `Output.schema: Vector[SchemaField]`
(`{name, type}`, canonical type strings from `DataFieldType.asString`) is already derived
symbolically by `PipelineAnalyzeService` (no row-0 inference) and already surfaced on
`OutputResponse.schema` (`OutputProtocol.scala:110`) — panels already receive this for HEL-469
per-column formatting. This ticket reuses that same schema as the sortability/typing source of
truth; it does not invent a new one.

HEL-451's filter, as shipped, is case-insensitive **substring ("contains")** matching only — a
quick term (any column) ANDed with optional per-column terms (`tableFilterPredicate.ts`). There is
no richer operator set to replicate.

## Decisions

### D1 — Query parameter shapes

Add two optional query params to `GET /api/outputs/:id/rows`:

- `sort=<column>:<asc|desc>` (e.g. `sort=revenue:desc`). Absent → unchanged behavior
  (`ORDER BY row_index ASC`).
- `filter=<url-encoded JSON>` — same shape as the client's existing `TableColumnFilters`
  (`outputConfigTypes.ts`): `{"quick"?: string, "columns"?: Record<string, string>}`. Reusing the
  client's own wire shape means the frontend serializes today's in-memory filter state directly,
  no new type. Malformed JSON → `400`.

Both are designed to be trivially extensible for HEL-915 (a dashboard variable is conceptually one
more `filter.columns` entry, or a richer future `filter.ops[]`) — no HEL-915 work is done here.

### D2 — Column typing: `output.schema` is the source of truth, never row-0 inference

Resolve a column's server-sortable/server-filterable-with-numeric-semantics status from
`output.schema.find(_.name == column)`:

- **Structured category** (`StringType`, `IntegerType`, `FloatType`, `BooleanType`,
  `TimestampType`) → sortable. Cast expression per type:
  - `IntegerType`/`FloatType` → `safe_numeric(data ->> $key)`
  - `TimestampType` → `safe_timestamptz(data ->> $key)`
  - `StringType`/`BooleanType` → `data ->> $key` (text compare is correct for boolean's two
    literal values `"true"`/`"false"`, and is the intentional semantics for string)
- **Content category** (`StringBodyType`, `BinaryRefType`) or **column absent from
  `output.schema`** (empty/stale schema on a legacy or never-re-analyzed Output) → **not
  server-sortable** — see D3 for the resulting behavior. Never inferred from sampled row data
  (MISTAKES.md: a schema inferred from row 0 is a known trap — the declared schema already exists
  and must be used instead).

**Migration V111** (`V111__safe_cast_functions.sql`, next free number after V110) adds two
functions, `safe_numeric(text) RETURNS numeric` and `safe_timestamptz(text) RETURNS
timestamptz`. Rationale: a column's *declared* type can still contain a malformed value for an
individual row (bad upstream data, a type-narrowing edit after data was already written) — an
un-guarded `::numeric`/`::timestamptz` cast throws and 500s the WHOLE query on one bad row.
`safe_*` converts that row's sort key to `NULL` instead (Postgres sorts `NULL` last by default in
`ASC`, and `NULLS LAST` is made explicit in the generated `ORDER BY` for `DESC` too, so a
malformed value never silently floats to the top of a `DESC` sort).

**Revision (skeptic-design-1.md, change request 1):** these are, where safe, `LANGUAGE sql`
functions using a regex-guarded `CASE` expression rather than `LANGUAGE plpgsql` with an
`EXCEPTION` block — **but see the round-3 correction below: `safe_timestamptz` could not stay
pure-SQL, because regex shape does not imply calendar validity.**

```sql
CREATE FUNCTION safe_numeric(val text) RETURNS numeric AS $$
  SELECT CASE WHEN val ~ '^-?\d+(\.\d+)?([eE][+-]?\d+)?$' THEN val::numeric ELSE NULL END
$$ LANGUAGE sql IMMUTABLE;

CREATE FUNCTION safe_timestamptz(val text) RETURNS timestamptz AS $$
BEGIN
  IF val !~ ('^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?'
          || '(Z|[+-]\d{2}:?\d{2})?(\[[^\]]+\])?)?|\d{2}/\d{2}/\d{4})$') THEN
    RETURN NULL;
  END IF;
  RETURN regexp_replace(val, '\[[^\]]+\]$', '')::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
```

**Volatility category (skeptic-design-4.md non-blocking note, addressed anyway):**
`safe_timestamptz` is marked `STABLE`, not `IMMUTABLE` — its result for a zone-less input (e.g.
`2024-01-01T10:15`) depends on the session's `TimeZone` setting, which `IMMUTABLE` disallows
depending on. `safe_numeric` has no such dependency (numeric parsing is locale/timezone-independent)
and correctly stays `IMMUTABLE`. The skeptic noted this had zero practical blast radius at this
ticket's scope (D9 already rules out any functional index these could mislead the planner through),
but the correct category costs nothing to fix, so it's fixed rather than left as a known mislabel.

**Why the asymmetry (round-1 rationale, still valid for `safe_numeric`):** a `LANGUAGE plpgsql`
function with an `EXCEPTION` clause pays a real, well-documented Postgres cost on every
invocation regardless of whether an exception fires — entering/exiting such a block starts an
implicit subtransaction. `safe_numeric` stays a plain `LANGUAGE sql` function with no exception
handling (no subtransaction cost, ordinary expression evaluation the planner can inline) because
digit-shape validity IS full numeric validity for Postgres's `numeric` type — confirmed
(round 3) against pathological inputs (`1e400`, a 70-digit integer) on a live Postgres 18
instance: all cast successfully, no realistic overflow/range ceiling a JSON-numeric value would
hit. `safe_timestamptz` cannot make the same claim — see below.

**Regex coverage, corrected against real code (not asserted from memory) — twice now:**

- Round 1 correction: an earlier draft claimed `node_snapshots.data`'s timestamps are "always
  ISO-8601" — checked against
  `backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala:15-19`
  (`looksLikeTimestamp`, shared by `SchemaInferenceEngine` and `DatasetRowValidator`) and that
  claim is **false**: this codebase's own schema inference already accepts FOUR formats as a
  timestamp — `ISO_DATE_TIME`, `ISO_LOCAL_DATE_TIME`, a bare `ISO_LOCAL_DATE` (`yyyy-MM-dd`), and
  `MM/dd/yyyy`. Fixed by adding `MM/dd/yyyy` as a second top-level alternative — confirmed against
  a live local Postgres 18 instance under its default `DateStyle` (`ISO, MDY`, unmodified anywhere
  in this repo): `SELECT '01/31/2026'::timestamptz` → `2026-01-31 00:00:00-08`. Task 1.1's
  verification is now DONE at design time, not merely required later.
- Round 2 correction (skeptic-design-2.md, change request 1): the round-1 regex still required
  `\d{2}:\d{2}:\d{2}` (seconds mandatory) and had no allowance for a bracketed zone-region suffix
  — but `ISO_LOCAL_DATE_TIME`/`ISO_DATE_TIME` both make seconds OPTIONAL, and `ISO_DATE_TIME`
  additionally accepts a trailing `[Zone/Id]` (e.g. `2024-01-01T10:15:30+01:00[Europe/Paris]`).
  Verified independently against a live local Postgres 18 instance (not merely re-read and
  asserted, per the skeptic's explicit ask) — the regex above now makes the seconds/fraction group
  optional and adds an optional `(\[[^\]]+\])?` suffix; **critically, the bracket suffix is
  syntax Java accepts but Postgres's `::timestamptz` input parser does NOT** (confirmed: `SELECT
  '2024-01-01T10:15:30+01:00[Europe/Paris]'::timestamptz` → `ERROR: invalid input syntax`), so
  the cast expression strips it first via `regexp_replace(val, '\[[^\]]+\]$', '')` before casting
  — matching the regex alone would have reintroduced exactly the un-guarded-cast-failure risk D2
  exists to prevent, one layer later. All six representative cases (no-seconds, offset+no-seconds,
  full ISO+bracket, `MM/dd/yyyy`, bare date, and garbage) were run end-to-end against the real
  function definition on a live Postgres 18 instance: `2024-01-01T10:15` → `2024-01-01
  10:15:00-08`; `2024-01-01T10:15+01:00` → `2024-01-01 01:15:00-08`;
  `2024-01-01T10:15:30+01:00[Europe/Paris]` → `2024-01-01 01:15:30-08`; `01/31/2026` →
  `2026-01-31 00:00:00-08`; `2024-01-01` → `2024-01-01 00:00:00-08`; `garbage` → `NULL`. A value
  matching neither alternative is genuinely malformed relative to every format this codebase's own
  inference recognizes, and sorts as `NULL` — an accepted, documented limitation, not a silent gap.
- **Round 3 correction (skeptic-design-3.md, change request 1) — the load-bearing one, found only
  by independently executing against a live database rather than re-reading prose:** the regex
  above validates DIGIT SHAPE, never CALENDAR VALIDITY. A value that is digit-shaped like one of
  the four recognized formats but semantically invalid (`2024-02-30`, `2024-13-45`, `9999-99-99`,
  `13/45/2024`) matches the regex — so the `CASE` branch attempts the cast, and Postgres's own
  `::timestamptz` parser THROWS (`ERROR: date/time field value out of range`) rather than
  returning anything, for a pure-`LANGUAGE sql` function with no way to catch it. Reproduced
  directly on the same live Postgres 18 instance used throughout this decision. This directly
  contradicted both D2's own stated purpose (never 500 the whole query on one bad row) and
  `specs/output-routes-api/spec.md`'s explicit scenario requirement — and unlike the round-1/2
  regex-coverage gaps (which degrade to a merely-useless all-`NULL` sort), this one is a genuine
  `500`, on a realistic "bad upstream data" input D2 itself already names as the scenario it
  exists to guard against; **one bad row anywhere in an Output would 500 every future
  `sort=<timestamp column>` request against that Output.**

  A clean, exception-free fix exists — `pg_input_is_valid()`, a built-in type-validity check with
  no subtransaction cost — but it requires **Postgres 17+**. **Citation correction
  (skeptic-design-5.md non-blocking note):** an earlier draft cited `.github/workflows/ci.yml:304`
  (`postgres:16`) for this constraint, but that service block belongs to the `e2e` job only. The
  `backend` job — the one that actually runs `sbt test`, task 1.1's own verification command — has
  no `services:` block at all and instead runs against `io.zonky.test:embedded-postgres:2.0.7`
  (`backend/build.sbt:212`), whose resolved POM pins `embedded-postgres-binaries.version` to
  **14.10.1** (confirmed directly from the local Coursier cache). The actual operative constraint
  for `sbt test` is Postgres 14, not 16 — an even stronger reason `pg_input_is_valid()` (17+) is
  unusable here, so the resulting decision is unchanged; only the citation was wrong. No other
  pure-`LANGUAGE sql` mechanism validates calendar correctness without either reimplementing full
  calendar/leap-year arithmetic by hand (needlessly complex and itself a new correctness surface)
  or attempting the cast. **Decision: `safe_timestamptz` reverts to `LANGUAGE plpgsql` with an
  `EXCEPTION WHEN OTHERS THEN RETURN NULL` guard** (shown in the function definition above),
  accepting the per-row subtransaction cost D2's round-1 revision was written to avoid — for this
  ONE function only, not `safe_numeric` (which has no calendar-validity analogue, per the
  numeric-overflow check above). This is a deliberate, narrow scope-back, not an abandonment of
  the round-1 fix: sorting by a NUMERIC column (presumably the common case for the ticket's own
  `revenue`/`quantity` examples) still pays zero subtransaction cost; only sorting by a TIMESTAMP
  column pays it, and only because correctness (never 500 the whole query) is non-negotiable
  against a performance concern that D9 already established is small at this ticket's stated
  scale. Re-verified end-to-end on the same live Postgres 18 instance: all six round-1/2 cases
  still produce identical results under the `plpgsql` version, AND all four calendar-invalid cases
  now return `NULL` instead of throwing.

### D3 — Non-server-sortable/filterable column: defined, non-silent behavior

- **Server**: `sort=<col>:...` or a `filter.columns.<col>` entry naming a column not in
  `output.schema`'s Structured category → `400 Bad Request`,
  `{"error": "column not sortable", "column": "<col>"}` (sort) /
  `{"error": "column not filterable", "column": "<col>"}` (filter). The quick filter term is
  exempt from this check — it matches only Structured columns automatically (a Content column is
  silently excluded from the quick-match OR, not an error) since the user never names a specific
  column for it.
- **Client**: `PanelCard`/`TableRenderer` already receive `output.schema` (existing HEL-469
  plumbing). Gate the sort control and the per-column filter input on
  `DataFieldType.fromString(schema.find(c => c.name === column)?.type)` being a Structured type —
  the UI never lets a user select an unsortable column in the first place, so the `400` path is
  defense-in-depth (a stale client, a schema that changed after the panel loaded), not the primary
  UX. When it IS hit (e.g. race with a schema change), surface a toast/inline error rather than
  silently dropping the sort/filter — never silent.

### D4 — Pagination reset semantics: state ownership and plumbing

**Revision (skeptic-design-1.md, change request 2):** the original draft of this decision claimed
resetting pagination "mirrors how `usePanelData`/`panelsSlice` already reset on other panel-config
changes" — checked against real code and this is false: `resetPanelPagination`
(`panelsSlice.ts:112-114`) has **zero call sites** anywhere in the frontend (unused scaffolding),
`usePanelData`'s fetch-effect dedupe key (`usePanelData.ts:52-113`) has no sort/filter awareness,
and sort/filter today are **component-local `useState` inside `TableRenderer.tsx`**
(`useSortedRows`/`toggleSort`, `filters`/`setFilters`) — three component layers below
`PanelCardBody`, which is where `fetchPanelPage` is actually dispatched
(`PanelCard.tsx:138-150`). No reset mechanism reaching the fetch layer exists today; this ticket
must build one, not merely invoke an existing pattern. Corrected design:

- **Authoritative state moves up to `PanelCardBody`.** It gains two new pieces of per-panel state,
  `activeSort: {column, direction} | null` and `activeFilter: TableColumnFilters | null`, seeded
  once from the Output config's persisted `columnSort`/`columnFilters` defaults (today's initial
  values) on mount/output-change — the same seeding pattern `usePanelData` already uses for its
  own initial fetch params.
- **New callback props, threaded `TableRenderer` → `PanelContent` → `PanelCardBody`:**
  `onSortChange(column, direction | null)` and `onFilterChange(filters)`. `TableRenderer`'s sort
  and filter UI become **controlled**: the `columnSort`/`columnFilters` props it already receives
  now carry the LIVE authoritative value (not merely a one-time seed), and its click/type handlers
  call the new callbacks.

  **Revision (skeptic-design-2.md, change request 2) — reconciling with the existing
  `canWrite`-gated persist, instead of the ambiguous "instead of mutating local state directly"
  phrasing above.** `TableRenderer.tsx`'s real `handleSort`/`handleFilterChange`
  (lines 507/532) are NOT a single `canWrite`-gated block — they already split into two
  independent halves:
  1. An **unconditional** first half: `toggleSort(key)` / `setFilters(next)` — updates local UI
     state and fires on every activation regardless of `canWrite`. This is what makes the sort
     arrows/filter inputs themselves work for a shared-dashboard viewer today.
  2. A **`canWrite`-gated** second half (`if (... || !canWrite) return;` then a debounced
     `persistColumnSort`/`persistColumnFilters` PATCH) — the HEL-448 D7-ruled "sticky as the
     panel's new default" behavior, owner-only because it writes the Output's `config` via RLS.
  The new `onSortChange`/`onFilterChange` calls are added to the **first, unconditional half** —
  called unconditionally alongside `toggleSort`/`setFilters`, firing for every user regardless of
  `canWrite`, exactly mirroring how the local UI update itself is already unconditional. The
  second, `canWrite`-gated half (the debounced config-PATCH via `persistColumnSort`/
  `persistColumnFilters`) is **retained completely unmodified** — it is an orthogonal concern
  (does this become the panel's new saved default) from the new concern this ticket adds (does the
  server refetch and re-rank correctly for whoever is looking right now). Concretely,
  `handleSort`'s shape becomes:
  ```
  function handleSort(key: string) {
    toggleSort(key);              // unchanged — local UI state
    const next = /* ...existing asc/desc math... */;
    onSortChange(next.key, next.direction);   // NEW — unconditional, drives the server refetch
    if (key === UNSORTED_SENTINEL || !canWrite) return;  // unchanged — persist gate
    /* ...existing debounced persistColumnSort call, unchanged... */
  }
  ```
  and `handleFilterChange` mirrors this shape identically for `onFilterChange`. This resolves the
  skeptic's two-implementation ambiguity in favor of option (a) — the option that actually
  satisfies D6/the ticket's read-ACL-only mandate — by name, not merely by preference: option (b)
  (folding the whole handler, including the `canWrite` early-return, into the new callback path)
  is explicitly REJECTED, because it would make the new server-accuracy fetch a silent no-op for
  every non-owner shared-dashboard viewer, which is precisely the failure this ticket exists to
  fix, now scoped to a specific user population instead of everyone.
- **On either callback firing**, `PanelCardBody`: (1) updates `activeSort`/`activeFilter`,
  (2) dispatches `resetPanelPagination(panelId)` — wiring its first real call site, (3) calls
  `fetchPanelPage({ panelId, outputId, page: 0, pageSize: 200, sort, filter })` with the new
  params. This reset-then-refetch sequence is what AC #2 ("no duplicated or dropped rows across
  pages") actually depends on — there is no other point in the current architecture where a
  sort/filter change could trigger it.
- **`useSortedRows`'s existing client-side re-sort is REMOVED** for any column the server sorted
  (the normal case) — the rows arriving from the server are already in final order, and
  re-sorting them client-side is not just redundant but risks the exact masking bug the skeptic
  flagged (a local `toggleSort` cycling to a direction the server was never asked for, silently
  disagreeing with what was actually fetched). For the D3 non-server-sortable-column path, no
  client resort is substituted either — that column's sort control is disabled per D3, so this
  code path is reachable only via the defense-in-depth `400`, which surfaces a visible error
  (task 4.4), never a silent client-side resort standing in for the missing server one.
- `tableFilterPredicate.ts`'s `rowMatchesFilters` (D7) is retained but now reads `activeFilter`
  from `PanelCardBody` (not a separate locally-owned `filters` state) — its sole remaining purpose
  is masking the brief window between a filter change and its refetch response landing, never a
  second, independent source of filter truth.

The stable tiebreaker (`row_index ASC`, always appended last in the generated `ORDER BY`
regardless of the requested `sort`) guarantees no duplicated/dropped rows across pages for a FIXED
sort/filter once the reset above fires correctly — Postgres `OFFSET`/`LIMIT` without a
deterministic full ordering can otherwise reorder ties between page fetches.

### D5 — Filtered total / `hasMore`

`NodeSnapshotRepository.listRowsPaged`'s existing two-query shape (count, then page) is extended:
the SAME `WHERE`-clause fragment (base node filter AND, when present, the filter predicate) is
used for both the count query and the data query, so `total` always reflects whatever `WHERE`
actually ran — filtered when a filter is present, raw otherwise. `OutputRowsResponse.total` is
unchanged in shape (still one `Int`); its MEANING changes to "count under the current filter",
which is exactly what `hasMore = offset + pageSize < total` (`panelThunks.ts`) already needs with
no client-side formula change.

**D5 amendment (skeptic-design-4.md, change request 1) — `total`'s new filtered meaning silently
breaks `OutputService.rows`'s existing `materialized` derivation.** Ground truth
(`OutputService.scala:359-386`): today, `paged.total > 0` is used as a proxy for "this Output has
ANY data at all," falling back to a `pipelineRunRepo.latestSuccessfulCompletedAtInternal` heuristic
only when `total == 0`. That proxy is correct ONLY because `total` is always the raw row count
today. Once `total` can mean "count under the current filter" (this decision, above), a filter
that legitimately matches ZERO rows of an Output that genuinely has data — the ordinary case for
any sufficiently specific filter term, nothing malformed — would incorrectly fall into the
never-materialized branch, which the frontend (`usePanelData.ts:156-162`,
`PanelContent.tsx:348`) renders as a distinct "this Output was never run" empty state instead of
the correct "0 rows match your filter" state. Worse: since `listRowsPaged` is keyed by
`pipelineId`/`nodeStepId`/`rootId`, not `outputId`, two different `Output` rows can share the same
underlying `node_snapshots` data with different `createdAt` values — so the SAME underlying data
could report `materialized: true` unfiltered and `materialized: false` under a 0-match filter,
purely as an artifact of this change, not a real difference in the data.

**Fix: decouple `materialized`'s "does raw data exist" signal from the (now possibly-filtered)
`total`, without touching `PagedResult[A]`'s generic shape** (that type is also consumed
unmodified by `PublicDashboardRoutes.scala:95`'s own `listRowsPaged` call, which never passes a
filter and must keep compiling and behaving identically — this fix must not touch it). Add one
new, narrow repository method:

```scala
// NodeSnapshotRepository — cheap indexed existence check, independent of any filter predicate.
def hasAnyRow(pipelineId: String, nodeStepId: Option[String], explicitRootId: Option[String]): Future[Boolean] =
  ctx.withSystemContext(
    sql"SELECT EXISTS(SELECT 1 FROM node_snapshots WHERE pipeline_id = $pipelineId"
      .concat(/* same nodeFilter fragment listRowsPaged already builds */ sql"")
      .concat(sql" LIMIT 1)")
      .as[Boolean].head
  )
```

`OutputService.rows` computes its raw-existence signal as: `paged.total > 0` when NO filter is
active (today's exact behavior, zero added cost — the overwhelmingly common case, since most
panel fetches sort/paginate without filtering); `nodeSnapshotRepo.hasAnyRow(...)` when a filter
IS active (one extra cheap indexed `EXISTS ... LIMIT 1` query — Postgres stops at the first match
via `idx_node_snapshots_pipeline_id` — paid only on a filtered request, which D9's existing cost
reasoning already has headroom for). The three-way `materialized` branch
(raw-exists → `true`; else `pipelineRunRepo == null` → `true`; else → the existing heuristic) is
otherwise completely unchanged — this fix only swaps which boolean feeds the first branch's
condition when a filter is present. `OutputRowsResponse.total`/`hasMore` remain exactly as D5
specifies above (filtered when a filter is active) — only the INTERNAL `materialized` derivation
is decoupled from it.

### D6 — Security

Every user-supplied value (sort column name, sort direction, filter quick term, filter per-column
term/name) is passed as a **bound SQL parameter** via Slick's `sql"..."` string interpolation
(which parameterizes automatically) — never concatenated into raw SQL text. The column NAME is
always the right-hand operand of `data ->> $key` (a bind parameter is valid there), so no
identifier-quoting/allow-listing hack is needed for the JSON key itself. Sort DIRECTION (`asc`/
`desc`) is validated against a closed 2-value set in Scala BEFORE it ever reaches SQL (it can't be
parameterized as ASC/DESC keywords) — an unrecognized direction is a `400`, never interpolated.
Execution must include a test that sends a hostile column name (e.g. containing `'; DROP TABLE
node_snapshots; --` or a `->` operator injection attempt) and asserts it is rejected as
not-server-sortable (`400`, D3) with no SQL error and no data leakage — this is the required
red-first security probe for this ticket, independent of the sort-ranking red-first proof.

The existing ACL gate (`outputRepo.findById(id, user)` in `OutputService.rows`, running BEFORE
`listRowsPaged`) is unchanged and remains the only access check; sort/filter parameters flow
through the same already-authorized call, never a new code path that could skip it.

### D7 — Disclosure removal/restatement

- **HEL-448's truncation note** (`LoadedScopeDisclosure.tsx`'s `!filtering` branch, "Sort covers
  only the loaded rows.") — REMOVED. Once sort ranks the whole Output, `rowsTruncated` (from
  `hasMore`) no longer implies a partial ranking; showing the note would now be actively wrong.
- **HEL-451's loaded-scope note** (`filtering` branch, "N of M loaded rows match." / "N result(s).")
  — RESTATED: once `matchCount`/`total` are Output-wide (D5), the component no longer needs the
  loaded-vs-matched distinction. Collapse both `filtering` branches to a single "{total}
  {result|results}." using the server's filtered `total`, not the client's local
  `rowMatchesFilters` count over the loaded page (that predicate becomes client-side-fallback-only,
  D3's defense-in-depth path — see below).
- `tableFilterPredicate.ts`'s `rowMatchesFilters` is KEPT, not deleted: it still runs client-side
  as the actual row-hiding mechanism for whatever page is currently loaded (the server did the
  real filtering server-side; the client still needs to decide which of the rows it already holds
  to render, and a stale/in-flight-refetch window can transiently hold rows that don't match a
  just-changed filter). It is no longer the source of the DISPLAYED COUNT.

### D8 — Non-goals (unchanged from proposal.md)

HEL-915 itself; chart panels' first-N-rows behavior; HEL-588 cross-filter and HEL-572 drill-down
(both client-side over already-loaded rows, verified-owner-ruling-governed for their OWN
interaction model per `openspec/changes/archive/2026-09-25-cross-filter-panels/design.md`, and
untouched by this ticket's row-fetching change); a richer filter-operator set beyond "contains".

### D9 — Performance & indexing (added: skeptic-design-1.md, change request 1)

ticket.md's driver context explicitly requires this decision ("state explicitly whether an index
is needed"); the original draft omitted it entirely. Answer: **no new index is added for the
JSONB key extraction itself.**

- **Row selection is already indexed.** `OutputService.rows`/`listRowsPaged`'s `WHERE` clause
  filters on `pipeline_id` (and `node_step_id`/`root_id`), and `idx_node_snapshots_pipeline_id`
  (`V94__outputs_model.sql:298`) already covers that filter — sort/filter never scan the whole
  `node_snapshots` table, only the Output's own rows.
- **A functional index cannot target the sort/filter column, because it is arbitrary and
  per-request.** `sort=<column>` and `filter.columns.<column>` name whatever field the CALLER
  picks from the Output's own dynamic, per-pipeline schema — there is no fixed, enumerable set of
  columns to build a `CREATE INDEX ... ((data ->> 'col'))` functional index against ahead of time
  (unlike, say, `dataset_rows`' fixed columns). A GIN index on `data` (`jsonb_path_ops`)
  accelerates containment (`@>`) queries, not `ORDER BY` on an extracted scalar — it would not
  help this query shape at all.
- **Expected cost at the ticket's own stated scale is acceptable — for both cast paths, including
  the `plpgsql` one D2's round-3 correction reintroduced for `safe_timestamptz`.** For an `ORDER
  BY <expr> LIMIT n` query, Postgres uses a top-N heapsort rather than sorting the full result set
  when `n` is small relative to the row count — the common case here (`limit` defaults to 200,
  capped at `Page.MaxLimit = 500`). At the ticket's own 10,000-row working example, a sequential
  scan of an already `pipeline_id`-narrowed row set, extracting one JSONB key and applying a cast
  per row, is the same order of cost as any other single-column in-memory sort over 10,000 short
  text values. `safe_numeric` (pure `LANGUAGE sql`, no exception handling) pays none of the
  `plpgsql`/`EXCEPTION` subtransaction overhead. `safe_timestamptz` (D2 round 3: reverted to
  `plpgsql`/`EXCEPTION`, because regex digit-shape does not imply calendar validity and Postgres
  17's exception-free `pg_input_is_valid()` isn't available under the actual `sbt test`
  environment's Postgres 14 — see D2's round-5 citation correction) DOES
  pay it, once per row, for a TIMESTAMP-column sort/filter specifically — accepted deliberately
  (D2 round 3) as a correctness-over-performance trade at this ticket's stated scale: low
  single-digit to tens of milliseconds total is not a scaling concern at Output sizes this product
  currently supports, and a 500 on one malformed row is a categorically worse failure mode than
  that added latency.
- **Escalation path, stated rather than silently deferred:** if a future Output's row count grows
  into the hundreds of thousands (well beyond anything currently seeded or reported), the fix
  would be a materialized, indexed columnar projection of the declared schema fields (effectively
  a typed shadow table kept in sync with `node_snapshots`) — explicitly out of scope for this
  ticket (D8), not a gap this ticket is pretending doesn't exist.

### D10 — Filter-aware empty state for table panels (owner ruling, 2026-09-28, folding
skeptic-design-5.md change request 2 into scope)

**The gap, traced precisely.** `PanelContent`'s top-level `noData`/`neverMaterialized`
short-circuit (`PanelContent.tsx:348-378`) runs BEFORE the `isOutputPanel` dispatch that ever
mounts `OutputPanelContent`/`TableRenderer` (`PanelContent.tsx:381+`) — and `PanelContent` itself
has no `output.kind` in scope at that point (`output.kind` is resolved later, inside
`OutputPanelContent`'s own separate `useOutputMeta()` call). `usePanelData`'s `noData`
(`usePanelData.ts:156-157`) is computed purely as `rows.length === 0`, with no awareness of
whether a filter is active. Today (client-side filtering, pre-this-ticket), that's harmless:
`rowMatchesFilters` only ever narrows what `TableRenderer` RENDERS from an already-loaded page —
it never empties `paginationEntry.rows` itself, so `noData` and "filter active" are already
practically disjoint. Once D1/D4 make filtering server-side, a filter matching zero rows across
the whole Output means the fetched page genuinely IS empty, so `noData` flips `true` for a reason
that has nothing to do with whether the Output has data — and `PanelContent` never gives
`TableRenderer` (which already has a correct, existing, HEL-451-tested empty state for exactly
this case — `emptyText`/`emptyAction`, `TableRenderer.tsx:628-667`, "No rows match your filter." +
a working "Clear filters" button) the chance to render at all.

**Fix — suppress the top-level short-circuit only when a table filter is genuinely active,
computed where that's already known.** `PanelCardBody` (D4: the component that now owns
`activeFilter` state) computes `filterActive = isFiltering(activeFilter)` — reusing the SAME
`tableFilterPredicate.ts` helper `TableRenderer` already imports, no new predicate — and passes
`noData: rawNoData && !filterActive` (instead of the raw `usePanelData`-computed `noData`) into
`PanelContent`. This requires no new `output.kind`/table-specific check anywhere: `activeFilter`
is only ever set by `TableRenderer`'s own filter UI (D4), which only renders for `table`-kind
Outputs in the first place — a chart/metric panel can never have a genuinely active `activeFilter`
to suppress against, so this is safely a no-op for every non-table panel kind without needing to
ask what kind it is. When `filterActive` is true and the fetch legitimately returned zero rows,
`PanelContent` falls through past BOTH the `neverMaterialized` branch and the plain `noData`
branch, mounts `OutputPanelContent`/`TableRenderer` exactly as it would for a non-empty result,
and `TableRenderer`'s own existing, unmodified `emptyText`/`emptyAction` logic (already gated on
its own `filtering` flag) renders the correct in-table message and a working "Clear filters"
button — because `paginationRows` is genuinely `[]`, `isEmpty` is `true`, `filtering` is `true`,
and that logic already does the right thing today; it was simply never reached.

**Round-4's `hasAnyRow` fix remains necessary and correct, independent of this decision.** D10
only changes which RENDER PATH an empty, filtered result takes (`PanelContent`'s generic states
vs. `TableRenderer`'s in-table one) — it does not change `materialized`'s VALUE, which D5's
`hasAnyRow` fix still computes correctly. This matters for the one edge case D10 does not fully
resolve on its own: an Output that has genuinely never run (`materialized: false`) AND has a
filter applied — since `filterActive` suppresses `PanelContent`'s short-circuit regardless of
`materialized`, this corner case renders "No rows match your filter." rather than the more
precise "Not run yet." **Accepted, stated explicitly rather than silently glossed over:** this is
a narrow, pre-existing-adjacent corner case (an Output that has never run AND has a filter
somehow already applied to it), strictly less actionable-but-not-wrong messaging, not a
regression — the unfiltered case (the common one this ticket's own AC #6/#7 are about) still
correctly distinguishes "Not run yet" via D5's fix, completely unaffected by D10.

**Copy restatement (owner-specified): `TableRenderer.tsx:632-634`'s "in the N rows loaded so
far... load more to widen the search" / "...may match" strings are now false and must be
restated.** These two strings exist for the case `filtering && isEmpty && rowsTruncated` — but
once filtering is server-side and D5 makes `hasMore`/`rowsTruncated` derive from the FILTERED
total, `rowsTruncated` is itself already `false` whenever the true filtered total across the whole
Output is `0` (`hasMore = offset + limit < total`, and `total = 0` makes that comparison false
for any non-negative `offset`/`limit`). So this branch is no longer a real "more of the Output
might still match" state — at most it is a brief, transient artifact of a filter/sort change whose
refetch hasn't landed yet, in which case implying "load more to widen the search" is actively
misleading (there is nothing wider left to search; the server already searched the whole Output).
**Fix:** collapse all three `filtering && isEmpty` cases (truncated-with-load-more,
truncated-without-load-more, not-truncated) to the SAME simple `"No rows match your filter."` —
mirroring D7's own parallel simplification of `LoadedScopeDisclosure` once a signal becomes
whole-Output-authoritative rather than window-relative. `showLoadMoreBtn`'s existing gating
(`rowsTruncated && onLoadMore != null`, unchanged) already correctly hides the "Load more" button
in the true zero-total steady state with no code change needed there — only the TEXT changes.

## Gate-Chain Implications Checklist

Not applicable — this change does not touch `.husky/**` or any script a `.husky/pre-commit` hook
invokes.
