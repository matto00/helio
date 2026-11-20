# HEL-1774: Modals: hidden screen-reader text in a scrolling modal body can stretch the dialog's scroll area

## Description

origin_kind: followup
origin_ticket: HEL-1763

HEL-1763 found that `.sr-only` text and visually hidden inputs (`position: absolute`) inside a modal's scrolling body
can be positioned against the fixed dialog, not the body. They then escape the `.ui-modal__body` clip and stretch the
dialog's scroll area into blank space. HEL-1763 fixed only the Output editor, with `position: relative` on
`.output-editor-sheet__group`.

Any other modal with the same pattern can have the same bug. A hidden element added to the Output editor body outside
a group would also bring it back.

HEL-1763 kept the shared fix out of scope on purpose: positioning `.ui-modal__body` app-wide changes what every
modal's absolutely positioned content is placed against.

## Acceptance Criteria

- List every modal or sheet whose scrolling body contains absolutely positioned hidden content, and measure
  scrollHeight against content height for each.
- Fix it once in the shared modal CSS, or per modal with a guard, and justify the choice against every absolutely
  positioned child the shared rule would move.
- An e2e or unit guard goes red when a modal's scroll area exceeds its content. Check desktop and phone, light and
  dark.

## Agent notes

- Evidence: `.concertino/runs/HEL-1763/evidence/` in the main checkout (design.md "Resolution", skeptic-final-1.md).
