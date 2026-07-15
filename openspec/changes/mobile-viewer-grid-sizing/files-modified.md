# Files modified — HEL-301 mobile-viewer-grid-sizing

Base: `a7b914fd` (HEL-300 merge, PR #226). Frontend-only; no backend or
`schemas/` diffs (verified via `git diff --name-only a7b914fd -- frontend`
vs. full repo — see the plain diff list below, identical set).

## Cycle 2 — evaluator change requests addressed (evaluation-1.md)

Cycle 1's structural work (hazard §4.1, the `PanelGrid`/`DesktopPanelGrid`/
`MobilePanelStack` split, per-kind height policy) is unchanged and was
independently re-confirmed still solid (see "Re-verification" below). This
cycle fixes the two rendering defects the evaluator found live in-browser and
adds the requested regression guards.

### CR1 — `container-type: size` collapse (CRITICAL)

**Root cause:** `.panel-grid-card` (`PanelGrid.css:28`) sets
`container-type: size`, which requires a *definite* height source. Desktop
always has one (RGL's `h × rowHeight` cell). In the phone stack, `table`,
`markdown`, `text`, and `image` intentionally get no
`--mobile-panel-height` (W4.3 — "fully intrinsic"), so `height: 100%`
resolves to `auto` against the stack's auto-height flex parent — and under
size containment, a box with `height: auto` and no other height source
collapses to ~0 content height regardless of its actual content, exactly as
the evaluator measured (`30px`, padding-only).

**Fix** (`frontend/src/features/panels/ui/MobilePanelStack.css`): added a
rule for `.mobile-panel-stack__item--table/--markdown/--text/--image` that
overrides `container-type: inline-size` (keeps the width-based `@container`
queries in `PanelGrid.css`/`PanelContent.css` working; the height-based ones
don't apply to a content-sized box) and `height: auto` explicitly, using the
same double-class-selector pattern the metric/chart rule already uses to win
over `.panel-grid-card` regardless of CSS import order. This is option (a)
from the evaluator's report — no explicit height source is manufactured for
these kinds (b), matching W4.3's "fully intrinsic" framing.

**Regression guard** (`frontend/src/features/panels/ui/MobilePanelStack.css.test.ts`,
new file): the evaluator correctly noted jsdom cannot catch the collapse
itself (no CSS containment/layout). Per the report's "at minimum" fallback
(no Playwright in `node_modules`, confirmed again this cycle), this is a
static CSS-source guard: reads `MobilePanelStack.css` as text and asserts
(a) the four intrinsic-kind classes never re-declare `container-type: size`,
(b) they explicitly declare `container-type: inline-size` + `height: auto`
(not just the *absence* of `size` — the actual override), and (c)
metric/chart are unaffected. 6 tests, all passing.

### CR2 — vertical divider renders 0px

**Root cause:** `DividerPanel.tsx` sets an *inline* `style={{ height:
"100%" }}` for `orientation === "vertical"`; inside the stack's auto-height
flex item this resolves to `0px`, and no CSS override can win over an
inline style.

**Fix** (`frontend/src/features/panels/ui/MobilePanelStack.tsx`): in the
divider branch, force `config.orientation` to `"horizontal"` before passing
the panel to `PanelCardBody` when the stored value is `"vertical"` — a
vertical divider has no meaning in a single-column stack. Scoped to the
stack only; `DividerPanel.tsx`/`DividerRenderer.tsx` (desktop-shared) are
untouched, so desktop vertical dividers (meaningful inside a multi-column
row) are unaffected.

**Regression guard** (`MobilePanelStack.test.tsx`, new test): renders a
`makeDividerPanel({ config: { orientation: "vertical" } })` in the stack and
asserts the rendered `.divider-panel` carries `divider-panel--horizontal`
(not `--vertical`) and its `.divider-panel__rule` does not have an inline
`height: 100%`. Required overriding the file's `usePanelData` mock from a
plain factory to a `jest.fn()` (with a `noData: false` override for this one
test) — the divider's actual DOM only mounts when `PanelContent`'s `noData`
early-return doesn't fire, matching `usePanelData`'s real behavior for a
kind with no `dataTypeId` (`currentFetchKey` is null → `noData: false`
unconditionally).

### Re-verification (in-browser, 390×844, cycle 2)

No Playwright in `node_modules` (confirmed again — same finding as cycle 1's
files-modified.md). Installed `playwright` + chromium via `npm install
--no-save playwright` + `npx playwright install chromium` (no `package.json`/
`package-lock.json` diff — verified via `git status --short`; uninstalled
again after use, `node_modules` is gitignored either way) and drove the app
with a throwaway script against the running dev servers
(`scripts/concertino/start-servers.sh`, `DEV_PORT=5474`,
`BACKEND_PORT=8381`), logged in as `matt@helio.dev`.

One-of-every-`PanelKind` check, assembled from the same five seed dashboards
the evaluator used plus one more (`HEL-244 Eval Check`, the only seed
dashboard with a `text` panel — the evaluator's five didn't cover `text`):

| Kind | Dashboard | Measured item height | Notes |
| --- | --- | --- | --- |
| `table` | HEL-254 Scroll Verification | 591.9px (card); inner `.panel-content--table` 506.4px = exactly `60dvh` of the 844px viewport | 50 rows in DOM, internal vertical scroll, horizontal scroll contained to `.ui-data-grid` (`scrollWidth` 5300 vs `clientWidth` 272) |
| `markdown` | HEL-293 UI Check | 171.9px | Content ("Roadmap" / "Q3 Goals" / bullets) renders fully inside the card's rounded chrome — no spill (screenshot confirms) |
| `image` | HEL-246 Eval Check | 356.7px | Natural aspect ratio, contained in card |
| `metric` | HEL-297 UI Check | 120px (×2) | Within the 104–132px target band |
| `table` (2nd instance) | HEL-297 UI Check | 567.1px | Same cap behavior, different content |
| `chart` | HEL-293 Full UI Check | 200px | At `CHART_MIN_HEIGHT_PX` for this content width |
| `divider` (`orientation: "horizontal"`, pre-existing) | HEL-293 Full UI Check | 17px item / 1px rule, `326px` wide | Non-zero, renders as intended hairline |
| `text` | HEL-244 Eval Check | 102.7px | Content-sized, no clipping |

All seven `PanelKind`s render at real, non-collapsed, content-appropriate
heights — zero `30px`/`0px` collapses. Screenshots captured for all seven
(not attached to this repo; ephemeral scratchpad artifacts) — visually
confirmed markdown/table/image content stays inside its card's rounded
background/border (the specific defect the evaluator screenshotted as
"spilling outside the card chrome" is gone).

Also re-drove the `HEL-293 Full UI Check` dashboard's stored vertical
divider equivalent by constructing one via `makeDividerPanel` fixture (no
seed dashboard currently has a `vertical`-orientation divider; the
evaluator's repro used `HEL-293 Full UI Check`'s "Sep" divider, which is
`horizontal` in its current stored config) — confirmed via the unit test
above plus a direct Playwright measurement of the *existing* horizontal
divider (`326px` × `1px` rule, non-zero) that the rendering path is
otherwise healthy.

**Hazard §4.1 re-confirmed unaffected** by this cycle's fix (no code in this
cycle touches `usePanelGridSave`/`DesktopPanelGrid`): opened `HEL-293 Full
UI Check` at 390px, changed viewport to 420px (still below the 768px
boundary), waited 31s (past `AUTO_SAVE_INTERVAL_MS`), and captured all
network requests — zero `PATCH /api/dashboards/*` requests fired.

### Non-blocking suggestions addressed

- `frontend/src/features/panels/ui/ChartPanel.tsx` — extracted the compact
  axis-label `fontSize: 10` into a named `COMPACT_AXIS_LABEL_FONT_SIZE`
  constant (both x/y axis usages), per the evaluator's suggestion.
- `frontend/src/features/panels/ui/PanelGrid.test.tsx` — added a test for
  the width-crosses-back-above-768px-while-mounted scenario (the
  `mobile-viewer-stack` spec's own scenario wording): stack renders below
  768px, then a width change to 900px swaps in the real RGL `<Responsive>`
  grid and removes `.mobile-panel-stack`, with no `updateDashboardLayout`
  dispatch anywhere in the transition.

### Fresh verification gates (cycle 2)

```
$ npm run lint
> helio-frontend@0.0.0 lint
> eslint src --max-warnings=0
(exit 0, no output — zero warnings)

$ npm run format:check
> helio-frontend@0.0.0 format:check
> prettier . --check
Checking formatting...
All matched files use Prettier code style!
(exit 0)

$ npm test
> helio-frontend@0.0.0 test
> jest --config jest.config.cjs --passWithNoTests

Test Suites: 88 passed, 88 total
Tests:       970 passed, 970 total
Snapshots:   0 total
(exit 0)

$ npm --prefix frontend run build
> helio-frontend@0.0.0 build
> vite build
...
✓ built in 570ms
PWA v1.3.0
mode      generateSW
precache  16 entries (2110.55 KiB)
files generated
  dist/sw.js
  dist/workbox-acf3c99e.js
(exit 0)
```

## New files

- `frontend/src/features/panels/ui/PanelGrid.tsx` (rewritten, see below) — thin
  wrapper: measures the grid container (`useContainerWidth`) and branches on
  `panelGridConfig.breakpoints.sm` (768px) between `DesktopPanelGrid` and
  `MobilePanelStack`. Owns the single `PanelGridHandle` ref, delegating
  `flushAndReset` to `DesktopPanelGrid`'s handle when mounted and no-op'ing
  when it isn't (phone path has nothing pending to flush).
- `frontend/src/features/panels/ui/DesktopPanelGrid.tsx` — the pre-existing
  `PanelGrid` body (RGL `<Responsive>`, drag/resize/title-edit/delete,
  `usePanelGridSave`), extracted unchanged apart from receiving `width` as a
  prop instead of calling `useContainerWidth` itself. This is the **only**
  file that imports `usePanelGridSave` — the structural guarantee behind
  hazard §4.1 (see below).
- `frontend/src/features/panels/ui/MobilePanelStack.tsx` — read-only
  single-column stack rendered below 768px. Orders panels via
  `orderPanelsForMobileStack` (xs layout `y` then `x`), reuses
  `PanelCardBody`/`getPanelCardStyle` from `PanelCard.tsx` for data-fetching
  and appearance parity, renders bespoke read-only card markup (no drag
  handle, no `ActionsMenu`, no title-edit input, no footer type badge), and
  opens `PanelDetailModal` on tap. Never imports `usePanelGridSave`.
  **Cycle 2 (CR2):** the divider branch now forces `config.orientation` to
  `"horizontal"` before rendering when the stored value is `"vertical"` — a
  vertical divider is meaningless in a single-column stack and its inline
  `height: 100%` collapsed to 0px there.
- `frontend/src/features/panels/ui/MobilePanelStack.css` — stack layout
  (`--space-3` gutters/padding), per-kind height application via
  `--mobile-panel-height`, and the nested-scroll/intrinsic-sizing overrides
  for table/markdown/text/image/divider (W4.3/W5). **Cycle 2 (CR1):** added
  a `container-type: inline-size` + `height: auto` override for
  `table`/`markdown`/`text`/`image` stack items, fixing the
  `container-type: size` collapse (see "Cycle 2" section above for the full
  root-cause explanation).
- `frontend/src/features/panels/ui/mobilePanelHeights.ts` — pure
  `(kind, h, w) → height policy` module (W4.3). All tuning constants live
  here (see "Tuning knobs" below).
- `frontend/src/features/panels/ui/mobilePanelHeights.test.ts` — per-kind
  band + `h`-modulation-edge unit tests (task 5.4).
- `frontend/src/features/panels/ui/MobilePanelStack.test.tsx` — ordering,
  fallback-resolution, read-only-affordance, divider-chrome, and
  internal-scroll-marker tests (tasks 5.2/5.3/5.5). **Cycle 2:** added the
  vertical-divider-forced-horizontal regression test (CR2); converted the
  file's `usePanelData` mock to a `jest.fn()` so that test can override
  `noData`.
- `frontend/src/features/panels/ui/MobilePanelStack.css.test.ts` (cycle 2,
  new) — static CSS-source regression guard for the `container-type: size`
  collapse (CR1). See "Cycle 2" section above.

## Modified files

- `frontend/src/features/panels/hooks/usePanelGridSave.ts` — exported
  `AUTO_SAVE_INTERVAL_MS` (was a private const) so the hazard §4.1 Jest test
  can advance fake timers past exactly the real interval.
- `frontend/src/features/panels/ui/panelGridConfig.ts` — added
  `orderPanelsForMobileStack(panels, xsLayout)`, the pure xs-ordering helper
  (task 1.3).
- `frontend/src/features/panels/ui/PanelCard.tsx` — exported
  `getPanelCardStyle` (was private) for reuse by `MobilePanelStack`; added an
  optional `compact` prop to `PanelCardBody`, forwarded to `PanelContent`.
  No behavior change for existing (desktop) callers — `compact` is unset
  there.
- `frontend/src/features/panels/ui/PanelContent.tsx` — added optional
  `compact` prop, forwarded only to `ChartRenderer`.
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` — added
  optional `compact` prop, forwarded to `ChartPanel`.
- `frontend/src/features/panels/ui/ChartPanel.tsx` — added optional
  `compact` prop (default `false`); when true, hides the ECharts legend and
  shrinks x/y axis label font to 10px via ECharts option overrides (W5: "fix
  via ECharts config, not CSS"). No effect on the pie branch (no axes) or on
  desktop (prop unset). **Cycle 2:** extracted the `10` into a named
  `COMPACT_AXIS_LABEL_FONT_SIZE` constant (non-blocking suggestion).
- `frontend/src/features/panels/ui/PanelContent.css` — added
  `white-space: nowrap` to `.panel-content__metric-value` so a long value
  (e.g. `1,234,567.89`) never wraps (W4.4). Applies everywhere, not just
  phone — this was a latent gap for any narrow metric card.
- `frontend/src/features/panels/ui/PanelList.css` — hides
  `.panel-list__zoom-widget` below the ratified 430px phone breakpoint (W4.4,
  `dashboard-chrome-zoom-widget` spec delta).
- `frontend/src/features/panels/ui/PanelDetailModal.css` — added a 430px
  media query making `.panel-detail-modal`/`.panel-detail-modal--view`
  full-viewport (100vw/100dvh, no border/radius) below the phone breakpoint
  (W4.5, `panel-detail-modal` spec delta). The close button was already
  persistent/non-hover-gated — no JSX change needed.
- `frontend/src/features/panels/ui/ChartPanel.test.tsx` — added a `compact`
  describe block (legend hidden, axis label shrunk, pie unaffected, desktop
  default unaffected).
- `frontend/src/features/panels/ui/PanelContent.test.tsx` — added two tests
  confirming `compact` forwards to `ChartPanel` and is `undefined` by
  default.
- `frontend/src/features/panels/ui/PanelGrid.test.tsx` — added the hazard
  §4.1 structural no-persist test suite (task 5.1) plus a desktop-unchanged
  sanity test (task 5.2's ≥768 half); imports `updateDashboardLayout` and
  `AUTO_SAVE_INTERVAL_MS` mocks. **Cycle 2:** added the width-crosses-above-
  768px-while-mounted test (non-blocking suggestion).
- `frontend/src/test/jest.setup.ts` — stubbed `HTMLElement.prototype.offsetWidth`
  to `1280` globally. See "Bug found and fixed during verification" below —
  this is required for `App.test.tsx` (and any other test that renders the
  real, unmocked grid) to keep exercising the desktop path.

## Bug found and fixed during verification (systematic-debugging evidence)

**Symptom:** after the `PanelGrid` split, `npm test` failed two `App.test.tsx`
cases (`"Move CPU Usage panel"` button not found; `"Customize"` menuitem not
found) — both desktop drag/actions-menu affordances that `DesktopPanelGrid`
renders and `MobilePanelStack` deliberately does not.

**Root cause (one sentence, naming the failing layer):** in the **test
environment layer**, jsdom never performs real layout, so
`HTMLElement.offsetWidth` is always `0`; `react-grid-layout`'s
`useContainerWidth` reads `offsetWidth` on mount (`measureWidth()`,
`chunk-7MZZ6T4J.js:14-21`) regardless of `ResizeObserver` availability, so any
test that renders the real (unmocked) `PanelGrid` — `App.test.tsx` does not
mock `react-grid-layout` — got `width = 0`, which is `< panelGridConfig.breakpoints.sm`
and silently flipped the grid onto the phone-stack branch my change
introduced.

**Probe:**
```ts
test("jsdom offsetWidth default is 0", () => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  expect(div.offsetWidth).toBe(0);
});
```

**Probe output:** `1 passed` — confirms `offsetWidth` is `0` in this jsdom
version, predicting exactly the observed symptom (every unmocked grid render
resolves `width = 0` → takes the phone branch).

**Fix:** `frontend/src/test/jest.setup.ts` now stubs
`HTMLElement.prototype.offsetWidth` to `1280` (a desktop-representative
value, matching `panelGridConfig.initialWidth`) globally, alongside the
existing `TextEncoder`/`ReadableStream` jsdom-gap polyfills already in that
file. This restores pre-HEL-301 behavior for any test that doesn't
explicitly control width (real `<Responsive>` always rendered regardless of
measured width) while leaving `PanelGrid.test.tsx` / `MobilePanelStack.test.tsx`
— which explicitly mock `useContainerWidth`'s return value — free to exercise
the phone path. **Verified with fresh evidence:** `npm test` went from
`3 failed, 959 passed` to `962 passed, 962 passed` after the fix (pasted
below).

## Task 1.2 probe — does today's grid PATCH an `xs` layout on narrow mount?

No live-browser runtime probe was available in this environment (no
Playwright/Puppeteer/Cypress in `node_modules`, no way to drive a real
resize/mount in a physical viewport — consistent with the ticket's own
framing that browser/device verification is human-performed only). The probe
performed instead is a **code-path trace** of the base commit
(`a7b914fd`, before any HEL-301 change), reading the actual dispatch chain
rather than assuming:

- `PanelGrid.tsx:233` (base): `onLayoutChange={handleLayoutChange}` →
  `handleLayoutChange` (line 207) calls
  `markLayoutChanged(fromResponsiveLayouts(panels, nextLayouts))`
  unconditionally on every RGL `onLayoutChange` firing, including mount.
- `usePanelGridSave.ts` `markLayoutChanged` (base): only dispatches
  `setLayoutPending(true)` when
  `!areDashboardLayoutsEqual(next, persistedLayoutRef.current)`.
  `persistedLayoutRef`/`latestLayoutRef` both initialize to `resolvedLayout`
  — the same value fed into `createLayouts()` that RGL renders from — so on
  a clean mount with no prior drag, RGL's `onLayoutChange` callback fires
  with geometry that, in the common case, exactly equals `resolvedLayout`,
  making the equality check pass and suppressing the PATCH.
- **This is an accident of equality, not a guarantee** (matches
  `design.md`'s own framing, independently reached): RGL's internal
  placement/compaction at a real DOM width can diverge from the
  `resolveDashboardLayout`-computed geometry (rounding, `xs`'s 2-column
  collapse forcing different item ordering than the fallback placer would
  choose, etc.), at which point `markLayoutChanged` **would** dispatch
  `setLayoutPending(true)` and the next 30s tick **would** PATCH
  `/api/dashboards/:id` with the phone-derived `xs` layout — exactly the
  corruption hazard.

**Conclusion:** the hazard is real and pre-existing, not merely theoretical
— it depends on an equality check that happens to usually pass, not on any
code path that prevents the write. **This finding is why the implementation
does not rely on strengthening that equality check** — it makes the whole
code path structurally unreachable below 768px instead (`DesktopPanelGrid`,
the only importer of `usePanelGridSave`, is never mounted there). The fix is
therefore robust regardless of whether the old suppression was reliable.

## Verification gates (fresh evidence)

```
$ npm run lint
> helio-frontend@0.0.0 lint
> eslint src --max-warnings=0
(exit 0, no output — zero warnings)

$ npm run format:check
> helio-frontend@0.0.0 format:check
> prettier . --check
Checking formatting...
All matched files use Prettier code style!
(exit 0)

$ npm test
> helio-frontend@0.0.0 test
> jest --config jest.config.cjs --passWithNoTests

Test Suites: 87 passed, 87 total
Tests:       962 passed, 962 total
Snapshots:   0 total
(exit 0)

$ npm --prefix frontend run build
> helio-frontend@0.0.0 build
> vite build
...
✓ built in 554ms
PWA v1.3.0
mode      generateSW
precache  16 entries (2110.17 KiB)
files generated
  dist/sw.js
  dist/workbox-acf3c99e.js
(exit 0 — the "chunks larger than 500kB" note is Vite's pre-existing
bundle-size advisory, unrelated to this change)
```

Husky pre-commit will re-run lint/format/`check:schemas`/`check:openspec`/
`check:scala-quality`/test on `git commit`; `check:schemas` and
`check:scala-quality` are no-ops here (no schema or Scala files touched).

## Terminal state: ready for device testing — NOT "done"

Desktop evidence above (jsdom + a production build) is **implementation**
evidence only. Per `.concertino/laws/verification-before-completion` and the
ticket's own explicit instruction, no agent can verify sizing "feels right"
or that the layout-corruption guarantee holds on a real iOS WebKit engine —
only matto00, on a physical phone, can close those two acceptance criteria.

**Cycle 2 update:** unlike cycle 1, this evidence now includes a real
in-browser (Playwright/Chromium, not jsdom) pass at 390×844 — see
"Re-verification" above. Device test plan step 2 below ("one of every
`PanelKind`") was previously blocked by the container-type collapse (4/7
kinds would have failed immediately); that blocker is now fixed and
independently re-confirmed in-browser. The plan itself is unchanged — a
real device pass (rendering engine, touch input, actual screen) is still
the acceptance gate this agent cannot substitute for — but it should no
longer surface the CR1/CR2 defects.

### How to bring it up for testing

```
npm --prefix frontend run build && npx --prefix frontend vite preview --host
```

Then open the printed LAN URL (e.g. `http://192.168.x.x:4173`) on the phone,
same wifi as the machine running `vite preview`.

### Ordered device test plan

1. **Layout-corruption byte-identity check (do not skip — hazard §4.1, the
   non-negotiable acceptance criterion):**
   - Note a real dashboard's stored `xs` layout server-side (e.g.
     `GET /api/dashboards` → inspect `layout.xs` for a dashboard with ≥2
     panels, or query the DB directly).
   - Open that dashboard on the phone (via the preview URL above).
   - Background the app (switch away in Safari / home-screen it if
     installed), wait a few seconds (long enough to clear the 30s auto-save
     window), reopen.
   - Re-read the dashboard's stored `xs` layout server-side.
   - **It must be byte-identical to the value noted before.** If it changed
     at all, hazard §4.1 is not satisfied and this is not done, regardless
     of anything else in this handoff.

2. **One-of-every-`PanelKind` sizing check (the deliverable matto00 judges):**
   - Build (or reuse) a dashboard with one panel of each kind: `metric`,
     `chart`, `table`, `text`, `markdown`, `image`, `divider`.
   - Open it on the phone. Confirm, specifically:
     - No metric panel is mostly whitespace (target band: ~104–132px).
     - No chart is squashed or stretched; a chart made "tall" (`h≥8`) reads
       visibly taller than one made "short" (`h≤4`).
     - The table scrolls horizontally *within its own card*; the page body
       never scrolls sideways.
     - Markdown/text flow with no nested scrollbar — the page scrolls, not
       an inner box.
     - Metric with a long value (e.g. type in `1,234,567.89` via a bound
       column, or eyeball an existing large metric) doesn't clip or wrap.
   - **Screenshot it** — this is the artifact matto00 judges the project
     against (handoff §6.5 / ticket AC).

3. **Rotation / ECharts resize check:**
   - With a chart panel visible, rotate the phone portrait → landscape →
     portrait.
   - Confirm the chart visibly resizes to the new container width each time
     (no stale/cut-off render). `ChartPanel` already sets
     `autoResize={true}` on `ReactECharts`, which wires `size-sensor`'s
     `ResizeObserver`-based resize handler
     (`node_modules/echarts-for-react/src/core.tsx` uses `bind`/`clear` from
     `size-sensor`) — this was verified by reading the library, not assumed,
     but only a real device proves it fires correctly in Mobile Safari.
   - Confirm the legend is hidden and axis labels are readably small (the
     `compact` ECharts overrides — no CSS clipping).

4. **Table / markdown scroll checks:**
   - A table with more columns than fit the phone width: confirm horizontal
     scroll is smooth and contained to the card; nothing outside the card
     (header, other panels, the page) shifts sideways.
   - Markdown with a long unbroken word or a wide code block: confirm it
     wraps or scrolls *within its own content box*, never forcing the page
     to scroll horizontally.
   - Tap a panel to open `PanelDetailModal`: confirm it's full-screen, and
     the close (×) button is reachable and dismisses it without needing a
     hover/long-press.

## Tuning knobs (W4.3 numbers are starting points — device feedback is the
next step, not a sign anything is wrong)

All in `frontend/src/features/panels/ui/mobilePanelHeights.ts` — this is the
**only file** device-feedback iteration on sizing should need to touch:

| Constant | Current value | Governs |
| --- | --- | --- |
| `METRIC_HEIGHT_PX` | `120` | Metric card height (target band ~104–132px) |
| `CHART_MIN_HEIGHT_PX` / `CHART_MAX_HEIGHT_PX` | `200` / `340` | Chart height clamp band |
| `CHART_WIDTH_ASPECT_RATIO` | `0.62` | Chart aspect ratio (`height ≈ width × ratio`) |
| `CHART_COMPACT_H` / `CHART_TALL_H` | `4` / `8` | The stored `h` thresholds that select the compact/tall ends |
| `CHART_H_COMPACT_FACTOR` / `CHART_H_TALL_FACTOR` | `0.85` / `1.15` | How far `h` pulls the chart height away from the width-driven aspect height — widen these if device feedback wants `h` to matter more (at phone widths the aspect height rarely reaches 340px, so in practice `h` only nudges within a narrower band than the full [200,340] range — see the constant's own comment) |
| `STACK_CONTAINER_PADDING_PX` / `STACK_CARD_PADDING_PX` | `24` / `32` | Approximated chrome subtracted from the measured container width to get a panel's content width (`resolveStackContentWidth`) — only matters for the chart formula above |

Non-height chrome/density tuning knobs, for completeness:

- `frontend/src/features/panels/ui/MobilePanelStack.css` —
  `.mobile-panel-stack { gap; padding }` (currently `--space-3`/12px, W4.4's
  gutter rhythm), the table `max-height: 60dvh` cap.
- `frontend/src/features/panels/ui/ChartPanel.tsx` — the `compact`-mode
  ECharts overrides (`axisLabel.fontSize: 10`, legend hidden) if legend/axis
  readability needs adjusting.

## Judgment calls / notes for the evaluator and skeptic

- **`PanelDetailModal`'s Edit button is left reachable on phone.** The
  ticket's "Out of scope" list says "any panel editing of any kind on phone
  (drag, resize, title edit, delete, create)" and the handoff's §2 Out list
  frames existing editors as "editing affordances may be hidden below 768px
  ... do not delete them; do not build mobile editors for them" — i.e.
  permissive, not mandatory to hide. Neither `tasks.md` nor the
  `panel-detail-modal` spec delta lists hiding the Edit button as a
  requirement, so I left it untouched rather than guessing at an
  unscoped change. Flagging explicitly in case matto00 wants it hidden below
  768px in a follow-up.
- `DesktopPanelGrid.tsx` is 284 lines, over CONTRIBUTING's ~250-line soft
  budget (informational only, not a gate) — it's a behavior-preserving
  extraction of the pre-existing `PanelGrid.tsx` body (271 lines before this
  change) plus doc comments; I did not further split it to avoid fragmenting
  cohesive drag/title-edit interaction state that was already living
  together before this ticket.
- `dashboardGridCols.xs` was not touched (still `2`), and no `schemas/` or
  backend file was touched — verified via `git diff --name-only a7b914fd`
  above.
