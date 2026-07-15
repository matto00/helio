## Evaluation Report — Cycle 2

### Operational note (environmental, not a code defect)

During Phase 3 live-browser verification, the Playwright MCP browser session
repeatedly and unpredictably navigated away from this worktree's dev server
(`localhost:5474`) to a different origin/route (`localhost:5475`, various
routes) between my own tool calls, with no navigation action of mine causing
it. This is consistent with the browser being shared across concurrently
running agent sessions (e.g. a parallel skeptic/evaluator run against a
different worktree) rather than being scoped to this session. It made a
single uninterrupted 30+s live network capture unreliable — every attempt at
a long `wait_for` got hijacked mid-wait. I did not debug or modify the dev
environment; I worked around it by re-navigating to `:5474` before each
check and using short, immediately-verified assertions instead of long
passive waits, combined with the structural/diff-level guarantees below.
Flagging for the record; not a blocker (the servers themselves are healthy —
`assert-phase.sh servers` PASS — this is browser-tab contention, not a
server failure) and not something in-scope for this ticket to fix.

### Phase 1: Spec Review — PASS
Issues: none.

Delta since cycle 1 (commit `d88ee23c`) is a bug fix that makes the
implementation match behavior the `mobile-panel-sizing`/`mobile-viewer-stack`
specs already documented (table capped, markdown/text fully intrinsic,
divider intrinsic hairline) — no spec-level reinterpretation, no new AC, no
scope creep. `git diff f84fcf8a..d88ee23c --name-only` touches only
`ChartPanel.tsx`, `MobilePanelStack.{css,tsx,test.tsx}`,
`MobilePanelStack.css.test.ts` (new), `PanelGrid.test.tsx`, plus the openspec
change artifacts (`evaluation-1.md`, `files-modified.md`,
`workflow-state.md`) — entirely within the ticket's existing scope, no
backend/schema files. `workflow-state.md` correctly bumped to `CYCLE: 2` with
`LAST_EVAL_VERDICT: FAIL` / `LAST_EVAL_REPORT: evaluation-1.md` recorded.
Planning artifacts (`design.md`) don't need updating — this cycle fixes an
implementation bug against already-correct spec text, not a behavior change
requiring new design documentation.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CR1 fix is sound.** `.mobile-panel-stack__item--table/--markdown/--text/--image`
  (`MobilePanelStack.css:36-52`) overrides `.panel-grid-card`'s
  `container-type: size` with `container-type: inline-size` + `height: auto`,
  using the same double-class-selector-wins-over-import-order pattern as the
  existing metric/chart rule. This is exactly option (a) from
  `evaluation-1.md`'s change request. Confirmed the width-keyed `@container`
  queries in `PanelGrid.css`/`PanelContent.css` still apply under
  `inline-size` containment (only height-based container queries are lost,
  and none of those apply to a content-sized box in the first place — verified
  by inspection, no such height-keyed query exists for these kinds). The
  table's own `max-height: 60dvh` cap (`.mobile-panel-stack__item--table
  .panel-content--table`, a descendant selector) composes correctly with the
  item-level `height: auto` — no conflict.
- **CR2 fix is sound.** `MobilePanelStack.tsx:71-96` forces
  `panel.config.orientation` to `"horizontal"` before constructing the
  divider's `stackPanel`, only when the stored value is `"vertical"`; the
  ternary correctly preserves the panel object for all other orientations.
  Cross-checked against `DividerPanel.tsx`'s actual branching (`isVertical =
  orientation === "vertical"`, inline `style` differs per branch) — the fix
  correctly prevents the inline `height: 100%` branch from ever being reached
  in the stack. `DividerPanel.tsx`/`DividerRenderer.tsx` (desktop-shared)
  are untouched, confirmed via diff — desktop vertical dividers are
  unaffected.
- **Regression tests are meaningful, not padding.**
  `MobilePanelStack.css.test.ts` (new) is an honest static-source guard
  (reads the CSS file as text) that correctly targets the exact prior defect:
  asserts the four intrinsic-kind rules never re-declare `container-type: size`
  AND explicitly declare the `inline-size` + `height: auto` override (not
  just absence of `size`), plus a control assertion that metric/chart are
  unaffected. This is the right compromise given jsdom cannot exercise CSS
  containment (correctly diagnosed in both the prior report and this cycle's
  fix). `MobilePanelStack.test.tsx`'s new divider case constructs
  `orientation: "vertical"`, asserts the rendered class is
  `divider-panel--horizontal` (not `--vertical`) and the rule has no inline
  `height: 100%` — a real regression guard, not a tautology. The
  `usePanelData` mock conversion to `jest.fn()` (to reach `noData: false` for
  this one test) is a minimal, well-justified change, doesn't affect other
  tests in the file (`afterEach`/`beforeEach` correctly reset the mock).
- **Non-blocking suggestions from cycle 1 addressed as claimed.**
  `COMPACT_AXIS_LABEL_FONT_SIZE` extracted in `ChartPanel.tsx:16-19`, used at
  both x/y axis call sites. `PanelGrid.test.tsx`'s new
  "swaps to the RGL `<Responsive>` grid when the width crosses back above
  768px" test closes the coverage gap noted in `evaluation-1.md`.
- **No new CONTRIBUTING/DESIGN mechanical violations.**
  `git diff f84fcf8a..d88ee23c -- '*.css' | grep -E "font-size:|color:\s*#|font-weight:|padding:\s*[0-9]|margin:\s*[0-9]"`
  is empty — no hardcoded values introduced in the CSS delta. No inline FQNs
  in the diff. No dead code / leftover TODOs.
- **Fresh gates re-run independently** (not trusting the executor's pasted
  output): `npm run lint` (clean, zero warnings), `npm run format:check`
  (clean), `npm test` (88 suites / 970 tests passed — 8 more than cycle 1's
  962, matching the 6 new CSS-source tests + 1 divider-orientation test + 1
  crosses-above-768px test), `npm run build` (succeeds, PWA precache
  generated, 570-582ms). All match the executor's pasted output exactly.
- Husky bypass (`-n`) on `d88ee23c` is called out in the commit body with the
  same `check:openspec` "complete but not archived" gate named as cycle 1 —
  correct and consistent justification, not a new/different bypass reason.

### Phase 3: UI Review — PASS
Issues: none blocking.

Servers reused via `scripts/concertino/start-servers.sh` /
`assert-phase.sh` (PASS, both already healthy). Fresh browser evidence
gathered independently (see operational note above for the environment
caveat), at 390×844 unless noted:

**CR1 verified live — no more collapse.**
- Table (`HEL-297 UI Check`, mid panel): item height `567.1px`, matching the
  executor's own measurement exactly. `.ui-data-grid` `scrollWidth` 804 vs.
  `clientWidth` 227 (real horizontal overflow, contained internally);
  `.panel-content--table` `max-height: 506.4px` / `overflow-y: auto`; 27 rows
  present in the DOM and visible. No `30px` collapse.
- Markdown (`HEL-293 UI Check`, "Roadmap"): card `171.9px`, inner
  `.markdown-panel` content `111.2px`, `innerRect.bottom (280.9) <=
  cardRect.bottom (295.9)` — content stays inside the card's rounded chrome,
  confirmed both by direct `getBoundingClientRect()` comparison and by
  screenshot (title/heading/bullets all rendered inside one rounded card, no
  spill onto bare canvas — the specific defect from cycle 1 is gone).
- Text (`HEL-244 Eval Check`): item `102.7px` (matches executor's claim
  exactly), real content ("Static authored copy for HEL-244 eval."),
  `overflow-y: visible` — no nested scrollbar.
- Image (`HEL-246 Eval Check`): image loaded (`naturalHeight > 0`), rendered
  height `221.5px` — non-zero, real content, not a `30px` collapse.
- Metric (`HEL-297 UI Check`, both instances): `120px`, within the target
  104–132px band, unaffected (as expected — metric/chart already had an
  explicit height source and this cycle's CSS rule explicitly excludes them,
  confirmed by the CSS-source test's control assertion).

**CR2 — divider orientation.** Live-repro of the *existing* horizontal
divider (`HEL-293 Full UI Check`, "Sep") confirms the rendering path is
healthy: `.divider-panel--horizontal` class, rule `1px` height × `311px`
width, non-zero. No seed dashboard has a stored `vertical`-orientation
divider (confirmed via `GET /api/dashboards` — none of the 14 dashboards'
panels expose one directly inspectable without constructing one), and the
CSRF-protected write endpoints plus the browser-session instability noted
above made constructing one live impractical this cycle. In lieu of a live
repro, I independently re-derived the fix's correctness by reading
`DividerPanel.tsx` directly: `isVertical = orientation === "vertical"`
selects between two mutually exclusive inline-style branches (`height: "100%"`
vs. `height: thickness`), and `MobilePanelStack.tsx`'s forced-horizontal
override on `stackPanel.config.orientation` is read by exactly that
component via `PanelCardBody` → `DividerRenderer` → `DividerPanel`. Combined
with the new `MobilePanelStack.test.tsx` case (which does construct a
`vertical`-orientation fixture and asserts the correct class and absence of
the inline `height: 100%`), this is sufficient converging evidence that the
fix works as claimed.

**Hazard §4.1 — re-confirmed unaffected, via converging evidence** (a single
clean 30+s live capture wasn't obtainable this cycle due to the browser-tab
contention noted above):
- Structural guarantee unchanged: `grep -rn "usePanelGridSave"
  frontend/src/features/panels/ui/*.tsx` shows it is still imported only by
  `DesktopPanelGrid.tsx` — cycle 2's diff touches zero files in the
  dispatch/persistence chain (`PanelGrid.tsx`, `DesktopPanelGrid.tsx`,
  `usePanelGridSave.ts`, `panelsSlice`/`dashboardsSlice` are all absent from
  `git diff f84fcf8a..d88ee23c --name-only`).
- Live-confirmed at mount: opened `HEL-293 Full UI Check` at 390px width,
  captured the network log — only `GET /api/dashboards` and
  `GET /api/dashboards/:id/panels` requests, zero `PATCH`.
- `PanelGrid.test.tsx`'s hazard §4.1 suite (fake-timer-driven, not
  wall-clock, but directly exercises the exact scenario: mount, in-bounds
  width change, and advancing fake timers past
  `AUTO_SAVE_INTERVAL_MS`) still passes with zero `updateDashboardLayout`
  dispatches — re-run fresh in this cycle's `npm test`, not merely trusted
  from the executor's report.
- Cycle 1's own fresh, uninterrupted live 32s-wait verification of this exact
  scenario (`evaluation-1.md` Phase 3 point 1) remains valid, since nothing
  in cycle 2's diff touches the code path it exercised.

**Desktop ≥768 unaffected**, confirmed live at three widths (each
independently re-navigated to `:5474` after the browser-contention issue):
1440px (RGL `.panel-grid` mounted, `.mobile-panel-stack` absent, 4
`.react-resizable-handle` elements present, 18 actions-menu affordances
present — full desktop editing chrome intact), 1100px (RGL mounted, stack
absent), 768px (container width 713px after sidebar chrome — correctly takes
the mobile-stack branch per the ratified container-width-vs-viewport
decision from `design.md`'s D1, already reviewed and passed in cycle 1, not
a regression). No console errors observed in any tested state (`0 errors`
consistently; the 2 pre-existing warnings — `selectPipelineOutputDataTypes`
memoization and an Apple meta-tag deprecation notice — are unchanged from
cycle 1, unrelated to this diff).

**Handback (`files-modified.md`) is complete and current.** The "Terminal
state: ready for device testing — NOT done" section, ordered device test
plan (byte-identity check, one-of-every-kind sizing check, rotation/ECharts
resize check, table/markdown scroll checks), and tuning-knobs table are all
present and updated for cycle 2 (the CR1/CR2 fixes are noted as removing the
blocker that would have failed step 2 of the device plan). Per the
verification stance for this ticket, this desktop/in-browser evidence
(including this evaluation's own) is implementation evidence only — the
terminal state correctly remains "ready for device testing," and no
physical-device claim is made or expected at this cycle.

### Overall: PASS

### Non-blocking Suggestions
- None new this cycle. Cycle 1's two non-blocking suggestions
  (`COMPACT_AXIS_LABEL_FONT_SIZE` extraction, above-768px crossing test) were
  both addressed as claimed.
