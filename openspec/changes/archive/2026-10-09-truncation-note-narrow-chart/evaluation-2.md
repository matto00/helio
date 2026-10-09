## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: 75b7fb6e0122106f4179c3e6545aa6dcf73aabff. Diff base: 586da928 (resolved live). Cycle delta: c5589f8f..75b7fb6e.

Evidence is persisted at `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/evaluator-c2/`:
- Base vs HEAD geometry for each panel kind: `{base,head}-{light,dark}-{1440,1900,320}.json`.
- Screenshots: the same names as `.png`, plus `crop-*-1440.png`.
- Red and green transcripts: `red-c5589f8f.txt`, `green-head.txt`.
- The eval spec `kinds.spec.ts` and `proxy.js`, an eval-only reverse proxy described under Phase 2.

### Phase 1: Spec Review — FAIL

1. **(a) The delta spec contradicts the shipped control-bar behavior.**
   - `specs/chart-panel-truncation-notice/spec.md:44-50` says a w=2, h=4 chart with an annotation and the note "SHALL keep its chart canvas at least 96px tall". It does not exclude a viewer-control bar.
   - With a control bar the canvas measures 45.4px at both widths, in both themes. Both my run and the committed e2e's log show this.
   - files-modified.md says "the spec's 96px scenario has no control bar", but the spec text does not say so.
   - The 96px minimum itself is still stated and measurable, and the no-control-bar case honours it: 114.4px at both 1440 and 1900, light and dark. The AC ("a stated minimum") is not weakened, but the control-bar case currently has no stated minimum at all.
2. **(b) Scope.** The title and footer rules are not chart-specific. The new rules at PanelContent.css:444-458 (`.panel-grid-card__title` 1-line clamp, and `.panel-grid-card .panel-grid-card__footer` nowrap / gap / letter-spacing) sit inside `@container panel-card (max-width: 260px) and (max-height: 260px)`. They therefore apply to every panel kind at w=2, h=4, not only charts carrying footnotes.
   - I measured against the base `PanelContent.css` (586da928) served to the same app; only that stylesheet was swapped. On every desktop card I placed at w=2, h=4 (metric, table, markdown, a plain chart with no footnotes), at 1440 and 1900, in both themes:
     - Each title went from fully readable (2-4 wrapped lines) to one clipped line.
     - At 1440 (216px card) that leaves 4 characters: "Tota…", "Regi…", "Rele…", "Plai…".
   - This includes 1900 cards where nothing needed the space. Example: "Total quarterly revenue" (metric, 1900): title 54.6 → 18.2px, clipped.
   - The ticket, proposal and design scope item 1 to a chart with an annotation and the note. The proposal's Impact section and the design's Non-Goals do not mention grid card chrome for other kinds. This is a cross-kind behavior change outside the ticket.
   - The phone stack is unaffected for all kinds: at 320px, title, content and card heights are identical before and after.
3. Items 2, 3 and 4 and constraints C1/C2 still hold.
   - The style guard's dead lookbehind was removed, and the docstring now credits the boundary anchor (CR from cycle 1, done).
   - The `.sr-only` re-declaration now has its comment, `padding: 0` and `border: 0` (cycle-1 CR3, done).
4. files-modified.md is stale. Its first two bullets still describe "canvas >= 96px … 96px canvas floor" for the e2e and CSS. The floor no longer exists, and the containment e2e is not mentioned.

### Phase 2: Code Review — FAIL (findings only; the gates are green)

Gates, run fresh by me in WORKTREE_PATH on HEAD, all exit 0: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm --prefix frontend run build`.

**(c) The containment e2e is genuinely red on c5589f8f and green on HEAD.**
- Red run: I ran the committed spec unmodified through `proxy.js`, an eval-only reverse proxy on :6832. It serves the c5589f8f `PanelContent.css` in place of HEAD's (the only frontend runtime file the cycle changed) and rewrites Origin to the dev origin so the backend accepts it.
  - Result: 6 failed, 2 passed (`red-c5589f8f.txt`). The failures are 1440 with and without a control bar, and 1900 with a control bar, in both themes. All six fail "canvas starts inside the content box": received 140.98, 175.48 and 178.89 against expected ≥ 159.06, 228.06 and 209.88.
  - The 1900 no-control-bar cases correctly pass, because the cycle-1 fix was fine there.
  - The geometry matches my cycle-1 measurements exactly, so the swap is faithful.
- Green run: 12/12 passed on HEAD at :6830 (`green-head.txt`).
- The containment assertions cover canvas top ≥ content top; annotation, note and canvas bottoms ≤ content bottom; content below the header and the control bar; and content above the footer. These close the cycle-1 gap.

**(d) Control-bar case: no overlap.**
- At both widths, in both themes: control bar 129–186, content 198–277, canvas 45.4px (198–243.4), note bottom 277, footer top 289.
- 45.4px is reported in the log and not asserted. That is fine once the spec states it (CR1).

**(e) Mobile stack is unchanged.**
- The committed e2e's phone assertions pass: canvas 100px at 390 and 320, long sentence kept.
- My 320px measurement of metric, table, markdown and chart stack cards is identical to base.

Code findings:
- **Readable / scope (blocking, see Phase 1 item 2).** PanelContent.css:444-458 restyles `.panel-grid-card__title` and `.panel-grid-card__footer`, which are PanelGrid.css's card chrome, from the chart-content stylesheet, for every kind. Grid card chrome rules belong with PanelGrid.css's existing `@container panel-card` blocks (PanelGrid.css:288-320), or must be scoped to the chart case.
- Non-blocking: at 1440 the nowrap footer's content is 4px wider than its box (`scrollWidth - clientWidth = 4`) on output cards. It spills into the card padding and is not visibly clipped (`head-*-1440.json`).

### Phase 3: UI Review — FAIL

| Check | Result |
|---|---|
| Chart w=2, h=4, annotation + note, 1440 and 1900, light and dark | Canvas 114.4px, everything contained, short form shown. Pass. |
| Same with a control bar | Contained, canvas 45.4px. Pass on layout; the spec text conflicts (CR1). |
| Other kinds at w=2, h=4 (metric, table, markdown, chart without footnotes), 1440 and 1900, light and dark | Titles clipped to one line, about 4 characters at 1440, versus fully readable on base. Fail, out of scope (CR2). |
| Phone stack, 390 and 320 | Unchanged. Pass. |
| Console errors | None in any run. |
| Accessibility | Clamped titles stay in the DOM and the accessibility tree. Sighted users have no way to read the full title (no `title` attribute), as the executor's own tradeoff note says. |
| Item 4 "matching rows" | Committed e2e green in both themes. |

### Overall: FAIL

### Change Requests

1. **spec.md:44-50 (delta spec).** Scope the 96px requirement and scenario to "with no viewer-control bar". Add a scenario for the control-bar case stating what is guaranteed: the canvas and both footnotes stay inside the card body, with no overlap with the header, control bar or footer, and the canvas gets the remaining space (measured 45.4px). The spec must not assert ≥96px for a configuration that ships 45.4px.
2. **PanelContent.css:444-458.** Restrict the title clamp and the footer tightening to the chart-with-footnotes case so other panel kinds at w=2, h=4 keep their base title and footer. For example, prefix the selectors with `.panel-grid-card:has(.chart-panel__annotation, .chart-panel__truncation-note)`; container queries still evaluate against that card.
   - Consider a 2-line title clamp instead of 1. At 1440 a 2-line title costs about 18px, which would leave the no-control-bar canvas at about 96px (114.4 − 18.2). Re-measure before choosing.
   - Then extend the e2e, or add a case, proving that a non-chart card at w=2, h=4 keeps an unclamped title. Make it red on 75b7fb6e and green after.
3. **files-modified.md.** Update the first two bullets. They still describe a "96px canvas floor" and a canvas-only e2e; describe the containment e2e and the floor-less narrow block.

### Non-blocking Suggestions

- Footer nowrap overflows its box by 4px at a 1440px viewport (216px card). If CR2 keeps the footer rule, check that `UPDATED 10/9/2026` still fits once the date format is longer, for example in other locales.
