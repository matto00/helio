## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit `ad84d7f6e5e7c909c1eb5cc40d20bc1d5dee81e7` (HEAD at the time I finished
reading the diff). Diff base resolved live via `resolve-review-base.sh`:
`55ad1d6dedb9bad5d65f13a81e3b22731553e9b1` (exit 0, non-empty).

### What I verified (with evidence)

**Backend security (D6) — read myself, not trusted from the evaluator's report.**
Read `NodeSnapshotRepository.scala` end to end: every sort/filter column name, filter
term, and the `ESCAPE` character are bound `sql"..."` parameters (`data ->> $column`,
`... ILIKE $pattern ESCAPE $likeEscapeChar`); the only literal SQL text ever embedded is
`ASC`/`DESC`, which is chosen from a closed 2-value Scala enum resolved in
`OutputRoutes.parseSortParam` before a `SortSpec` can even be constructed — the raw
caller string never reaches that branch. Ran the actual test suite myself:
`sbt "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec"` → **72/72 passed**,
including the required red-first probe (`RED: a naive string-interpolated SQL statement
executes an injected DROP TABLE` followed by two GREEN tests proving the shipped
`NodeSnapshotRepository`/route path rejects/neutralizes the same hostile column name).
D6's claim holds.

**D5 `hasAnyRow` amendment — read `OutputService.materializedFor` myself.** Matches
design.md exactly: unfiltered requests keep `paged.total > 0` unchanged; a filtered
request switches to the new `hasAnyRow` existence check. Confirmed by the same test run
above (`OutputService.rows materialized derivation under a filter` — both the RED-FIRST
zero-match case and the never-materialized case pass).

**D2 migration (`V111__safe_cast_functions.sql`) — read directly.** Matches the final,
round-3-corrected design exactly: `safe_numeric` stays pure `LANGUAGE sql IMMUTABLE`;
`safe_timestamptz` is `LANGUAGE plpgsql STABLE` with an `EXCEPTION WHEN OTHERS` guard and
strips a trailing `[Zone/Id]` bracket before casting. No drift from design.md.

**D4 mechanism deviation (controlled vs. uncontrolled `TableRenderer` state) — formed my
own view, did not defer to the executor's/evaluator's judgment.** The claimed rationale
(evaluation-1.md: making `TableRenderer`'s `columnSort`/`columnFilters` literally
controlled by `PanelCardBody` would reintroduce the two-independent-`useOutputMeta`-fetches
race a prior ticket already fixed) is real and correctly traced — I independently read
`PanelContent.tsx`'s `OutputPanelContent` (its own `useOutputMeta`) against
`usePanelSortFilter`'s separate `output` prop (`PanelCard`'s own `useOutputMeta`) and
confirmed they are in fact two independent resolutions of the same Output. On its own
narrow terms the deviation is sound: `displayRows = usingPagination && onSortChange !=
null ? filteredRows : sortedRows` (TableRenderer.tsx:441) correctly bypasses the local
`useSortedRows` re-sort whenever a server round trip exists, so the rendered rows are
never client-resorted over a stale/partial window — the exact bug class this ticket
exists to kill. AC #1 is genuinely satisfied at the row-order level.

**However, investigating this deviation is what led me to the two defects below** — the
deviation itself is sound, but the mechanism it sits on top of (`resetPanelPagination`
unconditionally deleting `paginationState[panelId]` on every callback firing) is not.

### Defect 1 (blocking) — the quick/per-column filter input is unusable for any
multi-character term; keystrokes after the first are silently dropped

**Root cause, traced in code:** `usePanelSortFilter.refetchFirstPage` (called
unconditionally, undebounced, from `TableRenderer`'s `handleFilterChange` on every
`onChange` of the filter textbox — confirmed no debounce anywhere in this new path:
`DataGrid.tsx:487-492`'s `handleQuickFilterChange` calls `emitFilterChange` synchronously
per keystroke) dispatches `resetPanelPagination(panelId)`
(`panelsSlice.ts:113-115`, `delete state.paginationState[action.payload]`) on **every**
keystroke. `usePanelData.ts:154`
(`isLoading = paginationEntry == null || ...`) then becomes `true` again immediately,
and `PanelContent.tsx:348-353` (`if (isLoading) return <PanelBodySkeleton/>`)
**unmounts the entire `TableRenderer`, including the filter textbox itself**, until the
new page-0 response lands. A real user typing the next character while that skeleton is
mounted types into nothing.

**Live-reproduced, twice, in this worktree's own dev server** (confirmed via
`readlink /proc/<pid>/cwd` on both the Vite and sbt processes bound to ports 6459/9366):
typed `"target"` and `"revenue"` character-by-character (`browser_type` with
`slowly: true`, real per-character keydown/input events) into the quick filter on the
seeded "HEL-1027 live verify dashboard"'s Revenue table panel. In both cases only the
**first character** ever committed (`"t"`, then `"r"`) — confirmed by (a) the rendered
textbox's own accessible value, and (b) the network log showing exactly **one**
`filter=` request was ever sent (`filter=%7B%22quick%22%3A%22t%22...%7D`), never a
request for the full typed term. Screenshot (second repro, term `"revenue"`, dark theme):
`/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/keystroke-loss-bug.png`
— textbox shows `"r"`, "Filters (1)" is active, and the table shows all 60 unfiltered
rows (every `row-N` label contains `"r"`), not the empty/near-empty result a real
`"revenue"` filter should have produced.

This directly undermines **AC #4** ("Filtering a table panel bound to an Output larger
than one page narrows the whole Output") — a user cannot actually type a real,
meaningful multi-character filter term through the shipped UI. It is also a severe
regression from pre-ticket behavior: HEL-451's client-side filter never unmounted the
input on a keystroke. No test in the diff exercises a real per-keystroke DOM typing
sequence (`usePanelSortFilter.test.ts` calls `handleFilterChange` directly, once, never
through a debounce-free live re-render cycle) — this is exactly the class of gap a
programmatic single-call unit test cannot see.

### Defect 2 (blocking) — the D7-restated "{n} results." disclosure can show the
Output's raw unfiltered count while the table is (client-side-masked) showing filtered
rows, and this is not a transient flash — it is a settled, wrong, sticky state

**Live-reproduced** on a fresh full page load (`page.goto`, not an SPA navigation) of
the same seeded dashboard, which has a **persisted** `columnFilters` default
(`quick: "t"`) saved from an earlier interaction in this same session. After the page
settled (screenshot taken twice, 2s apart, after all in-flight requests completed —
`/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/dark-theme-check2.png`):
the table correctly shows only the 3 `"target"` rows, but the disclosure beneath it reads
**"60 results."** — the Output's raw unfiltered total, not 3. Independently confirmed
the server itself is correct: `fetch('/api/outputs/.../rows?...&filter={"quick":"t",...}')`
→ `{"total": 3, "items": 3, "materialized": true}`. The network log for that page load
shows three requests: two unfiltered `rows?offset=0&limit=200` (a StrictMode
double-invoke of `usePanelData`'s mount effect — `main.tsx:58` wraps the app in
`<React.StrictMode>`) and one filtered `rows?...&filter=...` — `PanelCardBody`/
`usePanelSortFilter` never re-checks which of these responses actually lands last
before committing to `state.paginationState[panelId]`; `fetchPanelPage.fulfilled`
(`panelsSlice.ts:286-298`) unconditionally overwrites `total`/`rows`/`hasMore` from
whichever response's promise resolves last, with no sequence number, no
`AbortController`, and no "ignore if superseded" check anywhere in this path
(`fetchPanelPage` in `panelThunks.ts`, `getOutputRows` in `outputService.ts`). The
3 correctly-filtered rows visible in the table are `TableRenderer`'s own **client-side**
`rowMatchesFilters` mask (D7's transient-window fallback) applied over whatever
`paginationRows` the store actually holds — which is enough to explain why the rows
look right while the server-confirmed `total` is wrong.

This is exactly the out-of-order-response race class I went looking for after judging
the D4 controlled/uncontrolled question (a genuine, general gap: no site in
`fetchPanelPage`'s dispatch/reducer chain discards a stale response in favor of a
later request's result) — and this reproduction shows it is not merely a theoretical
concern reachable only via network-throttling tricks: this repo's own standard dev
harness (`<React.StrictMode>`, already relied on elsewhere in this same file to catch
the pinned-column double-persist bug at `TableRenderer.tsx:495-521`) triggers it on
a plain page load with a persisted filter, with no artificial delay needed.

Directly contradicts **AC #5** ("With a filter active, `hasMore` and any displayed
count describe the filtered set") and design.md D7's explicit restatement rationale
("once `total`/`matchCount` are Output-wide... a single "{total} {result|results}."
using the server's filtered `total`" — here it uses the WRONG server total).

### Everything else checked and found sound

- **AC #1** (sort ranks whole Output): satisfied — backend test 7.1 read directly (a
  genuine red-first proof against current `main`'s client-side-only sort), frontend
  `displayRows` never re-sorts a server-sorted response.
- **AC #2** (pagination reset, no dup/dropped rows across pages *for a fixed sort/filter*):
  the `row_index ASC` trailing tiebreaker and reset-then-refetch sequence are correctly
  wired at the code level; not itself falsified by the two defects above (which are about
  a filter VALUE never correctly landing, and a count STALENESS — not about duplicate/
  dropped rows within one fixed, successfully-applied sort/filter).
- **AC #3** (non-sortable column, non-silent): `400` + named column (D3), gated
  client-side (D3/4.5), defense-in-depth toast on a stale-client 400 (4.6) — confirmed in
  code.
- **AC #6/#7** (HEL-451/HEL-448 disclosure removed/restated): grepped for the old
  "Sort covers only the loaded rows." / "rows loaded so far... widen the search" strings
  — zero live hits, only historical comments referencing the removed text remain.
- **D10 empty state + D5's `hasAnyRow` composition** — live-verified, both light and dark
  theme. Typed a genuinely zero-match term (`"zzznomatch"`, via `.fill()`, not per-
  keystroke) into the quick filter: `TableRenderer`'s own in-table "No rows match your
  filter." + working "Clear filters" button rendered correctly (not the generic
  `PanelContent` "No data available" short-circuit) —
  `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/d10-empty-light.png`.
  Clicking "Clear filters" correctly refetched and displayed the unfiltered 60 rows —
  `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/d10-cleared.png`.
  Dark theme parity checked (tokens, contrast, borders) —
  `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/dark-theme-check2.png`
  (same screenshot also carries Defect 2's evidence above).
- No console errors traceable to this ticket's code (the one console error seen —
  `502` on `/api/pipelines/.../run-events` — is an unrelated SSE endpoint for a
  different pipeline, pre-existing and out of this ticket's scope).

### Gate-chain defect noted separately (not a verdict factor)

None found — I did not find any report in this change whose evidence directory
disclosed unsound mtimes that a prior gate then accepted at face value. My own
mtime-dependent claims above are none; the network-log/response-body evidence is
self-authenticating (content, not timestamp-ordered).

### Verdict: REFUTE

### Change Requests

1. **Debounce (or otherwise decouple) the new `onFilterChange`-driven server refetch
   from the per-keystroke local UI update.** `TableRenderer`'s `handleFilterChange`
   already keeps the local `setFilters`/`onFilterChange` calls unconditional for
   `canWrite`-gating reasons (D4) — that part is correct and must stay. The bug is that
   `usePanelSortFilter.refetchFirstPage`'s `resetPanelPagination` dispatch fires
   synchronously on every one of those calls, and `resetPanelPagination` fully
   `delete`s the pagination entry rather than marking it "refreshing" while keeping the
   currently-rendered rows/controls mounted. Fix needs both: (a) debounce the refetch
   trigger itself (separate from the `canWrite`-gated persist debounce, which is a
   different concern), and (b) stop `PanelContent`/`usePanelData` from unmounting
   `TableRenderer` into a full skeleton on every in-place refetch — an in-place
   "refreshing" indicator (this codebase already has `isRefreshing` distinct from
   `isLoading` in `usePanelData.ts` for exactly this purpose) should be used instead of
   `resetPanelPagination`'s hard delete, at least for the sort/filter-change path.
2. **Add sequencing to `fetchPanelPage` so a stale response can never overwrite a newer
   request's result.** Either a monotonic per-panel request counter checked in
   `fetchPanelPage.fulfilled` before committing (a `requestId`/`meta.requestId` guard
   already comes for free from `createAsyncThunk`), or an `AbortController` cancelling
   the previous in-flight request for the same panel before issuing a new one. This is
   required for both Defect 2's specific manifestation (a stale unfiltered response
   overwriting a correct filtered one) and Defect 1's fix once it fires a real refetch
   per committed keystroke.
3. **Add a regression test that exercises a real DOM typing sequence** (multiple
   sequential keystrokes through the actual rendered input, not one direct
   `handleFilterChange`/`onFilterChange` call) for the quick filter and at least one
   per-column filter input, asserting the FULL typed term is what reaches the
   dispatched `fetchPanelPage` call — this is the gap that let Defect 1 through 72
   backend tests, a full frontend suite, and 6 rounds of design-gate skepticism.
4. **Add a regression test reproducing Defect 2**: seed an Output with a persisted
   `columnFilters` default, mount the panel fresh (mirroring `usePanelData`'s real
   mount-effect/StrictMode double-invoke behavior rather than mocking it away), and
   assert the settled `total`/disclosure count matches the server's filtered total, not
   an interleaved unfiltered fetch's total.

### Non-blocking notes

- The `400` error body shape (`ErrorResponse(message: String)`, e.g. `"column not
  sortable: 'foo'"`) differs from design.md D3's originally-sketched
  `{"error": "...", "column": "..."}` JSON shape, but `specs/output-routes-api/spec.md`
  was correctly reconciled to the implemented behavior ("400 Bad Request naming the
  offending column") per task 6.2 — not a defect, just noting the spec was the side that
  moved, not the code.
- `escapeLikeTerm`'s `%`/`_`/`\` escaping in `NodeSnapshotRepository.scala` is a good,
  correctness-preserving addition beyond what D6's prose explicitly called out (matches
  the client's literal "contains" semantics rather than accidentally supporting SQL
  `LIKE` wildcards) — worth calling out as a positive, not just silence.
