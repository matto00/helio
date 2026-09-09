## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Base confirmed: `git log --oneline -2` in the worktree gives `36a9c1cc` (HEL-1015) over `adadb5d4`
(HEL-448). No implementation exists (`git status --porcelain` shows only the untracked change dir).

**Round 1 CR2 — ADDRESSED.** D5 now specifies the markup exactly (empty+no-filter = today's
`<p className="ui-data-grid__empty">` early return; empty+filter = full grid shell with the message
as one `<tr><td colSpan={resolvedColumns.length}>` inside the live `<tbody>`), with the rationale
for choosing it over a sibling `<p>`; tasks 3.3a mirrors it verbatim and forbids improvisation.
I checked the span is right in every case this design reaches: `DataGrid.tsx:158`
`resolvedColumns = columns ?? deriveColumns(rows)` would be EMPTY for an empty `rows` — but
`TableRenderer.tsx:266-274` always passes `columns`, derived from `naturalKeys` over the UNFILTERED
`paginationRows`/`rawRows`, and `usingPagination`/`usingRaw` (`:167-168`) are likewise computed from
the unfiltered source, so the filtered-empty render still enters the grid branch with a non-empty
column set. `colSpan` is correct, the `<th>` width `style` and the `role="region"` scroll wrapper are
unaffected by a `<td colSpan>` (no `colgroup` in the table). No finding.

**Round 1 CR3 — ADDRESSED.** Task 3.3 now names four non-test consumers and requires the no-action
path asserted against a NAMED non-panel one. I confirmed all four exist and reach the shared
`DataGrid.tsx:229-231` empty branch.

**Round 1 CR1 — PARTIALLY addressed; see CRs 1 and 2 below.** The diagnosis is now correct and well
documented (D4 + tasks 4.0/4.0a–4.0d), and I re-verified its premises independently:
`PanelDetailModal.tsx:400-404` passes `rawRows`/`headers` with no pagination props;
`usePanelData.ts:79-93` derives `rawRows` from the same `paginationEntry.rows`; `PanelCard.tsx:98-117`
passes BOTH `rawRows` and `paginationRows` (so the card takes the pagination branch and the modal the
raw branch). The prescribed wiring, however, is incomplete on one surface and its "one line" re-gate
is not one line.

**Stale citations corrected:** `formatCell` is `DataGrid.tsx:128-132` (design D2 now says so);
`canWrite` is `TableRenderer.tsx:159` (D6 and tasks 5.5 now say so). Both verified.

**D9a labelling:** `TableRenderer.tsx:281-285` still carries the pending-confirmation comment;
design and tasks (4.0c, 4.6) say pending everywhere and nowhere approved. The shared removal seam is
asserted but not yet real — see CR2, which is the same code region.

**Surfaces traced (attack 1):** `PanelContent` has exactly two non-test call sites — `PanelCard.tsx:99`
and `PanelDetailModal.tsx:400`; `TableRenderer` has exactly one (`PanelContent.tsx:133`). Only two
surfaces to get right.

**Settled rulings honoured:** flat sibling (D1), Output-scoped/on-load, minimal patch (D6/5.2),
silent degrade (D6/5.5), client-side only, restated counts AC with HEL-1027 named. No re-litigation.

### Verdict: REFUTE

Three findings, all in the `rowsTruncated` fix and the map-column justification — i.e. in the two
places this round was asked to attack. Everything else in the artifacts holds.

### Change Requests

1. **The `rowsTruncated` wiring omits `PanelCard`, which RELOCATES the inversion instead of fixing
   it.** Task 4.0 says: "pass it through `PanelDetailModal` → `PanelContent` → `TableRenderer` …
   and derive `truncated` from that on BOTH branches". `PanelCard.tsx:98-117` is not named anywhere
   in D4 or §4. If the executor follows the task literally, the dashboard card renders
   `TableRenderer` with `rowsTruncated` undefined → `truncated` defaults to `false` (D4: "defaulting
   to `false` only when genuinely unknown"), while the card is genuinely truncated
   (`paginationEntry.hasMore`). The card would then LOSE the disclosure it correctly shows today and
   render unqualified counts over a 200-row sample — the identical defect, moved from the modal to
   the grid. Required: name `PanelCard` explicitly as a second producer of `rowsTruncated`
   (`paginationEntry?.hasMore ?? false`), and/or specify the derivation as
   `truncated = rowsTruncated ?? (usingPagination && paginationHasMore)` so an unwired surface
   degrades to today's behaviour rather than to a false "complete". Add a Jest case asserting the
   pagination branch still discloses.

2. **Re-gating HEL-448's qualifier is NOT "one line", and the naive one-line change ships a dead
   Load-more button in the modal.** `TableRenderer.tsx:279-305`: the `<p
   class="panel-content__truncation-note">` and the `<button class="panel-content__load-more-btn">`
   are siblings inside ONE conditional, `{usingPagination && paginationHasMore && (...)}`. Changing
   that gate to `rowsTruncated` (task 4.0b, "One line, on a signal this diff introduces anyway")
   also re-gates the button, which then renders in the panel detail modal where `onLoadMore` is
   `undefined` (`PanelDetailModal.tsx:400-404` passes no handler) and
   `disabled={paginationIsLoadingMore}` is also undefined — an enabled, focusable "Load more" that
   does nothing. D4 anticipates the missing `onLoadMore` only for the truncated-EMPTY state (4.0a);
   the non-empty truncated case in the modal — matrix row 1, "sort qualifier only, UNCHANGED" — is
   exactly the case this exposes. Required: specify the split (qualifier gated on `rowsTruncated`;
   the Load-more control gated on `rowsTruncated && onLoadMore != null`, or on the existing
   pagination predicate), state it in D4 and tasks 4.0b, and add a Jest case that the `rawRows`
   branch with `rowsTruncated` true renders the qualifier and NO Load-more button. This is also
   where task 4.0c's "one removal seam" must become concrete rather than asserted.

3. **D2's central premise — "the filter matches the rendered text" — is FALSE on the `rawRows`
   branch, which is the panel detail modal, the primary filtering surface.** D2 justifies filtering
   map-classified columns on the grounds that "`formatCell` already renders those as
   `JSON.stringify(value)`", so a match is always visible and explainable. But
   `usePanelData.ts:86-92` builds `rawRows` as
   `Object.values(row).map((v) => (v != null ? String(v) : ""))` — `String({...})` is
   `"[object Object]"`. On that branch every map/struct cell DISPLAYS `[object Object]`, so:
   (a) the quick term `object` matches every map-valued row, an unexplainable match of exactly the
   kind D2 promises cannot happen; (b) filtering on any key or value inside the JSON matches
   NOTHING, though the pagination branch (`PanelCard`) matches it fine — the same filter term,
   persisted Output-scoped, behaves differently on the two surfaces bound to one Output;
   (c) the spec scenario "An object-valued cell matches its rendered text … and the matching text is
   visible in the cell" is unsatisfiable there. It also makes null rendering differ per branch
   (`—` via `formatCell` on the card, `""` on the modal). Required: D2 must state the per-branch
   rendering difference and decide it explicitly — either keep the predicate and scope the map-column
   justification to the branch where it is true (naming the modal's `[object Object]` behaviour as a
   known, accepted limitation, with the `object` false-match called out), or require `usePanelData`'s
   `rawRows` to serialize via `formatCell` so both branches agree. Task 1.3's object-cell test must
   name which branch it exercises, and tasks 6.6's map-classified-Output check must cover BOTH.

### Non-blocking notes

- D4a correctly records the positional-key precedent (verified: `TableRenderer.tsx:172`,
  `String(i + 1)`), which is round 1's note 2 discharged.
- Tasks §6 does commit to rendered-geometry measurement (6.3) and both-theme screenshots (6.4/6.5),
  which is what the lane-B 40px class needs; combined with D5's now-explicit markup I consider the
  two-axes (a) obligation met at design level.
- The restated counts AC does have an evidence path (4.5 + the 4.5a mutation-failable guard, labelled
  as a guard). CR1 above is what would make that guard incomplete rather than absent.
