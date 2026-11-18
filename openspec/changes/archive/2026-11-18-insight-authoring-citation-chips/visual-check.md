# Visual check (D11), cycle 2

Ran a throwaway probe (deleted, not committed) against the running app on 7176/10083, seeding all five panel states (rendered, failed after ok,
quota after ok, unchanged after ok, no render) as a beta owner, the upsell as a free owner, and the editor card (create sheet, custom prompt
open; free owner for the upsell note), in light and dark at 1280 and 390 wide. 16 screenshots in
.concertino/scratch/HEL-1744/shots2/ (panels-{beta,free}-*, editor-create-*, editor-upsell-*).
Opened by me: panels-beta-dark-phone, panels-beta-light-desktop, panels-free-dark-desktop, editor-create-dark-phone,
editor-create-light-desktop, editor-upsell-light-phone. Not opened: the other ten (same code paths, produced by the same passing run).
Findings: all states read as quiet notes under the render, the failed note in the error colour; chips are small neutral pills; the upsell
and not-yet-rendered states use the shared state recipe; the card fits a 390 phone with no sideways scroll (also asserted in e2e);
the footer shows the render date. Fixed after looking: the "Outputs it reads" legend was indented 2px against the labels (legend padding
removed); the refresh control stretched across a desktop card, so the full-width rule now applies on phones only.
