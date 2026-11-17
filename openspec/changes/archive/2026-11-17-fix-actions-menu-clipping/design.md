## Context

See proposal.md (Why). Probe evidence: `.concertino/runs/HEL-1750/evidence/` (`premise-validation.md`, probe report),
screenshot `.concertino/scratch/HEL-1750/short-last-row.png` in the main checkout.

Current code:
- `shared/chrome/ActionsMenu.tsx` `handleToggle` calls `handleOpen(rect => ({ top: rect.bottom + 8, right: innerWidth -
  rect.right }))` (or a `bottom`-anchored variant for `align="above"`, which no call site passes today). Panel is
  portalled to `<body>`, or to `trigger.closest("dialog[open]")` (HEL-1582), with `position: fixed`.
- `hooks/usePortalPopover.ts` clamps the panel horizontally once per open (right-anchored panels only) and offers an
  opt-in `place(panel, triggerRect)` (HEL-1668): the panel stays `visibility: hidden` until `placed`, re-placed on
  window resize. No consumer of `place` exists in `shared/` yet besides the hook's own tests.
- `shared/ui/selectPanelFit.ts` `fitSelectPanel` (HEL-1373) already holds the right vertical-fit arithmetic for Select:
  below if it fits, else above if above has more room, height capped to the room. Select applies it imperatively.

## Goals / Non-Goals

**Goals:** every ActionsMenu (all 13 call sites) opens fully reachable inside the viewport; one shared fit helper used
by both Select and ActionsMenu; no visible jump on open.

**Non-Goals:** other popovers (UserMenu, DashboardAppearanceEditor, provenance popover) — audit only, follow-up if
exposed; re-placing on scroll (the menu has a full-viewport scrim; unchanged behaviour); menu items or styling.

## Decisions

**D1 — Fix in the shared component, via `place`.** ActionsMenu passes a `place` function to `usePortalPopover` and
stops passing a one-shot `computePos`. `place` measures the mounted panel's natural height (`scrollHeight` plus
border chrome, independent of any cap applied on an earlier placement) and the trigger rect, and returns `{top,
maxHeight, right}`. Alternatives rejected: enlarging/un-clipping a container (the probe shows no container clips);
per-call-site `align="above"` (positional, breaks the moment the list scrolls or the window resizes); CSS
anchor-positioning `position-try` (not supported in all browsers the app targets; no precedent in the codebase).

**D2 — One shared vertical-fit helper.** Generalise `fitSelectPanel` into a helper taking `{gap, cap?, prefer:
"below" | "above"}` with Select's exact rule, parameterised by side: if the panel fits on the preferred side, open
there; else if the other side has MORE room than the preferred side, open there with height capped to that room;
else open on the preferred side capped to its room (never negative). 8px viewport margin as today. This is
`fitSelectPanel`'s rule verbatim when `prefer: "below"`, so the wrapper (gap 4, cap 280, prefer below) returns
identical outputs and `selectPanelFit.test.ts` stays green unmodified. The helper returns the side plus the edge
offset, so an "above" result can be expressed as a `bottom` anchor (D2a). **No-layout input** (keyed on
`panel.scrollHeight === 0`, exactly as `Select.tsx` does, not on a derived height): return the preferred side, uncapped — there is nothing to judge a collision against.
ActionsMenu uses gap 8 (today's offset) and `prefer` = its `align` prop (default `"below"`; prop kept, its doc
comment in `ActionsMenu.tsx` that says "no viewport-collision detection" is rewritten).

**D2a — Anchoring contract kept (resolves design-gate CR1).** ActionsMenu's `place` returns `{top, maxHeight, right}`
when the menu opens below and `{bottom, maxHeight, right}` (`bottom = innerHeight - (trigger.top - gap)`) when it opens
above, as `features/pipelines/ui/outputSchemaPanelPlacement.ts` does. Together with D2's no-layout rule, the existing
HEL-719 tests in `ActionsMenu.test.tsx` (default: `top` set, `bottom` empty; `align="above"`: `bottom` set, `top`
empty) keep passing UNMODIFIED. Editing those tests is not sanctioned by this plan; if they go red, the implementation
is wrong.

**D3 — Overflow scrolls inside the menu.** When capped, the panel gets `max-height` and `overflow-y: auto` (CSS on
`.actions-menu__panel`, value from `place`). Arrow-key `.focus()` scrolls the focused item into view natively.

**D4 — Horizontal.** `place` also returns `right = innerWidth - trigger.right`, clamped so the panel's left edge is
≥ 8px (same rule as the hook's existing clamp). The hook's existing clamp effect then measures an already-fitting
panel and is a no-op; it stays for other consumers.

**D5 — Focus after placement.** The panel is `visibility: hidden` until placed, and hidden elements cannot take
focus. The first-item focus effect (WAI-ARIA menu pattern, HEL a11y F-007) MUST run once `placed` is true, not on
`isOpen`; the existing ActionsMenu keyboard tests must still pass unmodified (no fixture/test weakening).

**D6 — Dialog portal.** Inside `dialog[open]` the panel keeps portalling into the dialog. `position: fixed` resolves
against the viewport there (portal-popover-hook spec: no lingering transform). The executor probes one in-dialog
site (MobileStepSheet on phone) to confirm the dialog does not clip the fitted panel; if it does, report it — do not
widen scope silently.

**D7 — Call-site audit.** All 13 call sites (DashboardList, SidebarItemList, DashboardFolderGroup, CommandBar,
DashboardMetaRow, PanelCardHeader, MobilePipelineHeader, MobileStepSheet, SpineOutputs, PipelineSpineHeader,
SpineSourceCard, SpineStepRow, ConnectorsPage) inherit the fix. The executor records each, with a live spot probe of
at least DashboardList, SidebarItemList, PanelCardHeader (low on a dashboard), SpineStepRow and MobileStepSheet, in
`files-modified.md`. Other popovers found exposed are listed for a follow-up, not fixed.

**D8 — e2e (red first).** New `e2e/hel1750-actions-menu-viewport-fit.spec.ts` (the repo has one Playwright
project, `dev`; viewport set in-test with `setViewportSize`):
- **Desktop, dashboard list (the reported surface):** create enough dashboards through the API (ids recorded, deleted
  in teardown by exact id) that the rail list's last row, list scrolled to its end, sits within the menu's height of
  the bottom of a 1280x400 viewport. Wait on real readiness (the last created dashboard's own name text in the row,
  never a skeleton-matchable selector). Open its ⋮, wait for the panel's animations to settle
  (`getAnimations()` finished), then assert for the LAST menu item: its rect is inside the viewport and
  `elementFromPoint(centre)` is the item (or inside it); then click it (Delete → its confirm appears; cancel it).
- **Phone (short, 390x300):** at ≤768px neither the dashboard list (`MobileNavSheet`: rows carry a separate Share
  button) nor dashboard panel cards (`MobilePanelStack` renders `PanelCardBody`, no `PanelCardHeader`) have a ⋮ — both
  confirmed live at the design gate — so the ticket's "phone" AC for the dashboard list is satisfied by absence. The
  pipeline Output ⋮ (`SpineOutputs`) was the planned phone case but CANNOT breach the viewport: its menu has one item,
  and its trigger must sit above the 68px `.bottom-nav` to be tappable, so even at the lowest tappable point (trigger
  bottom about 776) the menu ends at 776 + 8 + 54 = 838 <= 844 (measured on unchanged code at 390x844: fits, hit true).
  `SpineStepRow` has no phone row menu. The phone case actually built is the multi-item touch menu in
  `MobileStepSheet` ("Step actions", inside a modal `<dialog>`) at 390x300, where neither side holds the menu: it
  caps, scrolls inside, and End moves focus to the last item, asserted inside the viewport and hit at its centre, then
  tapped with its effect asserted. The desktop case runs with a fine pointer; only the phone case enables touch.
- **Horizontal left-edge (spec scenario):** covered by a unit test of the placement (trigger rect near x=0 in a 390px
  viewport, panel width > trigger's left offset → panel left edge ≥ 8).
Both e2e cases are run against unchanged code first and the red recorded.

## Risks / Trade-offs

- [Visibility: ActionsMenu itself must render `visibility: placed ? undefined : "hidden"` and `maxHeight:
  panelPos.maxHeight` inline — the hook exposes `placed` but does not hide the panel (cf. `OutputSchemaDisclosure.tsx`)]
  → task 2.3 + a unit assertion.
- [Cosmetic: on phone a menu below may overlap `.bottom-nav`; it paints above it (z 100), so reachability holds] →
  optional cap at the nav top like `outputSchemaPanelPlacement.ts`; not required.
- [`visibility: hidden` until placed delays the menu one layout pass] → `useLayoutEffect` placement lands before paint.
- [jsdom has no layout; `place` sees zero rects] → helper must yield a harmless position (no negative/NaN) so unit
  tests keep behaving; existing tests unchanged.
- [Changing Select via the shared helper] → wrapper keeps exact outputs; `selectPanelFit.test.ts` must stay green
  unmodified.

**D9 — Falsifiable unit tests.** jsdom focuses `visibility: hidden` elements and placement completes inside `act`,
so naive assertions pass on today's code. The focus test spies on `HTMLElement.prototype.focus` and records the menu's
`style.visibility` at the call (must not be `"hidden"`; red against today's `[isOpen]` ordering). The hidden-before-
placement test observes the pre-placement render (e.g. records `style.visibility` from a ref callback on first attach,
or mocks the hook with `placed: false`). Each new unit test is shown red against the unfixed code in files-modified.md.

## Planner Notes

- Self-approved: new capability spec instead of modifying `portal-popover-hook` (behaviour belongs to the menu).
- Self-approved: `align` prop kept as the preferred side for backward compatibility.

**D10 — Rail phantom page scroll (found after delivery, HEL-1750 CI e2e).** The desktop e2e hovering the rail's last row
hung in CI ("element is not stable"). Root cause, probe-confirmed (evaluator, re-probed by the executor): the rail rows'
visually-hidden three-dot wrappers are `position: absolute` (`DashboardList.css`, `.dashboard-list__item-row .popover.actions-menu`)
inside a `.dashboard-list` scroller that was not positioned, so they resolved against the page, escaped the scroller and
stretched the document's scroll height (538 at 1280x400, innerHeight 400). Hovering a row revealed its wrapper in flow
(`position: relative`), the phantom scroll shrank and rows jumped about 34px under the pointer. Fix: `position: relative`
on `.dashboard-list` (a product CSS bug, separate from the menu fit). Guards (red on the old CSS at 538 > 400, green after,
light and dark): `rail: no phantom page scroll and no row shift on hover` in `e2e/hel1750-actions-menu-viewport-fit.spec.ts`;
the desktop case is back on the real mouse path (hover the last row, click its trigger). Probed after the fix: every one of
12 rows reveals a 24x24 trigger inside the row on hover, flush right, in both themes (the other absolute elements in this
stylesheet already sit in positioned wrappers or are zero-size hidden inputs). The phone has no rail (MobileNavSheet).
The unit and e2e reds of the menu fit were re-confirmed against the unfixed ActionsMenu.tsx after this change.

**AC3 audit addendum:** SidebarItemList renders an ActionsMenu only when `onDelete` is passed and its only production
consumer (AssistantContextList) passes none, so that site is dormant and covered by the shared component. Live-probed
sites: DashboardList, PanelCardHeader, SpineStepRow, MobileStepSheet (in a dialog), SpineOutputs (one item, cannot breach).

**Follow-up candidates (not fixed here):** other popovers that may share the short-viewport overflow exposure and were not
probed: UserMenu, DashboardAppearanceEditor and the panel provenance popover.
