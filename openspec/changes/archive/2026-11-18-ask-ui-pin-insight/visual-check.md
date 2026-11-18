# Visual check (HEL-1746, task 4.2)

Against the RUNNING app (lane ports: dev 7178, backend 10085; every e2e test asserts its page origin is `http://localhost:7178`), light and
dark, desktop (1280x800) and phone (390x844), beside neighbouring dashboard chrome and the Output sheet. Screenshots: `e2e-evidence/HEL-1746/`
(gitignored; written by `e2e/hel1746-ask-ui.spec.ts` through `evidencePath`): `ask-answer|pinned|placed|provenance|ungrounded|unavailable|
viewer|upsell-<theme>-<viewport>.png`, `ask-sheet-<theme>-desktop.png`, `ask-sheet-<theme>-phone.png`, `ask-sheet-draft-<theme>-desktop.png`.

Observations (screenshots read by eye):
- Meta row (`ask-placed-light-desktop.png`): the Ask button is a quiet secondary icon, a question mark in a circle, sitting between the appearance
  editor and the assistant's two-bubble glyph. The two glyphs read as distinct (a question circle against a speech bubble), so `MessageCircleQuestion`
  stays; the `CircleHelp` fallback of D3 was not needed. Add panel remains the one accent control.
- Drawer, desktop (light and dark): a 540px centred dialog, labelled field, one accent "Ask" button, the answer in a soft card with two numbered chips
  inline, "Based on Orders table, Total amount", and after pinning "Pinned. Pinned as an insight and placed on this dashboard." The dashboard behind
  shows the new panel "How do revenue and cost compare?" in "Not yet rendered / This insight will appear after its first render."
- Drawer, phone (light and dark): the shared swipe sheet from the bottom edge (width equals the viewport width, asserted), grab handle, 44px targets;
  the answer card and the "Pin as insight" secondary button fit with no horizontal overflow.
- Output sheet (`ask-sheet-*`): "Ask about this Output" is a closed disclosure after the Preview card; opened, it reads like the neighbouring card groups;
  in a draft, Pin is disabled with "Save or discard your draft to pin."
- Free tier (`ask-upsell-*`): the upsell sentence and link in a soft card in place of the field; focus lands on the dialog title (no field to take it).
- Light/dark parity: all colours are existing tokens (`--app-accent`, `--app-surface-soft`, `--app-border-subtle`, `--app-text-muted`); nothing looked off in either theme.

Cycle 2 (re-read after the changes): the Ask and Pin buttons now use the shared `ui-modal-btn` recipe, painted 32px like the sheet's Save and Cancel, with a
44px hit region (measured in e2e at 390px). The question field uses `FormField`. New captures `ask-sheet-<theme>-phone.png` (light and dark) show the Output
sheet's ask group on a phone with the answer, both chips, "Based on ..." and the Pin button in frame, no horizontal overflow (asserted). `ask-viewer-*` now scrolls the
answer into frame (answer, no Pin under it) and `ask-sheet-draft-*` shows the disabled "Pin as insight" with "Save or discard your draft to pin." in frame.

Not judged by screenshot: 429, 403 (jest asserts their copy; the 403 upsell shares the free-tier element), and edit-mode meta row widths.
