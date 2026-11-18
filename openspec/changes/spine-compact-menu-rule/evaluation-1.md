## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c3a25b4a9ca64b9dc5ed3c49e8ba83464ea5b084` against live-resolved base `361c22f223ee27409b045860aab6ab889bbbb687` (resolve-review-base.sh).
Diff: `frontend/src/features/pipelines/ui/spine/PipelineSpine.css`, `e2e/hel1608-spine-count-overlap.spec.ts`, and the OpenSpec change dir.

### Phase 1: Spec Review — PASS
- Item 1 (menu rule): one rule at every desktop width. Cards and the selected row always show their ⋮, and unselected rows show it on hover or focus. In compact mode the selected row's ⋮ sits on line 2 in its own trailing track (D2). Hidden menus are `pointer-events: none`. Pointer input is re-enabled only for the selected row, for `.spine-row__menu:focus-within`, and for row hover inside `@media (hover: hover)` (D1). In regular rows the select's hit box extends under the menu slot (D1 CR).
- Item 2 (marker gap): in compact rows the markers track is dropped when the slot is empty (`:has(> .spine-row__markers:empty)`). One-line desktop rows use `display: none`, scoped `:not(.spine-row--phone)` (D3).
- Item 3 (test gap): the compact-is-on guard is derived from the spine's content box. The ticket's list-default widths are also asserted literally.
- Item 4 (1100px truncation): decided in design D4 and measured in the executor evidence. "Compute column" shows 99/110 on the hel1579 fixture. It keeps a marker, so it gains nothing; unmarked rows go from 113 to 125. My own fixture at 1100 shows 76/113 for a marked Compute row, which is above the ~60px floor.
- Item 5: the spec delta's 800px / ≤600px page-content-width wording matches `PipelineSpineHeader.css:345` (`@container (max-width: 800px)`) and `:379/:389` (600px). The container is the page's `container-type: inline-size` (`PipelineSpineLayout.css`).
- Tasks are all ticked and match the code. No scope creep. Phone rows render no menu (`SpineStepRow.tsx:252`), so the base `.spine-row__menu` changes cannot reach them. No API or schema impact. `openspec validate spine-compact-menu-rule --type change` passes.
- CONSTRAINTS C1–C10 are honoured in the diff. C9: no popover-fit or dialog-registry file is touched.

### Phase 2: Code Review — PASS
I ran these gates myself in WORKTREE_PATH:
- `npm run lint`: clean, zero warnings.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test`: root suite 66/66 suites, 579 tests; frontend suite 821/821 suites, 9927 tests. Exit 0.
- `npm --prefix frontend run build`: exit 0.
- Spine jest tests plus `pipelineHoverGating.css.test.ts`, run on their own: 8/8 suites, 60 tests.
- Full `e2e/hel1608-spine-count-overlap.spec.ts` and `e2e/hel1579-pipeline-spine-layout.spec.ts` against lane DB `helio_hel1671`, 2 workers: **19/19 passed** (`.concertino/scratch/HEL-1671/eval-green-run.txt`).

I verified the reds myself rather than relying on the executor's transcripts. I did not modify the delivery worktree. Instead, a harness copy of the new spec ran in a throwaway detached worktree, which has since been removed. Its `addInitScript` replaced the Vite style element for `PipelineSpine.css` with a chosen stylesheet, against the running 7103 app.
- **Main's CSS** (base `361c22f22`): 3 failed and 2 passed. Failures:
  - selected compact menu opacity 0, not hit-testable, covers the count;
  - summary-to-count gap 16px vs 8px;
  - empty markers slot not `display: none` at 1100;
  - touch tap does not select the row, opens a menu, and the second tap fails, at both 1100 and 900px.
  
  (`eval-red-main-css.txt`)
- **HEAD's CSS** through the same harness (control): 5/5 passed. This shows the harness itself is sound (`eval-control-head-css.txt`).
- **Mutant: threshold 226→100**: the compact guard fails ("769px list=default (content box 147px): select display").
- **Mutant: hit-box extension removed**: the touch test fails at 1100 ("the tap selects the row", "the second tap opens the menu"). (`eval-mutations.txt`)

Code-quality notes:
- All CSS values are tokens (`--control-sm`, `--space-2`, `--app-bg`, `transparent`).
- The new `:hover` selectors are either inside `@media (hover: hover)` (base `pointer-events` restore) or inside the already-allowlisted compact block. The guard is unchanged and green.
- Old comments were updated (task 2.5). No TODO/FIXME.
- The hit-box extension is the complement container query `(width > 226px)`. At every width I measured, the row's right edge equals the select's right edge (`edge=0`), and the hidden trigger's centre hit-tests to the select.

### Phase 3: UI Review — PASS
I used the running app (7103/10010, lane DB) with my own seeded pipeline: 4 step rows including a lane and a Compute row with a marker, plus a Source card and an Output card. A step was selected and the pointer parked off the spine. Each configuration was measured in both light and dark.

| Width | List | Spine content box | Compact |
|---|---|---|---|
| 769 | default | 147px | on |
| 900 | default | 207px | on |
| 1024 | default | 212px | on |
| 1100 | default | 238px | off |
| 769 | max | 147px | on |
| 900 | max | 147px | on |
| 1100 | max | 207px | on |
| 1440 | max | 243px | off |

Results across all of these:
- Card menus have opacity 1.
- The selected trigger has opacity 1, its centre hit-tests to the menu, it does not overlap the count or summary, and 0 of 9 title samples are covered.
- Unselected triggers have opacity 0 and their centre hit-tests to the select.
- Unmarked compact rows have an 8px summary-to-count gap, equal to `column-gap`.
- Titles at compact widths are 79–164px wide with no truncation except "Compute col…" at 99/113. At 1100 default, "Compute col…" is 76/113.

Other checks:
- **Hover:** on a fine pointer at 900 / list max, hovering reveals the overlay ⋮ on the row's tone. Click-to-open on hover, keyboard focus reveal and the touch-tap path are covered by the green e2e run.
- **Console:** the only error is a 404 for `GET /api/pipelines/:id/schedule`. That is expected, since the pipeline has no schedule, and it is not from this diff.
- **Accessibility:** names, roles and tab order are unchanged (CSS-only change).
- **Screenshots:** `.concertino/scratch/HEL-1671/eval-shots/`.

Judgment-level visual cohesion (for example, the selected compact ⋮ box sitting at the row's bottom edge) is left to the skeptic.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `e2e/hel1608-spine-count-overlap.spec.ts`: the `markersDisplay` field returned from the `geo` evaluate (around the "spine row menu: one rule" test) is never asserted. Drop it; the separate empty-markers test already covers that.
- Same file: `hitInMenu` can be written as `hit?.closest(".spine-row__menu") != null` instead of the `!== null && !== undefined` pair.
- The executor's evidence labels its "default" screenshots as "list min via Home". If that is literal, the before/after set covers list minimum and maximum, not list default. My own comparison above covers list default and max, so this is a labelling note for the PR body, not a gap.
