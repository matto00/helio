## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold agent. Every claim below is re-derived from the tree at
`.claude/worktrees/feature/in-panel-column-filtering/HEL-451`, not from prior reports.

### What I verified (with evidence)

**Surfaces / props (D4b's surface matrix) — re-derived, CORRECT except one clause.**
- `PanelCard.tsx:98-118` passes `rawRows`, `paginationRows={paginationEntry?.rows ?? null}`,
  `paginationHasMore={paginationEntry?.hasMore ?? false}` and `onLoadMore={handleLoadMore}`
  UNCONDITIONALLY. So round 3's CR2 is real: gating the Load-more button on `onLoadMore != null`
  alone would render a live button on every fully-loaded grid panel. The tasks' gate
  (`rowsTruncated && onLoadMore != null`, 4.0b) is correct.
- `PanelDetailModal.tsx:400-412` passes `rawRows`/`headers` only — no pagination props, no
  `onLoadMore`. Confirmed.
- `TableRenderer.tsx:282-305` (verified in file): ONE `{usingPagination && paginationHasMore && ...}`
  block wraps BOTH `panel-content__truncation-note` and the Load-more `<button>`. The design's
  "not one line" claim is true, and the HEL-448 qualifier genuinely cannot render in the modal.
- `usePanelData.ts:80-95`: `rows = paginationEntry?.rows ?? []`; `rawRows` is derived from those same
  rows and is `null` when `rows.length === 0`. So on the grid `rowsTruncated` is always meaningful
  (never the "genuinely unknown" default) — the design's caveat is conservative, not wrong.

**Uncovered-combination hunt (the specific attack asked for).**
- Loading / error / `noData` / `neverMaterialized` all return from the OUTER `PanelContent`
  (`:228`, `:239`, `:257`, `:281`) BEFORE any renderer is reached, so none of them can reach the
  disclosure. Not a hole.
- `usingPagination` / `usingRaw` (`TableRenderer.tsx:167-168`) are computed from the RAW props, i.e.
  PRE-filter. A filter that empties the set therefore still takes the `DataGrid` branch with
  `rows=[]`, so D5's empty-state path is reachable; a genuinely zero-row panel takes the
  `aria-hidden` skeleton branch and is unaffected. This is the load-bearing fact that makes D5
  implementable, and it holds.
- `paginationRows` non-empty while `rawRows` null cannot occur (both derive from the same `rows`).
  Also the converse — see note N2.

**Single `TableRenderer` call site** (`PanelContent.tsx:133`, `columnSort={cfg.columnSort}` at `:143`),
two `PanelContent` call sites. The "enumerate the class" requirement (tasks 4.0) names exactly the
right two, in BOTH design.md and tasks.md this time — verified by reading both files, not by diff.

**Supersession rule (D4b / task 4.0f).** Checked cell by cell. There is no state where a user needs
both messages: the filter-scoped message strictly dominates the sort note (it names the same scope
plus the match count). Encoding it inside `LoadedScopeDisclosure` is genuinely structural, because
the two render positions (in-`tbody` empty row per D5; below-grid per D4) are mutually exclusive by
`rows.length`, so "exactly one message" is a property of the component's own return, not of two
independent conditions.

**Deferrals are live.** HEL-1027 open/Backlog, retitled "Server-side sort, filter and counts for
Output rows", and its body explicitly owns the transferred counts AC. HEL-1033 open/Backlog. Both
verified via Linear, not assumed.

**Nothing describes D9a as approved.** Grepped design.md and tasks.md: every mention says pending
owner confirmation; task 4.6 forbids it explicitly. The removal seam is a concrete named component
with one marker comment (4.0c), verifiable by grepping the name — a real seam, not an assertion.

**Round 3's fixes did not introduce a new defect of the class this lane keeps hitting**, with one
wording exception (N1). ACs trace: quick filter → 1.2/3.1; per-column AND → 1.2; empty state with a
clear action → 3.3/3.3a/4.1; persistence across modal close and reload → 5.3 + Playwright; restated
counts AC → 4.1-4.5 + 4.5a guard; Jest coverage → 1.3/2.3/4.5/5.6; composition with sort → 2.1/2.3.
Design.md and tasks.md now AGREE on the two call sites, the separate gates, the wrapper, the
supersession and the removal seam.

### Verdict: CONFIRM

An executor can build this from tasks.md without improvising a decision the artifacts do not make.
The notes below are polish; none would ship a defect on its own, and N1 is already covered by the
binding sentence in task 4.0b.

### Non-blocking notes

1. **Wrapper rule is stated twice, and the two statements diverge in one state.** Task 4.0g says
   "the wrapper and the note gate on `rowsTruncated`"; task 4.0b says it "MUST NOT render as an empty
   padded box when both children are gated away". In `filtering && truncated && empty &&
   onLoadMore == null` (the detail modal, the sharpest case) the note is SUPERSEDED and the button is
   absent, so 4.0g's shorthand yields an empty padded `panel-content__load-more` directly beneath the
   empty-state message. 4.0b's rule is the correct and safe one. Prefer stating it once:
   *the wrapper renders iff at least one child renders*. Worth adding that exact state to the task-6.4
   screenshot list.
2. **D4b's headline "correction" is factually wrong, though harmlessly conservative.** It claims the
   dashboard grid "falls to the `rawRows` branch whenever `paginationRows` is null/empty — with
   `onLoadMore` present". It cannot: `usePanelData.ts:87-95` makes `rawRows` null exactly when
   `rows.length === 0`, and `paginationRows` is the same `rows`, so `usingRaw` is unreachable on the
   grid; when both are empty `TableRenderer` takes the skeleton branch. The gates derived from it are
   still correct (strictly stricter), and the state remains constructible in unit tests by passing
   props directly — but the executor should not burn time trying to reproduce it through the app, and
   the sentence should be corrected so a later reader (HEL-465/469) does not inherit a false premise.
3. **Stale priority clause.** D2 says HEL-1033 is "(Medium; ...)" and then "triaged High and owned by
   the lane that shipped HEL-1015". Linear says Medium, Backlog, and the ticket itself records the
   High triage as having been withdrawn. Drop the High clause.
4. **`columnFilters` plumbing is implied, not written.** Nothing states the mirror of
   `PanelContent.tsx:143` (`columnFilters={cfg.columnFilters}`) or whether the local filter state is
   seeded once like `defaultSort` (`TableRenderer.tsx:205-212`, deliberately never re-derived) or
   tracks the prop. "Mirror `columnSort`" is the obvious read, but one sentence in task 5.1 removes
   the judgement call.
5. **Placement of the scoped count in the non-empty truncated case is unstated.** Supersession implies
   it renders where the sort note renders; saying so avoids a second placement being invented.
6. **Spec delta has no scenario for the supersession rule.** Tasks 4.0f requires the Jest assertion,
   so it will be tested, but "exactly one loaded-scope message renders" belongs in the delta as a
   scenario too.
7. **Preserve the note's DOM/class when extracting `LoadedScopeDisclosure`.** Task 4.0c does not say
   the extracted component must keep `<p className="panel-content__truncation-note">`; changing it
   silently changes rendered geometry, which is the exact class task 6.3 exists to catch.
