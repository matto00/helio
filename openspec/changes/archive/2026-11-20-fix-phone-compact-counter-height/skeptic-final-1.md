## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 5175f1a99e07fa3c66a22e081add429d648ffe23 against base 3b9f4c83d84962fa9b8d0b34646fa9c8899519ad (resolved
live with resolve-review-base.sh, exit 0). Commits: 2713623b4 (failing spec plus recorded red run), 5175f1a99 (fix).

### What I verified (with evidence)
- **Diff scope.** `git diff BASE...HEAD -- frontend`: the code change is limited to
  `frontend/src/features/panels/ui/grid/MobilePanelStack.css`. It adds `.mobile-panel-stack__item.mobile-panel-stack__item--form`
  to the existing two-class intrinsic-height rule (`container-type: inline-size; height: auto; flex-shrink: 0`). It also
  adds `.mobile-panel-stack__item--form .panel-content--form { height: auto; overflow-y: visible }`. Both selectors
  need `--form` inside the stack, so they cannot affect another kind or the desktop grid. The jest guard adds `form` to
  the intrinsic-kinds list and asserts the body override. A new e2e spec is added. No shared Crossfade or PanelContent
  CSS is touched, and no HEL-1649 or HEL-1697 files are touched.
- **Root cause.** The fix matches the design's hypothesis: `form` is a real PanelKind that the stack rule never listed,
  so the card kept `.panel-grid-card`'s `container-type: size` while its parent had auto height. My probe shows the card
  now computes `container-type: inline-size` (probe-results.json, every key). The executor's probe-ancestors.json and
  the evaluator's CSSOM-removal measurement both record base as 30/30/42 px, `size` containment, and a body with
  scrollHeight 56 against clientHeight 24. Neither of those depends on mtimes.
- **Gates, re-run by me (lane servers on 7223/10130, lane DB helio_hel1791, empty ANTHROPIC_API_KEY):**
  - `npm run e2e -- e2e/hel1791-compact-counter-stack-height.spec.ts --workers=2`: 5 of 5 passed (owner and editor, light
    and dark, each test looping 390/768/1100, plus the per-kind table). The teardown deleted 3 throwaway users.
  - `npm --prefix frontend test -- --testPathPatterns=MobilePanelStack.css --maxWorkers=3`: 24 of 24 passed.
  - The red run (red-run.txt: 4 geometry tests failed, value bottom 881 > card bottom 823 at 390) and the mutation run
    (mutation-run.txt: dropping `--form` makes the 4 tests fail again) are committed. The red spec commit comes before the
    fix commit in `git log`, which is commit-graph order, not mtime. The evaluator's pasted lint, format, typecheck, full
    jest and build output is specific and unambiguous, so I relied on it rather than re-running the full suites.
- **AC1 (390, light and dark, value, both buttons, caption for a non-owner, no inner scroll):** met. The e2e asserts
  that each element is inside the card rect and that `.panel-content--form` has scrollHeight <= clientHeight + 1. I
  confirmed this visually (screenshots below): at 390 the editor's card is 226 px and shows the Widgets label, −, 0, +
  and "Your net change this session". The owner's card is 211 px and has no caption.
- **AC2 (768, and 1100 with the sidebar open):** met. At 1100 the Dashboards sidebar is open and the single-column stack
  renders the full counter (full-editor-dark-1100.png). 768 is covered by the e2e loop.
- **AC3 (other kinds keep their height):** met, but by measurement, not by a spec assertion. heights-red.json and
  heights-green.json are identical for every non-form kind. The evaluator also measured a 0 px delta with the fix
  removed from the live CSSOM, and the selectors cannot structurally match another kind.
- **AC4 (a test that fails first):** met (see above).
- **Console:** 0 console errors and 0 page errors across 8 page loads (probe-results.json `errors: []`).
- **Design judgment (DESIGN.md, light and dark, sibling cards):** the counter card now reads as a normal stack card:
  the same chrome, the same title treatment as the text and multi-field form siblings, and correct theme parity (the
  caption is muted in both themes and the button and value contrast holds in dark). The fix adds no hardcoded values.
  The card's title, labels and hints leave the `max-height: 179px` container-query sizing and now use the stack's
  normal sizes. That matches the sibling cards.
- **Cleanup:** my probe deleted its dashboard and sources over the API. I deleted its 2 users by exact id with
  `buildUserDeleteSql` on helio_hel1791 and confirmed 0 remain. I stopped the servers with `stop-servers.sh`
  (`STOPPED ports=7223,10130`).

Evidence (durable):
- /home/matt/Development/helio/.concertino/runs/HEL-1791/evidence/.concertino/scratch/HEL-1791/skeptic/full-editor-light-390.png
- /home/matt/Development/helio/.concertino/runs/HEL-1791/evidence/.concertino/scratch/HEL-1791/skeptic/full-editor-dark-390.png
- /home/matt/Development/helio/.concertino/runs/HEL-1791/evidence/.concertino/scratch/HEL-1791/skeptic/full-editor-dark-1100.png
- /home/matt/Development/helio/.concertino/runs/HEL-1791/evidence/.concertino/scratch/HEL-1791/skeptic/probe-results.json
- /home/matt/Development/helio/.concertino/runs/HEL-1791/evidence/.concertino/scratch/HEL-1791/skeptic/probe.cjs

### Verdict: CONFIRM

### Non-blocking notes
- **Bottom whitespace in the compact counter card (follow-up candidate, not a regression).** Across the stack, the
  caption ends about 75 px above the card bottom, while the Widgets label starts about 41 px below the title. The
  multi-field form sibling has about 26 px under its Submit button. The measured cause (probe-results.json, chain for
  `editor-light-390`) is two empty, zero-height children inside `.form-panel-view__compact-counter`:
  `.form-panel-view__alert` and `.form-panel-view__status`. Each still takes one 16 px `gap` slot, which adds 32 px of
  dead space before the counter's own 16 px padding. This is pre-existing in `CounterControl.css` and in the
  form-panel view, and was hidden while the card was collapsed. Changing it touches the shared compact-counter layout,
  which is outside this ticket's stack-scoped fix. Suggested follow-up: do not let empty live regions take a gap slot,
  without removing them from the DOM.
- AC3 is asserted only by the recorded JSON. The per-kind e2e test asserts only that 7 cards were measured. A band
  assertion would let the spec guard AC3 by itself (the evaluator's suggestion too).
- The spec's `afterAll` does not delete the pipeline it creates. The user-teardown cascade covers it today.
- red-run.txt includes a `userCleanup: 0 of 10 recorded users match` teardown error from the red run. It is outside the
  shipped code, but someone should check that the red run did not leave users in helio_hel1791.
