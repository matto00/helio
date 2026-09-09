# Tasks — HEL-451 In-panel column filtering

EXTEND, do not duplicate. HEL-448 (merged `adadb5d4`) already established the row-transform pipeline
in `TableRenderer`: ONE pre-branch normalization → ONE `useSortedRows` call. Filtering inserts into
that pipeline. Do not add a second normalization, a second hook call, or an early return that
splits it — `react-hooks/rules-of-hooks` is an ERROR under the zero-warnings policy.

## 1. Predicate

- [x] 1.1 Export `formatCell` from `DataGrid` (already exported for HEL-448) and build the match on
      it: a cell matches when `formatCell(value).toLowerCase().includes(term.trim().toLowerCase())`.
      REUSE `formatCell` — do NOT reimplement serialization. Design D2: the match source being the
      rendered text is the entire justification for filtering map-classified columns, and a
      reimplementation would let the two drift apart silently.
- [x] 1.2 Quick-filter matches a row when ANY visible column matches. Per-column terms match only
      their column and AND together; the quick term ANDs with them. An empty/whitespace-only term
      filters nothing.
- [x] 1.3 Jest: case-insensitivity, trimming, quick-across-columns, per-column AND, quick+column AND,
      empty term is a no-op, and an OBJECT-valued cell matching via its `formatCell` text. The
      object case is the one that justifies D2 — it must be a real test, not an assumption. Test it
      on the PAGINATION branch, where objects survive as objects. On the `rawRows` branch
      `usePanelData.ts:87-92` has already flattened them to `"[object Object]"` via `String(v)` —
      a pre-existing display defect filed as HEL-1033, NOT fixed here (five renderers share
      `rawRows`). Do not "fix" it by editing `usePanelData`, and do not write a test asserting the
      broken text is desirable — assert the documented limitation if you assert anything.

## 2. Pipeline composition

- [x] 2.1 In `TableRenderer`, filter `normalizedRows` BEFORE the existing `useSortedRows` call
      (design D3). The filtered array MUST be `useMemo`-stable — `useSortedRows` memoizes on
      `[rows, columns, sortState]` by identity, so an unstable array defeats it every render.
- [x] 2.2 Do NOT add a second normalization or hook call, and do not restructure HEL-448's D6a
      shape. Verify `npm run lint` still passes — a rules-of-hooks violation is an ERROR here.
- [x] 2.3 (REOPENED — was marked [x] with NO test behind it) Jest: filter-then-sort composition on BOTH the pagination branch and the `rawRows` branch
      — a filtered table stays sorted, and re-sorting does not restore filtered-out rows. The
      `rawRows` branch is where BOTH of HEL-448's ordering defects actually lived; do not test only
      the pagination branch.

## 3. DataGrid surface

- [x] 3.1 Add optional `filters` / `onFilterChange` props and render the filter row in the `full`
      variant only. `preview` gains nothing. `DataGrid` does NOT decide which rows match — it
      renders controls and reports changes; the caller supplies rows.
- [x] 3.2 Each input carries an accessible name identifying its column (and the quick-filter its
      own), keyboard reachable and editable (DESIGN.md §8).
- [x] 3.3 Extend the empty state with an optional `emptyAction?: ReactNode` rendered beneath the
      message (currently message-only). With no action supplied and no filter active it must render
      EXACTLY as before. "No regression" must be EVIDENCE, not a claim: the `DataGrid` empty state
      is shared by four non-test consumers — `TableRenderer`, `StepCard.tsx`, `SqlTab.tsx`,
      `SourceDetailPanel.tsx` (plus the `preview`-variant call sites). Assert the no-action path
      against at least one NAMED non-panel consumer, so the shared branch is covered by something
      other than the surface being changed.
- [x] 3.3a Implement the D5 markup shape EXACTLY as specified — do not improvise it. Empty + no
      filter: today's `<p className="ui-data-grid__empty">` early return, unchanged. Empty + filter
      active: the full grid shell (`role="region"` wrapper, `<table>`, `<thead>` WITH the filter
      row) and the message as ONE full-width `<tr><td colSpan={resolvedColumns.length}>` inside the
      existing `<tbody>`. The `<td colSpan>` inherits the table's column geometry so the message
      aligns with the first column and scrolls with the header; a sibling `<p>` after a header-only
      table drifts out of alignment at narrow widths and sits outside the scroll region.
- [x] 3.4 The filter row stays visible when an active filter empties the table (design D5), so the
      term that caused the empty result can be seen and edited. This means the empty-state branch
      can no longer short-circuit the whole render while filtering is active.
- [x] 3.5 Style the filter row and extended empty state to read as the same system as the HEL-448
      sort header and the resize/density affordances. Token compliance is necessary but NOT
      sufficient — see task 6.

## 3c. Filter chrome behind a toggle (design D4d — ruled after live measurement)

- [x] 3c.1 Put BOTH filter rows behind ONE toggle. Measured: 124.5px of chrome in a 143px scroll
      area left ~18px for a 35px row. The global quick-filter is ticket-required (`ticket.md:9` and
      the AC at `:18`), NOT an addition — keep it, behind the same toggle as the per-column row.
- [x] 3c.2 COLLAPSED MUST NOT HIDE AN ACTIVE FILTER. A filtered table that looks unfiltered is a
      confidently wrong answer with no cue at all — worse than the partial-count problem this ticket
      exists to solve. The collapsed state MUST: indicate filters are active AND how many (the quick
      filter counts as one); make "clear all filters" reachable WITHOUT expanding; and be visually
      distinct from the inactive state, not merely a changed tooltip.
- [x] 3c.3 Jest: with filters active and the row collapsed, the active-count indicator renders and
      the clear action is reachable; with no filters active it does not.

## 3d. Sticky offsets (design D4e)

- [x] 3d.1 FIX THE OFFSETS PROPERLY — the toggle only reduces how often the bug occurs. Measured
      live: all three `<thead>` rows are `position: sticky; top: 0` and collapse to one offset
      (347/347/347) on scroll, painting over the column-name header. When expanded, each row's
      offset must be computed so the rows stack instead of overlapping.
- [x] 3d.2 DELETE the comment at `DataGrid.css:188-192`. It is a garbled unfinished sentence
      admitting the offsets were never worked out, followed by `top: 0` anyway. Replace it with one
      stating what the offsets actually are.
- [x] 3d.3 A test that MEASURES RENDERED GEOMETRY — assert the three rows resolve to DISTINCT,
      increasing `top` offsets and that the header row is not covered on scroll. Nothing in lint,
      types or unit tests can see this; it survived a fully green suite and reached review.
- [x] 3d.4 Fix `DataGrid.css:208`: `var(--weight-normal)` DOES NOT EXIST — `theme.css:32` defines
      `--weight-regular: 400`. The undefined token fails open, so the inputs render at computed
      weight 600 instead of 400. Grep the whole diff for any other undefined `--*` reference.

## 4. Disclosure (design D4 — the obligation, not a nicety)

- [x] 4.0 FIRST, fix the truncation signal, or every state below is wrong in the detail modal.
      `usingPagination && paginationHasMore` is FALSE in the panel detail modal, which renders
      `PanelContent` with `rawRows`/`headers` only (`PanelDetailModal.tsx:400-404`) while
      `usePanelData.ts:87-95` derives those rows from the SAME paginated set. The matrix would then
      claim a "complete answer" over a truncated 200-row sample — the exact confidently-wrong answer
      this section exists to prevent. Expose the `hasMore` that `usePanelData` already holds on
      `paginationEntry`, pass it through `PanelDetailModal` → `PanelContent` → `TableRenderer` as a
      branch-independent `rowsTruncated` prop, and derive `truncated` from that on BOTH branches.
      WIRE BOTH `PanelContent` CALL SITES — there are exactly two and both must pass it:
      `PanelDetailModal.tsx:400` AND `PanelCard.tsx:99` (which already holds
      `paginationEntry?.hasMore` at `:113`). Wiring only the modal defaults the prop to `false` on
      the dashboard grid and RELOCATES the inversion there instead of removing it. Enumerate the
      call sites; do not patch only the one the bug was reported against.
- [x] 4.0b Re-gate HEL-448's existing sort qualifier on the SAME `rowsTruncated` prop (ruled
      `fix-inline`). It is currently gated on the broken predicate, so it has never rendered in the
      detail modal since `adadb5d4`. NOT a one-line change: `TableRenderer.tsx:282-305` wraps BOTH
      the truncation note AND the Load-more `<button onClick={onLoadMore}>` in ONE
      `{usingPagination && paginationHasMore && ...}` block. Re-gating that block wholesale would
      render a visible, focusable, DEAD button in the modal, where `onLoadMore` is undefined. Gate
      them SEPARATELY — note on `rowsTruncated`, button on `rowsTruncated && onLoadMore != null`.
      The button gate MUST retain `rowsTruncated`: `PanelCard.tsx:115` passes
      `onLoadMore={handleLoadMore}` UNCONDITIONALLY, so gating on `onLoadMore != null` alone renders
      a live Load-more button on every FULLY-LOADED dashboard table panel — a new defect this very
      fix would introduce.
      Also handle the wrapper — SEE 4.0g FOR THE SINGLE AUTHORITATIVE RULE. Do not derive a second
      wrapper condition here.
- [x] 4.0e Jest REGRESSION GUARD (mutation-failable, label it): on the `rawRows` branch with
      `rowsTruncated` true and no `onLoadMore`, the truncation note RENDERS and NO Load-more button
      is rendered. Re-gating both on one conditional must turn this red.
- [x] 4.0c Both qualifiers MUST share ONE CONCRETE removal seam — not an asserted intention. They
      are gated on different conditions and rendered at different sites, so "removable together" is
      only true if it is BUILT that way. Required shape: both disclosure strings render through a
      SINGLE named component (e.g. `LoadedScopeDisclosure`) defined in one place, carrying ONE
      marker comment recording that it is pending owner confirmation. Removal is then deleting that
      component plus its call sites — one contiguous change a reviewer can verify by grepping the
      component name. Do NOT inline the two strings at their render sites with separate comments;
      that is the shape that silently stops being removable. D9a remains the delivery-coordinator's
      addition PENDING the owner's confirmation — fixing its predicate does NOT promote it.
- [x] 4.0d Jest: the re-gated sort qualifier RENDERS on the `rawRows` branch when `rowsTruncated` is
      true. This is the HEL-448 regression being fixed — it must have a direct test, not inherited
      coverage.
- [x] 4.0a The detail modal has NO `onLoadMore`. When no load-more affordance is available, the
      truncated-empty state renders the disclosure TEXT WITHOUT the action and offers Clear filters
      alone. Do not discover this as an undefined prop and improvise. REQUIRED TEST: this state
      exists on exactly one surface, which makes it the state nobody exercises by accident — assert
      it directly.
- [x] 4.0f SUPERSESSION (from design D4b's coherence pass): the loaded-scope disclosure is ONE
      message, never two. With `filtering && truncated` the sort note and the filter-scoped message
      would BOTH render — two stacked loaded-scope messages saying overlapping things. The sort note
      renders only when `!filtering`; the filter-scoped message supersedes it. Encode this INSIDE
      the single `LoadedScopeDisclosure` component so it is structural, not a pair of conditions
      that can drift. Jest: with a filter active and the set truncated, exactly ONE loaded-scope
      message renders.
- [x] 4.0g WRAPPER RULE — the single authoritative statement; 4.0b defers to this one.
      **AMENDED (HEL-451 skeptic CR5, cycle 2):** the ORIGINAL formula below (`showSortNote =
      rowsTruncated && !filtering`) predates this ticket's OWN filter-scoped message and is WRONG
      once it exists — design D4b's filter-disclosure table requires "scoped count + loaded-scope
      note" for `filtering && rowsTruncated`, WITH OR WITHOUT `onLoadMore` (the panel detail modal
      never has one), and the literal old formula would silently drop that note in the modal. The
      corrected formula, matching design.md D4b's "CORRECTION (HEL-451 skeptic CR5)" note:
        `showLoadedScopeNote = rowsTruncated || filtering`  (generalizes 4.0f's sort-note case to
                                                              EVERY non-empty message state)
        `showLoadMoreBtn     = rowsTruncated && onLoadMore != null`   (unchanged)
        `render wrapper      = showLoadedScopeNote || showLoadMoreBtn`
      Compute the two children's visibility as named booleans FIRST, then derive the wrapper from
      them — that structural discipline is unchanged; only the note's OWN formula was wrong.
      Deriving the wrapper FROM its children is required, not stylistic: the wrapper (renamed
      `panel-content__disclosure` — skeptic CR7, it no longer only wraps a load-more affordance)
      carries its own padding, and the state `!filtering && !rowsTruncated` (nothing loaded-scope-
      relevant to say) has NEITHER child — a wrapper gated unconditionally would render there as an
      empty padded box. That state is reachable and is exactly the case an earlier revision of
      these tasks disagreed with itself about.
      NOTE (design D4b, corrected): the dashboard grid CANNOT reach the `rawRows` branch —
      `usePanelData.ts:80-95` derives both `rawRows` and `paginationRows` from the same
      `paginationEntry.rows`, so when one is empty the other is null and `TableRenderer` renders its
      skeleton instead. The `rawRows` branch occurs only in the detail modal, where `onLoadMore` is
      absent. Keep the `rowsTruncated &&` term anyway: it is CONSERVATIVE, correct on both reachable
      surfaces, and stays correct if that derivation is ever decoupled. Do not "simplify" it away —
      and put that REASON in a code comment AT the gate, not only in the design doc. A future reader
      with a linter suggesting the term is redundant will delete it otherwise.
- [x] 4.1 Implement the five-state matrix, with `truncated` from task 4.0's `rowsTruncated`:
      - not filtering + truncated → HEL-448's existing sort qualifier only, UNCHANGED
      - filtering + not truncated + results → count, unqualified (a complete answer)
      - filtering + not truncated + empty → "No rows match your filter." + Clear filters
      - filtering + truncated + results → count SCOPED ("N of M loaded rows match.") + loaded-scope note
      - filtering + truncated + empty → names the loaded scope, says more rows may match, offers
        BOTH Clear filters AND Load more
- [x] 4.2 A count is NEVER rendered bare when truncated — always paired with its denominator, so it
      cannot be read as "there are N".
- [x] 4.3 The disclosure DISAPPEARS when not truncated. A permanent caveat is noise that trains
      users to ignore it, and it would be false: with every row loaded the count is exact.
- [x] 4.4 Load more is offered in the truncated-empty state because it is the actual remedy for the
      actual problem. Offering only "clear filters" answers "are there any EMEA rows?" with a shrug.
- [x] 4.5 Jest: all five states, exercised on BOTH the pagination branch AND the `rawRows` branch.
      The `rawRows` branch is where the truncation predicate inverts (task 4.0), so a matrix tested
      only against pagination proves nothing about the case that was actually broken. These are the
      acceptance signal for the restated counts AC — do not leave the matrix to manual checking.
- [x] 4.5a Jest REGRESSION GUARD (mutation-failable, label it): with `rowsTruncated` true on the
      `rawRows` branch, the UI does NOT render an unqualified count and does NOT render the
      non-truncated empty state. Reverting `truncated` to `usingPagination && paginationHasMore`
      must turn this red.
- [x] 4.6 Do NOT describe HEL-448's sort qualifier as owner-approved anywhere. It is a
      delivery-coordinator addition still PENDING the owner's confirmation.

## 5. Persistence (reuses HEL-448's path exactly — design D6)

- [x] 5.1 Add `columnFilters?: TableColumnFilters | null` to `TableOutputConfig` beside `columnSort`,
      with a tolerant `readColumnFilters` (non-object → undefined; non-string `quick` dropped;
      `columns` keeps only string-valued string keys; `null` tolerated). Normalize empty/whitespace
      terms away at WRITE time so a cleared filter does not persist as `{ columns: { region: "" } }`.
- [x] 5.2 Persist via `updateOutput(outputId, { config: { columnFilters } })` — the MINIMAL patch.
      Do NOT spread `output.config`: it is a per-mount `useOutputMeta` snapshot never refreshed
      after a write, so spreading makes every filter change a lost update.
- [x] 5.3 Write only in response to a real user edit — NEVER on mount. Debounce ~300 ms and FLUSH on
      unmount, not cancel (closing the detail modal unmounts `TableRenderer`, which is the path the
      persistence AC exercises).
- [x] 5.4 Rows filter IMMEDIATELY from local state; only the PATCH is debounced. Persistence latency
      must never make typing feel laggy.
- [x] 5.5 Owner PRE-CHECK via the existing `canWrite` (`TableRenderer.tsx:159`) — a non-writable
      caller filters session-locally and silently, write suppressed, NOT attempted-then-swallowed.
      Keep the deliberate commented `.catch` on the write.
- [x] 5.6 Jest (label guards as guards, make them mutation-failable): PATCH body carries only
      `columnFilters` and `fieldMapping`/`columnOrder`/`columnSort` survive; no write on mount; no
      write when `!canWrite`; debounce flushes on unmount; cleared term is not persisted as `""`;
      tolerant read across every malformed shape.

## 6. Gates and rendered-geometry review

- [x] 6.1 `npm run lint`, `npm run typecheck`, `npm run format:check` clean.
- [x] 6.2 `npm --prefix frontend test` green. Do NOT cite root `npm test` — it is
      `jest --passWithNoTests && npm --prefix frontend test`, and the root jest arm finds zero tests
      in a worktree and reports silence as a pass. State which gate exercised the new code.
- [x] 6.3 TWO-AXES (a) — RENDERED GEOMETRY, not source text. The new empty state (`<p>` + buttons)
      and the filter row (inputs in a `<thead>`) are exactly the markup that inherits UA margin,
      padding and line-height. Lane B's 40px misalignment on HEL-510 was inherited from UA defaults,
      written NOWHERE in source, and passed lint, 2801 unit tests and 6/6 Playwright cases. No
      source-text check can see this class of defect — measure or look at the rendered result.
- [x] 6.4 Screenshots to `.concertino/runs/HEL-451/evidence/` — NEVER `openspec/**`, and never
      `git add -f` past `.gitignore` (`:42` ignores `*.png`, `:87` ignores `.concertino/`, so that
      path is safe by construction). Both light AND dark (known light-theme hover token collision:
      HEL-866, HEL-496). Capture the filter row, a scoped count, and BOTH empty states.
- [x] 6.5 Compare against the HEL-448 sort header, the resize/density affordances, AND the HEL-1022
      list tables. If those neighbours disagree with each other, SAY SO rather than adding a third
      variant. If cohesion needs an adjacent surface beyond scope, ESCALATE with screenshots — the
      owner is the tiebreaker on visual calls.
- [x] 6.6 TWO-AXES (b) — VARY THE DATA. Exercise: a legacy Output whose `fieldMapping` fails HEL-892
      merged-config validation (4 of 53 table Outputs in the dev DB; the filter write hits the
      identical owner-only PATCH, and HEL-448's unhandled rejection was found ONLY by sampling one);
      the all-strings `rawRows` branch; and an Output with a MAP-CLASSIFIED column, without which
      design D2's central justification is untested. A filter exercised only against well-formed
      pagination-branch Outputs will look green and prove little.

## 7. Handoff

- [x] 7.1 Rebase on `main` before the PR (concurrent lanes are moving frontend files) and re-run the
      task-6 comparison if anything moved.
- [x] 7.2 Update `files-modified.md`, run gates, and COMMIT before yielding. Staging without
      committing is an incomplete handoff.
- [x] 7.3 PR body states plainly: filters are Output-scoped and converge ON LOAD (never per-panel);
      a non-writable caller filters session-locally; filtering is CLIENT-SIDE over LOADED rows only,
      so counts describe the loaded set — with HEL-1027 linked as the ticket that owns whole-Output
      counts; and that the loaded-scope disclosure exists because a filtered sample can otherwise
      state a confidently wrong answer.
- [x] 7.4 The PR body MUST also state plainly, as a fixed pre-existing defect: HEL-448's
      `Sort covers only the loaded rows.` qualifier has never rendered in the panel detail modal
      because `truncated = usingPagination && paginationHasMore` is false there, so a sorted 200-row
      sample has presented as complete since `adadb5d4`. Include the mechanism —
      `PanelDetailModal.tsx:400-404` passes `rawRows`/`headers` with no pagination props, while
      `usePanelData.ts:87-95` derives those rows from the same paginated entry.
- [x] 7.5 Comment on HEL-448 in Linear pointing at this PR, so a shipped ticket whose behaviour
      changed carries the record. HEL-448 stays Done — this is a note, NOT a reopen.

## 8. D10 reframe — chrome and the filtered-empty message leave the table (owner-authorized)

- [x] 8.1 Introduce `.ui-data-grid__frame` (D10-2): filter toolbar, quick-filter row, and the
      filtered-empty message all render as ordinary block-level chrome BEFORE the scroll container
      (`.ui-data-grid`), never after. `.ui-data-grid__filter-row--columns` STAYS inside the table.
- [x] 8.2 Frame contract (D10-3/D10-3a): frame is `display: flex; flex-direction: column;
      min-width: 0; min-height: 0`. `.ui-data-grid--full` changes from `height: 100%` to
      `flex: 1; min-height: 0`. `--preview` keeps `max-height: 320px` on the scroll container, not
      the frame. Frame chrome carries `flex-shrink: 0` (skeptic-design-9 non-blocking note 1).
- [x] 8.3 Re-home the chrome's presentational CSS (D10-4): toolbar/quick-filter row/filtered-empty
      message carry the same `--app-surface-soft`/`--app-border-subtle`/`--space-*` recipe the old
      `<th>`/`<td>` cells had. Frame mirrors the density modifier class so the chrome still responds
      to density even though it is now a sibling of `.ui-data-grid`, not its ancestor.
- [x] 8.4 Delete `stickyCellMaxWidth` (state + effect), `.ui-data-grid__sticky-cell`, `stickyOffsets
      .toggle`/`.quick`, `toggleRowRef`/`quickRowRef`, and the `73a2dd0c` truncation-group reset
      selector list (D10-5). Success criterion: `stickyCellMaxWidth` no longer exists and no inline
      `maxWidth` is computed anywhere in `DataGrid`.
- [x] 8.5 The genuinely empty `<tbody>` (D10-6): zero `<tr>`s when filtered-empty; `tbody:empty`
      gets `display: block; min-height: var(--space-8)` so it cannot collapse to a 0px sliver.
- [x] 8.6 Confirm `stickyOffsets.columns` (now a single measured header-row-height offset feeding the
      per-column filter row's `top`) is LIVE, not inert (D10-7) — the per-column filter row is still
      the only sticky row left inside `<thead>` besides the column header itself.
- [x] 8.7 The `rows.length === 0 && filtering` state (D10-8): the table shell (`<thead>`, header row,
      per-column filter row) still renders; only `<tbody>` rows are absent.
- [x] 8.8 Test guards (D10-9): retargeted `DataGrid.test.tsx`'s sticky-cell/colSpan/max-width/static-
      source tests to the new structure; added the three required replacement guards — (a) no
      `colSpan` inside `<table>`, (b) no inline `maxWidth` computed anywhere, (c) toolbar/quick-
      filter/filtered-empty message all precede `.ui-data-grid` in DOM order. `:840`'s "measured, not
      hardcoded" property retargeted to the one remaining offset rather than dropped.
- [x] 8.9 Verify invariants 1-4 and 7 survive (D10-10) — persistence, predicate, supersession,
      removal seam, drag-resize — against the moved DOM. Invariant 5 (HEL-448 modal re-gate) was
      already wired (`showLoadedScopeNote = rowsTruncated || filtering`); invariant 6 (collapsed
      filters never hide an active filter) is carried by the `Filters (n)` badge on the toolbar,
      unchanged in the frame.
- [x] 8.10 D10a: strip the "pending owner confirmation"/"NEVER owner-approved"/"deliberately
      trivially removable" labelling from `LoadedScopeDisclosure.tsx` and `TableRenderer.tsx` — the
      owner has confirmed the disclosure. The removal seam itself stays.
- [x] 8.11 Gates: `npm run lint`, `npm run typecheck`, `npm run format:check`,
      `npm --prefix frontend test` all clean/green.
