## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `4b9d37b5c138551c776b0a661d6723170af8455e`: the cycle-2 commit on top of a112db440. Base:
`1f8e762b5b0055a2c1c76eddd47771eeca8823db` (resolve-review-base.sh). Only the cycle-2 delta is re-reviewed here. The cycle-1
findings that still stand are listed in evaluation-1.md.

### Phase 1: Spec Review — PASS

- **Cycle 1 CR1 (AC1, "no longer re-renders the whole page"): addressed, AC1 now met.**
  - Renders per later keystroke went 47, then 37, then 29 (`after2-renders.txt`, dev and production).
  - These no longer render on a later keystroke: the header subtree, `PipelineDetailDialogs`, `PipelineDraftDialogs`, the
    `SpineSourceCard` subtree, `SpineOutputs` and every unedited `SpineStepRow`. Test 3.2 asserts each of them with its own
    counter, on a 3-step fixture with one Output.
  - What still renders is the state owner (`PipelineDetailPageContent` and the layout it feeds) and the components that show
    the edit or its result: the edited row, the step editor, the preview, `LiveOutputColumn`, the notices and the status strip.
  - That is the render narrowed to what the keystroke changes, which is what the AC and proposal.md asked for. The page root
    re-rendering is inherent to where the state lives. Moving that state is a colocation refactor the AC does not require.
- **Cycle 1 CR2 (artifacts): addressed.**
  - tasks.md 2.1 now says "No change made", cites the owner ruling `proceed-without-claim-2` and calls 3.1 a mutation-only
    guard.
  - proposal.md now records that the saved walk had no repeat to stop, and that observer-burst coalescing was not done because
    D4's condition (bursts) was not met.
- **Cycle 1 CR3 (mutation files): addressed.** Every `mutation-*.txt` now starts with an `EDIT:` line that names the exact edit.
- **AC2 re-run: still met.** `after2-probe-control.txt` has n=10 under host load. The D6 reading is the LoAF handler entry:
  - 6 of the 10 runs produced none, which means the handler frame was under 50 ms. All 5 before runs produced one (52-61 ms).
  - The 4 runs that did produce one read 40, 75, 54 and 42 ms.
  - Event Timing: median 41 ms after against 55 ms before. The ranges overlap because of 2 runs taken under load (76 and 55 ms).
  - The file states this plainly and limits the claim to the medians. That matches D6's overlap rule.
  - The cycle-1 n=5 comparison (54 to 44 ms, no overlap) still stands for its commit.
- Constraints C1-C5 are still honoured. The existing synchronous scroll-edge tests remain unedited.

### Phase 2: Code Review — FAIL

Gates, run by me at 4b9d37b5c (with `nice -n 19` and 3 jest workers):
- `npm run lint`: clean.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test`: root 71 suites / 621 tests passed; frontend 907 suites / 10,487 tests passed.
- `npm --prefix frontend run build`: exit 0.

The executor's mutations cover only one direction: removing a memo or comparator makes components render again. They do not
check the other direction, where a comparator wrongly reports "equal".

**The comparators are correct as written.** I checked each one against what its component reads:
- `SpineStepRow`: covers every one of its 15 props. `sameStep` covers every `Step` field the row reads (`summarizeStepConfig`
  reads `config`/`opType`; `renderKey` is not displayed). `sameMenu` covers every `ActionsMenuItem` field except `onClick`,
  and `onClick` is routed through the lane's wrappers.
- `samePageForDialogs`: its six ignored fields are not read by the host, except `steps`, which it compares while the sheet is
  open, and `draft`, where it compares `hasDraft`.
- `SpineOutputs`: its value comparison covers exactly what the view shows.
- The live-handler wrappers look up the lane's latest render by step id at event time. `useLatestCallback` updates in a layout
  effect, so a click never reaches a stale closure. `SpineLane.liveHandlers.test.tsx` covers this, and its mutation was shown red.

**I confirmed the current behaviour live** (MCP browser on 7241, a 3-step pipeline of limit 15, limit 10 and extractRegex, with
one Output):
- Editing step 1 updated both downstream rows: "10 → 5", then "10 → 7", including their accessible names.
- Selecting row 2 moved the selected class and switched the editor.
- "Move up" from a memoised row's menu moved the step. Repeating it after the reorder moved the correct step again, so the
  wrappers re-key by step correctly.
- The Move up/Move down disabled flags updated after each reorder.
- The leave guard (draft dialogs) opened on an in-app link. "Keep editing" kept the draft.
- The Output sheet opened on the draft's columns.
- "Save & run" saved and the counts settled to the run's.
- No console errors from the app; the only one is the existing schedule 404.

**But nothing guards the comparators against wrongly reporting "equal".** I ran mutations in a throwaway detached worktree at
4b9d37b5c (since removed) against the whole `features/pipelines` jest scope (232 suites, 3,289 tests):

| mutation | file | real user-visible effect | suite |
| --- | --- | --- | --- |
| drop `a.selected === b.selected` | `SpineStepRow.tsx:311` | the old row keeps its highlight after selecting another | **all green** |
| `sameDraft` ignores `status` and `count` | `SpineStepRow.tsx:275-284` | downstream rows keep a stale "10 → 5" count and status | **all green** |
| `sameMenu` always equal | `SpineStepRow.tsx:286` | Move up/Move down disabled flags go stale after a reorder | **all green** |
| drop the open-sheet `steps` check | `PipelineDetailDialogs.tsx:40` | an open Output sheet misses a step added by "add as tail" | **all green** |
| drop the `hasDraft` check | `PipelineDetailDialogs.tsx:39` | the sheet keeps the wrong draft/immediate mode | **all green** |
| `SpineOutputs` ignores subtitles | `SpineOutputs.tsx:159` | an Output's "from ..." line goes stale after a step relabel or move | **all green** |
| `sameStep` ignores `config` | `SpineStepRow.tsx:271` | the edited row's summary goes stale | red (test 3.2) |

Six of these seven silent, user-visible regressions pass the entire pipelines suite. Design.md lists "Memoisation hides a needed
update" as the main risk of this change, and the hand-written comparators are exactly where that risk now lives. Today the code
is right. But the next edit to any of these comparators, or a new row prop the comparator does not know about, can ship stale
UI with every gate green. That fails the "tests meaningful: would catch a real regression" check for the new code (see CR 1).

Other code notes, all non-blocking:
- The `wrappers` map in `SpineLane` is never pruned for deleted steps. It is bounded by the steps seen in a session. Harmless.
- `SpineOutputs`' `onClick={() => onOpenOutput(output)}` can pass the previous, JSON-equal `output` object when the section was
  skipped. That is harmless while consumers key by id.
- `PREVIEW_GRID_KEY` replaces the `{false}` slots, as suggested in cycle 1, and test 3.4 still guards it (mutation shown).

### Phase 3: UI Review — PASS

- I started the servers with start-servers.sh on 7241/10148 (lane DB `helio_hel1809`, empty `ANTHROPIC_API_KEY`), and the
  assert-phase check passed.
- e2e at 1x, 2 workers: `hel1683-regex-main-thread`, `hel1631-draft-mode`, `hel1685-draft-polish`,
  `hel1733-draft-outputs-shapes-{desktop,drafts,phone}`, `hel1734-draft-roots`: **60 passed** (3.6 min).
- Live flows are as listed under Phase 2. The draft preview results matched the saved/draft semantics throughout. The HEL-1798
  session-epoch suites are in the jest run above and pass.
- My test user was deleted by exact id (buildUserDeleteSql). The servers were stopped with stop-servers.sh and the ports are
  free. The throwaway worktree was removed.

### Overall: FAIL

### Change Requests

1. **Guard every memo comparator against wrongly reporting "equal".** Add jest tests that fail under each mutation in the table
   above (the six marked "all green"). Commit their red output with `EDIT:` lines, as in cycle 1. A suggested shape, extending
   `PipelineDetailPage.keystrokeRenders.test.tsx` or a sibling test using the same kit:
   - (a) **Downstream count.** Use a fixture where editing step 1 changes the counts of steps 2 and 3. Assert their rows' visible
     count and accessible name update, for example "… saved, N in draft". This should go red under the `sameDraft` mutation.
   - (b) **Selection.** Select another row and assert the previous row loses `spine-row--selected`. This should go red under
     the `selected` mutation.
   - (c) **Menu flags.** Reorder a row through its menu, "Move up". Assert the moved row and its neighbour show the right
     Move up/Move down `disabled` state. This should go red under the `sameMenu` mutation.
   - (d) **Output subtitle.** Relabel or reorder the step an Output reads from in a draft, and assert its "from …" line updates.
     This should go red under the `SpineOutputs` subtitle mutation.
   - (e) **Open Output sheet.** With the sheet open, change `steps` (for example through `onAddAsTailWithAggregate`, or by
     re-rendering with a new `steps` and an open `outputSheet`) and assert the sheet receives them. Also cover `hasDraft`
     flipping, so the sheet switches mode. These should go red under the two `samePageForDialogs` mutations.

   Each of these can sit in a small unit test of the memoised component (render it, then rerender with the one changed prop and
   assert the DOM) if driving the whole page is awkward. What matters is that every value a comparator compares has a test that
   goes red when that comparison is dropped.

### Non-blocking Suggestions

- `SpineStepRow`'s and `SpineOutputs`' comparators enumerate props by hand, so a prop added later is ignored silently. Consider
  a typed exhaustiveness guard, for example a `Record<keyof SpineStepRowProps, …>` of per-key comparers, so adding a prop fails
  `tsc` until someone decides how it compares. `samePageForDialogs` already defaults to identity for unknown keys, which is
  the safer shape.
- Prune `SpineLane`'s `wrappers` map to the lane's current step ids on each render.
