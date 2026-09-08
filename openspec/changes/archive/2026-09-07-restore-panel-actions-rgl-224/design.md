## Context

See proposal.md - Why. The root cause was established by observation during Planning, not inferred from the changelog;
the full probe transcript is recorded in `ticket.md` under "Orchestrator Planning-phase root-cause probe".

Summary of the confirmed mechanism:

- `frontend/src/features/panels/ui/PanelList.tsx:70` calls `useContainerWidth` imported from `react-grid-layout`, and
  passes the measured width to `PanelGrid`.
- `frontend/src/features/panels/ui/grid/PanelGrid.tsx` branches on `width < panelGridConfig.breakpoints.sm` (768):
  below it, `DesktopPanelGrid` is never mounted and `MobilePanelStack` renders instead.
- `MobilePanelStack` is a deliberately read-only presentation (HEL-301) and renders no panel-actions trigger, so no
  element with the accessible name `"Revenue Pulse panel actions"` exists on that branch.
- react-grid-layout 2.2.3 measured `node.offsetWidth`. 2.2.4 replaced that with `getContentWidth(node)`, which prefers
  `Number.parseFloat(getComputedStyle(node).width)` and otherwise uses `node.clientWidth` minus horizontal padding. It
  never reads `offsetWidth`.
- `frontend/src/test/jest.setup.ts` stubs `HTMLElement.prototype.offsetWidth = 1280` because jsdom performs no layout.
  Under 2.2.4 that stub is never read, so it is silently ineffective.
- The observed node is `.panel-list__zoom-container` (`PanelList.tsx:376-380`), which carries an inline percentage width
  from `zoomContainerStyle` (`PanelList.tsx:181`: `width: `${100 / zoomLevel}%``). jsdom returns the literal `"100%"`
  from `getComputedStyle().width`; `Number.parseFloat("100%") === 100` is FINITE, so `getContentWidth` returns 100 at
  its first branch and the `clientWidth` fallback is NEVER reached. Measured width is 100, not 0 -> 100 < 768 -> phone
  branch.
- In a real browser `getComputedStyle().width` returns the USED value in px (e.g. `"1152px"`), never `"100%"`. jsdom
  returns the SPECIFIED value because it performs no layout. react-grid-layout 2.2.4 is correct against real browsers;
  jsdom is the deviant environment. That asymmetry is the whole reason this is a harness defect and not a product one.

Explanations 1-3 from the ticket are ruled out by observation, not by argument: the accessible name is still produced by
`PanelCard.tsx:303` via the shared `ActionsMenu`, both files are untouched on this branch, and the button renders with
the correct role and name whenever the desktop branch is taken. The full suite under 2.2.4 fails exactly 2 tests in 1
suite — 2690 passing / 263 suites on the PRE-REBASE base (matching the ticket's reported CI result), and 2766 passing
/ 272 suites on the current base 6b081b86 after HEL-1022 added tests. Either way exactly 2 tests in 1 suite fail; no
other surface is affected.

## Goals / Non-Goals

**Goals:**

- Land 2.2.4 with the two `App.test.tsx` assertions passing **unmodified**.
- Make the width stub robust to the measurement API rather than to one library version.
- Leave behind a guard that is demonstrably able to fail for a missing accessible name.
- Prove in a real browser that the desktop panel-actions affordance under 2.2.4 is visually and behaviourally identical
  to 2.2.3 - not merely present in the accessibility tree.

**Non-Goals:**

- See proposal.md - Non-goals. Additionally: no change to `PanelGrid`'s width-based desktop/phone branch. It is correct
  product behavior and load-bearing for HEL-301; the bug is that the harness stopped feeding it a realistic width.

## Decisions

**D1 - Fix the harness, not the query, and not the product.** The ticket's explanation 4 is correct, but the useful
statement of it is narrower than "test-harness artefact": the stub is coupled to a measurement API the dependency
changed, and the product's desktop/phone branch is width-driven, so a silently-wrong width (100, from an inline
percentage jsdom never resolves) is not an inert harness detail - it changes which component tree renders. Alternative considered and rejected: weakening the query to
`getByTestId` or a class selector. HEL-1003 makes that a binding prohibition, and it would have masked the fact that an
entire branch of the UI was rendering.

**D2 (REVISED after design gate round 1 REFUTE) - Shim `getComputedStyle().width` to a resolved px value, only where
jsdom leaves it unresolved.** The original D2 (stub `clientWidth`) was empirically disproven: applied exactly as
written, with the stub verified live in-harness, `App.test.tsx` stayed RED at 2 failed / 27 passed across three runs,
because the `clientWidth` fallback is never reached. It is withdrawn.

The fix must intervene on the value the hook actually consumes. The shim wraps `globalThis.getComputedStyle`, returns
the native style object untouched whenever `style.width` is ALREADY a resolved `px` value, and otherwise returns a
proxy reporting `width` (and `getPropertyValue("width")`) as `"1280px"`. This narrowness is deliberate: any test that
sets an explicit px width still sees its own value, so the shim only fills in where jsdom has no layout to compute one
— emulating the used value a real browser would report. It is the same principle as, and a strict generalisation of,
the pre-existing `offsetWidth` stub sitting beside it.

MEASURED blast radius, not asserted (the original D2 rejected this route on assertion alone, which is no longer
available). Full frontend suite via `npx jest` from `frontend/` on base 6b081b86:
- Baseline, no shim: `Test Suites: 1 failed, 271 passed, 272 total` / `Tests: 2 failed, 2766 passed, 2768 total`.
- With the shim: `Test Suites: 272 passed, 272 total` / `Tests: 2768 passed, 2768 total`.
Exactly the two target assertions flip; zero collateral change across 272 suites.

Alternatives rejected: (a) stubbing `clientWidth` - disproven above; (b) mocking `useContainerWidth` outright - stops
exercising the real hook and would have concealed this very bug; (c) keying the shim to `.panel-list__zoom-container`
specifically - brittle, couples the harness to one component's class name, and leaves other real consumers of the hook
(e.g. `PanelGridSkeleton`) still measuring wrong; (d) a blanket `width: "1280px"` for every element regardless -
broader than necessary and would override widths tests set deliberately.

**D3 - Bump the lockfile in this PR.** The fix and the bump must land together, or the guard protects nothing and
Dependabot immediately re-raises #481. This makes the "does this block the bump?" question answerable by the PR itself
rather than by assertion.

**D4 - Evidence hierarchy.** Three distinct artifacts, because none of them substitutes for another:
1. *Proof*: the two existing `App.test.tsx` assertions, confirmed RED under 2.2.4 before the fix (already observed
   during Planning) and GREEN after, with the assertions unmodified.
2. *Guard*: a new test asserting the panel-actions trigger is reachable by role+accessible name on the desktop branch,
   plus a stub-integrity assertion that the real `useContainerWidth` reports >= 768 in jsdom. The stub-integrity guard
   MUST measure a node carrying an inline percentage width, the shape the product actually renders — asserted against a
   bare `div` it would pass while the app still flips to the phone branch, which is precisely the error that produced
   the withdrawn D2. Both guards must be shown failable by mutation and labelled as guards, not proofs; the mutation
   must neuter the shim the fix actually adds, not a stub that is off the consumed path.
3. *Real browser*: jsdom cannot substantiate any claim about visibility, hit target, stacking or hover. Verified via the
   Playwright MCP browser against this worktree's dev server.

**D5 - UI cohesion is a gate, judged on the running app.** This is a regression fix on an existing surface, so the bar is
that the panel-actions affordance returns to being *identical* to its pre-bump state, not merely reachable. The
comparison that carries meaning here is 2.2.3-desktop vs 2.2.4-desktop in a real browser: the change set touches no
product rendering code, so any visual delta is attributable to react-grid-layout 2.2.4's own DOM/measurement change and
must be caught rather than assumed absent. Required evidence: same position, size, hover and focus treatment, and
stacking against the drag handle; drag and resize still work (a stacking or `pointer-events` shift would break dragging
silently); both light and dark themes. A DESIGN.md token check is necessary but not sufficient, and a green jsdom
accessible-name assertion is not evidence of any of this.

**D6 - Phone width must not be assumed to host actions.** HEL-1006 is open: at phone width there is no host for row
actions. Nothing here may assume such a host exists. If the fix is found to interact with that gap, report it rather
than absorbing it silently.

## Risks / Trade-offs

- [The stub re-couples to 2.2.4's API and breaks again on a future bump] -> The stub-integrity guard asserts the outcome
  (the real hook reports a desktop width) rather than the mechanism, so a future measurement change fails loudly and
  specifically instead of silently re-flipping tests onto the phone branch.
- [2.2.4 changes desktop rendering in some way not covered by the failing assertions] -> D5's real-browser before/after
  comparison exists precisely to catch this; it is the only evidence class that can.
- [`main` moves under this branch on frontend files while a parallel UI lane lands] -> Rebase before opening the PR and
  re-run the visual comparison afterwards.
- [Shimming `getComputedStyle` globally perturbs unrelated suites] -> No longer a hypothetical: MEASURED at 272/272
  suites and 2768/2768 tests green with the shim, against a 271/272 + 2 failed baseline, so the observed collateral is
  exactly zero. The `width` carve-out (already-resolved `px` passes through untouched) means any test asserting its own
  explicit width is unaffected. The pre-existing `offsetWidth` stub establishes the same precedent.

## Planner Notes

Self-approved: `skip_specs: true`. No spec-level behavior changes - the product's rendered behavior in a real browser is
identical before and after; only a dependency version and a test-harness stub change.

**D7 - Do not absorb neighbouring tickets.** HEL-1023 (panel overlap at mismatched grid breakpoints) is filed and
deliberately untouched. It is react-grid-layout territory and this change sits directly in it, so the temptation is
real: adopting 2.2.4 may change overlap behavior. If an interaction is observed, it is REPORTED and left to HEL-1023 —
it is not fixed here. The same applies to HEL-1006 (no phone host for row actions) and to the concurrent table-panel
lane. Widening this diff would make a dependency-bump bug unreviewable and would silently take work from tickets that
own it.

**D8 - Visual baseline is taken on the rebased base.** This branch was rebased mid-Planning onto origin/main @ 6b081b86
(HEL-1022), which repaired `MobilePanelStack.css` rules that had been targeting panel kinds HEL-909 retired, collapsing
output panels to 42px. Any before/after visual comparison must be captured on that base or later, or it will attribute
HEL-1022's bug to this change. The diagnosis itself was re-derived post-rebase and is unchanged: it depends on which
component tree mounts and on the width-measurement primitive, never on panel sizing or clipping.

**D9 - Bump the lockfile only, not the declared range.** `frontend/package.json` already declares `^2.2.2`, which
admits 2.2.4, so the range needs no edit and Dependabot PR #481 is itself lockfile-only. Restore `package.json` to
`^2.2.2` and carry 2.2.4 in `frontend/package-lock.json` alone, keeping the diff minimal and faithful to the bump being
superseded.
