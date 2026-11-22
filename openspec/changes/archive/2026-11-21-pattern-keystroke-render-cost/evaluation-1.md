## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `a112db4406473d1a7301e1bdbb4c6d8ec16d50e3` against the live merge-base `1f8e762b5b0055a2c1c76eddd47771eeca8823db`
(resolve-review-base.sh, main/origin).

### Phase 1: Spec Review — FAIL

AC-by-AC:

- **AC1 (a) "a Pattern keystroke no longer re-renders the whole page": NOT MET.** What it requires, read with the ticket
  (item 1: "React re-renders the pipeline page on each keystroke") and with proposal.md's own commitment ("Narrow the re-render
  to what the keystroke actually changes"), is that a keystroke's render is confined to the part of the page the edit affects.
  What the after profile shows (`after-renders-dev.txt`, case B): the render root is still `PipelineDetailPageContent`, the page
  root, on every keystroke, and every section of the page except the header still renders: 37 of the previous 47 renders, 27
  distinct components. That includes components whose inputs a Pattern keystroke does not change: `PipelineDetailDialogs` and
  `PipelineDraftDialogs` (both closed), `SpineSourceCard` and its subtree (`SourceSampleLabelView`, `IconButton`,
  `RefreshCw`, `ActionsMenu`), and `SpineOutputs`. The fixture has one step. On a real pipeline every `SpineStepRow` in
  `PipelineSpine` also re-renders, so the remaining breadth grows with pipeline size, and none of this diff narrows it.
  The header memo is a real, measured reduction: 10 renders, and AC2's 54 to 44 ms is partly from it. But "the header no longer
  re-renders" is not "the page no longer re-renders". The executor states this itself ("PARTLY met", "spinoff candidate").
  Dropping the rest of the AC's main item to a spinoff is a scope decision no agent can make. It needs either the fix or an
  owner ruling. The ruling recorded for this run (`escalation.answered` proceed-without-claim-2) covers claim 2 only.
- **AC1 (b) "does no repeated walk": MET by evidence**, under the owner's ruling (`.concertino/runs/HEL-1809/events.jsonl`
  line 18, `answer_source: human`, proceed-without-claim-2). Production-build counts in `before-walks.txt` and
  `after-walks.txt` are exact: case A has 1 saved walk (null to defs when `walkBase` turns on), case B has 0, and with an Output
  every keystroke has 0. The StrictMode x2 factor is stated (C4). No load-time precompute was added (D2 honoured).
- **AC1 (c) "useScrollEdges cost lower on a 1,000-row frame": MET.** `before-scroll-edges.txt` puts the 15.6-17.9 ms
  (prod 4x) / 17.2 ms (dev) cost in the mount layout-effect `measure` of a remounted `DataGrid` on the first edit. After the fix
  the grid is kept (`gridSurvived=True`), the forced layout is 0.00 ms and no state update happens. This is measured on the
  keystroke-driven path, as D4 requires. Fixture: 1,000 x 6, the same before and after.
- **AC2: MET, with a stated method deviation.** D6 names "the HEL-1683 spec" as the instrument. That spec's own control window
  logged no frame of 30 ms or more in 5/5 before runs (`profile-harness/raw-before-hel1683-spec-n5.txt`): the handler fell under
  the 50 ms LoAF reporting threshold, so the literal D6 reading has no before number. The substitute harness
  (`profile-harness/hel1809-profile.spec.ts.txt`) uses the same seed (`(x)` saved, 2 rows), the same fill (`(a+)!`), the same
  4x CDP throttle, 1 worker and n=5. It reads the same quantity, the LoAF script duration of the `DIV#root.oninput` entry, with
  Event Timing `input` processing as a cross-check. One difference: the harness waits 1 s after load before it throttles. This
  explains why its absolute numbers are higher than the spec's, but it applies equally before and after, so the comparison holds.
  Before: 61, 55, 54, 52, 54 (median 54, range 52-61). After: 44, 45, 44, 44, 42 (median 44, range 42-45). The ranges do not
  overlap. This meets D6's rule (after-median below before-median, every run reported). The one after run of the spec itself that
  logged a 52 ms task (46 ms `oninput` script) is reported, not hidden. I accept this deviation as disclosed and reasoned. It is
  not grounds to fail.
- **AC3 (parity corpus + e2e): MET.** I re-ran them myself (Phase 2/3).

Other checklist items:

- The render-profile correction is sound. The withdrawn first profile scanned `PerformedWork` flags over the whole fiber tree.
  React resets a fiber's flags only when it re-processes that fiber (`createWorkInProgress`), so a bailed-out subtree keeps flags
  from earlier commits. Restricting the scan to subtrees whose children were rebuilt (`f.child !== f.alternate.child`) is the
  right correction. It is corroborated independently by the render-body counters (AppShell/AppRail at 0) and by jest test 3.2.
- Task 2.1 is ticked `[x]` "Stabilise the identity churn that re-runs the saved walk ... verify 3.1 green", but the code has no
  such change: there was no churn (claim 2). The checkbox does not match what was implemented (see CR 2).
- proposal.md still promises "no repeated layout measurement per burst of observer callbacks". This was not implemented, and
  correctly so: D4 made coalescing conditional on bursts, and `before-scroll-edges.txt` shows one `ro` measure per keystroke, so
  there were none. The artifact does not reflect the final behaviour (see CR 2).
- Scope: no scope creep. The diff touches only the four source files and four new tests listed in `files-modified.md`.
- CONSTRAINTS C1-C5: C1 holds (before evidence in d1931fe52/0ee89745d/fdc9601b3, ahead of source commit 3b82936d9). C2 holds
  (memo, bail-out and no-remount each remove work; no transition/deferral). C3 holds (counts only, no wall-clock; red or mutation
  evidence present). C4 holds (prod-exact walk counts, factor stated). C5 holds (`useScrollEdges.test.tsx`, `DataGrid.test.tsx`
  and `PanelDetailModal.editScrollFade.test.tsx` untouched in the diff, and the layout read stays synchronous inside `measure`).

### Phase 2: Code Review — PASS

Gates, run by me in WORKTREE_PATH at a112db440 (with `nice -n 19` and 3 jest workers):
- `npm run lint`: clean (0 warnings).
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test`: root 71 suites / 621 tests passed; frontend 906 suites / 10,486 tests passed; exit 0.
- `npm --prefix frontend run build`: exit 0.

Red-first and mutations: I re-ran these myself in a throwaway detached worktree at a112db440, which I have since removed. The
committed `mutation-*.txt` files are excerpts that do not say what was mutated, so I reproduced them:
- Clean: all 6 tests in the 4 new files pass.
- M1, base `useScrollEdges.ts`: test 3.3 red.
- M2, base `StepPreviewTable.tsx`: test 3.4 red.
- M3, base `PipelineSpineHeader.tsx` (unmemoised): test 3.2 red.
- M4, base `PipelineSpineLayout.tsx` with the memo kept (inline closures back): test 3.2 red. The test catches both halves of the
  header fix.
- M5, `draftSteps` added to the `baseWalk` deps: test 3.1 red.
- M6, `draftSteps` added to the `baseDefs` deps: test 3.1 red.
- M7, `baseSteps` dropped from the `baseDefs` deps: test 3.1's "saved change still re-walks" case red.
Test 3.1 is a guard by design: green on the base tree, failable only by mutation. That matches the ruling that claim 2 was absent.

Code:
- `useScrollEdges.ts`: the `last` ref mirrors `edges` (both start at `NO_EDGES`, and they are updated together). The layout read
  stays synchronous, and the bail-out is correct and minimal.
- `PipelineSpineLayout.tsx`: `useLatestCallback` handlers are called only from events, never during render, so they are safe. The
  `headerRun`/`headerDraft` memo deps are complete. Live check: after the first edit the header showed Discard / Save & run, and
  "Save & run" persisted `(a+)` and updated the header's run status.
- `StepPreviewTable.tsx:278-295`: the saved grid sits at fragment slot 3 behind three `{false}` placeholders to line up with the
  draft branch. It works, and it is commented on both sides, but it is positional and fragile. See Suggestions.
- No `any`, no dead code, no TODOs. Files stay under the 400-line threshold (357/336/265). No DESIGN.md token or CSS changes.

### Phase 3: UI Review — PASS

I started the servers with start-servers.sh on 7241/10148 (lane DB `helio_hel1809`, empty `ANTHROPIC_API_KEY`), and the
assert-phase servers check passed.
- e2e at 1x, 2 workers: `hel1683-regex-main-thread`, `hel1631-draft-mode`, `hel1685-draft-polish`,
  `hel1733-draft-outputs-shapes-{desktop,drafts,phone}`, `hel1734-draft-roots`: **60 passed** (4.1 min). Throwaway users cleaned up.
- Live check (MCP browser on 7241, 500 x 3 static source, extractRegex `(x)`):
  - First edit to `(a+)`: the `<table>` DOM node is identical before and after; the `out` column changed from `—` to `aaaa`; the
    count stayed "500 rows"; the draft chrome appeared.
  - Later keystroke `(b+)`: same node, scroll position kept (200 to 200), rows correct.
  - Discard: the saved rows (`—`) came back.
  - Save & run: persisted, and the header updated.
- Breakpoints: 1440 / 1100 render without horizontal overflow. 768 shows the phone layout correctly. The phone draft flows are
  covered by the passing hel1733/hel1734 phone specs.
- Console: the only error from the app is the pre-existing `GET /schedule` 404 for a pipeline with no schedule. One more error
  was my own rejected setup request (an oversized row payload).
- Observed behaviour delta, which design D4 intends: the preview's scroll position now survives the first edit (it used to reset
  on remount) and Discard.
- My test user was deleted by exact id (buildUserDeleteSql), and the servers were stopped with stop-servers.sh (ports free).

### Overall: FAIL

### Change Requests

1. **AC1 (a), narrow the keystroke re-render beyond the header, or get an owner ruling that accepts the partial.** As shipped,
   every keystroke re-renders from `PipelineDetailPageContent` down through every page section except the header (37 renders).
   Concretely, on a later keystroke (case B) make these bail out:
   - `PipelineDetailDialogs` (`ui/PipelineDetailDialogs.tsx:21`, takes the whole `page`) and `PipelineDraftDialogs`, both of which
     render closed dialogs.
   - `SpineSourceCard` and its subtree.
   - `SpineOutputs`.
   - Every `SpineStepRow` whose step, draft count and selection did not change. `PipelineSpine` is fed inline closures at
     `spine/PipelineSpineLayout.tsx` (`rowCountFor`, `onRemoveRoot`) and `presentation.*` getters. Stabilise those, or memo the
     row level, so a 1-step edit does not re-render N rows.

   Then:
   - Update `profile-findings.md`'s expected re-render set and its before/after table (renders per case B commit).
   - Extend test 3.2 (`PipelineDetailPage.keystrokeRenders.test.tsx`) with counters for the dialog hosts and the source
     card/outputs, and use a fixture with at least 2 steps so an unedited `SpineStepRow` is counted.
   - Show it red by mutation, as was done for the header.

   If the executor or orchestrator judges this outside the ticket, that is a scope change to AC1's primary item. It must go to the
   owner as an ESCALATION, with options such as "narrow further" and "accept header-only + file spinoff". The evaluator cannot
   accept it on the strength of the written reason.
2. **Make the planning artifacts match what shipped.**
   - In `tasks.md`, change 2.1 to say no change was made (no identity churn found; claim 2 met by evidence under the owner ruling
     proceed-without-claim-2; 3.1 is a mutation-red guard) instead of a plain `[x]` "Stabilise the identity churn".
   - In `proposal.md` "What Changes", drop or qualify "Stop re-walking the saved pipeline when only the draft changed" (nothing to
     stop) and "no repeated layout measurement per burst of observer callbacks" (not done; the profile showed no bursts, per D4).
3. **Make the mutation evidence self-describing.** For each `mutation-*.txt`, add one line naming the exact edit, for example
   "reverted `measure` to the unconditional `setEdges({...})`" or "added `draftSteps` to the `baseWalk` deps". As committed, a
   reader cannot tell what `saved-walk-churn` mutated. I reproduced all four, but the artifact should stand on its own.

### Non-blocking Suggestions

- `StepPreviewTable.tsx:278-295`: instead of three positional `{false}` placeholders, give both `DataGrid` elements the same
  explicit `key` (for example `key="preview-grid"`) inside their fragments. Keyed children reconcile by key, so neither branch's
  slot order has to be kept in step by a comment, and a future fifth conditional child in the draft branch cannot silently bring
  the remount back. Test 3.4 already guards it either way.
- `before-probe-control.txt` could say in one line why the harness's absolute numbers (54 ms) sit above the spec's sub-50 ms
  handler (the 1 s pre-throttle settle), so nobody later reads 54 as the spec's own number.
