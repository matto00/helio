## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Base: `git log --oneline -2` → `36a9c1cc` (HEL-1015) over `adadb5d4` (HEL-448). `git status --porcelain`
shows only the untracked change dir — no implementation exists. All findings below are from source,
not from either prior report.

**Call-site enumeration (attack 1), done myself.** `grep -rn "PanelContent" frontend/src` → exactly two
non-test render sites: `PanelCard.tsx:99` and `PanelDetailModal.tsx:400-417` (verified the modal passes
`rawRows`/`headers` and NO `paginationRows`/`paginationHasMore`/`onLoadMore`). `grep -rn "TableRenderer"`
→ exactly one non-test render site, `PanelContent.tsx:133`. `MobilePanelStack.tsx:95,118` renders
`PanelCardBody`, i.e. it inherits `PanelCard`'s props — not a third producer. `<DataGrid` non-test
consumers are exactly four: `TableRenderer.tsx:273`, `StepCard.tsx:382`, `SourceDetailPanel.tsx:288`,
`SqlTab.tsx:223` — task 3.3's enumeration is complete and correct.

**D2's limitation (attack 4) — ACCURATE.** `usePanelData.ts` `rawRows` is
`rows.map((row) => Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")))`, so
objects are destroyed there. The pagination branch preserves them end to end:
`PanelCard.tsx:112` `paginationEntry?.rows` → `TableRenderer.tsx:167,183` `normalizedRows` passes the
records through unchanged → `DataGrid.tsx:128-132` `formatCell` `JSON.stringify`s objects. `rawRows` is
the only pre-destroying branch. D2 states this correctly and does not overclaim.

**Deferrals are real.** HEL-1033 — open, Backlog, priority High, title matches, and its body already
carries the mechanism and the "HEL-451 documents the limitation" record. HEL-1027 — open, Backlog,
retitled "Server-side sort, filter and counts for Output rows", explicitly owns filtered counts/`hasMore`
and the removal/restatement of both disclosures. Both references in design/tasks are accurate.

**D9a is nowhere described as approved.** `grep -n "approved"` over design.md/tasks.md returns only
design.md:176, design.md:221 and tasks.md:121, each stating PENDING/NOT approved. Clean.

**Settled rulings honoured** — flat sibling (D1), Output-scoped on-load, minimal patch (D6/5.2), silent
degrade via the real `canWrite` at `TableRenderer.tsx:159` (verified), client-side only, restated counts
AC with HEL-1027 named. Nothing re-litigated.

### Verdict: REFUTE

Four findings. Two of them (CR1, CR3) are round-2 CRs that were addressed in `design.md` but NOT in
`tasks.md` / not made concrete — and the executor works from `tasks.md`. CR2 is a NEW defect introduced
by round 2's own fix, and it is the same class for the third time in this lane: a gate written from the
props one surface happens to receive.

### Change Requests

1. **`tasks.md` still never mentions `PanelCard` — the round-2 defect is reproducible verbatim by an
   executor following the task list.** Task 4.0 reads: "pass it through `PanelDetailModal` →
   `PanelContent` → `TableRenderer` … and derive `truncated` from that on BOTH branches."
   `grep -n "PanelCard" tasks.md` returns NOTHING. Design D4:160-162 was corrected and names both call
   sites, but tasks.md is the executable artifact and still describes the modal-only chain that round 2
   ruled defective. Required: (a) task 4.0 names `PanelCard.tsx:99` explicitly as the SECOND producer,
   passing `rowsTruncated={paginationEntry?.hasMore ?? false}` (it already holds that value at `:113`);
   (b) adopt the defensive derivation round 2 offered and design still declines —
   `truncated = rowsTruncated ?? (usingPagination && paginationHasMore)` — so an unwired or
   future call site degrades to today's behaviour rather than to a false "complete"; (c) add a Jest case
   asserting the PAGINATION branch (card) still discloses truncation after the change. Enumerating the
   class is a design-artifact obligation, not just a prose one.

2. **NEW DEFECT, introduced by round 2's fix: gating the Load-more button on `onLoadMore != null` makes
   it render on every non-truncated dashboard table panel.** Design D4 says "the button on the load-more
   affordance actually being available (`onLoadMore != null`, which also implies the pagination branch)",
   and task 4.0b repeats it. That parenthetical is FALSE in both halves: `PanelCard.tsx:98-117` passes
   `onLoadMore={handleLoadMore}` UNCONDITIONALLY — it is a `useCallback` that always exists, passed
   regardless of `hasMore` and regardless of which branch `TableRenderer` takes. Today the button is
   gated `usingPagination && paginationHasMore` (`TableRenderer.tsx:282`). Under the prescribed gate a
   fully-loaded table panel on the dashboard grid renders an enabled "Load more" that fetches a page that
   does not exist. Task 4.0e's guard only asserts the MODAL case (no `onLoadMore`), so nothing would
   catch this. Required: gate the button on `(rowsTruncated || paginationHasMore) && onLoadMore != null`
   — truncation AND affordance, both — state it in D4 and 4.0b, delete the false "which also implies the
   pagination branch" claim, and add a Jest case: pagination branch, `paginationHasMore` false,
   `onLoadMore` supplied → NO Load-more button.
   **Same CR, the wrapper:** neither artifact says what happens to
   `<div className="panel-content__load-more">` once its two children are gated independently.
   `TableRenderer.css:12-19` gives it `display:flex; gap: var(--space-1); padding: var(--space-2) 0 0`,
   so an executor who hoists the wrapper above the two conditionals renders an EMPTY div with ~8px of
   padding under every non-truncated table panel — source-text-invisible geometry, exactly the lane-B
   class. Specify it: the wrapper renders only when at least one child does, and task 6.3 must name the
   non-truncated table panel as a surface whose geometry is measured (it currently names only the empty
   state and the filter row).

3. **The D9a "one removal seam" is still asserted, not concrete — round 2's CR2 required it to become
   concrete and it did not.** Task 4.0c and design.md:176 both say the qualifiers "MUST share ONE removal
   seam" without naming any mechanism, and the note and button are now gated on DIFFERENT conditions
   while the filter disclosure's own DOM home is never specified anywhere in D4/D5. The existing seam is
   documented in `TableRenderer.css:24` as "delete this rule + the `<p>` in TableRenderer.tsx" — a
   filter disclosure with its own class and its own conditional does not join that seam by assertion.
   Required: name the concrete unit — one function/component (e.g. a `LoadedScopeDisclosure` rendering
   both the sort qualifier and the filter scope note) plus ONE CSS block — such that removing that unit
   and its rule removes both qualifiers and leaves the Load-more button intact. State it in D4 and 4.0c,
   and have 4.0c's evidence be that removal seam existing in the diff, not a claim in the PR body.

4. **The spec delta contradicts D4/task 4.0a on the modal.** `specs/table-panel-column-filtering/spec.md`
   (Requirement "The UI states the scope of a filtered result…") says unconditionally: "When a filter
   matches no loaded row AND the loaded row set is truncated, the empty state … SHALL offer both a
   clear-filters action and a load-more action." That is UNSATISFIABLE in the panel detail modal, which
   has no `onLoadMore` at all — and D4 / task 4.0a deliberately specify text-without-action there. A spec
   requirement no implementation can meet on one of its two surfaces is a contradiction the final gate
   would have to either fail or quietly ignore. Required: qualify the requirement ("…and SHALL offer a
   load-more action where a load-more affordance is available; where none is available it SHALL state
   that more rows may match and offer clear-filters alone") and add the matching scenario, so task 4.0a's
   required direct test has a requirement to trace to.

### Non-blocking notes

- The spec scenario "An object-valued cell matches its rendered text" remains unqualified by branch. With
  D2's limitation documented and HEL-1033 open and owning it, I do not consider this blocking, but the
  requirement sentence "including for columns whose values are objects, which render as serialized text"
  is only true on the pagination branch; a one-clause qualifier would keep the spec honest.
- D2 cites `usePanelData.ts:87-92`; the actual `String(v)` map is at `:86-93` and uses
  `v !== null && v !== undefined` rather than `v != null`. Semantically identical, cosmetically stale.
- Tasks §6 does commit to rendered-geometry measurement (6.3) and both-theme screenshots (6.4/6.5), and
  §6.6 varies the data across the three shapes that matter. Subject to CR2's wrapper addition, the
  two-axes obligations are met at design level.
