## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: c5589f8f21bc8d5422bd5e5c175f5bf1d4f55cd3. Diff base: 586da928abb6b7000d5e17799d3b5fb9b181ebce, resolved live with resolve-review-base.sh.
Persisted evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/evaluator-c1/`. It holds the measurement JSONs, screenshots, and the scratch spec `eval-controls.spec.ts` that produced them.

### Phase 1: Spec Review — FAIL

- **Item 1 is not met at the ticket's own repro width.** The executor measured only at a 1900px viewport, where the w=2 card is 254px wide and the pre-fix canvas is 48.4px. At a **1440px** viewport the w=2 card is 216px wide and the header title wraps. There I measured the **pre-fix canvas at 5.2px**. That is the ticket's "~5px", so the claim was right and the executor's "not reproduced" conclusion came from testing one viewport only. Evidence: `preemu-vw1440-light-nocontrols.json`.
  - Post-fix at 1440, light and dark, no controls: canvas is 96px, but `.panel-content` is only 92.4px tall (top 159.6, bottom 252). The floor therefore overflows the content box in both directions:
    - The canvas starts at 141.0, about 18px above the content box, under the header.
    - The note ends at 270.6, past the content box and 6.6px into the card footer, which starts at 264.0.
  - Design D3 rules this out: the floor is "a backstop, not the primary fix", and "a clipped-away note is a failure". Evidence: `post-vw1440-{light,dark}-nocontrols.{json,png}`.
- **With a viewer-control bar (orchestrator point 1), the fix makes the card unreadable in both themes.** At 1900, card 254x262, the bar is 57px tall:
  - Pre-fix canvas: 0px (emulated). After the fix it sits at the 96px floor, but the content box is only 66.6px tall.
  - The canvas (top 178.9) overlaps the control bar (bottom 198.4) by about 20px.
  - The annotation and the note (bottom 308.5) overflow into the card footer (289–313). In the screenshot, "200 of 500 rows." prints on top of "OUTPUT ⓘ UPDATED 10/9/2026".
  - At 1440 it is worse: the chart's axis labels print over the "All" dropdown, and the annotation prints over the footer.
  - The footnotes are not clipped, but they are illegible, which fails the spec's "both footnotes remain visible" and D3. Evidence: `post-light-controls.png`, `post-dark-controls.png`, `post-vw1440-{light,dark}-controls.png` with their JSONs.
- **The new spec scenario holds only where the e2e measures it.** "canvas >= 96px and both footnotes remain visible" passes at the 254px-wide card and fails at the 216px-wide card on the same lg breakpoint.
- Items 2, 3 and 4 are addressed:
  - Item 2: the prop comment is fixed (ChartRenderer.tsx:32-34).
  - Item 3: the guard strips comments, catches a rule placed after a comment, and has a comma-preceded negative case (C1).
  - Item 4: the light and dark screenshots exist and read "Based on the first 200 of 250 matching rows." Server cross-filter was not live-checked; the design made that optional ("if reachable").
- CONSTRAINTS: C1 is honored (see the Phase 2 note on the dead lookbehind). C2 is honored:
  - The narrow query requires `max-height: 260px`.
  - `.mobile-panel-stack__item--output` sets `container-type: inline-size` (MobilePanelStack.css:81), so the height clause never matches in the stack.
  - The committed e2e's phone assertions passed in my run: canvas 100px at both 390 and 320, long sentence kept. HEL-1438 is not absorbed.
- Scope is clean: no backend, schema or data-hook change, and every task box matches the diff.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in WORKTREE_PATH, all exit 0:
- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm test`: 491 suites, 5162 tests
- `npm --prefix frontend run build`

HEL-1392 regression check: `e2e/hel1392-remount-request-burst.spec.ts` (3 tests) and `e2e/hel1392-remount-staleness.spec.ts` (light and dark) passed against this branch's live servers. I confirmed the servers' cwd is this worktree with `readlink /proc/<pid>/cwd`. No data hook is in the diff.

Committed e2e (`e2e/hel1398-chart-narrow-footnotes.spec.ts`): all 4 tests passed for me post-fix, light and dark.

Red-first check on pre-fix code: I could not run the pre-fix code genuinely. A second Vite server at 586da928 on another port was refused by the backend's CORS origin check, and start-servers.sh refuses a foreign backend. Instead I emulated the pre-fix layout on the live app: I deleted the single HEL-1398 `@container ... 260px` rule through the CSSOM and removed the short spans. The emulation reproduces the executor's recorded pre-fix numbers exactly: 48.4375px without controls and 0px with controls at 1900. So the committed spec's canvas and short-form assertions are red against the pre-fix layout. The executor's `prefix/red-transcript.txt` came from an earlier spec revision (its line 203 `toMatch(/500/)` is not in the committed spec), but it fails on the same assertion.

Findings:
- **Tests meaningful (blocking).** The e2e cannot catch the defect above:
  - It asserts canvas height, line count and text, but never that the footnotes sit inside `.panel-content` and above the card footer. A layout that is 96px canvas plus overlapping footnotes passes.
  - It measures only at a 1900px viewport, where the card is 254px wide.
  - It never tests the w=2 card with a viewer-control bar.
- **Design [mechanical] / DRY.** PanelContent.css:420-428 hand-rolls the visually-hidden recipe. theme.css:487-490 says "feature CSS should use this shared class instead of redefining it locally", and DESIGN.md:481 lists `.sr-only` as the canonical utility. The class cannot be applied conditionally inside a container query, so a local copy is defensible. But it must say why in a comment, and it should match the canonical declarations: it omits `padding: 0` and `border: 0`.
- **Readable (non-blocking).** The lookbehind `(?<![,>+~\w-])` in `STANDALONE_NOTE_RULE` (PanelContent.truncationNoteStyle.test.ts:19-20) is dead. I checked six cases: the rule after a comment, the shared list, the shared list with comments, a comma after a brace, the `+` join, and the real CSS file. All give the same result with and without it. The comma and combinator exclusion actually comes from the `(?:^|[};{])\s*` anchor. The docstring credits the lookbehind for the C1 behavior, which misleads.
- Type safety, security, error handling and dead code: no issues. `truncationCounts` is a clean single fail-closed gate, and the `null` parity between the long and short forms is unit-tested.

### Phase 3: UI Review — FAIL

The servers were reused through start-servers.sh, and assert-phase printed `PASS servers`. Both processes' cwd is this worktree.

| Check | Result |
|---|---|
| Happy path, w=2 h=4, 1900px viewport, no controls, light and dark | Canvas 102.0px, both footnotes one line, short form "200 of 500 rows.", content box not overflowed. |
| Happy path, w=2 h=4, **1440px** viewport, no controls, light and dark | **Fail.** The 96px floor overflows the 92.4px content box: canvas under the header, note 6.6px into the footer. |
| w=2 h=4 **with a viewer-control bar**, 1900 and 1440, light and dark | **Fail.** Canvas overlaps the control bar (about 20px at 1900; it prints over the dropdown at 1440). The annotation and note overprint the card footer. |
| 1100px viewport (card 259px wide) | Without controls: canvas 102px, footnotes clear of the footer. With controls: same overlap as at 1900. |
| 768 / 0 | The mobile stack renders. Covered by the committed e2e at 390 and 320: canvas 100px and the long sentence, unchanged from pre-fix. |
| Console errors | None in any of my runs. |
| Accessibility | The long sentence stays in the accessibility tree (visually hidden, never `aria-hidden`). The short span is `aria-hidden="true"`. The `title` keeps the full sentence. |
| Item 4 live "matching rows" | Screenshots exist for both themes (`.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/matching-rows-{light,dark}.png`), and the committed e2e test passed in my own run. |

### Overall: FAIL

### Change Requests

1. **PanelContent.css:409-438, the narrow container block.** Make the narrow layout fit inside the card in every w=2, h=4 configuration I measured:
   - **1440px viewport** (card 216px wide, title wrapping): content box 92.4px.
   - **Viewer-control bar** at 1900px (content box 66.6px) and at 1440px (23.4px).

   The canvas must never extend above `.panel-content`'s top, and the footnotes must never extend below its bottom or into `.panel-grid-card__footer`. The 96px floor fits none of these boxes, and the sum of 96px plus two 16.8px footnotes is larger still. So the fix cannot be "floor plus one-line footnotes" alone; per D3, the footnotes or the floor must yield. Possible options, but the choice is yours:
   - Hide the annotation, keeping the note, when space is short.
   - Express the floor as a clamp against the available height instead of a fixed `min-height: 96px`.
   - Key the narrow query on a smaller height.

   Then state the minimum the fix actually guarantees per configuration in files-modified.md. If no layout can give canvas >= 96px plus both legible footnotes in these boxes, say so explicitly with the measured numbers so the orchestrator can decide whether the AC's "stated minimum" needs an owner ruling. Do not ship overlapping text.
2. **e2e/hel1398-chart-narrow-footnotes.spec.ts.** Make the e2e able to catch Change Request 1:
   - Add a 1440px-viewport case (w=2 card about 216px wide) and a w=2, h=4 case with a viewer-control bar (`seed(..., withControl=true)`), in both themes.
   - In every case, assert containment: canvas top >= `.panel-content` top, note bottom <= `.panel-content` bottom, and `.panel-content` bottom <= `.panel-grid-card__footer` top.
   - Show these new cases red on the current commit c5589f8f, then green after the fix.
3. **PanelContent.css:420-428.** Add a one-line comment explaining why this block re-declares the visually-hidden recipe instead of using the canonical `.sr-only` from theme.css: the class cannot be applied conditionally under a container query. Add the missing `padding: 0;` and `border: 0;` so it matches theme.css:505-515.

### Non-blocking Suggestions

- PanelContent.truncationNoteStyle.test.ts:17-20: drop the dead `(?<![,>+~\w-])` lookbehind, or correct the docstring. The C1 exclusion comes from the `(?:^|[};{])\s*` boundary anchor, so say that.
- files-modified.md: correct "The ticket's '~5px' is not reproduced as 5px". It reproduces as 5.2px at a 1440px viewport.
