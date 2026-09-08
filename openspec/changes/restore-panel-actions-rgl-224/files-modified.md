# Files modified — HEL-1014

## Product/dependency

- `frontend/package-lock.json` — bumps `react-grid-layout` 2.2.3 -> 2.2.4 (exactly the 3-line
  version/resolved/integrity diff on `node_modules/react-grid-layout`; `frontend/package.json` is
  unchanged, still `^2.2.2`, which already admits 2.2.4). Supersedes Dependabot PR #481.

## Test harness

- `frontend/src/test/jest.setup.ts` — adds a `getComputedStyle` width shim alongside the existing
  `offsetWidth` stub. react-grid-layout 2.2.4's `useContainerWidth` reads
  `getComputedStyle(node).width` (via `getContentWidth`) instead of `node.offsetWidth`. jsdom
  returns the SPECIFIED value (a real browser returns the USED value in px), so the product's
  inline-percentage-width `.panel-list__zoom-container` node resolved to the literal string
  `"100%"`, which `Number.parseFloat` reads as a finite `100` — below `panelGridConfig.breakpoints.sm`
  (768) — flipping `PanelGrid` onto the phone-only `MobilePanelStack` branch, which by design
  (HEL-301) renders no panel-actions trigger. The shim passes through any already-resolved `px`
  width untouched and reports `"1280px"` only for unresolved values (percentages, `auto`, empty).

## New guard tests

- `frontend/src/test/widthMeasurementShim.test.tsx` — stub-integrity guard: asserts
  react-grid-layout's real, unmocked `useContainerWidth` reports >= `panelGridConfig.breakpoints.sm`
  for the actual `.panel-list__zoom-container` node (inline percentage width), not a synthetic
  bare `div` (which would pass vacuously — the mistake the withdrawn `clientWidth`-stub approach
  made).
- `frontend/src/test/panelActionsAccessibleName.test.tsx` — regression guard: asserts the
  panel-actions button is reachable via `getByRole("button", { name: /panel actions/ })` through
  the real, fully unmocked `PanelList` -> `PanelGrid` -> `DesktopPanelGrid` -> `PanelCard` ->
  `ActionsMenu` chain.

## Unmodified (verified clean)

- `frontend/src/app/App.test.tsx` — `git diff --exit-code` clean throughout; the two original
  assertions at line 893 pass unmodified.
- `frontend/src/features/panels/ui/PanelCard.tsx`, `ActionsMenu.tsx`, `PanelGrid.tsx` — untouched,
  per design.md.

---

## Evidence

### Task 1.1 — lockfile/range verification

```
$ git diff frontend/package.json
(empty)

$ git diff frontend/package-lock.json | head
diff --git a/frontend/package-lock.json b/frontend/package-lock.json
     "node_modules/react-grid-layout": {
-      "version": "2.2.3",
-      "resolved": ".../react-grid-layout-2.2.3.tgz",
-      "integrity": "sha512-OAEJHBxmfuxQfVtZwRzmsokijGlBgzYIJ7MUlLk/VSa43SaGzu15w5D0P2RDrfX5EvP9POMbL6bFrai/huDzbQ==",
+      "version": "2.2.4",
+      "resolved": ".../react-grid-layout-2.2.4.tgz",
+      "integrity": "sha512-Eb57FsgOMYOfsUGrMI1ku/FFR+dPNPrE8qo+3hwZubpqVSy4GO9v52DeX50Tl3JDYAlCypP4rmw7Vrqk/zOIvA==",

$ grep -n '"react-grid-layout"' frontend/package.json frontend/package-lock.json | head -20
package.json:31:    "react-grid-layout": "^2.2.2",
package-lock.json:23:        "react-grid-layout": "^2.2.2",
```

### Task 1.2 — RED baseline (App.test.tsx only)

```
$ npx jest --testPathPatterns='app/App.test'
Test Suites: 1 failed, 1 total
Tests:       2 failed, 27 passed, 29 total
```

Matches expected exactly. Both failures at `App.test.tsx:893`
(`screen.findByRole("button", { name: "Revenue Pulse panel actions" })` timing out).

### Task 1.3 — RED baseline (full suite)

```
$ npx jest
Test Suites: 1 failed, 271 passed, 272 total
Tests:       2 failed, 2766 passed, 2768 total
```

Matches expected exactly.

### Task 2.3 — RED -> GREEN after the shim

```
$ npx jest --testPathPatterns='app/App.test'
Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total

$ git diff --exit-code frontend/src/app/App.test.tsx
(exit 0 — clean)
```

### Task 3.3 — mutation-prove the accessible-name guard (`panelActionsAccessibleName.test.tsx`)

Mutation: removed the accessible name in `PanelCard.tsx:303`
(`label={`${panel.title} panel actions`}` -> `label={`${panel.title} MUTATED`}`).

```
$ npx jest --testPathPatterns='panelActionsAccessibleName'
FAIL src/test/panelActionsAccessibleName.test.tsx
  ● ... › is reachable via getByRole('button', { name: /panel actions/ }) ...
    at waitForWrapper (node_modules/@testing-library/dom/dist/wait-for.js:163:27)
    at Object.<anonymous> (src/test/panelActionsAccessibleName.test.tsx:70:45)
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
```

Confirmed RED. Restored the `label` prop.

```
$ npx jest --testPathPatterns='panelActionsAccessibleName'
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total

$ git diff --exit-code frontend/src/features/panels/ui/PanelCard.tsx
(exit 0 — clean)
```

### Task 3.4 — mutation-prove the stub-integrity guard (`widthMeasurementShim.test.tsx`)

Mutation: neutered the 2.1 shim in `jest.setup.ts` by forcing its early-return branch
(`if (typeof style.width === "string" && style.width.endsWith("px"))` -> `if (true)`), disabling
the shim entirely — targeting the ACTUAL fix path, not the withdrawn `clientWidth` stub.

```
$ npx jest --testPathPatterns='widthMeasurementShim'
FAIL src/test/widthMeasurementShim.test.tsx
  ● ... stub-integrity guard › react-grid-layout's real useContainerWidth reports a
    desktop-representative width ...
    expect(received).toBeGreaterThanOrEqual(expected)
    Expected: >= 768
    Received:    100
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
```

Confirmed RED — measured width is exactly 100, matching the diagnosed mechanism
(`Number.parseFloat("100%") === 100`). Restored the shim condition.

```
$ npx jest --testPathPatterns='widthMeasurementShim'
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

### Task 3.5 — full-suite blast radius

```
$ npx jest
Test Suites: 274 passed, 274 total
Tests:       2770 passed, 2770 total
Snapshots:   1 passed, 1 total
```

Against the 1.3 baseline (271 passed/272 total suites, 2766 passed/2768 total tests): the two
target assertions flip GREEN, and the two new guard test files add 2 more passing suites / 2 more
passing tests. Zero collateral change elsewhere.

### Tasks 4.1–4.2a — real-browser verification (Playwright, headless Chromium, driven via a
throwaway script — no Playwright MCP tool was available in this session; `npx playwright install
chromium` was used to fetch a matching browser build)

Dev server started via `scripts/concertino/start-servers.sh` on DEV_PORT 6446 / BACKEND_PORT 9353.
Logged in as `matt@helio.dev` and navigated to an existing dashboard with a panel.

**2.2.4 (post-fix), dark theme (app default):**
- `aria-label`: `"My chart panel actions"` (role=button, confirmed via accessibility attribute)
- bounding box: `{"x":734,"y":93,"width":24,"height":24}`
- Screenshots: `desktop-base-theme.png` (rest), `desktop-base-theme-hover.png` (hover outline
  visible), `desktop-base-theme-focus.png` (focus ring visible), `desktop-base-theme-menu-open.png`
  (menu opens with Rename/Customize/Duplicate/Delete)

**2.2.4, light theme** (toggled via `localStorage.setItem("helio-theme", "light")` + reload):
- Same button, same bounding box `{"x":734,"y":93,"width":24,"height":24}`
- Screenshot: `desktop-light.png`

**2.2.3 (before-baseline, installed via `npm install react-grid-layout@2.2.3 --no-save` on this
same rebased base, Vite dep cache cleared, dev server restarted):**
- Same button, IDENTICAL bounding box: `{"x":734,"y":93,"width":24,"height":24}`
- Screenshots: `rgl223-base.png`, `rgl223-hover.png`, `rgl223-focus.png`, `rgl223-menu-open.png` —
  pixel-identical position, hover treatment, and menu contents to the 2.2.4 captures.

**Verdict (D5): position, size, hover/focus treatment, and menu contents are IDENTICAL between
2.2.3 and 2.2.4 on the desktop branch, in both themes.** No visual regression introduced by the
version bump.

**Task 4.2a — lockfile-shape re-verification after the 2.2.3 detour:**

```
$ npm install react-grid-layout@2.2.4 --no-save
$ git diff frontend/package.json
(empty)
$ git diff frontend/package-lock.json
     "node_modules/react-grid-layout": {
-      "version": "2.2.3", ...
+      "version": "2.2.4", ...
```
Exactly the 3-line diff at 2.2.4, confirming the 2.2.3 install for the baseline left no residue.

### Task 4.3 — drag/resize verification (2.2.4, real browser)

Single-panel dashboard: resize worked (`{width:547,height:262}` ->
`{width:660,height:332}`); drag alone did not change position, consistent with RGL's compaction
having nowhere else to place a lone panel in that layout (not a regression — see multi-panel test
below for a definitive result).

Multi-panel dashboard (`HEL909-EVAL4-clobber`, 4 panels), dragging via the dedicated
`aria-label="Move ... panel"` handle (not the actions button):

```
before drag, item0 box: {"x":264,"y":343,"width":321,"height":262}
after drag, item0 box:  {"x":264,"y":623,"width":321,"height":262}
drag changed position: true
```

Screenshots `rgl224-multi-mid-drag.png` (dashed drop-target ghost visible, correct z-order over
the drag handle) and `rgl224-multi-post-drag.png` (panel settled at new position, "Unsaved
changes" / "Save now" banner appeared as expected) confirm drag-and-drop is unregressed under
2.2.4. No `pointer-events` or stacking issue observed.

### Task 4.4 — phone-width / HEL-1006 interaction check

Real browser at a 390x844 (phone) viewport, real login, real dashboard:

```
mobile-panel-stack present: 1
desktop panel-grid present: 0
panel-actions buttons at phone width: 0
```

Confirms `PanelGrid` still branches to `MobilePanelStack` at phone width under 2.2.4, and that (as
before this change, and as HEL-1006 already tracks) there is still no panel-actions host at phone
width. **No new interaction with HEL-1006 observed** — this fix does not touch, worsen, or
otherwise interact with that gap; the behavior is unchanged from pre-fix. Screenshot:
`phone-width.png`.

### HEL-1023 interaction check

The only overlap/breakpoint-relevant behavior exercised above is the multi-panel drag (task 4.3),
which showed normal RGL collision/placement behavior (drop-target ghost, panel settling into an
open slot) with no anomaly. **No HEL-1023 interaction observed** in this session's manual
verification; the fix does not touch `PanelGrid`'s breakpoint/overlap logic at all (confirmed:
`PanelGrid.tsx`, `PanelCard.tsx`, `ActionsMenu.tsx` are all byte-for-byte unmodified — see `git
diff --exit-code` above). No conclusion is drawn about HEL-1023 itself; it remains open and
untouched.

### Screenshots (all under this session's scratchpad, not committed to the repo)

`/tmp/claude-1000/-home-matt-Development-helio/ee73f684-1d91-4333-a409-bc3d96f8ee84/scratchpad/hel1014-shots/`:
`desktop-base-theme.png`, `desktop-base-theme-hover.png`, `desktop-base-theme-focus.png`,
`desktop-base-theme-menu-open.png`, `desktop-light.png`, `rgl223-base.png`, `rgl223-hover.png`,
`rgl223-focus.png`, `rgl223-menu-open.png`, `rgl223-nobutton.png` (unused), `rgl224-mid-drag.png`,
`rgl224-post-drag.png`, `rgl224-mid-resize.png`, `rgl224-post-resize.png`,
`rgl224-multi-mid-drag.png`, `rgl224-multi-post-drag.png`, `phone-width.png`.

## Standard verification gates

```
$ npm run lint
> eslint src --max-warnings=0
(clean, exit 0)

$ npm run format:check
Checking formatting...
All matched files use Prettier code style!

$ npm run typecheck
> tsc --noEmit
(clean, exit 0)

$ npm run build
✓ built in 336ms
(PWA precache generated; pre-existing >500kB chunk warning, unrelated to this change)

$ npx jest
Test Suites: 274 passed, 274 total
Tests:       2770 passed, 2770 total
```

## Blockers / notes

- No blockers. Real-browser verification used a throwaway local Playwright script (no Playwright
  MCP tool was available in this session) driving a headless Chromium fetched via `npx playwright
  install chromium`. This is a local dependency install outside the repo (`~/.cache/ms-playwright`,
  a scratchpad `node_modules`), not a change to the frontend's own dependencies.
- PR body should state: this does NOT block, and instead SUPERSEDES, Dependabot PR #481, which can
  be closed once this merges. The fix is harness-only (jest.setup.ts + 2 new guard test files) plus
  the lockfile bump; no product code changed.
