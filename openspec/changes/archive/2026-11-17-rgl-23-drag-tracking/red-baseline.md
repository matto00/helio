# HEL-1728 red baseline (tasks 1.1-1.3)

Command (each): `DEV_PORT=7160 BACKEND_PORT=10067 npx playwright test e2e/hel1573-motion-grid-chart.spec.ts:275 --repeat-each N --workers 2` against the pinned dev server (servers restarted and `node_modules/.vite` cleared between installs).

| Install (versions via node_modules package.json) | Result |
|---|---|
| react-grid-layout 2.2.4, react-resizable 3.1.3 (branch as-is, after `npm ci`) | 20 passed / 20 (1.6m) |
| react-grid-layout 2.3.0, react-resizable 3.2.0 (`npm install react-grid-layout@2.3.0`) | 20 failed / 20 |
| react-grid-layout 2.3.0 + react-resizable forced to 3.1.3 (D2 override) | 3 failed / 3, red |

The 20/20 red was re-measured here, not inherited. Failure is at the intended assertion: `item tracks the pointer at dx=120`, `Expected: < 30, Received: 110` (the panel barely moves). Not a harness/other-assertion failure.

D2 verdict: react-resizable is NOT the cause (red with 3.1.3). Cause is in react-grid-layout itself. Note: overriding react-resizable alone left no hoisted copy (npm nested it under react-grid-layout), which broke the app's own `import "react-resizable/css/styles.css"` (vite resolve error; first attempt was an environment failure, not a result), so a hoisted 3.1.3 was added with `--no-save`. Side finding: the app imports react-resizable directly without declaring it (phantom dependency).

All installs undone per D0 (`git checkout -- frontend/package.json frontend/package-lock.json`, `npm ci`, status clean).

## 1.2 dist drag-path diff (published 2.2.4 vs 2.3.0, `GridLayout` chunk, unminified)
Suspect hunks:
1. `onDragStop`: `if (!activeDrag) return;` became `if (!oldDragItemRef.current) return;` and `activeDrag` removed from deps (#2291/#2292). **Lead suspect.**
2. `GridItem` wrapped in `React.memo` with a custom comparator (#2240) - ignores `dragConfig`/`resizeConfig`-derived props not listed; a stable-identity concern for our inline `dragConfig`/`resizeConfig` literals.
3. Edge auto-scroll controller fed from every drag move (`createEdgeScrollController`, #2232).
4. Resize `containerHeight` from `offsetParent`, n/nw/ne resize y handling, external-drop refactors (not on the drag path).
Built 2.3.0 `dist/*.mjs` is identical to the npm tarball after normalizing chunk hashes (0 diff lines); same for 2.2.4.
