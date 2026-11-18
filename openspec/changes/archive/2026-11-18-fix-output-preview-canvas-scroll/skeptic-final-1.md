## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 6dd7e3eb9e3c24148e39d394e92aee3a9cfa8a79. The diff base is 3b8a34d57, resolved live with resolve-review-base.sh.
The only product change is one line, `position: relative` on `.output-editor-sheet__group`
(OutputEditorSheet.css:32). The rest is the new e2e spec and the OpenSpec artifacts.

Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1763/evidence/.concertino/scratch/HEL-1763/`.
I ran everything on the recreated lane DB `helio_hel1763`. The backend migrated it (141 flyway rows). Servers came up
through start-servers.sh, and assert-phase reported `PASS servers`.

### What I verified (with evidence)

- **Root cause, probed independently (live browser, 375x812, dark).** I injected styles at runtime. The fix line's
  CSS file was not touched.
  - Group forced `position: static`: dialog scrollHeight 1490. This reproduces the ticket's number.
  - Static, and also the canvas hidden: still 1490. This refutes the ticket's canvas theory.
  - Static, and also the in-group `.sr-only` elements and `.ui-toggle__input` hidden: 729. This confirms the claimed cause.
  - Styles restored: 729.
  - With the fix, every absolute/fixed descendant of `.ui-modal__body` has `.output-editor-sheet__group` as its
    containing block: two `.sr-only` spans, one `.sr-only` p and the History toggle input. The canvas resolves to
    ECharts' own positioned div. No absolute element sits outside a group. `.ui-modal__body` stays `static`.
- **Green: the three requested spec files in full** (`skeptic-green-run.txt`), 2 workers under nice -n 19: 15 passed, 0
  failed, 0 flaky, exit 0.
  - hel1763 runs 5 cases: 375 light, 375 dark, 390x844 light, 390x844 dark, and desktop.
  - hel1752 runs all 6 cases.
  - hel1573 runs all 4 cases, including :104, which passed.
  - Measured with the fix: dialog scrollHeight 729 vs content bottom 729.8 at 375, and 758 vs 758.6 at 390.
- **Red: fix line reverted** (`skeptic-mutation.diff` removes exactly `position: relative;`; `skeptic-red-run.txt`).
  All 5 hel1763 cases fail, exit 1.
  - 375 light and dark: dialog scrollHeight 1490 vs 729.8.
  - 390 light and dark: 1490 vs 758.6.
  - Desktop: 1211 vs 719, so the bug also existed on desktop and the desktop case also discriminates.
  - I restored the file with `git checkout --`. `git status --porcelain` was clean afterwards.
- **C9 spec shape.** The content bottom is derived from in-flow content: `.ui-modal__inner` bottom for the dialog, and
  the body's last child plus its padding for the body. Both the dialog and `.ui-modal__body` are asserted. The desktop
  case compares the canvas rect against the `.output-preview-pane__chart` rect on all four edges. The body assertion
  is a guard rather than a discriminator: it was 1957/1957 in both the red and green runs, as the evaluator also noted.
- **Desktop at 1280x800, live.** Dialog scrollHeight equals clientHeight (718). The canvas is 282–382 x 318–962,
  inside the wrapper at 282–522 x 318–962, so it renders and is clipped by the card.
- **Visual judgment.**
  - 375 dark, scrolled to the end (`skeptic-375-dark-bottom.png`): the body ends at Placements, followed by the footer,
    with no blank tail.
  - 390x844 light after a fresh load (`skeptic-390-light-bottom.png`): the same. The chart axes read correctly and the
    group cards are unchanged.
  - The change has no visual surface beyond removing the blank scroll, and no tokens are involved.
- **Static checks on the changed files.** Prettier is clean on both. ESLint with `--max-warnings=0` passes on the spec.
- **Wider regression run.** The evaluator's pasted 44/44 run (`eval-green-run.txt`, tail `44 passed (3.2m)`) covers
  the in-group popovers, the toggle and the ask specs (hel1350, hel1306, hel1331, hel1746, hel1510). I accepted it as
  pasted output.
- **Console.** The only error is the expected 404 on `GET /pipelines/:id/schedule` (no schedule exists). It is
  unrelated to this change.

### AC trace
1. **At 375 and 390x844, light and dark, scrollHeight matches content; red before, green after.** Met, by the hel1763
   phone cases above: red 1490, green 729 and 758.
2. **Desktop chart preview renders and clips.** Met, by the desktop case and the live rect check.
3. **The full hel1752 spec passes.** Met: 6 of 6 passed.

### Fix-layer judgment
The right call for this ticket. All the escaping elements live inside editor groups. A shared `Modal.css` change
(`position: relative` on `.ui-modal__body`) would change the containing block for every modal's absolutely
positioned popovers. That is a cross-app blast radius this low-priority bug ticket does not warrant, and design.md
Non-Goals excluded it unless the probe placed the defect there. The probe places the defect in the latent pattern,
not in `Modal.css` itself, and the design records the pattern as a spinoff.

### Verdict: CONFIRM

### Non-blocking notes
- **The group-level fix only protects elements inside a group.** If someone later adds an `.sr-only` or other absolute
  element to the editor body outside a group, the bug comes back. A scoped `.output-editor-sheet .ui-modal__body`
  rule would have covered the whole editor. Either way, a spinoff for the shared `Modal.css` pattern should actually
  be filed; none is filed yet.
- **The `.ui-modal__body` assertion is a guard, not a discriminator.** It is not red in the mutation run. A one-line
  comment saying so would make its label honest.
- **Pre-existing spinoff candidate.** The editor preview chart draws at 100px inside a 240px card at every width,
  which leaves roughly 140px of empty card. It is identical in the red run, so it is not caused by this change.
- **Cleanup.** I recreated the lane DB and dropped it afterwards with `dropdb helio_hel1763`. That also removed my
  throwaway browser user (e529f7e4-62a6-4c78-b85d-d8e95e7ea4e9) and its seed. I stopped the servers with
  stop-servers.sh.
