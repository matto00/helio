## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: f63ab8365d2b0e6cac36154a83437b6d26b3a209 (worktree HEAD; the only change is the untracked change dir).
origin/main is now 51a8f593c. `git diff --stat f63ab8365 origin/main -- frontend/src/features/panels frontend/src/shared/ui
frontend/src/theme DESIGN.md openspec/specs/write-path-audit e2e/support` is empty, so there is no overlap.

### What I verified (with evidence)

- **Spawn cwd**: assert-cwd.sh printed `READY ambient=/home/matt/Development/helio branch=task/hel1399-followups-split-tablerenderer/HEL-1449`.
- **Owner ruling**: events.jsonl line 5 is `escalation.answered`, `answer:"scroll-hint"`, `answer_source:"human"`. D5 is judged on execution only.
- **Base file**: `git show f63ab8365:frontend/src/features/panels/ui/renderers/TableRenderer.tsx` is 903 lines. I checked every boundary with `sed -n … | cat -A`:
  - L30 is blank (end of imports) and L31 is `interface TableRendererProps {`.
  - L121 is `}`, L122 is blank, and L123 starts the HEL-1027 doc comment.
  - L241 is `}`, L242 is blank, and L243 is `const PERSIST_DEBOUNCE_MS = 300;`.
  - L282 is `}`, L283 is blank, and L284 is `export function TableRenderer({`.
  - L310 is `useState(widths)`, L319 is `useAppSelector`, L320 is `canWrite` and L321 is blank.
  - L322-336 is the D6a/D10 comment, L337 is `usingPagination` and L468 is `displayRows`. L469 is blank.
  - L470 starts the HEL-448 D6 comment, and L603 is `}, [outputId]);`.
  - L605-611 is handleSort's doc comment and L612 is `function handleSort`.
  - L694 is `  }`, the end of handlePinToggle. L695 is blank and L696 starts the HEL-451 render comment.
  - L752-783 is `emptyAction` and L787-801 holds the three useMemos.
  - The `eslint-disable-next-line` lines are L448 and L577.

  Every line number in D1 and the Context section matches the file.
- **D2 partition**: the blocks are 1-30, 31-122, 123-242, 243-283, 284-321, 322-468, 469, 470-694 and 695-903. Each block's end plus one equals the next block's start, from 1 through 903. The blocks are sorted and do not overlap, so together they cover 1..903 with no gaps. Each moved block starts and ends on the correct line: a, b and c end on their blank separator; d ends on `displayRows`; e ends on handlePinToggle's closing `}`.
- **Round-2 CR1 (e range)**: fixed. D1e is "L470-694", the Context section says handlers L605-694 and render L696-903, D2 says host L695-903, and tasks 2.3 says "L470-694".
- **Round-2 CR2 (partition and mechanical assertion)**: fixed. The proof asserts that the ranges are sorted, non-overlapping and contiguous over 1..903, and that first/last lines appear in order. Task 2.5 persists this.
- **Round-2 CR3 (stale Risks bullet)**: fixed. The Risks section no longer contains the "judged live" inset-shadow bullet.
- **Round-1 CR1-CR4**: all still addressed:
  - The handlers move with their doc comments.
  - EditFormScrollArea mounts with the form.
  - The test starts in view mode and stubs prototype getters before the toggle.
  - The live check covers view→Edit, E and a 390×844 open.
  - The budget is recomputed.
  - The fade is drawn on an overlay above the opaque rows, with a pixel-delta check and a click-through check.
- **No forward references out of the moved blocks**: the identifiers declared at L695-903 are `isEmpty`, `showLoadedScopeNote`, `showLoadMoreBtn`, `showTruncationWrapper`, `emptyText`, `emptyAction`, `hasLeading`, `ruledColumns`, `gridRowClassName` and `gridColumns`. None of them appears in code in L284-694; `emptyText`/`emptyAction` appear only in comments at L335. Moving the handlers into a hook therefore cannot lose a closure binding.
- **Hooks in e**: they are at L502, L517, L518, L557 and L582, and all stay inside e. No hook sits in the render section apart from the three useMemos.
- **Line budget**: the moved blocks total 92 + 120 + 41 + 147 + 225 = 625 lines, which leaves 278 host lines before additions. That is about 325 after imports and call sites, under 400. `useTablePersistedState` comes to about 225 lines plus params and return, under 400.
- **D5 layout**:
  - The wrapper is now stated as a column flex.
  - The form keeps `flex:1; overflow-y:auto`. Because the form is a scroll container, its `min-height:auto` resolves to 0, so the box is equivalent to today's form inside `.panel-detail-modal__inner` (column flex, `height:100%`).
  - The form's children are AppearanceEditor, OutputPanelSection and OutputControlsEditor. The fragment flattens, so they are direct children and the child ResizeObserver sees them.
  - There is no `z-index` in `editors/*.css` or `detailModal/*.css`, so the overlay at `z-index:1` sits above the rows.
- **useScrollEdges** (shared/ui/useScrollEdges.ts): `measure` sets a fresh object on every call, so adding fields does not change render counts.
- **elevationTokenGuard**: it pins by file and count, and its CSS-file count is 132 (L351). The design prefers the existing stylesheet and updates the count if a new file is added.
- **D3**:
  - The `write-path-audit/spec.md` `test -e` loop prints exactly 7 MISSING.
  - `PanelContent.css:238-239` is the stale Spinner pointer.
  - `ChartRenderer.tsx:18` and `MarkdownRenderer.tsx:10` both carry the stale `PanelContent.tsx` text, and the grep-and-classify step covers them.
- **D4**: `editors/OutputControlsEditor.tsx:56` calls `getFilterCapabilities`. The test's `outputService` mock (L24-30) lacks it, so the premise holds.

### Verdict: CONFIRM

Every change request from rounds 1 and 2 is resolved and checked against the base file. The revisions introduce only minor imprecisions, listed below; none blocks implementation.

### Non-blocking notes

- **D3 grep pattern broken by the 120-column re-wrap** (design.md L74-75): the regex is split inside the code span (`…DashboardAppearanceEditor|` / `DashboardList)…`). Pasted literally into bash, grep -E would split it at the newline and fail with an unmatched `(`. Rejoin it into one line before running.
- **D2 blank-line rule**: "blank separator lines belong to the block they close" is applied to a, b and c, but L469 is its own host block and L695 opens the host remnant. This is harmless because comparisons strip whitespace, but the transcript should list the ranges exactly as D2 states them.
- **D2 timing**: commit 2 (D3) edits comment text inside moved code, for example the "`PanelContent` withholds…" comments now in useTableRows/useTablePersistedState. Run the byte-identity proof against commit 1, as task 2.5 implies, and state that in the transcript. A re-run at final HEAD will legitimately differ in those comment lines.
- **Positional comment rot after the move**: verbatim moves carry "above"/"below" references across the new file boundary, for example L335 "skeleton below", L445 "see the comment above" and L497 "`filters`/`defaultSort` above". C1 forbids editing them in commit 1. D3's grep does not catch them, so consider fixing them in commit 2 as comment text.
- **tasks.md 4.3** omits the "Controls section that finishes loading after the form opens" case, which D5 (design.md L133) includes. Treat the design as binding.
- **D1f**: if the fallback triggers, keep `renderFilterEmptyAction` in the host file. Otherwise D3's "Spinner lives only in TableRenderer.tsx" pointer changes.
