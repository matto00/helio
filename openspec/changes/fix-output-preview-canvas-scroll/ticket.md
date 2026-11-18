# HEL-1763: Phone: Output editor dialog has ~760px of blank scroll because the chart preview canvas escapes the modal body

## Description

On a phone, the Output editor dialog scrolls about 760px past its content into blank space. The dialog's
scrollHeight is 1490 where the content needs about 729.

Claimed (unverified) cause: the chart preview's ECharts `<canvas>` is `position: absolute`, and its parent has no
positioning, so the canvas escapes the `.ui-modal__body` clip and stretches the scroll area. This predates HEL-1752:
reverting HEL-1752's CSS at runtime gives the same scrollHeight.

Likely fix (per the ticket, to be verified against the tree first): `position: relative` on the preview wrapper.

Origin: follow-up of HEL-1752 (PR #1165, merged as 3b8a34d57). Evidence under `.concertino/runs/HEL-1752/evidence/`.

## Acceptance Criteria

- At 375px and 390x844, light and dark: the dialog's scrollHeight matches its content. An e2e is red before the fix
  and green after.
- The chart preview still renders and clips correctly on desktop.
- The full hel1752 spec file still passes.
