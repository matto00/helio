## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 46d3ae07a7392f4482da9eef24be21a115e3927b (diff base 506c22442, resolved live).
Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1752/evidence/.concertino/scratch/HEL-1752/eval/`
(`e2e-full.txt`, `mutation-no-height-auto.txt`, `fixed-dark-confirm-375.png`, `fixed-light-confirm-375.png`,
`fixed-dark-add-tail-375.png`, `prefix-reverted-dark-confirm-375-dialog-scrolled.png`).

### Phase 1: Spec Review — FAIL

- AC1 (confirm label fits at 375px, light and dark): met. On the running app the confirm wraps onto its own line, two
  lines, 46px tall, text 5px inside the top and bottom edges, scrollWidth == clientWidth (293/293). Screenshots in both
  themes.
- AC2 (Add as tail fits without being squeezed): met. One line, 32px, in both themes. Dark: [Cancel][Add as tail] on
  line 1, Save on line 2. The executor's light run: Cancel on line 1, [Add as tail][Save] on line 2. Both arrangements
  are on design.md's acceptable list.
- AC3 (full label with count): met. The spec asserts the exact text "Confirm delete (removes from 1 dashboard)".
- AC4 (desktop unchanged): met. At 1280 there is one row of 32px single-line buttons, right-aligned. The add-tail
  footer measured left=606, right=979. The baseline was 604/979; the 2px shift comes from sub-pixel button widths
  (Add-tail 203 vs 204), not from a layout change. The 768px viewport also shows one row.
- Tasks: all marked done and match the diff. No scope creep: the CSS is scoped under `.output-editor-sheet__footer`,
  global `.ui-modal-btn` is untouched (C16).
- **Issue (planning artifacts do not match the final behavior):**
  - design.md Decision 6, and C15, both name a `scrollHeight <= clientHeight` assertion. The spec dropped it
    (`e2e/hel1752-output-editor-footer-fit.spec.ts:197-198`) and design.md was not updated.
  - design.md Decision 2's arithmetic is wrong for the running app. It assumes a 21px line (line-height 1.5) and a
    52px two-line button. Measured: buttons compute `line-height: normal`, about 18px per line, so the confirm is
    46px and a single line is 18+8+2=28px, held to 32 by `min-height`. The conclusion (single-line stays
    `--control-md`) still holds; the stated numbers do not.

**Executor claim 1 checked (scrollHeight dropped because of the ::after expander):** partly true, and "every button"
is overstated. On the running app at 375px:
- Cancel and Save (32px tall): scrollHeight 37 vs clientHeight 30. The 44px centred `::after` hit expander
  (`Modal.css:279-287`) overflows 7px below, so a plain `scrollHeight <= clientHeight` check fails on every button
  shorter than 44px.
- The two-line confirm (46px): scrollHeight 44 == clientHeight 44, so it is not inflated.

The Range-rect check does guard vertical overflow in both directions. `labelOutside` takes the max of
`r.top - x.top` and `x.bottom - r.bottom` as well as both horizontal edges. My own mutation re-run (removing
`height: auto`) failed with `"Confirm delete (removes from 1 dashboard)" label rect outside its button by 2` in both
themes, matching the executor's `mutations.txt` (2 failed, 4 passed). The mutation log is real. The CSS was restored
and `git status` is clean.

### Phase 2: Code Review — FAIL

Gates I ran myself in WORKTREE_PATH:
- `npm run lint`: pass.
- `npm run format:check`: pass.
- typecheck: pass.
- `npm test`: pass (root 66 suites / 579 tests; frontend 812 suites / 9848 tests).
- `npm --prefix frontend run build`: pass.
- Full affected e2e files (hel1752, hel1733-draft-outputs-shapes, hel1510-output-editor-table-overflow,
  hel908-full-flow, hel1390-chart-tail-aggregate-live, hel1744-insight-panel): 45 passed (7.4m). Run against the
  lane DB `helio_hel1752`, 2 workers.

Code is minimal and correct:
- Tokens only (`--control-md`, `--space-1`).
- Scoped selector.
- The DESIGN.md §3/§5 "No other control heights" exception is deliberate, documented in design.md Decision 4, and
  passed the design gate.

Issues:
- `OutputEditorSheet.css:99-100`: the comment states "21px line + 2 x 4px padding + 2px border = 31px". This is false
  for the running app: the button's line-height is `normal` (about 18px), so a single line is 28px. CONTRIBUTING.md
  "Comments" says to prefer *why* over a restated *what* that "silently stops being true"; this one is already untrue,
  and it is font-dependent (HEL-1757 is changing the e2e fonts).
- `e2e/hel1752-output-editor-footer-fit.spec.ts:197-198`: the comment says the expander inflates scrollHeight "for
  every button". Measured: only for buttons shorter than the 44px expander (see Phase 1).

### Phase 3: UI Review — PASS

- Happy path: confirm state and create-mode add-tail state at 375px, light and dark, on the running app. Every label
  is inside its box, at most two lines, and Cancel/Save stay 32px. Visual cohesion in both themes:
  - The confirm on its own full-width line reads as the destructive lead.
  - Cancel/Save are right-aligned below it.
  - Dark add-tail fills line 1 edge to edge with Save right-aligned on line 2, consistent with the design list.
- Desktop at 1280 is unchanged (see AC4). 768px shows one row.
- **Executor claim 2 checked (blank sheet body, footer at the top, in the 375px confirm screenshots): pre-existing,
  not a regression.**
  - The Output editor `<dialog class="ui-modal ui-modal--lg">` is itself `overflow-y: auto`, with scrollHeight 1490
    vs clientHeight 729.
  - The cause is the chart preview's ECharts `<canvas>`: `position: absolute` with an unpositioned parent, so its
    containing block escapes `.ui-modal__body`'s clip. That extends the dialog's scrollable overflow with a blank
    tail. When the dialog is scrolled, the footer rides to the top and the area below is empty.
  - Reverting both HEL-1752 rules at runtime (flex-wrap nowrap, fixed height, padding-block 0) gives the identical
    dialog scrollHeight (1490/729). Scrolled to the bottom, the pre-fix dialog is fully blank
    (`prefix-reverted-dark-confirm-375-dialog-scrolled.png`).
  - With scrollTop 0 the fixed sheet renders normally in both themes (`fixed-*-confirm-375.png`). This matches the
    HEL-1733 evidence layout apart from the now-contained label.
  - The HEL-1733 screenshot is a *table* Output (no canvas), so it could not show this. The runtime revert is the
    comparison.
- Console: the only error is `GET /api/pipelines/:id/schedule` 404 (no schedule set, pre-existing). The rest are
  ECharts zero-size warnings during sheet open, also pre-existing.
- Accessible names are present on all footer buttons.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css:96-100`: replace the arithmetic in the
   comment. Either drop the numbers and keep the why ("min-height holds a one-line label at --control-md; a two-line
   label grows the box instead of spilling"), or state the real basis: button `line-height: normal`, about 18px at
   `--text-sm`. Do not leave the incorrect "21px line ... = 31px".
2. `e2e/hel1752-output-editor-footer-fit.spec.ts:197-198`: correct the comment. The 44px `::after` hit expander
   inflates scrollHeight only on buttons shorter than 44px (measured: Cancel/Save 37 vs 30; the 46px two-line confirm
   44 == 44). Optional, and it would fully honour C15: reinstate a scrollHeight assertion that allows the expander's
   own overflow, computed rather than hard-coded. For example, read `getComputedStyle(b, "::after").height` in
   `measure()` and assert `scrollH <= clientH + max(0, (expanderH - rect.height) / 2) + 1`.
3. `openspec/changes/fix-output-editor-footer-overflow/design.md`:
   - Decision 6: record that the `scrollHeight <= clientHeight` assertion was replaced (or scoped, if you take the
     optional part of CR2), with the accurate reason, and that the Range-rect check is the vertical guard.
   - Decision 2: correct the line arithmetic (line-height `normal`, two-line confirm measured at 46px, not 52px).

### Non-blocking Suggestions
- `expectDesktopArrangement` only asserts first-button-left == footer-left. That is nearly tautological for a
  shrink-wrapped footer. Also asserting the footer's right edge against the modal footer's content-right (the
  baseline's 979) would catch a footer that stopped shrink-wrapping.
- `labelOutside` starts at `-Infinity`, so a button with no text rects passes vacuously. Consider
  `expect(rects.length).toBeGreaterThan(0)`.
- Follow-up ticket: the chart-preview `<canvas>` (absolute, unpositioned ancestor) gives the Output editor dialog a
  phantom scroll tail of about 760px on phones. Fix it with `position: relative` on the preview wrapper. This is
  pre-existing and out of scope here.
- The branch is behind `main` by HEL-1757 (local e2e fonts). Re-run hel1752 after the Delivery rebase, since the
  create-mode wrap arrangement depends on font metrics.
