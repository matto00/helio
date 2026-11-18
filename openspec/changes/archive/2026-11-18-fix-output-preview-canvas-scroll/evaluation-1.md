## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 097d85e69d2dfb6d7574da22a62e76b174909b9d against live base 3b8a34d57b42cc5b64b4a51b3d9f7f43fa74492d.
The code diff is one CSS rule (`position: relative` on `.output-editor-sheet__group`) plus one new e2e spec.

### Phase 1: Spec Review — PASS
- AC1 (375 and 390x844, light and dark, scrollHeight matches content, red then green): met. My own mutation
  run with only `position: relative;` removed (diff persisted as eval-mutation.diff) gave 5/5 red: the dialog
  scrollHeight was 1490 against a content bottom of 729.8 at 375 and 758.6 at 390, and 1211 against 719 on
  desktop. With HEAD restored, 5/5 were green.
- AC2 (desktop preview still renders and is clipped): met. The e2e desktop case passed. My own probe at 1440
  showed the canvas inside its wrapper rect, a 644x100 canvas, the dialog scrollHeight equal to clientHeight,
  and no horizontal overflow.
- AC3 (full hel1752 spec passes): met. All of hel1752 passed in my run.
- The ticket's cause was not silently reinterpreted. The executor refuted it with evidence, and I confirmed
  the refutation myself (see Phase 3). The fix layer differs from the ticket's guess, which design.md
  Decision 1 explicitly allowed for.
- All tasks are marked done and match the work. There is no scope creep. Constraints C1-C9 were honoured; the
  e2e follows C9 (content bottom from in-flow content, assertions on both the dialog and `.ui-modal__body`,
  desktop canvas rect compared with the wrapper rect).

### Phase 2: Code Review — PASS
I ran the gates fresh in WORKTREE_PATH with nice -n 19 and 3 jest workers:
- lint 0, format:check 0, typecheck 0
- jest: 66/66 suites and 579 tests at root; 820/820 suites and 9915 tests in frontend
- `npm --prefix frontend run build` 0. I re-ran the build after restoring HEAD because the first run may have
  overlapped the mutation window. Both runs exited 0.

CSS review:
- The fix uses no tokens and has no magic values. It carries a comment that explains why.
- A non-z-indexed `position: relative` creates no stacking context.
- `.popover__panel` and `.ui-select__panel` are `position: fixed` and portaled, so they are unaffected. The
  group sets no transform, filter or contain.
- The tap-expander pseudos (`.tap-expand-44::after`, z-index 1) already resolve to their own positioned host.

E2E review: the measurement is in-flow (inner column, and the body's last child plus its padding), not a max
over every descendant. It waits for a sized canvas before measuring.

### Phase 3: UI Review — PASS
Servers ran on lane DB helio_hel1763 through start-servers.sh, and assert-phase reported PASS.

Root-cause probe, re-done independently at 375x812 with the chart Output open and Ask expanded. I enumerated
every absolutely or fixed positioned element and pseudo-element inside all 6 groups. For each I compared its
containing block and rect with the fix and with the groups forced to `position: static`:
- The only elements whose containing block changes are 4 visually-hidden 1x1 elements:
  - `input.ui-toggle__input` (History card)
  - `span.sr-only` (upsell)
  - `span.sr-only` and `p.sr-only` (Ask details)
- Each of those moved from `dialog.ui-modal` to its group, with an identical rect, because they use
  static-position offsets.
- Every visible absolute element keeps its own positioned host and is unchanged. That covers the
  mode-toggle and mark-add `::after` pseudos, the Ask `summary.tap-expand-44::after`, and the canvas.
- The canvas's containing block is ECharts' own `position: relative` div whether or not the fix is applied,
  which confirms the ticket's canvas hypothesis is refuted.
- Dialog scrollHeight was 729 with the fix and 1951 without it (Ask open), against a clientHeight of 729.

So the fix has no side effect on popovers, menus, tooltips, the HEL-1752 footer (outside the groups) or the
HEL-1746 ask panel.

Full affected spec files, run on the lane DB with 2 workers: 44 passed, 0 failed, 0 flaky (eval-green-run.txt).
- hel1763-output-editor-preview-scroll
- hel1752-output-editor-footer-fit
- hel1573-motion-grid-chart (including :104)
- hel1746-ask-ui (ask panel inside a group)
- hel1510-output-editor-table-overflow
- hel1331-history-payloads-toggle (Toggle sr-only input inside a group)
- hel1350-chart-compare-picker (popover from inside a group)
- hel1306-chart-reference-lines (mark-add buttons)

HEL-1760 (chart preload) has no CSS or code overlap with this change, and the chart renders in every case.

Breakpoints:

| Viewport | Dialog scrollHeight / clientHeight | Horizontal overflow |
|---|---|---|
| 375 | 729 / 729 | none |
| 768 | 808 / 808 | 0 |
| 1440 | 808 / 808 | 0 |

The only console error was the pre-existing `GET /pipelines/:id/schedule` 404, which is expected when no
schedule exists and is unrelated to this change.

Evidence (persisted). The screenshot was captured in the dark theme despite its filename; it shows the dialog
ending at Placements and the footer, with no blank tail.
- `/home/matt/Development/helio/.concertino/runs/HEL-1763/evidence/.concertino/scratch/HEL-1763/eval-phone375-light-bottom.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1763/evidence/.concertino/scratch/HEL-1763/eval-red-run.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1763/evidence/.concertino/scratch/HEL-1763/eval-green-run.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1763/evidence/.concertino/scratch/HEL-1763/eval-mutation.diff`

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- design.md still describes only the canvas hypothesis and a fix layer of `.output-preview-pane__chart` or the
  shared chart CSS. A short "Resolution" note would record the actual root cause and the group-level fix.
  Today it lives only in uncommitted scratch (probe.md) and in the CSS comment.
- `specs/pipeline-output-sheet/spec.md` says "No preview element (including the chart's drawing surface)". The
  real escapees were sr-only elements in the History and Ask groups, not preview elements. Consider "No
  element inside the editor body".
- The `.ui-modal__body` assertion in the e2e is a guard, not a discriminator: it was green in the red run
  (1957 vs 1957). That is fine under C9, but a comment would make the label honest.
- Spinoff candidates, both pre-existing and out of scope:
  1. Shared `Modal.css` latent bug: any scrolling `.ui-modal__body` with an unpositioned sr-only descendant
     can stretch its fixed dialog. Probe.md also notes this.
  2. The editor chart preview draws a 100px chart inside a 240px wrapper. `.panel-content` computes to 100px,
     independent of this fix. That leaves ~140px of empty card at every width.
