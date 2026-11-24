# HEL-1835 D4 before/after at sm (1280x1000, container 928)

Reproducing dashboard: 9 text panels, stored `sm` with column gaps, `md` and `xs` empty. Per-panel
`getBoundingClientRect` relative to `.panel-grid`, 3 s after the grid is ready.

- before = main 0548a4640's `DesktopPanelGridSkeleton.tsx` (fix file checked out from that commit, then restored)
- after = HEAD (the fix)
- `diff before-dark.txt after-dark.txt` and `diff before-light.txt after-light.txt`: empty (identical positions and sizes).
- dark and light dumps are also identical to each other. Screenshots (`*.png`) accompany the dumps.
- Caveat: the before run swaps the file under a live Vite dev server; the loop itself was proven on unfixed code by the
  red runs, not by this comparison.
