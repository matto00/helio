## Context

`frontend/src/shared/ui/panelFit.ts` exports `fitPanelVertically(trigger, naturalHeight, viewportHeight, {gap, cap,
prefer})`, the single vertical-fit rule since HEL-1750/HEL-1756. It reserves only `VIEWPORT_MARGIN` (8px) at each edge.
`usePortalPopover` itself does no vertical math: its opt-in `place` callback is supplied by each consumer, and each
consumer's `place` calls `fitPanelVertically` with `window.innerHeight`.

Callers of the shared fit (enumerated with `grep -rn "fitPanelVertically\|fitSelectPanel" frontend/src`):

| # | Caller | Renders on phone? | How it fits today |
|---|--------|-------------------|-------------------|
| 1 | `features/panels/provenance/useProvenancePopoverHost.tsx` `placeProvenance` (panel `ProvenanceTrigger` and HEL-1744 citation chip share it) | yes, dashboard grid and insight panels | `fitPanelVertically(..., window.innerHeight)`, prefer below, cap `min(0.7*innerHeight, 480)` |
| 2 | `shared/chrome/ActionsMenu.tsx` `placeActionsMenu` | yes (dashboard list rows, pipeline footer, step sheet) | same, prefer per `align`; portalled into `dialog[open]` when inside one |
| 3 | `shared/ui/Select.tsx` via `selectPanelFit.ts` `fitSelectPanel` | yes (forms) | same, cap 280, applied directly to the element in a layout effect |
| 4 | `features/dashboards/ui/DashboardAppearanceEditor.tsx` `placeAppearanceEditor` | no (not rendered <=768px, per the popover-viewport-fit spec) | same; change is a no-op on desktop |

Popovers with their own placement that must be checked but do not use the shared fit:

| # | Popover | Finding |
|---|---------|---------|
| 5 | `features/pipelines/ui/outputSchemaPanelPlacement.ts` `placeMountedPanel` | Already measures `.bottom-nav` itself (skipped inside `dialog[open]`, because the step sheet covers the nav). Switch it to the shared reader so there is one definition; behaviour preserved, plus the safe-area inset when the nav is absent. |
| 6 | `features/auth/ui/UserMenu.tsx` | `placement="nav"` opens ABOVE the bottom-nav trigger (`bottom: innerHeight - rect.top + 8`), so it can never sit under the nav; `rail` is desktop only. No change; record in the PR. |

The layout already defines the nav's geometry: `theme.css` `--bottom-nav-height = capsule + inset +
env(safe-area-inset-bottom)`, `BottomNav.css` positions `.bottom-nav` fixed at
`bottom: calc(var(--bottom-nav-inset) + env(safe-area-inset-bottom))`, `display: none` above 768px. `App.css` reserves
`--bottom-nav-height` as `.app-content` padding/scroll-padding, and `toast.css` offsets toasts by it.

**Stacking (verify, do not assume).** `.popover__panel` and the Select panel are `z-index: var(--z-popover)` (100),
portalled to `<body>` (or the open dialog); `.bottom-nav` is `z-index: 5`. Statically, then, the popover paints OVER
the nav, so `document.elementFromPoint` at a popover item that overlaps the nav would most likely return the item even
before the fix: the ticket's "items under the nav can't be tapped" is a claim to probe, not a fact. The visible defect
the HEL-1744 evaluator measured (popover bottom y=800 vs nav top ~776 at 390x844) is geometric overlap of the popover
with the band the app reserves for the nav.

## Goals / Non-Goals

**Goals:**
- One shared, layout-measured bottom inset used by every shared-fit caller.
- At phone widths, a popover's bottom edge stays >= 8px above the nav's top; it flips/caps exactly as at the window edge.
- Desktop placement byte-for-byte unchanged (inset 0 when no nav and no safe area).
- Red-before/green-after e2e at 390x844 and a short phone viewport, light and dark.

**Non-Goals:**
- Top chrome insets (phone top bar), keyboard/visualViewport handling, horizontal safe areas.
- Changing z-index/stacking of the nav or popovers.
- UserMenu placement (already opens above the nav).

## Decisions

**D0. Probe first (before any code).** At 390x844 on a phone dashboard, open a provenance popover from a trigger low
enough that it opens below and reaches past the nav's top. Record into
`.concertino/scratch/HEL-1762/probe.md`: the popover rect, the nav rect, and `document.elementsFromPoint` at the last
item's centre (full stack). This settles whether the nav or the popover is on top and fixes the exact red assertion in
D4. If no trigger placement on a real dashboard can make the popover reach the nav at 390x844 or the short viewport,
stop and return an `ESCALATION` (the AC would be unreproducible), do not invent a setup.

**D1. `fitPanelVertically` gains an optional `bottomInset` (default 0) in `PanelFitOptions`.**
`roomBelow = viewportHeight - bottomInset - (trigger.bottom + gap) - VIEWPORT_MARGIN`. `roomAbove`, `top` and the
`bottom` CSS anchor (`viewportHeight - (trigger.top - gap)`) are unchanged: the anchor is a CSS distance from the real
viewport bottom, so it must keep using the real height. Alternative rejected: passing `innerHeight - inset` as
`viewportHeight` — it would shift every `bottom`-anchored (opens-above) popover down by the inset, into the nav.

**D2. One reader, `readBottomInset(panel?: Element | null): number`, exported from `panelFit.ts`.**
- Nav band: `document.querySelector(".bottom-nav")`; if it has a non-zero rect AND `panel` is not inside an open modal
  `dialog` (`panel?.closest("dialog[open]")` — the precedent in `outputSchemaPanelPlacement.ts`: a modal dialog's top
  layer and backdrop cover the nav), the band is `window.innerHeight - navRect.top` (this already includes the nav's
  own edge inset and the safe area, because the nav is positioned off both).
- Else the safe-area band: the measured `env(safe-area-inset-bottom)` value, read from a lazily created, cached,
  `aria-hidden`, `position: fixed; visibility: hidden; pointer-events: none` probe element whose `height` is
  `env(safe-area-inset-bottom, 0px)` (read its `getBoundingClientRect().height`). A custom property holding `env()` is
  not used, because whether its computed value is substituted is engine-dependent.
- Result: `max(0, band)`. In jsdom every rect is 0, so the reader returns 0 and unit behaviour is unchanged.
- Not a hard-coded pixel constant and not a re-derivation of `--bottom-nav-height` in JS: measuring the rendered nav
  follows the nav if its tokens change.

**D3. Callers.** Callers 1-4 pass `bottomInset: readBottomInset(panel)` (Select: `fitSelectPanel` gains a
`bottomInset` parameter defaulting to 0, `Select.tsx` passes `readBottomInset(panel)`). Caller 5 replaces its own
`.bottom-nav` measurement with `readBottomInset(panel)` (its `navTop` becomes `viewport.height - inset`), preserving
its dialog rule. Caller 6 untouched. The provenance cap `min(0.7*innerHeight, 480)` is unchanged.

**D4. Red-before / green-after e2e** (`e2e/hel1762-popover-clears-bottom-nav.spec.ts`), at 390x844 and a short phone
viewport (390x400, the hel1756 "phone short" size), each in light and dark:
- Provenance popover opened from a real panel trigger whose position makes the unfixed fit reach the nav band (D0).
- For the popover's last item (scrolled into view inside the popover when capped): assert (a) the popover's bottom
  edge is <= nav top - 8, and (b) `document.elementFromPoint(itemCentre)` returns the item (or a descendant), and (c)
  `document.elementsFromPoint(itemCentre)` contains no `.bottom-nav` element or descendant. Check (c) is the
  elementFromPoint-family assertion that is red before the fix even if D0 shows the popover paints over the nav; if D0
  shows the nav paints over the popover, (b) is also red before. D0 picks a trigger that puts the popover's last item centre well inside the nav band and inside the inset capsule's
  horizontal range. Record which of (a)/(b)/(c) went red in the probe file
  and the PR. Do not weaken (b) or (c) to make the spec pass.
- One shared-actions-menu case on phone (a dashboard-list row or other `ActionsMenu` low on the page at 390x844 that
  opens below into the nav band), same (a)-(c) on its last item, light and dark.
- Red is recorded by running the new spec against the unfixed shared fit (mutation: `bottomInset` ignored in
  `fitPanelVertically`), saved under `.concertino/scratch/HEL-1762/`.

**D5. Unit tests.** `panelFit.test.ts`: `bottomInset` shrinks room below (flip/cap), leaves `bottom`/`top` anchors
computed against the real height, default 0 is identical to today. `readBottomInset`: nav visible -> band, nav inside an
open modal dialog -> safe area only, nav absent -> safe area (stub rects). `selectPanelFit.test.ts`: inset honoured.
Each new unit test is shown red against the mutation in D4. The safe-area branch is unit-tested only (Playwright
Chromium reports 0 safe area); the PR says so.

## Risks / Trade-offs

- **Over-reservation in a non-modal context that covers the nav** (e.g. a non-modal bottom sheet): popovers lose ~76px
  of room below and flip/cap sooner. Acceptable; it never makes content unreachable.
- **HEL-1746 ask drawer / phone sheets:** if they are modal dialogs the dialog rule applies; if not, the over-reservation
  above applies. The executor checks which and records it.
- **Concurrent lanes HEL-1752 (Output editor footer) and HEL-1738 (usePanelData/PullRefreshRegistry):** no expected
  file overlap; check `git diff --stat origin/main...` for overlap before delivery.
- **e2e flake surface:** reuse the stable-box wait helpers from `hel1756-popover-viewport-fit.spec.ts`.
