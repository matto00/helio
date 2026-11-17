## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD a6499da125f7984d9d0338f09a0ef62173865382 (worktree, planning artifacts untracked).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-detail-hooks/HEL-1704`.
- Line counts: `wc -l` -> `usePipelineDetailPage.ts` 562, `usePipelineDraftSave.ts` 433. Matches the ticket's re-measure.
- D2 line citations checked against the live file. 190-256 is fingerprint, laneGraph, rootSourceIds, useSourceSamples,
  watchdog, debounced analyze, clear-run-on-leave and lookups, all in one contiguous run. 288-342 is structure,
  mutations and root/toggle. 344-413 is the HEL-1631/HEL-1684 routing block. `useLatestCallback` carries a
  `useLayoutEffect`, so the routing block is effect-bearing. Moving it as a contiguous run respects D1.
- All 15 keys of the planned `usePipelineDetailStepActions` result are in today's page return list, so the D2 spread
  rule can apply there.
- D3 citations checked. 284-320 is the definition check, `definitionMatchesBase`, `replayOverlay` and the request.
  The four result kinds cover every early return in that range. The only effects are the mounted and dropped
  effects (124-136), and D3 keeps both in the main hook in the same order. `useSearchParams` stays after them.
- Existing jest nets exist: `usePipelineDetailPage.{identity,analyze,sourceSamples}.test.tsx` and
  `usePipelineDraftSave.dropped.test.tsx`. Its only importers are `usePipelineDetailPage.ts` and the test, so the
  re-export plan holds.
- CSS: `.step-preview` is `flex: 1; min-height: 0; overflow: hidden`. `.step-preview__header` is `flex-wrap: wrap`
  with schema chips (StepPreviewTable.css:3-29). The disclosure editor is `flex-shrink: 0; max-height: max(45%, 290px)`
  (PipelineSpineLayout.css:115-118). The comment at :64 is stale as the ticket says.
- Prior decision: archive `2026-10-22-draft-mode-polish/evidence.md:122-124` (HEL-1685 addendum G). The disclosure
  editor was deliberately made non-shrinking, so "the editor shows its first input row in full (no inner scroll)".
  It is guarded by `e2e/hel1685-draft-polish.spec.ts:207-244`, which checks `scrollHeight <= clientHeight + 1` and
  that the first condition row sits inside the editor, at 900x800 and 900x700 only.
- Size feasibility, measured by deleting every range D2/D3 moves out (prettier printWidth 100,
  `prettier.config.cjs`):
  - `sed -e '46,77d;79,90d;116,122d;138,197d;284,320d;411,419d' usePipelineDraftSave.ts | wc -l` -> 276. This
    already excludes the types block, runRefused/stepNamedBy, undo, adopt, the builder body and
    confirmUndoWithDraft. It does not yet count the builder call, the result switch, the adopt/undo hook calls and
    the re-export lines that D3 adds back.
  - `sed -e '37,40d;120,121d;135,140d;154,159d;190,256d;288,413d' usePipelineDetailPage.ts | wc -l` -> 351. This
    does not yet count the three new hook calls (the analyze hook alone needs about 20 arguments).

### Verdict: REFUTE

### Change Requests

1. **The planned split cannot meet its own size targets. Re-plan the seams with measured projections.**
   - `usePipelineDraftSave.ts`: everything D3 moves out still leaves 276 lines (measured above). Adding back the
     `buildDraftSaveRequest` call and the switch on its 4 kinds (about 20 lines), the adopt/undo calls (about 12)
     and the re-exports puts it near 300. Task 2.2 says "verify file sizes <= 250", and D2's 300 exception covers
     only the page composer.
   - `usePipelineDetailPage.ts`: the composer is 351 lines before the new calls are added back, so it ends near
     360-390. That is above D2's "hard ceiling 300", and neither D2 nor the tasks say what to do then.
   - Revise D2/D3 with a per-file projected line count. Name more seams so every file lands within budget.
     Candidates: `settleSaved` (lines 202-269, 68 lines) into its own hook or module; the catch-branch
     conflict/error-to-notice mapping (334-355) as a pure helper in `draftSaveRequest.ts`; the run/save block
     415-454 (`usePipelineRunAndSaveActions`, `outputsLoaded`, `usePipelineDraftSave`), which is contiguous, as one
     page hook; passing the `usePipelineEditorState` result as one object instead of a 30-line destructure.
     Check each candidate against D1.
   - If a file must stay above ~250, record the measured reason in **design.md**. AC1 requires that location; D2
     says "PR body". Reconcile tasks 2.2 and 3.3 with whatever ceiling you settle on.

2. **D4 overrides a shipped decision and pre-empts the owner question the ticket reserves.** The ticket says "If
   neither fits, ask the owner what gives way on windows <=700px tall."
   - HEL-1685 addendum G made the disclosure editor non-shrinking on purpose (see Evidence).
   - design.md's Context already says that at 900x600 the editor (290px) plus the Output section (200px) leave less
     than the preview header. So at 900x600, D4's `flex-shrink: 1` makes the filter editor scroll inside itself and
     can clip its first input row. Addendum G fixed exactly that, and only because hel1685's guard stops at 700px
     does nothing catch it.
   - The Planner Note "the editor already scrolls inside itself past its cap" holds only for editors taller than
     290px. It does not hold for the 267px filter editor addendum G protects.
   - D4's escape hatch, "a usable editor", is undefined.
   - Required:
     - (a) Define "usable" as addendum G's own criterion: the first condition row is fully inside the editor.
     - (b) Measure on main now, at 900x600 with the Output section open and the filter editor, whether the preview
       title and that criterion can both hold under D4. Record the numbers in design.md.
     - (c) If they cannot both hold, raise the ticket's owner question before execution. Do not self-approve it.
     - (d) Extend the new guard (D5) to assert the first-input-row criterion at the same sizes, so the trade is
       visible.
   - The spec delta's "the step editor SHALL give way by scrolling inside itself" should be written only after (b)
     or (c) settles the policy.

3. **The min-height target is ambiguous for a wrapping header.**
   - `.step-preview__header` wraps (`flex-wrap: wrap`) with an unbounded number of schema chips. "Size for the
     wrapped case" and the spec's "the preview's title and header SHALL remain fully visible" have no fixed answer
     for a wide schema.
   - Pin the guarantee to what AC4 asks for: the **title**, or the title row. Say how the min-height is derived
     from tokens: for example, the header's vertical padding plus the title's line-height at `--text-sm` plus the
     border.
   - Say what happens to chips that wrap past it: clipped by `overflow: hidden`, or something else.
   - Align the spec delta's wording with this choice.

### Non-blocking notes

- D3 lists only `mountedRef`, `setNotice` and `adoptDefinition` as inputs to the undo hook. It also needs `id`,
  `dispatch`, `draft` and `pushToast`, and it must return `savedToastRef` (or an equivalent) and
  `dismissSavedToast` for `settleSaved`. Spell these out.
- D1's phrase "the only calls it moves past each other are effect-free" can be read as forbidding the UiState move.
  That move takes `useState` calls past `useRunHistory` and `usePipelineRunStream`. Say plainly that moving
  effect-free calls past effect-bearing ones is allowed, since only the relative order of effect-bearing calls
  matters.
- D5: at 900x700 the title may already be visible on main (the ticket says the preview "shows only its header").
  The red-first requirement should name which cases are expected red (at least 900x600), so the guard is not
  rewritten to force a red at 700.
- D5's "the editor is scrollable" assertion only holds for a tall editor. Keep hel1685's addendum G test in the
  before/after nets (task 1.1 already does).
