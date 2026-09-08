# Tasks — HEL-448 In-panel column sort

REUSE FIRST. HEL-1022 shipped the sorting system (`useSortedRows`, `SortableTh`, `SortableTable` in
`frontend/src/shared/ui/`, documented in DESIGN.md ~452-475 and ~520-540). Do NOT write a new
comparator, a new sort glyph, a new header affordance, or a new sort-state shape. See design D3/D4.

## 1. Wire the shared sort into DataGrid

- [x] 1.1 Add optional `sort: SortState<string> | null` and `onSort: (key: string) => void` props to
      `DataGrid`. Render sort controls only when `variant === "full"` AND `onSort` is supplied.
      `DataGrid` must NOT order rows — the caller does (design D4; same split as `columnWidths`).
- [x] 1.2 Render the header using `SortableTh`'s EXACT affordance: the `faSort`/`faSortUp`/
      `faSortDown` glyphs, the whole-header-is-a-button interaction, `aria-sort` of
      `ascending`/`descending`/`none`, and the `.sortable-th__btn`/`.sortable-th__glyph` CSS classes.
      Reuse the classes rather than inventing a parallel family, so the panel table and the list
      tables cannot drift apart visually.
- [x] 1.3 The resize handle MUST stay outside the header button (nesting interactive content in a
      `<button>` is invalid and would make every resize drag fire a sort) and the `<th>` must keep
      its `style={{ width }}`. These two are exactly why `SortableTh` could not be rendered directly
      — state both in the report.
- [x] 1.4 Jest: two-state toggle, cross-column reset to ascending, `aria-sort` values including
      `"none"` on unsorted columns, Enter and Space activation, no sort controls on `preview`,
      and resize-does-not-sort.

## 2. Sorting behaviour (all ordering logic comes from the shared hook)

- [x] 2.1 In `TableRenderer`, drive sorting with `useSortedRows`. Build `columns` as
      `SortColumn<Row, string>[]` with a `getValue` that coerces `unknown` at the boundary only:
      per design D3: `number`/`null`/`undefined` pass through; a `string` that is empty or
      whitespace-only coerces to `null`; otherwise a `string` coerces to `Number(v)` when
      `Number.isFinite(Number(v.trim()))`, else passes through as a string; everything else
      stringifies by REUSING `formatCell`'s semantics (`DataGrid.tsx:108-112`, which `JSON.stringify`s
      objects) so the sort key matches the rendered text — a bare `String(v)` collapses every object
      to `"[object Object]"`. Coercion is PER VALUE, not per column.
      BOTH blank guards are required, and they are different traps: `Number("") === 0` would sort a
      blank as zero, AND a blank passed through as a string bypasses the hook's blanks-last branch
      (which keys on `null`/`undefined` only, `useSortedRows.ts:58-60`) and sorts FIRST ascending —
      `"".localeCompare("-5", undefined, {numeric:true})` is `-1`.
      This is a value adapter, NOT a comparator — do not reimplement ordering.
      WHY the coercion is mandatory: `compareNonNull` takes its numeric branch only when BOTH values
      are `typeof number`; strings fall to `localeCompare(..., {numeric:true})`, which compares digit
      runs, so "1.5","1.25","1.9","10","2" orders as 1.5, 1.9, 1.25, 2, 10 — decimals inverted. The
      `rawRows` branch is `string[][]`, so EVERY value there is a string. `columns`, `defaultSort` AND the normalized `rows` must be `useMemo`-stable (the hook
      memoizes on `[rows, columns, sortState]` by identity, and the `rawRows` branch rebuilds its
      record array every render at `TableRenderer.tsx:107`).
- [x] 2.2 Do NOT reimplement nulls-last or date handling. `useSortedRows` already sorts nulls last
      in BOTH directions and parses `Instant.toString()` shapes to epoch millis, because
      `localeCompare` with `numeric: true` inverts order across differing fractional-second widths.
      Hand-rolling either reintroduces exactly the bug HEL-1022 fixed.
- [x] 2.3 Seed `defaultSort` with the `UNSORTED_SENTINEL` key that matches no column. Give it a
      value that cannot collide with a real JSON column key (a `__helio_` prefix, e.g.
      `__helio_unsorted__`). Record at the seeding site that seeding through `useSortedRows`'
      `useState` initializer is correct ONLY because `PanelContent.tsx:104-110` withholds
      `TableRenderer` behind a skeleton until `useOutputMeta` resolves — the hook has NO reseed path,
      so relaxing that guard would silently stop the stored sort applying.
      The sentinel makes a never-sorted panel render in the pipeline's own row order with every
      header showing the neutral glyph (design D2 — `useSortedRows` returns `rows` unchanged when
      the key matches no column).
- [x] 2.4 REQUIRED (not optional): a test that names the `useSortedRows` no-match passthrough the
      sentinel depends on, and that **FAILS if the passthrough is removed**. A guard that survives
      mutation is not a guard — verify it actually goes red by mutating the behaviour, and say so in
      the report. Label it a regression guard, not a proof test. ALSO add a comment at the
      sentinel's definition pointing at the `useSortedRows` behaviour it relies on, so a future
      refactor of the hook has a chance of noticing.
- [x] 2.5 Restructure `TableRenderer` so ONE pre-branch normalization produces a single
      `{ rows, columns }` (plus the "no rows" case) feeding ONE `useSortedRows` call, with the three
      early-return branches (`paginationRows` :73, `rawRows` :104, empty skeleton :119) reduced to
      presentation. A per-branch hook call violates rules-of-hooks, which `eslint.config.cjs:70,79`
      enables as an ERROR under the zero-warnings policy — it will not lint. Note the branches
      derive different rows AND different columns (`rawRows` builds records from
      `headers`/positional indices at :105-107). This restructure is planned in design D6a; do not
      improvise a different one.
- [x] 2.5a Jest PROOF test for the ticket AC "numeric columns sort numerically, not lexically":
      a decimal-valued STRING column ("1.5","1.25","1.9","10","2") sorts to 1.25, 1.5, 1.9, 2, 10 —
      written against the `rawRows` branch specifically. This test must be RED against a `getValue`
      that passes strings through unchanged; confirm that before implementing the coercion.
- [x] 2.5b Jest: blanks sort last in BOTH directions, and a blank is not treated as zero (a column
      with blanks and negatives orders blanks after the negatives). Cover BOTH blank representations
      on the all-strings `rawRows` branch: `null`/`undefined` AND empty/whitespace-only strings
      (`""`, `"   "`). Without the empty-string-to-`null` coercion this test is unsatisfiable — the
      blank leads the ascending sort — so it doubles as the proof for that clause and must be RED
      against a `getValue` that passes `""` through.
- [x] 2.6 Jest: sort spans the whole loaded set, and newly loaded rows merge into the order rather
      than trailing it — on both data branches.

## 3. Output-scoped persistence

- [x] 3.1 Add `columnSort?: SortState<string> | null` to `TableOutputConfig`
      (`frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts`) and read it
      tolerantly in `readTableConfig` (object with a string `key` and a `direction` of exactly
      `"asc"`/`"desc"`, else `undefined`). NAME IT `columnSort`, not `sort` —
      `TimelineOutputConfig.sort` already exists in this same file. Add the design-D5 comment naming
      the flat-sibling extension point (`columnFilters`/`pinnedColumns`/`columnFormats`) so
      HEL-451/465/469 do not invent a nested container.
- [x] 3.2 Pass the stored `columnSort` from `PanelContent.tsx` to `TableRenderer`. `panelId` at
      `PanelContent.tsx:134` already carries an Output id despite its name, and is declared at
      `TableRenderer.tsx:11-13` but never destructured — rename it `outputId` rather than adding a
      second prop with the same value.
- [x] 3.3 Persist via `updateOutput(outputId, { config: { columnSort } })` — the MINIMAL patch,
      debounced ~300 ms. Do NOT spread `output.config`: it is a per-mount `useOutputMeta` snapshot
      never refreshed after a write, so spreading re-sends stale `fieldMapping`/`columnOrder` and
      makes every sort click a lost update. The backend merges top-level keys
      (`OutputService.mergeConfig`), so untouched keys survive.
- [x] 3.3b The debounce MUST FLUSH on unmount, not cancel. The usual `clearTimeout`-on-cleanup idiom
      cancels the pending PATCH, and closing the panel detail modal unmounts `TableRenderer` — the
      exact path the AC "sort persists across detail-modal open/close" and Playwright 5.4 exercise.
      Jest: a sort activated and then unmounted inside the debounce window still issues the write.
- [x] 3.3a The persist fires on a USER ACTIVATION ONLY — invoked from the `onSort` handler, never
      from an effect observing `sortState` — and guards `key !== UNSORTED_SENTINEL` before writing.
      A debounced effect keyed on `sortState` fires on MOUNT with the sentinel and PATCHes
      `columnSort: { key: "<sentinel>", direction: "asc" }` into the Output config of every table
      panel a user merely VIEWS; task 3.1's tolerant read accepts it, so it round-trips and persists
      forever, silently (D2's passthrough makes it visually benign). It would also fire 3.5's
      non-owner path on every view. See design D6.
- [x] 3.4a Jest REGRESSION GUARD (mutation-failable, label it as a guard): merely rendering a
      never-sorted table panel attempts NO config write, and no write ever carries the sentinel key.
- [x] 3.4 Jest: the PATCH body contains ONLY `columnSort`, and `fieldMapping`/`columnOrder` survive
      the round trip. Regression guard for the lost-update hazard — label it and make it
      mutation-failable.
- [x] 3.5 When the caller cannot write the Output, suppress the write and keep the sort
      session-local: no error surfaced, no control disabled or hidden (design D7 — the write is
      RLS owner-only via `updateOwned`, so a shared-dashboard grantee would otherwise error on every
      click). Use a PRE-CHECK comparing `Output.ownerId` (`types/output.ts:25`) against the current
      user id from the auth selector (idiom: `useOnboardingHost.ts:35`; ownership comparison:
      `PipelineListTable.tsx:151`). Do NOT attempt the PATCH and swallow a 403 — that puts a failing
      request on the wire on every grantee click and violates the spec's "no config write is
      attempted". Jest: a non-writable Output sorts on screen and attempts no PATCH.
- [x] 3.6 Jest: persisted `columnSort` round-trips through `readTableConfig`; malformed and
      unknown-column values render source order.

## 3b. Truncation qualifier (D9a — NOT owner-approved, trivially removable)

- [x] 3b.1 Render a short qualifier near the EXISTING "Load more" affordance stating that the sort
      covers only the loaded rows. Show it ONLY when the set is actually truncated
      (`paginationHasMore`); render nothing at all when everything is loaded.
- [x] 3b.2 Reuse existing type and token treatment. Do NOT build a new banner, a new component, a
      tooltip system, or anything needing its own design decision. The sort control itself stays
      LIVE at all times, including while truncated — never disable or hide it.
- [x] 3b.3 OBJECTIVE escalation trigger — STOP and ESCALATE with a screenshot if, at the DEFAULT
      dashboard-grid panel size, in EITHER theme, the qualifier wraps to a second line, is clipped
      or truncated by overflow, or displaces/overlaps/reflows the "Load more" button. Do not invent
      something to work around any of those. ("Costs more than allowed" is not a usable trigger —
      an executor always reads its own output as within budget.)
- [x] 3b.4 Mark it in the report AND the PR body as an addition pending owner confirmation, layered
      on top of the sort-mechanism ruling by the delivery coordinator. It must NOT be described as
      owner-approved anywhere — code, comments, PR, or docs.
- [x] 3b.5 Jest: the qualifier is absent when the set is fully loaded and present when truncated,
      and absent entirely on the `rawRows` branch (no pagination there).
- [x] 3b.6 Screenshot the qualifier in a SMALL DASHBOARD-GRID PANEL specifically — not only the
      detail modal — in BOTH themes, saved and referenced by path. That is the tightest space and
      the worst truncation (50 rows vs 200), and it is the surface most likely to be skipped.

## 4. Gates

- [x] 4.1 `npm run lint`, `npm run typecheck`, `npm run format:check` clean.
- [x] 4.2 `npm --prefix frontend test` green. Do NOT cite root `npm test` as evidence — it is
      `jest --passWithNoTests && npm --prefix frontend test`, and the root jest arm finds zero tests
      inside a worktree and reports silence as a pass.
- [x] 4.3 State in the report which gate actually exercised the new code and what it scanned.

## 5. UI-cohesion review (binding — see workflow-state.md)

- [x] 5.1 BEFORE changing the renderer, start the dev servers and capture a BASELINE screenshot of
      the existing table-panel chrome (resize handles, density, header affordances) and of a list
      table's sort affordance for comparison. Save both to `.concertino/runs/HEL-448/evidence/screenshots/` — NEVER `openspec/**`, and never `git add -f` past the ignore rules — and reference them BY PATH in the report.
- [x] 5.2 Capture matching POST-CHANGE screenshots. Both themes, light AND dark (known light-theme
      hover token collision: HEL-866, HEL-496). Report whether the sort glyph, hover/active states
      and clickable header target read as the same system as BOTH neighbours — the list tables'
      sort and the panel's own resize/density affordances.
- [x] 5.3 If the two existing surfaces disagree with each other, SAY SO rather than picking one and
      adding a third variant. If cohesion needs an adjacent surface beyond scope, ESCALATE with the
      screenshots for an owner ruling — do not widen the diff silently, do not ship incohesive.
- [x] 5.4 Verify sort persists across panel detail-modal open/close and a page reload.

## 6. Handoff

- [x] 6.1 Rebase on `main` before the PR (a concurrent owner thread is moving frontend files) and
      re-run the task-5 comparison if anything moved.
- [x] 6.2 Write `files-modified.md`, run gates, and COMMIT before yielding. Staging without
      committing is an incomplete handoff.
- [x] 6.3 The PR body must state plainly, without papering over any of them:
      (a) sort is Output-scoped — it follows the Output into every panel bound to it, converging
          ON LOAD (panels do not re-sort each other live), so two panels on one Output cannot hold
          different sorts across reloads. Accepted, not overlooked. Never describe it as per-panel.
      (b) the cycle is two-state, so once sorted there is no click that returns the table to the
          pipeline's own row order.
      (c) a caller who cannot write the Output sorts session-locally; it does not stick.
      (d) the sort is client-side and ranks ONLY the rows loaded so far (50 in a dashboard panel,
          200 in the detail modal), so a sorted panel on a large Output shows a partial ranking.
          Server-side sort is deferred to HEL-1027 — link it.
      (e) the truncation qualifier is a coordinator addition pending owner confirmation, NOT part of
          the owner's ruling, and is trivially removable.
