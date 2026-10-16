# HEL-1576 red-first evidence

Recorded outputs are in `/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/`.

| proof | red (how it was broken) | file |
| --- | --- | --- |
| gutter token drift | `GRID_GUTTER_PX = 13` | `gutter-red.txt` |
| `useDashboardMeta` reads/derivation | 9 mutations (empty-outputId skip, request sequence, unsubscribe, terminal reload, failed read, mount read, source cap, oldest run) | `useDashboardMeta-red.txt` (one survivor, the removed `mounted` guard, which cycle 2 dropped as unobservable) |
| tidy persists through the REAL `useLayoutSave` | `recordLayoutTidy` replaced by `pushLayoutSnapshot` + `setDashboardLayoutLocally`: 0 PATCHes instead of 1, 1 instead of 2 | `tidy-patch-red.txt` |
| drag/resize gated with the REAL react-grid-layout | `dragConfig.enabled` / `resizeConfig.enabled` forced true: view-mode and turn-off tests fail | `drag-gate-red.txt` |
| tidy rule | skip the in-bounds (unauthored) guard; change x while compacting; zero the non-live entries | `tidyLayout-red.txt` |
| Escape ignores an open appearance popover | selector without `.popover [aria-expanded]` | `escape-popover-red.txt` |

## e2e specs that drag or resize by handle (task 2.3), re-pointed to enter Edit layout first

`grep -n "panel-grid-card__handle\|react-resizable-handle" e2e/**` hits, all re-pointed:
- `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts` (drag, resize, and its Undo/Redo button clicks, which now exist only in edit mode; the xs case asserting no handle is unchanged because the phone shell has no meta row)
- `e2e/hel1230-drag-then-create-persists.spec.ts`
- `e2e/hel1457-stale-tab-layout-save.spec.ts` (both drag helpers)

Also re-pointed for the move of Add panel from the command-bar kebab to the meta row's primary button: `hel1230`, `hel1189-output-panel-controls-live`, `hel1260-orphan-owner-repair`, `hel516-palette-quick-create`, `hel909-output-picker-panel-sheet`, `hel910-pipeline-to-dashboard-flow`.
