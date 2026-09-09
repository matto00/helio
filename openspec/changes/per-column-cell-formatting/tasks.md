# Tasks — HEL-469 Per-column cell formatting

EXTEND, do not duplicate. `ColumnDef.render(row, value)` already exists (`DataGrid.tsx:31`) with no
table-panel consumer, and `TableOutputConfig` already carries the flat-sibling extension point that
HEL-448's own comment names for this ticket. Do NOT add a second render hook or nest inside
`columnSort`.

## 1. Format spec + persistence

- [x] 1.1 Add `columnFormats` to `TableOutputConfig`
      (`frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts`) as a FLAT sibling of
      `columnSort`, per HEL-448's comment there. `mergeConfig` deep-merges only four hardcoded chart
      keys, so a nested container is replaced wholesale on every unrelated patch.
- [x] 1.2 Define `TableColumnFormat` as its OWN type — do NOT reuse or re-point `MetricFormat`
      (`outputConfigTypes.ts:50`). Reuse the OVERLAPPING NAMES (`number`, `currency`) so the two
      surfaces do not drift into synonyms; add `date` and `text`. The domains genuinely differ: a
      column can be a date, a metric can be a percent, and a shared enum forces each surface to
      carry values it cannot honour.
- [x] 1.3 Tolerant `readColumnFormats`: non-object → undefined; unrecognised format type → that
      entry dropped; entry naming an absent column → ignored at render, not at read. Never throw.
- [x] 1.4 PERSIST VIA THE OUTPUT EDITOR'S SAVE PATH (design D1a), not an in-panel write. The
      control lives on the same surface that configures column visibility/order, so
      `buildOutputConfig.ts` (which today emits only `{ fieldMapping, columnOrder }` for a table at
      `:68-69`) MUST also emit `columnFormats`. `TableRenderer` only READS the spec and applies it —
      it does NOT write formats.
      Do NOT carry over HEL-448's in-panel minimal-patch/debounce/owner-pre-check language: there is
      no in-panel format control, so that would specify a write path nothing uses.
      VERIFIED SAFE: `buildOutputConfig` omits `columnSort` today and that does NOT wipe a persisted
      sort, because `OutputService.mergeConfig` is `existing.fields ++ patch.fields` — an omitted key
      is left intact. Carry `columnFormats` through the editor rather than dropping it, for the same
      reason.
- [x] 1.5 Jest: round-trip through `readColumnFormats`; every malformed shape; PATCH body carries
      only `columnFormats` and `fieldMapping`/`columnOrder`/`columnSort` survive. Label the
      minimal-patch test a regression guard and make it mutation-failable.

## 2. Formatters

- [x] 2.1 Formatter module mapping spec + raw value → display text: `number` (decimal places,
      grouping), `currency` (EXPLICIT currency code — do NOT hardcode USD as
      `MetricRenderer.tsx:28` does), `date` (chosen pattern), `text` (unchanged).
- [x] 2.2 NEVER THROW. A value that cannot be interpreted as the column's type renders its own raw
      string. Null/undefined keep `formatCell`'s existing `—`. Formatting must not change which rows
      render.
- [x] 2.3 Do NOT modify `MetricRenderer` or `chartAppearance.ts`. Their hardcoded USD and
      runtime-locale inheritance are owned by **HEL-1042** (Medium, parented to HEL-346), which
      records that this ticket deliberately did not absorb them.
- [x] 2.4 Jest for each formatter and the fallback path — see §4 for the pinning requirement, which
      applies to ALL of these.

## 3. Wiring + the sort guarantee

- [x] 3.1 In `TableRenderer`, build `ColumnDef.render` per column from the spec and pass it to
      `DataGrid`. Do NOT touch `sortColumns` (`TableRenderer.tsx:243`) — the separation IS the
      design, not an implementation detail.
- [x] 3.2 MUTATION-FAILABLE GUARD (this is the ticket's central AC, not a nicety): a test over a
      currency column whose formatted text sorts differently from its raw values — e.g. `9.99` and
      `1234.56` rendering `$9.99` and `$1,234.56` — asserting the numeric order. VERIFY IT GOES RED
      by mutating **the call site at `TableRenderer.tsx:243`** — re-pointing
      `getValue: (row) => getSortValue(row[col.key])` at the per-column formatter — then restore.
      NOT inside `getSortValue`: it takes only a value, so the mutation is not expressible there,
      and this ticket has already specified one guard whose mutation exercised the wrong branch.
      Under the call-site mutation a currency column's numbers become `"$9.99"`/`"$1,234.56"`
      strings and sort LEXICALLY — that is the red. Report the exact output.
      An observation that the paths are currently separate protects nothing; this component has
      already produced TWO numeric-ordering defects, the second introduced by the first's fix.
- [x] 3.2a ALSO assert the OBJECT-column contract: an object cell's sort key comes from
      `formatCell`. **State in the test that this assertion is NOT independently mutation-failable**
      while D3's formatter fallback resolves to `formatCell` — the two coincide for objects, so the
      call-site mutation does not change the object sort key. Task 3.2's currency guard is what
      proves the invariant; this documents the intended contract so a later change making the
      formatter non-inert for objects has something to break. Do not claim it as protection it does
      not provide.
- [x] 3.2b CORRECT HEL-448's now-stale comment at `TableRenderer.tsx:127-130` in the same change.
      **This task OWNS that comment; task 3.6 references the same address for context only — do not
      write it twice.**
      It says the object branch uses `formatCell` "so the sort key matches the rendered cell text";
      once a column carries a format spec the rendered text is `render(row, value)` instead, so the
      stated reason no longer holds. Replace it with the real reason: sorting must not depend on
      display formatting, so object cells keep a stable JSON sort key. Leaving the stale comment
      invites exactly the "restoration" 3.2a guards against.
- [x] 3.3 Right-align numeric and currency columns — **HEADER AND CELL TOGETHER** (design D3a,
      owner-ruled). The halted draft claimed `DataGrid.css:72` (as it then was) hardcodes `text-align: left` on the
      CELL. That is FALSE and shipping it would have produced right-aligned cells under a
      left-aligned header. Verified at `a6bde0d3`: the declaration is `DataGrid.css:147`, inside
      `.ui-data-grid__table thead th`; `tbody td` (`:197-204`) has NO `text-align` and inherits.
      Alignment therefore applies to the `th` and the `td` **together, or to neither** — this is an
      implementation decision, not an open question; do not reopen it. Add
      `align?: "left" | "right"` to `ColumnDef` (see 3.3a for how it coexists with the format spec),
      default absent = today's behaviour so no existing consumer changes, and wire BOTH elements in
      this same task. Do NOT have `render` emit a wrapper element — that puts layout inside content
      and breaks the `<td>`'s own box.
      This is RENDERED GEOMETRY — see task 5.2; a class name is not evidence that the column aligns,
      and a cell that aligns while its header does not is the defect this task exists to prevent.
- [x] 3.3a `ColumnDef` gains exactly ONE new optional field for this ticket, not two competing ones
      (design D3a + D6b). `align` is presentational and belongs on `ColumnDef`; the FORMAT SPEC does
      not — it is resolved by `TableRenderer` into `render` (and into the filter predicate, 3.5)
      before `DataGrid` ever sees it. State which of the two `TableRenderer` sets, and confirm
      `DataGrid` needs no knowledge of formats at all. If both a format spec and an `align` field
      end up on `ColumnDef`, stop: that is the collision this task exists to prevent.
- [x] 3.4 CLEARING a format must WRITE, not omit (design D3b). `mergeConfig` is
      `existing.fields ++ patch.fields`, so an omitted key leaves the stored value INTACT — the same
      property that makes the minimal patch safe. Dropping a column's entry would leave it formatted
      after reload. `buildOutputConfig` emits the whole `columnFormats` object on Save, so a removed
      entry IS a whole-key replacement and clears correctly — ASSERT that rather than assuming it.
      Jest: set a format, clear it, reload, confirm the column renders unformatted.

- [x] 3.5 FILTERING must use the per-column formatter (design D6a). **This scope is NEW: HEL-451
      merged as `a6bde0d3`, so `columnFilters` now exists on `main` and the earlier
      "filter composition is out of scope because HEL-451 is parked" statements are SUPERSEDED
      (corrected in ticket.md, proposal.md and task 8.3).**
      `tableFilterPredicate.ts:13` matches on `formatCell(value)`, and its comment at `:5-9` states
      the contract: the match source IS the rendered text, so a match is always visible in the cell
      that matched. Per-column formatting falsifies that unless the predicate is updated: a cell
      rendering `$1,234.56` would NOT match `1,234`, and WOULD match `1234.56`, which appears
      nowhere on screen.
      Pass the resolved per-column formatter into the predicate, falling back to `formatCell` for
      unformatted columns so every existing HEL-451 test keeps its exact meaning. **Rewrite the
      `:5-9` comment** to describe the per-column rendered text — leaving it is a confidently-false
      comment about a contract the code no longer honours.
- [x] 3.5a Guard 3.5, mutation-failable, and PIN LOCALE + TZ for it exactly as task 4.1a requires
      (the currency fixture is subject to the same `en-US`-only hazard: neither `jest.config.cjs`
      nor `jest.setup.ts` pins either). With a currency format active: the term matching the
      FORMATTED text matches, and the term matching only the RAW text does not. **Run it against the
      pre-fix predicate (bare `formatCell`) and confirm it goes red** — a guard that passes against
      the known-bad state guards nothing.
- [x] 3.6 ONE shared formatter resolver (design D6b). Render (`DataGrid.tsx:803`) and filter
      (`tableFilterPredicate.ts:13`) must never drift, so resolve the column spec to a
      `(value) => string` ONCE and share it; `formatCell` is its fallback. SORT DOES NOT USE IT —
      it reads raw values (`TableRenderer.tsx:309`), and that asymmetry is deliberate (D6): sort
      raw so `1000` orders above `99`, filter formatted so a match is visible. Correct
      `TableRenderer.tsx:127-130`'s comment, which says the sort key should match the rendered cell
      text — this ticket makes that FALSE, and leaving it invites a "tidy-up" that re-points sort at
      the formatter and reintroduces the lexical-ordering defect HEL-448 already fixed.

## 4. Locale and timezone — pin them, in tests only

- [x] 4.0 PINNING MECHANISM, stated so it is reproducible rather than aspirational: set the locale
      by passing an EXPLICIT locale argument to every `Intl` call under test (not by mutating a
      global), and pin the timezone for the suite via `process.env.TZ` set BEFORE any date is
      constructed, restoring it afterwards. State the chosen locale and TZ in the test file so a
      reader knows the assertions are anchored, not incidental.
- [x] 4.1a SCOPE: pinning applies to EVERY test whose assertion could vary — the formatter unit
      tests AND any `TableRenderer`/`DataGrid` test that asserts rendered cell text for a formatted
      column, AND the 3.2/3.2a sort guards if their fixtures contain dates. Not formatter unit tests
      alone.
- [x] 4.1 PIN LOCALE AND TIMEZONE EXPLICITLY in every formatting test — including the ones you do
      not think are locale-sensitive. That assumption is exactly what makes a test pass on one
      machine and fail on another. Verified: `frontend/jest.config.cjs` and `src/test/jest.setup.ts`
      pin NEITHER today, so a naively-written `"$1,234.56"` assertion is green in `en-US` and red
      elsewhere — a defect wearing a green check.
- [x] 4.2 Production keeps locale-aware defaults. The pinning is a TEST-DETERMINISM measure, not a
      behaviour change — do NOT "fix" production to match the tests. Say so where the pinning is set.
- [x] 4.3 Cover a date near a day boundary so the timezone pin is actually load-bearing: the same
      instant is a different calendar day either side of midnight.
- [x] 4.4 Whether pinning belongs in the shared Jest setup instead of per-suite is HEL-1042's
      question. Pin per-suite here; do not change the shared setup.

## 5. Config UI

- [x] 5.1 Add the per-column format control beside the existing column visibility/order surface in
      the Output editor (`useOutputTableColumns.ts` / `OutputEditorSheet.tsx`). Keyboard operable,
      with an accessible name identifying its column (DESIGN.md §8).
- [x] 5.2 TWO-AXES (a) — RENDERED GEOMETRY. Right-alignment and the new control's spacing are
      inherited-layout properties no source-text check can see; `table-layout: fixed` plus
      per-column widths means alignment interacts with the column's own width. MEASURE the rendered
      result. Screenshots to `.concertino/runs/HEL-469/evidence/`, NEVER `openspec/**`, and never
      `git add -f` past `.gitignore`. Both light and dark.
- [x] 5.3 Before any visual observation, CONTENT SELF-AUTHENTICATE: confirm the dev server is
      serving THIS branch by checking for a string that exists only here (pick one from your own
      diff and verify it has 0 occurrences on `origin/main` first). A port number proves only what
      you connected to; the collision is symmetric.

## 6. Gates and evidence

- [x] 6.1 `npm run lint`, `npm run typecheck`, `npm run format:check`,
      `npm --prefix frontend test`. Do NOT cite root `npm test` — it is
      `jest --passWithNoTests && npm --prefix frontend test`, whose root jest arm finds zero tests in
      a worktree and reports silence as a pass. State which gate exercised the new code.
- [x] 6.2 TWO-AXES (b) — VARY THE DATA. Exercise: locale-dependent formatting (4.1),
      timezone-dependent dates (4.3), values that FAIL TO PARSE (2.2), and an OBJECT-VALUED column on
      the `rawRows` branch, which arrives as `"[object Object]"` (see 7.1). None of these is
      exercised by any existing table-panel test.

## 7. The `rawRows` type-loss boundary

- [x] 7.1 Formatting applies on BOTH branches. On `rawRows`, `usePanelData.ts:87-92` has already run
      `String(v)`: numbers and dates survive as parseable strings and format correctly; objects
      arrive as `"[object Object]"`, whose type is destroyed. Task 2.2's fallback returns it
      unchanged.
- [x] 7.2 Write NO SPECIAL CASE for the object value. The fallback already produces the only honest
      outcome, and a special case would imply this ticket repaired something it has not.
      **HEL-1033 owns the underlying fix.** Do NOT edit `usePanelData`.
- [x] 7.3 Record in the PR body that this ticket's behaviour CHANGES when HEL-1033 lands — object
      columns will arrive as objects, `formatCell` will `JSON.stringify` them, and a `number`/`date`
      spec will still fall back, but the displayed text becomes real JSON instead of
      `[object Object]`. A known consequence, not a future surprise.

## 8. Handoff

- [x] 8.1 Rebase on `main` before the PR (concurrent lanes are moving frontend files) and re-run
      task 5.2's comparison if anything moved.
- [x] 8.2 Update `files-modified.md`, run gates, COMMIT before yielding. Staging without committing
      is an incomplete handoff.
- [x] 8.3 PR body states: formats are Output-scoped, converging ON LOAD (never per-panel); a
      non-writable caller formats session-locally; **sort reads raw values and that is guarded by a
      mutation-failable test**; the row-data export clause was dropped because no row export exists
      (`exportDashboard` returns a structure `DashboardSnapshot`); filter composition IS implemented and guarded (tasks 3.5/3.5a/3.6), superseding the earlier
      "HEL-451 is parked" deferral
      and 7.3's HEL-1033 consequence. (The former "filter composition out of scope" note is SUPERSEDED — HEL-451 merged as `a6bde0d3`; see tasks 3.5/3.5a/3.6.)
      **Do not state any count you have not verified**, and prefer claims that stay true over claims
      that are precise.
