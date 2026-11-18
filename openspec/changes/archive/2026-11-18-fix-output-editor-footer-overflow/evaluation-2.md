## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: a2af4a52fefbc05b796c0f2109026a731dbbff6a (diff base 506c22442, resolved live; cycle delta 46d3ae07a..a2af4a52f).
Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1752/evidence/.concertino/scratch/HEL-1752/eval2/`
(`e2e-full.txt`, `m1-no-wrap-no-heightauto.txt`, `m2-footer-stretch.txt`).

### Phase 1: Spec Review — PASS

All three cycle-1 change requests are resolved.
- **CR1 (CSS comment).** `OutputEditorSheet.css:97-100` drops the false 21px arithmetic and keeps only the why:
  min-height holds a one-line label, and a two-line label grows the box.
- **CR2 (spec comment and scrollHeight check).** `measure()` now reads `getComputedStyle(b, "::after").height`, and
  `expectContained` asserts `scrollH <= clientH + max(0, (expanderH - rect.height) / 2) + 1`. That restores the C15
  scrollHeight/clientHeight measure, computed rather than hard-coded. The "every button" claim is gone.
- **CR3 (design.md).** Decision 2 now has the measured arithmetic (`line-height: normal`, about 18px per line, 28px
  held to 32, confirm 46px). Decision 6 now describes the scrollHeight check with expander slack.
- The cycle also adds two checks I suggested in cycle 1: a `labelRects > 0` assertion and a desktop footer right-edge
  check.

AC1-AC4 are unchanged from cycle 1, which verified them on the running app. The CSS rules themselves are identical;
only the comment changed. The non-retired constraints C1-C16 are honoured.

### Phase 2: Code Review — PASS

Gates I ran myself in WORKTREE_PATH:
- lint: pass.
- format:check: pass.
- typecheck: pass.
- Root jest (66 suites / 579 tests): pass.
- Frontend build: pass.
- Frontend jest was not re-run. Its full pass in cycle 1 was on identical CSS rules, and this cycle changes only a
  CSS comment and e2e/openspec files.

Full affected e2e files (C12): all six, against the lane DB `helio_hel1752` with freshly restarted servers and 2
workers. **45 passed (4.3m).** The six files are hel1752, hel1733-draft-outputs-shapes,
hel1510-output-editor-table-overflow, hel908-full-flow, hel1390-chart-tail-aggregate-live and hel1744-insight-panel.

Mutations I re-ran myself (CSS restored after each; `git status` is clean):
- **M1: remove `flex-wrap` and `height: auto`.** Result: 4 failed, 2 passed.
  - It failed with `"Confirm delete (removes from 1 dashboard)" scrollHeight 60 vs clientHeight 30 (+ expander 6)` in
    both themes, and with `Add as tail with aggregate must fit one line`.
  - The new scrollHeight assertion is live and can fail. This matches the executor's `mutations-cycle2.txt`.
- **M2: `flex: 1` on the sheet footer.** Result: survived (6 passed).
  - The sed matched all four `flex-wrap: wrap;` lines in the file, so it was not a single-rule mutation.
  - I confirmed the effect on the running app at 1280 with a runtime style injection of only
    `.output-editor-sheet__footer{flex:1}`. The confirm moved from left 493 to 301, to the dialog's far left;
    Cancel and Save did not move.
  - The spec is not violated by this: its scenario compares positions *relative to the footer*, and that relation
    still holds when the footer itself stretches. It is a weak guard, so it is a non-blocking suggestion, not a
    change request.
  - My cycle-1 suggestion said the right-edge check would catch a footer that stopped shrink-wrapping. That was wrong:
    with `margin-right: auto` on Delete, both edge checks still pass.

### Phase 3: UI Review — PASS

The CSS rules are unchanged since cycle 1, whose running-app review (375px light and dark, confirm and add-tail;
1280 and 768) still applies. The full e2e set re-ran green on the running app this cycle. The blank-body-on-scroll
finding from cycle 1 still stands: it was there before this change (ECharts canvas escaping the body clip), not a
regression.

### Overall: PASS

### Non-blocking Suggestions
- **Desktop arrangement guard (`expectDesktopArrangement`).** Encode the gaps between buttons as well: each button's
  `left` should equal the previous button's `right` plus the footer's computed `column-gap`. That catches M2, where
  the footer stretches and Delete moves to the far left. The current edge checks do not.
- **Zero real tolerance in the scrollHeight check.** The `+ 1` slack is exactly consumed by the bottom border:
  scrollHeight is measured from the padding box, so Cancel/Save measure 37 against a limit of 30 + 6 + 1 = 37. Add
  `borderBottomWidth` explicitly and keep a separate epsilon.
- **Follow-up, carried from cycle 1.** The chart-preview canvas gives the Output editor dialog a blank scroll tail on
  phones. This was already there before this change.
- **Rebase.** Re-run hel1752 after the Delivery rebase onto HEL-1757's fonts.
