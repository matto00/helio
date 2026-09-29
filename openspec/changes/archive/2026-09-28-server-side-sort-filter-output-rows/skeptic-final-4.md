## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed commit `5f4fe0b24c394e6b4fea908ff06df96364c2c262` (HEAD, confirmed clean
worktree except the untracked `evaluation-4.md` this evaluator round left behind).
Owner-authorized 4th round (escalations HEL-1027-1790637619254-5e0366 and
HEL-1027-1790641194186-60dd48). Cold spawn — every claim below is grounded in a
command I ran myself or a file I read myself this round, not in the executor's or
evaluator's narrative.

### Headline: my own negative control succeeded

Per the brief's explicit instruction, I ran my own discriminating check before
trusting any "fixed" result:

1. Live-set a persisted quick-filter default (`columnFilters: {"quick":"target"}`)
   on a real table Output (`fb968d18-34bc-442a-a32c-93ba6ca0199d`, 60 rows, 3
   containing "target") via the real UI (typed into the quick filter, confirmed
   via `GET /api/outputs/:id` that the PATCH landed).
2. Reverted `PanelCard.tsx`/`PanelContent.tsx` to their exact `03137f28` content
   (`git show 03137f28:<path> > <path>`).
3. Killed the running Vite dev server (pid `1831535`, cwd-confirmed against this
   worktree's `frontend/`) and restarted it fresh via `start-servers.sh` (new pid
   `1852529`, cwd-confirmed).
4. Resized to 375×812, cleared `localStorage`/`sessionStorage`, did a genuine
   full navigation reload.
5. **Result: "60 results." — reproduced the defect myself.** Network log showed
   exactly two unfiltered `GET /rows` requests and zero `filter=` requests
   (`browser_network_requests`, requests #519/#521). The DOM itself was
   internally inconsistent in a way that corroborates the root cause exactly:
   the 3 visible rows were already client-side filtered to "target" (the stale
   client-side filter predicate still runs), while the disclosure text said "60
   results." — the server-truth total never got corrected. Screenshot:
   `ref=/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/.skeptic-evidence/hel1027-skeptic-r4-negative-control-mobile-wrong.png`.

This is a real, reproduced negative control — my reproduction environment is
discriminating, not a "clean pass that proves nothing." It gives full weight to
the CONFIRM below.

### Positive result, same rigor

6. Restored `PanelCard.tsx`/`PanelContent.tsx` exactly (`git status --short`
   clean, confirmed HEAD unchanged at `5f4fe0b2`).
7. Killed the dev server again, restarted fresh (new pid `1854474`,
   cwd-confirmed).
8. Cleared storage, full reload at 375×812 (persisted filter default untouched
   across the frontend-only restart). **Result: "3 results." (correct)**, with
   the filtered request `GET .../rows?offset=0&limit=200&filter=%7B%22quick%22:%22target%22%7D`
   actually observed in the network log (request #524). Screenshot:
   `ref=/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/.skeptic-evidence/hel1027-skeptic-r4-fixed-mobile-correct.png`.
9. Resized to 1440×900 on the same fixed build (no server restart, no storage
   clear needed — same page origin, same session), reloaded — **"3 results."
   (correct)** again, filtered request present (#528). No desktop regression.
   Screenshot: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/.skeptic-evidence/hel1027-skeptic-r4-fixed-desktop-correct.png`.
10. Cleaned up: clicked "Clear all" in the UI, confirmed via `GET /api/outputs/:id`
    that `columnFilters`/`columnSort` are back to `null`.

### Code-level verification of the fix's claims (not just live behavior)

- **Diffed `03137f28...5f4fe0b2` myself** for `PanelCard.tsx` and
  `PanelContent.tsx`. Confirmed: `PanelCardBody`'s `output` prop was removed;
  `PanelCardBody` now calls `useOutputMeta(outputId)` itself and threads the
  result both into `usePanelSortFilter`'s seed and down into
  `<PanelContent output={output} outputMetaLoading={isOutputMetaLoading} />`.
  `PanelCard`'s own separate `useOutputMeta(outputId)` call for
  `chartInspectConfig` (line 336) is untouched.
- **Read `useOutputMeta.ts`'s actual source**: `outputId === null` skips the
  effect body's `getOutputById` call entirely (returns early via a resolved
  Promise that clears local state) — confirms `OutputPanelContent`'s
  `useOutputMeta(hasExternalOutput ? null : outputId)` is a genuine skip, not a
  discarded-result call, exactly as `evaluation-4.md` claimed.
- **`PanelContent.tsx`**: `OutputPanelContent` now takes `output`/`isLoading` as
  optional props; `hasExternalOutput = outputProp !== undefined`; when true, uses
  the supplied value and passes `null` to its own `useOutputMeta` call (no
  fetch); when `undefined` (the two unchanged callers below), falls through to
  its own independent fetch exactly as before.
- **`PanelFullscreenOverlay.tsx`/`PanelDetailModal.tsx`**: read both `<PanelContent
  ... />` call sites directly — neither passes `output` or `outputMetaLoading`.
  Confirmed genuinely unaffected, not merely asserted.
- **Double-fetch-race reintroduction check**: the `evaluation-1.md` race was two
  *independently resolving* fetches of the same Output. This fix produces the
  opposite shape — one fetch, shared by construction (`OutputPanelContent`
  receives the exact object `PanelCardBody`'s own `useOutputMeta` resolved,
  never fetches its own copy when a caller supplies one). No race is
  reintroduced; if anything this closes the previously-documented,
  accepted-as-cosmetic desktop-side "two independent fetches could
  theoretically settle a render apart" gap too (confirmed by reading the diff,
  not just the executor's claim).
- **Red-first regression test, re-verified myself**: reverted `PanelCard.tsx`/
  `PanelContent.tsx` to `03137f28`, ran
  `MobilePanelStack.staleFetchSequencing.test.tsx` — failed exactly as claimed
  (`filteredCalls.length` was `0`, expected `>=1`). Restored both files
  (`git status --short` clean), re-ran — 1/1 passing. This is a second,
  independent red/green confirmation on top of the live browser negative
  control above — two different mechanisms (unit test + live browser) both
  discriminate correctly.

### Gates re-run fresh, this round

- `npm run lint` — clean, 0 warnings.
- `npm run typecheck` — clean.
- `npm test` (full suite) — **360 suites / 3894 tests, all passing.** Matches
  `evaluation-4.md`'s claim exactly.
- Targeted re-run of the HEL-1027 frontend test files
  (`PanelCard.loadMoreCarriesSortFilter`, `PanelCard.filterTyping`,
  `PanelCard.staleFetchSequencing`, `MobilePanelStack.staleFetchSequencing`,
  plus their sibling files) — 7 suites / 32 tests, all passing.
- Backend: confirmed via `git diff --stat 03137f28 5f4fe0b2 -- backend/` that
  zero backend files changed this cycle (or any cycle since `ad84d7f6`). Re-ran
  `sbt "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec"` fresh myself
  anyway (last-round diligence) — **72/72 passing**, including the hostile
  sort-column-name injection probe, the RED-FIRST materialized-under-filter
  test, and the end-to-end "ranks the WHOLE Output" / "filtered total drives
  hasMore" tests (tasks 7.1/7.2).

### Acceptance criteria — traced end to end

1. **Sorting ranks the whole Output** — `OutputRoutesSpec` task 7.1 test (RED-
   FIRST against current main's client-side-only sort), passing. ✓
2. **Sort change resets pagination coherently** — `NodeSnapshotRepository`
   stable ORDER BY with `row_index` tiebreaker (task 2.1 test); frontend
   `PanelCard.loadMoreCarriesSortFilter.test.tsx` passing (re-run, green). ✓
3. **Non-server-sortable column has defined, non-silent behaviour** — route
   400s a Content-category or schema-absent sort column, naming it
   (`OutputRoutesSpec` "400s sort on a column absent from schema" / "400s sort
   on a Content-category column" tests, both passing); client-side,
   `usePanelSortFilter.ts:118-123` catches the rejection and pushes an error
   toast (read the source directly — not silent). ✓
4. **Filtering narrows the whole Output** — `OutputRoutesSpec` task 7.2 test,
   passing; live-reproduced myself above ("3 results." from a 60-row Output). ✓
5. **`hasMore`/displayed count describe the filtered set** — `TableRenderer.tsx`
   drives `LoadedScopeDisclosure`'s `matchCount` from `totalRowCount` (the
   server-derived filtered total), with `rowsTruncated` forced `false` whenever
   `totalRowCount` is defined (read the source directly, lines ~786-799) — this
   is the exact mechanism I just live-verified settles correctly on BOTH render
   paths this round. ✓
6. **HEL-451's loaded-scope disclosure removed/restated** — read
   `LoadedScopeDisclosure.tsx`: the non-filtering branch returns `null`
   unconditionally (old qualifier deleted), the filtering branch states either
   a plain `"N results."` (whole-Output count, not loaded-scope) or, only when
   genuinely truncated, `"N of M loaded rows match."` — restated to match the
   new reality, not left stale. ✓
7. **HEL-448's truncation qualifier removed/restated** — same file/read: the
   `!filtering` branch (where HEL-448's "Sort covers only the loaded rows."
   note used to live) is now `return null` outright, with an in-file comment
   explaining the removal is because sort now ranks the whole Output. ✓

All 7 ACs traced to real, currently-passing evidence — not just the specific
mobile-stack defect chain this final gate has been chasing for 4 rounds.

### Non-blocking notes (carried, unaffected by this cycle)

- Two stale doc comments (`PanelCard.tsx`'s `chartInspectConfig` `useOutputMeta`
  comment; `MobileStackPanelBody`'s cross-filter comment) still describe
  `OutputPanelContent` as independently fetching — no longer accurate for a
  `PanelCardBody`-rendered panel post this fix. Cosmetic.
- `NodeSnapshotRepository.scala`/`OutputService.scala` remain over the 250-line
  soft file-size budget (carried from cycle 1, never blocking).
- The `400` error body shape's cosmetic deviation from design.md D3 was already
  reconciled in the spec delta (carried, non-blocking).

### Verdict: CONFIRM

This round's CONFIRM carries full weight: I obtained my own genuine,
discriminating negative control (reproduced "60 results." against the actual
pre-fix commit, at the exact viewport and scenario in dispute, on a
freshly-restarted dev server) before ever trusting the "3 results." positive
result on the same methodology — the standard this entire dispute has been
missing until evaluator round 4, and which I independently repeated rather than
taking evaluator round 4's word for it. Combined with a second, independent
red/green confirmation via the unit test, a from-source (not from-narrative)
trace of the "no reintroduced race / no second independent fetch" claims, a
direct read confirming `PanelFullscreenOverlay`/`PanelDetailModal` are
untouched, all gates re-run fresh and green, and all 7 ACs traced to currently-
passing evidence, this ships.
