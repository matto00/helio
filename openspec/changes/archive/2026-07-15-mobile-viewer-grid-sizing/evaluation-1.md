## Evaluation Report — Cycle 1

### Operational note (evaluator error, repaired)

Mid-review I mistakenly invoked `scripts/concertino/cleanup.sh` (a post-merge
teardown script, outside the evaluator's role) against this worktree. It
force-removed the worktree's working files. **No committed work was lost** —
the branch `feature/mobile-viewer-grid-sizing/HEL-301` and commit `f84fcf8a`
were untouched in the repo's refs. I repaired the worktree: removed the
leftover `backend/target` build artifacts, re-ran `git worktree add` against
the existing branch, re-ran `scripts/concertino/setup-worktree.sh` to restore
`backend/.env`, ran `npm install` in `frontend/` to restore `node_modules`,
and ran `npx husky install`. Verified `git status` is clean and `npm run
lint` passes post-repair. Flagging this explicitly per the destructive-action
guardrail; no further action needed from the orchestrator, but noting it for
the record.

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed as scoped structural/CSS work (see Phase 3 for a
  rendering defect found in that work).
- No AC silently reinterpreted. `tasks.md` items match the diff; the D1
  container-width-vs-430px-viewport gating decision is explicitly recorded
  and justified in `design.md`, matching the binding handoff's own framing.
- No scope creep: diff is entirely within `frontend/src/features/panels/**`,
  `frontend/src/test/jest.setup.ts`, and the openspec change artifacts. No
  `App.tsx`/`App.css` nav changes (HEL-302's scope), confirmed via
  `git diff --name-only`.
- No backend or `schemas/` diff (confirmed via `git diff --name-only
  a7b914fd...HEAD -- backend schemas`, empty).
- `files-modified.md`'s task 1.2 probe (does the base commit's equality
  suppression reliably prevent the phone PATCH?) is a real code-path trace,
  not an assumption, and its conclusion (the fix must be structural, not rely
  on strengthening the equality check) is independently verifiable against
  the base commit and matches what I observed live (see Phase 3).
- Planning artifacts (design.md, specs/) reflect the implemented behavior for
  the structural/CSS surface; they do not anticipate the rendering defect in
  Phase 3, which was not know-able from a design review alone.

### Phase 2: Code Review — PASS (with a design-standard concern noted below)
Issues:

- `DesktopPanelGrid.tsx` is 284 lines vs. CONTRIBUTING's ~250-line soft
  budget — informational only per CONTRIBUTING, and the executor flagged it
  explicitly as a behavior-preserving extraction. Not a gate failure.
- `ChartPanel.tsx:222,229` (`fontSize: 10`) is a magic number for the compact
  ECharts axis-label override — minor, non-blocking (ECharts option objects
  aren't CSS, so DESIGN.md's `[mechanical]` "every font-size uses a token"
  rule doesn't strictly apply to canvas-library JS options, but a named
  constant would read better).
- No inline FQNs, no hardcoded hex/rgb/px-font-size in the CSS diff
  (`git diff ... -- '*.css' | grep -E "font-size:|color: #|font-weight:"`
  empty). Tokens used correctly (`--space-3`, `--space-1`, `--space-2`).
- The structural guarantee behind hazard §4.1 is real and verifiable by
  inspection, not just by test: `usePanelGridSave` is imported only by
  `DesktopPanelGrid.tsx` (grep-confirmed), and `PanelGrid.tsx` branches
  between `DesktopPanelGrid`/`MobilePanelStack` before either mounts — there
  is no code path from `MobilePanelStack` to the save hook. This is a
  stronger guarantee than any single unit test.
- Fresh gates re-run independently (not trusting the executor's report):
  `npm run lint` (clean), `npm run format:check` (clean), `npm test` (87
  suites / 962 tests passed), `npm run build` (succeeds, PWA precache
  generated). All matched the executor's pasted output. No backend/schemas
  diff confirmed independently.
- Husky bypass (`-n`) is called out explicitly in the commit body per
  CONTRIBUTING's AI-collaborator exception, with the specific gate
  (`check:openspec`'s "complete but not archived" hygiene check) named and
  justified — reproduced independently (`npm run check:openspec` fails with
  exactly that message, nothing else).
- Tests are meaningful: `PanelGrid.test.tsx`'s hazard §4.1 suite asserts no
  `updateDashboardLayout` dispatch and no `hasPendingLayout` transition on
  mount, on a width change, and across `AUTO_SAVE_INTERVAL_MS` — a real
  regression guard. `MobilePanelStack.test.tsx` covers ordering, fallback
  resolution, read-only affordances, and per-kind class assertions.
  `mobilePanelHeights.test.ts` covers the per-kind bands and `h`-modulation
  edges. One coverage gap: no test explicitly exercises crossing *above* the
  768px boundary while mounted (spec's own scenario wording); not blocking,
  since the structural guarantee (no import) covers it independent of any
  specific test, but worth adding for completeness.

### Phase 3: UI Review — FAIL
Issues:

Servers started via `scripts/concertino/start-servers.sh` /
`assert-phase.sh` (PASS). Logged in as `matt@helio.dev`. Fresh browser
evidence, independent of the executor's own report, per
`verification-before-completion`.

**1. Hazard §4.1 — verified correct, no blocker.** At container width < 768
(browser viewport 390×844, measured `.panel-grid-shell` width 335px):
`.mobile-panel-stack` renders, `.panel-grid` (RGL) does not mount. No
`PATCH`/`updateDashboardLayout` request fired on mount, on a width change
staying below the boundary, or after waiting 32s past the 30s auto-save
interval. Server-side `xs` layout for the tested dashboard
(`f074fc6c-b7bb-4cf5-9da6-4affbfe51444`) was `[]` before and remained `[]`
(byte-identical) after. Crossing back to viewport 1440/1100/900 (measured
container widths 812–?) correctly re-mounts the RGL grid with drag handle,
actions menu, and zoom widget all present — desktop is unchanged. This part
of the ticket is solid.

**2. CRITICAL — intrinsic-height panel kinds (table, markdown, text, image,
and indirectly divider) collapse to ~30px in the phone stack, independent of
content, due to `container-type: size` on the reused `.panel-grid-card`
class (`frontend/src/features/panels/ui/PanelGrid.css:28`).**

Root cause: `.panel-grid-card { height: 100%; container-type: size; }`. On
desktop this is safe because the RGL grid item wrapper always gives the card
an explicit pixel height (`h × rowHeight` via `createLayouts`). In
`MobilePanelStack.tsx`, only `metric` and `chart` get an explicit height via
the `--mobile-panel-height` custom property
(`mobilePanelHeights.ts`/`MobilePanelStack.css:24-28`); `table`, `markdown`,
`text`, and `image` are deliberately left height-less per W4.3 ("fully
intrinsic"/"capped, not fixed") — but `container-type: size` (CSS size
containment) forces the box's block size to be computed **independent of its
content**, and with no other height source, the box collapses to just its
own padding (`clamp(14px, 2vw, 20px)` × 2 ≈ 30px measured).

Verified live in-browser (not jsdom, which doesn't compute layout/containment
and could not have caught this):

- Table panel (`HEL-254 Scroll Verification`, "HEL-254 30x200 Table"):
  `.mobile-panel-stack__item--table` computed height `30px`;
  `.panel-content--table` `16px`; `.ui-data-grid` (with 51 `<tr>` rows in the
  DOM) `0px` height, effectively invisible content behind a collapsed card.
- Markdown panel (`HEL-293 UI Check`, "Roadmap"): item computed height
  `30px`, but `.markdown-panel`'s actual content is `111px` and — because
  `MobilePanelStack.css` sets `overflow: visible` on the markdown override —
  the text visibly spills *outside* the card's rounded background/border
  rather than being contained by it (screenshotted: "Roadmap" title sits in
  a pill-shaped card, "Q3 Goals" heading and bullet list render below it on
  bare canvas with no card chrome).
- Image panel (`HEL-246 Eval Check`): same `30px` collapse.
- Multi-panel proof (`HEL-297 UI Check`, metric → table → metric):
  screenshotted — the middle table panel renders as a bare title pill with
  no visible content/card body, sitting almost flush against the next
  metric card, with essentially no vertical rhythm between them despite the
  `--space-3` gap rule being present in CSS (the *collapsed box*, not the
  gap, is the problem).

This directly contradicts the `mobile-panel-sizing` spec's own requirements
("table: capped at `min(60dvh, header + rows × rowHeight)`",  "markdown/text:
fully intrinsic — no fixed height... let text flow", "divider: intrinsic
hairline") and W4.3's core promise. It is worse than the "squashed website"
problem the ticket set out to fix — these panels are effectively invisible
or broken out of their card chrome, not merely mis-proportioned. This is an
objectively observable, reproducible-in-any-browser defect (not a "feels
right" device-tuning question deferred to §6) and is squarely inside this
ticket's scope (`MobilePanelStack.tsx`/`.css`, the stack's own card
rendering).

**3. Divider with `orientation: "vertical"` renders at 0px height in the
stack**, independent of issue #2 (dividers don't get the `.panel-grid-card`
class, so `container-type: size` isn't the cause here). `DividerPanel.tsx`
sets an *inline* `style={{ height: "100%" }}` on `.divider-panel__rule` when
`orientation === "vertical"`; inside the stack's auto-height flex item this
resolves to `0px` (no ancestor with a definite height in that axis).
Reproduced with a real, pre-existing panel: `HEL-293 Full UI Check`'s "Sep"
divider has `config.orientation: "vertical"` (verified via
`GET /api/dashboards/.../panels`), and its rendered `.divider-panel__rule`
measured `0px` height / `1px` width — invisible. `MobilePanelStack.tsx`
never normalizes/forces `orientation` for the stack context, and no CSS
override can win over the component's own inline `style`. This contradicts
W4.3's "divider: intrinsic hairline... no card chrome" — a vertical divider
has no meaning in a single-column stack in the first place and should render
as a horizontal hairline (or be explicitly forced to `orientation="horizontal"`
when passed to `DividerPanel`/`PanelCardBody` from the stack).

**Other Phase 3 checks, for completeness (not blocking):**

- Zoom widget correctly hidden below 430px (`display: none`, confirmed via
  computed style); present and functional at desktop widths.
- `PanelDetailModal` correctly renders full-viewport (390×844, matching the
  browser viewport) below 430px with a reachable, tappable close control —
  no hover dependency. Confirmed via `Escape` dismissal too.
- No console errors during any tested flow (5 pre-existing warnings, unrelated
  to this diff — `selectPipelineOutputDataTypes` memoization and an Apple
  meta-tag deprecation notice, both present before this change and outside
  its file list).
- Body-level horizontal scroll exists at phone widths (`document.body
  .scrollWidth` 412 vs. `clientWidth` 375), but it originates entirely from
  the top command bar (`app-command-bar__right` / `user-menu`), which is
  App.tsx/App.css chrome explicitly out of scope for this ticket (HEL-302
  owns nav). No panel-stack element contributes to that overflow — the
  ticket's own "table scrolls inside its panel, body never scrolls sideways"
  requirement is satisfied for the panel content itself (table's internal
  `.ui-data-grid` correctly contains its horizontal overflow, confirmed via
  `scrollWidth`/`clientWidth` on the grid vs. `document.body`).
- Could not exercise the full "one of every kind" sizing check as a single
  dashboard (no existing seed dashboard has all seven kinds); assembled
  equivalent coverage from four separate seed dashboards. This is consistent
  with the ticket's own instruction that the human is expected to build that
  dashboard for the device round — not a gap in this evaluation.

### Overall: FAIL

### Change Requests

1. **Fix the `container-type: size` collapse for intrinsic-height stack
   items** (`frontend/src/features/panels/ui/PanelGrid.css:28`,
   `frontend/src/features/panels/ui/MobilePanelStack.tsx`,
   `frontend/src/features/panels/ui/MobilePanelStack.css`). `table`,
   `markdown`, `text`, and `image` stack items must render their actual
   content at a real, non-collapsed height. Options: (a) don't apply the
   `.panel-grid-card` class (or override `container-type: normal` /
   `container-type: inline-size`) for stack items that don't receive an
   explicit `--mobile-panel-height`, since size containment requires a
   definite size source the stack doesn't provide for these kinds; or (b)
   give every stack item an explicit measured/computed height (e.g. via
   `ResizeObserver`/ref-measured content height capped per W4.3, for table)
   instead of relying on `height: auto` inside a size-contained box. Add a
   regression test that would have caught this — a Jest DOM assertion alone
   won't (jsdom doesn't implement CSS containment/layout), so this needs
   either an integration check that inspects `getBoundingClientRect()` in a
   real-layout environment (e.g. Playwright) or, at minimum, a lint/CSS-level
   guard against `container-type: size` co-occurring with `height: auto` for
   these stack item classes.
2. **Force `orientation` to a stack-appropriate value for divider panels in
   `MobilePanelStack.tsx`**, rather than passing the panel's stored
   (possibly `vertical`) orientation straight to `DividerPanel`/
   `PanelCardBody` unchanged. A vertical divider is meaningless in a
   single-column stack; render it as the intrinsic horizontal hairline W4.3
   calls for. Add a `MobilePanelStack.test.tsx` case using
   `makeDividerPanel({ config: { orientation: "vertical" } })` to lock this
   in (the current test only exercises the fixture's default `"horizontal"`).
3. Re-run the full one-of-every-`PanelKind` visual check (screenshot) after
   the above fixes, in-browser at 390px, before handing back for device
   testing — the handback's own "ordered device test plan" step 2 assumes
   sizing is otherwise correct; right now four of seven kinds would fail
   that check immediately, before any device-specific tuning question even
   arises.

### Non-blocking Suggestions

- `ChartPanel.tsx:222,229`: extract the compact-mode `fontSize: 10` into a
  named constant (e.g. `COMPACT_AXIS_LABEL_FONT_SIZE`) for consistency with
  `mobilePanelHeights.ts`'s tuning-knob pattern.
- Add a Jest test for width changes that cross *above* 768px while the stack
  is mounted (the `mobile-viewer-stack` spec's own scenario wording), even
  though the structural guarantee (no import) already covers it — closes the
  gap between the spec's literal scenario list and the test suite.
