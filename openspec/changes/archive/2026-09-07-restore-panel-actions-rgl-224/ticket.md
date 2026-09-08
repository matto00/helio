# HEL-1014: react-grid-layout 2.2.4 makes the panel-actions button unreachable by accessible name

## Description

Dependabot PR #481 bumps `react-grid-layout` 2.2.3 -> 2.2.4 and deterministically fails two assertions in `frontend/src/app/App.test.tsx` at line 893, where `screen.findByRole("button", { name: "Revenue Pulse panel actions" })` no longer resolves. Observed result on the bumped tree: 2 failed, 2690 passed, 263 suites — not flake. `main` is green, so the bump is the cause rather than pre-existing drift.

`findByRole` resolves through the accessibility tree, so a non-match has four candidate explanations, in descending order of seriousness:

1. The button's accessible name changed or was lost.
2. The button is no longer exposed as a `button` role.
3. The button is no longer rendered at all in that grid context.
4. It renders but outside the queried container, or later than the `findBy` timeout (a pure harness artefact).

Explanations 1-3 would be genuine accessibility regressions for keyboard and screen-reader users. HEL-1003 established the binding rule for this defect class: do NOT "fix" this by weakening the query (e.g. `getByTestId` or a class selector) before the mechanism is understood, because that converts a real signal into a silent regression.

PR #481 is deliberately held open and unmerged pending this investigation — closing it only invites Dependabot to re-raise it while 2.2.3 accumulates whatever 2.2.4 fixed.

## Scope

1. Determine which of the four explanations is true by observing the rendered accessibility tree under 2.2.4, not by reading the diff.
2. Treat the upstream changelog as a hypothesis to confirm, never as the finding.
3. If it is a real product regression, fix the product so the accessible name survives, and keep the test as written.
4. If it is genuinely a harness artefact, say precisely why, and record what evidence distinguishes it from explanations 1-3.
5. Verify in a real browser, not only jsdom.

## Acceptance criteria

- [ ] The mechanism is named and demonstrated, not inferred from the changelog.
- [ ] If it is a product regression, the panel-actions button is reachable by accessible name under 2.2.4 and the original assertion passes unmodified.
- [ ] If the test is changed at all, the change is justified against explanations 1-3 being ruled out by observation.
- [ ] Mutation-proven: whatever guard ends up in place goes red when the accessible name is removed. A test that has never failed for a missing name has not been shown able to catch one.
- [ ] Verified in a real browser, not only jsdom.
- [ ] The PR body states explicitly whether this blocks the Dependabot react-grid-layout bump (#481).

## Notes

- Failing job: https://github.com/matto00/helio/actions/runs/34094004296/job/101653418057
- Related: HEL-1003 (actions-menu keyboard reachability; source of the "do not weaken the query" rule), HEL-458 / HEL-506 (panel/grid virtualization, also react-grid-layout territory).

## Orchestrator Planning-phase root-cause probe (already performed, HEL-1014)

Reproduced in this worktree with `react-grid-layout@2.2.4` installed: `npx jest` gives exactly 2 failed / 2690 passed / 263 suites, matching the ticket. `App.test.tsx` is the ONLY affected suite.

Observation of the rendered tree (full-fidelity dump, `DEBUG_PRINT_LIMIT=2000000`): the "Revenue Pulse" panel IS rendered, but as `<article class="panel-grid-card mobile-panel-stack__item ...">` inside `<div class="mobile-panel-stack">` — the phone stack, not `DesktopPanelGrid`. `MobilePanelStack` is a deliberately read-only presentation (HEL-301) and renders no panel-actions trigger at all, which is why no element with that accessible name exists.

Mechanism, confirmed at source level in both installed copies:

- 2.2.3 (`dist/chunk-7MZZ6T4J.js`): `useContainerWidth` measures `const newWidth = node.offsetWidth;`.
- 2.2.4 (`dist/chunk-BMN6M2VL.js`): `useContainerWidth` now calls a new `getContentWidth(node)` which prefers `Number.parseFloat(getComputedStyle(node).width)` and otherwise falls back to `node.clientWidth` minus horizontal padding. It never reads `offsetWidth`.

`frontend/src/test/jest.setup.ts` stubs `HTMLElement.prototype.offsetWidth = 1280` precisely because jsdom performs no layout — a stub written against 2.2.3's measurement API, which 2.2.4 no longer reads.

CORRECTED MECHANISM (design gate round 1, skeptic-design-1.md CR1). An earlier Planning probe measured a bare detached
`div` and reported `{"offsetWidth":1280,"clientWidth":0,"computedWidth":""}`, concluding the measured width was 0 via
the `clientWidth` fallback. That was the WRONG NODE and the conclusion was wrong. The node `useContainerWidth` actually
observes is `.panel-list__zoom-container` (`PanelList.tsx:376-380`), which carries an inline percentage width from
`zoomContainerStyle` (`PanelList.tsx:181`: `width: `${100 / zoomLevel}%``). jsdom returns the literal `"100%"` from
`getComputedStyle().width`, and `Number.parseFloat("100%") === 100` is FINITE — so 2.2.4's `getContentWidth` returns
100 immediately and the `clientWidth` fallback is NEVER REACHED. The measured width is 100, not 0, and no `clientWidth`
stub can change it (reproduced RED three times against exactly that stub, with the stub verified live in-harness).

The distinction matters beyond bookkeeping: in a real browser `getComputedStyle().width` returns the USED value in px
(e.g. `"1152px"`), never `"100%"`. jsdom returns the SPECIFIED value because it performs no layout. react-grid-layout
2.2.4 is correct against real browsers; jsdom is the deviant environment, which is why this is a harness defect and not
a product regression.

`PanelGrid.tsx` branches on `width < panelGridConfig.breakpoints.sm` (768). Measured width 100 -> phone branch -> `MobilePanelStack` -> no panel-actions button.

This is explanation 4 (harness artefact), but a specific subtype worth naming: not "outside the container or too late", but "the harness's width stub is coupled to a measurement API the dependency changed, and the product's desktop/phone branch is width-driven". Explanations 1-3 are ruled out by direct observation: the accessible name is still produced by `PanelCard.tsx:303` (`label={`${panel.title} panel actions`}`) via the shared `ActionsMenu`, unchanged on this branch, and it renders correctly whenever the desktop branch is taken. This must still be confirmed in a real browser, where `getComputedStyle().width` returns a real px value.
