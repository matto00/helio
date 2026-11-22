# HEL-1809 profile findings

Evidence (before): `before-renders-dev.txt` (corrected), `before-walks.txt`, `before-loaf-dev.txt`, `before-loaf-prod.txt`,
`before-scroll-edges.txt`, `before-probe-control.txt`; raw rows and the harness in `profile-harness/` (instrumentation patch and
spec stored as `.txt`; never committed to source). `profile-harness/raw-dev-render-nooutput.jsonl.txt` and
`raw-dev-render-withoutput.jsonl.txt` are from the first harness version, whose render counts were wrong (see Correction) and
are kept only for their walk logs. Scroll-edge fixture: CSV, 1,000 rows x 6 string columns (the grid shows 50 rows). Dev server and a
production build (`vite build` + `vite preview` on the lane DEV_PORT, `/api` proxied to the lane backend).

## Correction (withdrawn finding)

The first profile reported that every commit re-renders the app shell (~200 components: `Link`, `UserMenu`, `BottomNav`,
`CommandPalette`, ...). That was a harness artefact: it counted `PerformedWork` flags over the whole tree, and a bailed-out
subtree keeps stale flags from earlier commits. With the traversal restricted to subtrees whose child fibers were rebuilt in the
commit, a keystroke re-renders the pipeline page only (below). AppShell and AppRail render-body counters stay at 0.

## Three claims against the ticket

1. **Page re-render per edit: CONFIRMED.** One Pattern `fill` is 2-4 commits. Commit 0 (the input handler's commit) has one
   render root, `PipelineDetailPageContent` (page state), and re-renders all of it: 47 component renders, 34 distinct
   (`PipelineSpineHeader` and its whole subtree, `PipelineDraftNotices`, `SpineStatusStrip`, `PipelineSpine` with source card,
   lane, step rows and outputs, `StepCardFocused` > `StringOpsConfig` > 2 `TextField`s, `StepPreviewTable` > `DataGrid`,
   `LiveOutputColumn`, both dialog hosts). The header props that change identity every render are inline closures and
   fresh objects in `PipelineSpineLayout` (`onSave, run, onEditSchedule, onOpenShare, onEditOnlySource, onDryRun, onRun,
   draft`). Further commits: 1-2 x `DataGrid` alone (its own state update from `useScrollEdges`' fresh-object `setEdges`)
   and an asynchronous `LiveOutputColumn` commit.
2. **Re-walk of the saved step on every keystroke: NOT PRESENT; recorded as met by evidence (owner ruling: proceed
   without claim 2, do not move the saved walk to load).** Production-build counts (exact; the dev build doubles every memo
   factory under StrictMode, `main.tsx:113`): case A (first edit of a pipeline with no Output) = 1 saved walk + 1 draft walk,
   the saved walk being the one-time walk that `hasDraft` turning `walkBase` on starts (`baseDefs` null -> defs); case B (each
   later keystroke) = 0 saved walks + 1 draft walk; with an Output, 0 saved walks on every keystroke including the first.
   "One saved walk across the whole first-edit keystroke" (all its commits), per design D2. AC1's "no repeated walk" holds on
   the unmodified tree (`before-walks.txt`); the after profile repeats it so it is shown still true.
3. **Scroll-edge cost 13-18 ms: CONFIRMED; the cause is a DataGrid remount on the first edit, not the keystroke.** 17.2 ms dev,
   17.9 and 15.6 ms prod (4x), at 1,000 x 6, in the mount layout-effect `measure` (forced layout of `scrollWidth`/`scrollHeight`)
   of a freshly mounted `DataGrid`: the first edit switches `StepPreviewTable` from its saved `DataGrid` branch to the draft
   branch, the element type at that position changes and the grid remounts (DOM node not kept). Later keystrokes run no
   expensive measure. Every measure, including `unchanged=true` ones, sets a fresh object, which re-renders the grid.

## Which case AC2 reflects

The HEL-1683 control window is case A. Its own LoAF logging yielded no frame >= 30 ms in 5 runs at 4x
(`profile-harness/raw-before-hel1683-spec-n5.txt`), so the n=5 comparison uses the harness with the same seed and fill
(`before-probe-control.txt`): case A handler script median 54 ms, range 52-61 ms.

## Expected re-render set for a Pattern keystroke (test 3.2, named before writing it; cycle 1 version, superseded by the cycle 2 set below)

Rendering: `PipelineDetailPageContent`, `PipelineSpineLayout`, `PipelineDraftNotices`, `SpineStatusStrip`, `PipelineSpine` (and
its rows/outputs), `StepCardFocused` and the Pattern field chain, `StepPreviewTable`, `DataGrid`, `LiveOutputColumn`, the dialog
hosts. NOT rendering: `PipelineSpineHeader` and its descendants (`SpineRunStatus`, `SpineScheduleChip`, `SpineLastRunMeta`,
`ActionsMenu`), the app shell. The test asserts the header descendants do not render on a keystroke after the first (draft chrome)
change, by identity of the component names in this list only.

## What changed (commit 3b82936d9)

- `useScrollEdges`: a measure that finds the same six edge flags sets no state (the layout read and the scroll/resize/observer
  triggers stay synchronous; existing tests unedited).
- `StepPreviewTable`: the saved grid and the draft grid occupy the same fragment slot, so the first edit keeps one `DataGrid`
  mounted (and in the reverse direction on Discard).
- `PipelineSpineLayout` / `PipelineSpineHeader`: the header is `memo`; its eight changing props (`onSave`, `onEditSchedule`,
  `onOpenShare`, `onEditOnlySource`, `onDryRun`, `onRun`, `run`, `draft`) are made identity-stable (`useLatestCallback`,
  `useMemo`). No saved-walk change: there was nothing to fix (claim 2). HEL-1798 session-epoch guards untouched.

## Before / after (dev = Vite dev server with StrictMode; prod = `vite build` + `vite preview`)

AC2, the HEL-1683 control window shape (case A, 2-row fixture, 4x, 1 worker, n=5 per side, harness reading; D6):

| reading | before (every run) | before median / range | after (every run) | after median / range |
| --- | --- | --- | --- | --- |
| LoAF `DIV#root.oninput` script, ms | 61, 55, 54, 52, 54 | 54 / 52-61 | 44, 45, 44, 44, 42 | 44 / 42-45 |
| Event Timing `input` processing, ms | 62, 55, 55, 53, 55 | 55 / 53-62 | 45, 46, 45, 44, 43 | 45 / 43-46 |

The ranges do not overlap on either reading; the after-median is below the before-median: AC2 met. The HEL-1683 spec's own
control window logged no frame >= 30 ms at 4x in 5 of 5 runs before and in 4 of 5 after (one after run logged a 52 ms task;
all passed), so it cannot give this number itself. Case B (later keystroke) Event Timing: before median 36 (33-38), after
median 28 (27-35).

Other AC1 numbers:

| measure | before | after |
| --- | --- | --- |
| component renders, commit 0, later keystroke (B), dev and prod | 47 | 37 |
| header subtree rendered on a later keystroke (`SpineRunStatus`, `SpineScheduleChip`, ...) | yes | no (jest count, red then green) |
| commits for the first edit (prod, 2 rows) | 4 (47, 1, 1, 2) | 3 (47, 1, 2) |
| DataGrid node kept across the first edit | no (remount) | yes |
| `useScrollEdges` forced layout on the first edit, 1,000 x 6, 4x, prod | 15.2 and 19.7 ms (dev 17.2) | 0.00 ms (edges unchanged, no state set) |
| prod handler (Event Timing), first edit, 1,000 x 6, 4x | 47, 55 ms | 33, 38 ms |
| prod handler, first edit, 2 rows, 4x | 28, 24 ms | 16, 16 ms |
| dev handler (LoAF), first edit, 1,000 x 6, 4x | 176 ms | 119 ms |
| saved walks, first edit / later keystroke (prod, exact) | 1 / 0 | 1 / 0 (unchanged: claim 2 met by evidence) |

AC1 reading: the keystroke no longer re-renders the app shell or the page header, repeats no walk (the profile showed none to
remove), and the scroll-edge cost on a 1,000-row frame is gone on the first edit. It still re-renders the rest of the page:
`PipelineDraftNotices`, `SpineStatusStrip`, `PipelineSpine` (source card, lanes, step rows, outputs), the step editor chain, the
preview table, `LiveOutputColumn` and both dialog hosts (37 renders). Those take the whole `page` object or step arrays that
legitimately change; narrowing them is a larger prop-contract refactor than this ticket's profile motivated and is left as a
follow-up (spinoff candidate).


## Cycle 2: narrowing beyond the header (evaluation-1 CR1)

Changes: `PipelineDraftDialogs` takes narrow props and is `memo` (handlers made stable in `PipelineDetailPage`);
`PipelineDetailDialogs` is `memo` with a comparator that ignores the six page fields that change on every edit
(`steps`, `draft`, `draftOutputs`, `draftOutputEditedIds`, `laneGraph`, `draftSave`) and compares every other field by
identity, plus `draft.hasDraft` and, while the Output sheet is open, `steps`; `SpineSourceCard` is `memo` (its `onRemoveRoot` is
stable); `SpineOutputs` is `memo` with a value comparator over the Outputs, the edited ids and each card's source line;
`SpineStepRow` is `memo` with a value comparator (step content, displayed counts and flags, menu labels, reorder index), and
`SpineLane` hands each row identity-stable click and drag wrappers that call the lane's latest closures, so a skipped row never
acts on a stale closure (`SpineLane.liveHandlers.test.tsx`, red by mutation). The scroll grid carries one explicit key
(`PREVIEW_GRID_KEY`) on both branches instead of positional placeholders; test 3.4 stays green.

Expected re-render set on a later keystroke (test 3.2, 3 steps + 1 Output fixture): `PipelineDetailPageContent`,
`PipelineSpineLayout`, `PipelineDraftNotices`, `SpineStatusStrip` (take the whole `page`; cheap, return null or a constant),
`PipelineSpine` and `SpineLane` (their `steps`/`laneGraph` really change), the edited step's row (its summary and count
change), `StepCardFocused` > `StringOpsConfig` (the field), `StepPreviewTable` > `DataGrid`, `LiveOutputColumn`. NOT rendering:
the header, both dialog hosts, `SpineSourceCard`, `SpineOutputs`, the rows of unedited steps (unless their displayed count
changes, which happens when the edit changes a downstream count; the test keeps the filter's output count fixed).

Renders in commit 0 of a later keystroke (1-step, no-Output fixture; `after2-renders.txt`): before 47, cycle 1 37, cycle 2 29,
in dev and prod. First edit: 47, 47, 42. First-edit handler, prod 4x: 2 rows 28/24 ms -> 16/16 -> 15/15; 1,000 x 6 47/55 -> 33/38
-> 30/40. AC2 re-run (`after2-probe-control.txt`, appended, n=10, host load about 5): Event Timing median 55 before, 45 cycle 1,
41 cycle 2; eight quiet runs read 39-43 ms, two loaded runs read 55 and 76 ms, so the ranges overlap and the claim is the
medians plus the eight quiet runs.

## Cycle 3: comparator audit (evaluation-2)

Every memo comparator was re-audited for "wrongly equal":
- `SpineStepRow`: now typed over every prop (`ROW_COMPARERS`, a `Record` over `keyof SpineStepRowProps`), so a prop added later fails
  `tsc` until its comparison is chosen. One semantic gap fixed: the step comparison ignored `opType.label` and `renderKey`; both
  are compared now. Menu click and drag handlers are intentionally not compared (the lane's stable wrappers call the latest
  closures; `SpineLane.liveHandlers.test.tsx`).
- `SpineOutputs`: typed the same way (`OUTPUTS_COMPARERS`); `steps` and `laneGraph` are covered by the source-line comparison.
- `PipelineDetailDialogs`: unknown page fields default to identity (already the safe shape); `draft.hasDraft` and, with the sheet
  open, `steps` are compared. `SpineSourceCard`, `PipelineSpineHeader` and `PipelineDraftDialogs` use React's shallow compare.
- `SpineLane`'s wrapper cache is pruned to the lane's current step ids on each render.
- No memo was removed; no comparison was found semantically wrong beyond the two missing step fields. Render counts are unchanged
  (29 per later keystroke), so nothing was re-measured.

Tests that fail when a comparison is dropped: `SpineStepRow.memoComparators.test.tsx` (every row prop, the menu's flags, reason,
label and aria label, the select handler, the reorder index), `SpineOutputs.memoComparators.test.tsx`,
`PipelineDetailDialogs.memo.test.tsx` (open-sheet steps, `hasDraft`, a non-volatile field, and that a volatile-only edit is
skipped). Mutations: `mutation-cmp-*.txt`.
