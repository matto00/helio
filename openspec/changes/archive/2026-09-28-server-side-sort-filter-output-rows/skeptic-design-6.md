## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Context: owner-authorized extension round (escalation `HEL-1027-1790624581328-31877c`,
resolved "extend-and-fix"). Cold read of the full current ticket.md/proposal.md/design.md/
tasks.md/specs/output-routes-api/spec.md, plus independent code tracing of every factual
claim D10 and the round-5 citation fix depend on. No prior-round narrative taken on faith.

### What I verified (with evidence)

**CR1 fix (IMMUTABLE → STABLE) — confirmed resolved, no remaining contradiction.**
`grep -n "IMMUTABLE" design.md tasks.md` shows `safe_numeric` stays `LANGUAGE sql IMMUTABLE`
in both files, and `safe_timestamptz` is `LANGUAGE plpgsql STABLE` in both files (tasks.md:5-8,
design.md:79/83-86). No lingering `IMMUTABLE` label on `safe_timestamptz` anywhere.

**Round-5 citation fix — confirmed accurate against ground truth, not merely re-asserted.**
- `backend/build.sbt:212`: `"io.zonky.test" % "embedded-postgres" % "2.0.7" % Test` — confirmed
  present exactly as cited.
- Resolved POM `~/.cache/coursier/v1/.../embedded-postgres/2.0.7/embedded-postgres-2.0.7.pom`
  line 33: `<embedded-postgres-binaries.version>14.10.1</embedded-postgres-binaries.version>` —
  confirms the "14.10.1" claim directly from the local Coursier cache, not from memory.
- `.github/workflows/ci.yml`: `postgres:16` appears exactly once, at line 304, inside the `e2e:`
  job's `services:` block (job starts line ~299). The `backend:` job (lines 115-160) runs
  `sbt compile test` (line 159) with **no** `services:` block at all. Confirms design.md's
  corrected claim precisely: `postgres:16` is `e2e`-only; `sbt test`'s actual operative Postgres
  version is 14.10.1 via embedded-postgres, not 16. The resulting decision (`pg_input_is_valid()`,
  17+, unusable) is unaffected either way, as design.md states.

**D10 — traced against real code, not re-read prose:**
- `PanelContent.tsx:348-378` (the `noData`/`neverMaterialized` short-circuit) — confirmed line
  numbers and structure: `if (noData && neverMaterialized) {...}` then `if (noData) {...}`,
  both returning before the `isOutputPanel(panel)` dispatch at line 381.
- Confirmed `output.kind` is genuinely NOT in scope at that point: `OutputPanelContent`
  (mounted only after the dispatch, line 381-397) is the component that calls
  `useOutputMeta(outputId)` (line 126) and reads `output.kind` (line 179) — `PanelContent`
  itself never resolves `output.kind`. D10's structural claim is accurate.
- `PanelCardBody` (inside `PanelCard.tsx`, lines 90-196) is confirmed as the component that
  currently passes `noData={noData}` straight through to `PanelContent` unmodified (line 168) —
  exactly the seam D10/task 4.7 proposes to intercept with `noData: rawNoData && !filterActive`.
- `tableFilterPredicate.ts`'s `isFiltering` (exported, takes `TableColumnFilters | undefined`)
  is confirmed already imported and used by `TableRenderer.tsx` today (`import { isFiltering }`
  line 19; `const filtering = isFiltering(filters);` line 327) — D10's "reusing the SAME helper
  TableRenderer already imports, no new predicate" claim is accurate, not aspirational.
- `TableRenderer.tsx:507-544` (`handleSort`/`handleFilterChange`) confirmed to have exactly the
  two-half shape D4/D10 rely on: an unconditional first line (`toggleSort(key)` / `setFilters(next)`)
  followed by `if (... || !canWrite) return;` gating only the debounced persist call. This is the
  seam D4's `onSortChange`/`onFilterChange` wiring (already locked in prior rounds) depends on,
  and D10 depends on the same `activeFilter` state this produces.
- `TableRenderer.tsx:628-667` confirmed verbatim: `emptyText` at lines 628-634 contains exactly
  the "in the N rows loaded so far... load more to widen the search" / "...may match" strings
  D10 names as needing restatement (task 4.8), and `emptyAction` (636-667) contains the existing
  "Clear filters" button (638-644) and "Load more" button (649-665) D10 says already work
  correctly and require no code change beyond the text collapse.
- `usePanelData.ts:156,175`: `noData = rows.length === 0` (modulo loading/error guards) and
  `rowsTruncated: paginationEntry?.hasMore ?? false` — confirms D10's claim that once D5 makes
  `total` (hence `hasMore`) filtered, `rowsTruncated` genuinely goes `false` at a true zero-match
  filtered total, making the "load more to widen the search" copy actually false in that state
  (not merely asserted).
- Traced the stated accepted corner case (never-materialized Output + active filter) through the
  actual code: `PanelCardBody` would pass `noData: false` (since `filterActive` is true) while
  `neverMaterialized` (computed independently in `usePanelData` from the *raw* `noData`) is passed
  through unchanged as `true`. In `PanelContent`, both short-circuit branches gate on the (now
  false) `noData` prop, so neither the `neverMaterialized` branch nor the plain `noData` branch
  fires — `TableRenderer` renders "No rows match your filter." This exactly matches D10's own
  stated corner-case description; no additional gap found.

**One clerical (non-blocking) type-signature gap found, not a substantive design defect:**
`design.md` D4 (line 202) types `activeFilter` as `TableColumnFilters | null`; D10 (line 429)
calls `isFiltering(activeFilter)` directly, but `isFiltering`'s existing signature
(`tableFilterPredicate.ts`) takes `TableColumnFilters | undefined`, not `| null`. Under this
repo's `strict: true` (`frontend/tsconfig.json:7`), `null` is not assignable to a param typed
`| undefined` — this line as written would not compile. This is trivially resolved one of two
ways (`isFiltering(activeFilter ?? undefined)` at the call site, or widen `isFiltering`'s
parameter to accept `| null` too) with zero behavioral ambiguity — `isFiltering`'s own runtime
body (`if (!filters) return false;`) already treats `null` and `undefined` identically. Flagging
per this round's instruction to distinguish clerical/doc-consistency findings from substantive
ones: **this is clerical, not substantive** — I am not treating it as REFUTE-worthy, and it
requires no design decision, only a one-line adjustment at implementation time.

### Verdict: CONFIRM

D10's structural claims about `PanelContent.tsx`, `PanelCardBody`, `isFiltering`, and
`TableRenderer.tsx`'s existing `emptyText`/`emptyAction`/`handleSort`/`handleFilterChange` all
check out against the real, current code — not merely against prose. The round-5 citation
correction (Postgres 16 is `e2e`-only; `sbt test` runs against embedded-postgres 14.10.1) is
independently confirmed accurate from the actual POM and workflow file. The round-5 CR1
(IMMUTABLE/STABLE) fix is consistently applied in both design.md and tasks.md with no
contradiction remaining. The one gap I found — the `activeFilter: TableColumnFilters | null`
vs. `isFiltering(... | undefined)` signature mismatch — is a one-line, unambiguous
implementation nit, not a substantive design defect, and does not warrant a REFUTE (nor another
escalation) on its own. Per this round's explicit instruction: this finding should be folded
into the executor/evaluator briefs (a one-line reminder to coalesce `activeFilter ?? undefined`
or widen `isFiltering`'s signature) rather than triggering a re-escalation.

### Non-blocking notes
- The `activeFilter`/`isFiltering` null-vs-undefined signature nit above — hand to the executor
  as an implementation note, not a design revision.
- No other issues found in this round's scope (D10, the CR1 fix, the citation fix). Design is
  sound enough to implement as written.
