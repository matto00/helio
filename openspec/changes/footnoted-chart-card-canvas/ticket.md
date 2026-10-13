# HEL-1444: Narrow footnoted chart cards with a viewer-control bar leave a 33px canvas (axis labels overprint); also no title tooltip, and wide h=4 charts with both footnotes get ~82px

## Description

Origin: HEL-1398 (matto00/helio#890, 7ea2d038). Owner ruling 2026-10-09: accept HEL-1398 scoped to cards without a
control bar, and file this.

1. **Control-bar case:** a w=2, h=4 chart with an annotation, the truncation note AND a viewer-control bar (~57px) has
   a 33px canvas. Nothing overlaps, but the y-axis labels overprint and the bars collapse. About 67px of content height
   remains and the two footnotes take ~34px. Options (a product/design call; escalate with screenshots):
   * hide or merge the annotation when a control bar is present;
   * compact or inline the control bar;
   * a taller minimum height for chart cards with controls.
2. **Title tooltip:** at 1440, footnoted chart titles clamp to ~1.5 words ("HEL-…") and have no `title` attribute or
   accessible full name.
3. **Wide charts:** a non-narrow h=4 chart with both footnotes gets only ~82px of canvas.
4. **Cosmetic:** on footnoted cards at 1440 the footer runs ~4px into the card padding; two PanelContent.css comments
   (~L411, ~L462) exceed 100 characters.

Verify in the running app, both themes; the mobile stack is HEL-1438.

Priority: Low. Labels: Follow-up, Bug.

## Acceptance Criteria

- Item 1: a short (h=4) desktop chart card carrying footnotes and a viewer-control bar keeps a usable canvas (floors in
  `specs/`), y-axis labels never overprint, nothing overlaps; measured in the running app, light + dark, 1440 + 1900.
- Item 2: a clamped desktop panel title exposes its full text as a native tooltip (`title`) and keeps its full
  accessible name.
- Item 3: a non-narrow h=4 chart with footnotes keeps a canvas at or above the floors in `specs/`.
- Item 4: the >100-character PanelContent.css comment lines are rewrapped; the footer-overrun claim is re-measured
  (the Setup repro found 0px overrun — no change unless reproduced).
- The mobile stack (HEL-1438) is out of scope and unchanged.

## Orchestrator repro on unmodified main (a369a9cb8)

Card 262px tall at h=4 (220px content box). Canvas heights (px), identical light/dark, identical 1440/1900:

| Case | w2 | w4/w6 |
|---|---|---|
| annotation + truncation note, no bar | 102 | 94.4 |
| annotation + truncation note, 1-control bar (57px) | 33 | 25.4 |
| + 3rd footnote (time/histogram), no bar | 85.2 | 69.6 |
| + 3rd footnote, 1-control bar | 16.2 | 0.6 |

Title: h3 clamped to 2 lines, no `title` attribute, accessible name already the full title (getByRole resolves).
Footer overrun: 0px in all 36 measured cards (not reproduced). Raw data + screenshots:
`.concertino/runs/HEL-1444/evidence/repro/` in the main checkout.
