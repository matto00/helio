## Context

See proposal.md (Why). HEL-1750's reference design is
`openspec/changes/archive/2026-11-17-fix-actions-menu-clipping/design.md` (D1-D10). The relevant current code:

- `frontend/src/shared/ui/panelFit.ts` — `fitPanelVertically(trigger, naturalHeight, viewportHeight, {gap, cap, prefer})`
  and `VIEWPORT_MARGIN = 8`. Pure, unit-tested.
- `frontend/src/hooks/usePortalPopover.ts` — the opt-in `place(panel, triggerRect)` option: the panel renders hidden
  (`placed` false) until placed, is re-placed on window resize; requires `panelRef` attached to the panel root.
- `frontend/src/shared/chrome/ActionsMenu.tsx` `placeActionsMenu` — the reference consumer: natural height =
  `scrollHeight + (offsetHeight - clientHeight)`, vertical fit via `fitPanelVertically`, horizontal clamp of `right`.
- The three popovers today (trigger-rect only, no measurement of the panel):
  - `UserMenu.tsx` `handleToggle`: `rail` → `{bottom: innerHeight - rect.bottom, left: rect.right + 8}` (grows upward
    from the trigger's bottom, beside the rail); `nav` → `{bottom: innerHeight - rect.top + 8, right}` (above the phone
    bottom nav); `bar` → `{top: rect.bottom + 8, right}`. No max-height, no scroll. Consumers: `AppRail` (rail) and
    `BottomNav` (nav); check whether `bar` still has a consumer.
  - `DashboardAppearanceEditor.tsx`: `{top: rect.bottom + 8, right}`, a `<form className="popover__panel">`, no cap.
  - `ProvenanceTrigger.tsx` `computePos`: below unless `roomBelow < 320 && rect.top > roomBelow` (then above);
    `ProvenancePopover.css` caps `max-height: min(70vh, 480px)` with `overflow-y: auto`. A trigger mid-viewport in a
    400px window can still push the 280px-capped panel past the bottom.

## Goals / Non-Goals

**Goals:** probe all three first; fix only the ones that can clip; prove each fix red-then-green with an
`elementFromPoint` e2e on the last item; strengthen the hel1750 rail guard with a last-row/scrolled-to-end hover.

**Non-Goals:** no change to `panelFit.ts`; no behavior change to `usePortalPopover.ts` for existing consumers (D7 adds
one additive return value only); no
redesign of any popover's content; no other popovers (Select, OpDropdown, OutputSchemaDisclosure etc. are out of scope);
no backend.

## Decisions

**D1 — Probe first, per popover, and let the probe decide.** Before any code change, the executor runs the app
(`scripts/concertino/start-servers.sh` / the worktree's own ports) and, via Playwright, opens each popover at: desktop
1280x400 and 1280x320 (rail and a dashboard with a provenance trigger near the middle and near the bottom), phone
390x500 and 390x400, each in light and dark. For each it records the panel rect, viewport, and whether the last
item/control is inside the viewport and returned by `elementFromPoint`. Results go in
`openspec/changes/fit-remaining-popovers-viewport/probes.md`. Any popover with zero failures at every size and theme is
left untouched (spec requirement "An already-fitting popover is left unchanged"), and probes.md states why with the
numbers. Alternative rejected: converting all three unconditionally — the ticket and driver both say "probe first; if
one already fits, don't change it". Before trusting any probe the executor checks the page URL/port are this lane's
(`DEV_PORT`), because the shared Playwright browser has been hijacked between lanes.

**D2 — The fix is the HEL-1750 pattern, local to each consumer.** A clipping popover gets a local `place<Name>`
function mirroring `placeActionsMenu`: measured natural height, `fitPanelVertically` with the popover's existing gap and
existing preferred side (UserMenu `rail`/`nav` → prefer `"above"`-equivalent, `bar` and appearance editor and
provenance → `"below"`), `maxHeight` applied to the panel root, `overflow-y: auto` on a consumer-scoped class (D9) so a capped panel
scrolls, `visibility: hidden` until `placed`, and `panelRef` attached. Horizontal: keep the existing anchor and clamp
it so the panel keeps an 8px margin from both edges (provenance already clamps `left`; appearance editor and user menu
`right`-anchored use the `ActionsMenu` right-clamp; UserMenu `rail` is `left`-anchored and clamps `left` against
`innerWidth - width - 8`). Alternative rejected: a new shared generic `placePopover` helper in `panelFit.ts` — it would
edit a shared file another lane may also touch, for three call sites whose anchors differ; revisit only if the three
local functions turn out identical. Note on UserMenu `bar`: it has no consumer (AppRail passes `rail`, BottomNav passes `nav`); it stays, on the same
`place` function preferring below, and is not deleted here. Note on the UserMenu `rail` variant: it is bottom-anchored at `rect.bottom` (its
bottom edge aligned with the trigger's bottom, beside the rail, not above it). `fitPanelVertically` models only
above/below the trigger, so for this variant the executor either (a) uses the fit with a synthetic trigger rect whose
`top` = `rect.bottom` and `gap` 0, preferring `"above"`, so the preferred side is exactly today's alignment and a short window flips or caps it; or (b) keeps the `bottom` anchor and only caps `maxHeight` to `rect.bottom - VIEWPORT_MARGIN`. Choose (a), stated in a comment, unless the probe shows it misbehaves; record which in probes.md.

**D3 — Adding the hook's `panelRef` opts the popover into usePortalPopover's focus-out close.** `place` only runs
when the hook's own `panelRef` is attached to the panel root. That also enables the hook's close-on-focus-leaving. For
UserMenu (a menu, same as ActionsMenu) that is desired. For DashboardAppearanceEditor (a form) and the provenance
popover (a dialog with its own Tab wrap), moving focus between controls inside the panel stays "inside", so it stays
open; a test must prove that tabbing between the editor's controls and clicking into a field does not close it, and
that the provenance Tab wrap still holds. Any behavior change found is recorded in probes.md.

**D4 — e2e, red first.** One new spec `e2e/hel1756-popover-viewport-fit.spec.ts`, one test per fixed popover per
viewport class it renders in (desktop short, phone short; the appearance editor is desktop-only, see D10), parameterised over light and dark, using the real mouse/tap path to open,
then scrolling the last item into view inside the panel (if capped) and asserting `elementFromPoint` at its centre
returns it (or a descendant). Each test is run against the unfixed component first and its red output recorded in
`openspec/changes/fit-remaining-popovers-viewport/red-evidence.md` (the mutation = the fix reverted, file + lines).
Playwright workers 2. Unit tests (jest, maxWorkers 3) beside each placement function cover: fits preferred side, flips,
caps, no-layout (jsdom 0) keeps preferred side uncapped, horizontal clamp.

**D5 — Rail guard on the last row, page scrolled to its end.** (Setup made explicit: scroll the window AND the
`.dashboard-list` scroller to their ends, and assert the last row's box is inside the viewport before the mouse move.) Extend the existing
`rail: no phantom page scroll and no row shift on hover` describe in `e2e/hel1750-actions-menu-viewport-fit.spec.ts`
with a new test (light and dark, 1280x400): ensure enough dashboards exist for the rail to be long (reuse the spec's
existing seeding), `window.scrollTo(0, document.documentElement.scrollHeight)`, record the LAST row's bounding box,
hover it with the real mouse, record again, assert |dy| <= 1 and scroll height unchanged and the trigger visible inside
the row. The assertion that must carry the guard alone is the row-shift assertion (not the scrollHeight one, which the
existing test already has). Mutation to record: remove `position: relative` from `.dashboard-list` in
`DashboardList.css` (the D10 fix); with only the row-shift assertion enabled the new test must go red. Record command
and output in red-evidence.md, then restore.

**D6 — Focus on open is keyed on `placed`.** A converted panel is `visibility: hidden` until placed, and a hidden
element cannot take focus (HEL-1750 hit this; `ActionsMenu.tsx` re-keyed its focus effect on `placed`). So:
UserMenu's focus-in effect (`UserMenu.tsx`, today `useEffect(..., [isOpen])`) runs on `[isOpen, placed]` and acts only
when `placed`. `ProvenanceTrigger` passes `placed` to `ProvenancePopover`, whose focus `useLayoutEffect` adds `placed`
to its deps and does nothing until it is true (the Checks-heading branch included). The proof is an e2e in a real
browser per converted popover asserting `document.activeElement` is inside the panel after opening by keyboard; a jsdom
`toHaveFocus` test is not accepted as the proof (jsdom does not enforce visibility for focus).

**D7 — Re-fit on content growth: an additive `reposition()` from the hook plus a ResizeObserver on an inner
content element.** `fitPanelVertically` returns `maxHeight = natural height` even when the panel fits, so a panel
measured in a small state (provenance "Loading provenance…", the editor before its contrast warning or `InlineError`)
is pinned to that height; a `ResizeObserver` on the capped panel itself never fires when content arrives. Decision:
`usePortalPopover` returns one new stable callback, `reposition()`, which re-runs the opted-in `place` against the
current panel and trigger exactly as the resize listener does (a no-op when not open or not opted in). This is the one
shared-file edit, additive and backward-compatible (no existing consumer reads it); it gets its own hook unit test.
Each converted consumer wraps its panel's content in an inner element (or uses an existing one) that is NOT
height-capped and observes it with a `ResizeObserver` (guarded `typeof ResizeObserver !== "undefined"` for jsdom),
calling `reposition()` on a change. Natural height is measured as `scrollHeight + (offsetHeight - clientHeight)`, which
grows with content even when the panel is capped. Dispatching a synthetic `window` `resize` event is forbidden (it would
re-run every app-wide resize handler, including react-grid-layout). Covered: provenance loading to ready and loading to
error (unit, with a controlled observer) and the e2e cache-miss open; the editor's contrast warning and save error
(unit). Alternative rejected: an observer inside the hook on the panel's first child — implicit coupling to every
consumer's DOM shape.

**D8 — Provenance cap, width and refs.** The provenance `place` passes `cap: Math.min(0.7 * window.innerHeight, 480)`
to `fitPanelVertically`, so the inline `maxHeight` never exceeds the CSS design cap (`min(70vh, 480px)`), and keeps
`computePos`'s existing `width = min(360, innerWidth - 40)` and `left` clamp to an 8px margin on both sides. The old
`MIN_ROOM_BELOW = 320` heuristic is replaced by the measured fit (prefer below); a panel opened while loading may open
below and later flip above when its content arrives — expected per the spec, recorded in probes.md so it is not read as
jitter. Refs: `ProvenanceTrigger` passes the hook's `panelRef` down; `ProvenancePopover` merges it with its own local
ref (a callback ref assigning both), since the local ref drives focus and the native Tab/keydown listener. The HEL-1207
doc comment saying "No `panelRef` is attached to the hook, so it does not close on focus-out" is updated to the new
truth. UserMenu's local `panelRef` (`useRef` at `UserMenu.tsx:80`) is replaced by the hook's `panelRef` (one ref, no
merge needed).

**D9 — Scroll CSS is consumer-scoped, on new classes only.** `overflow-y: auto` (and any `max-height`-related rule)
goes on `.user-menu__popover`, on a NEW class on the appearance editor's portalled `<form>` named
`.dashboard-appearance-editor__panel` (unused today), and stays on `.provenance-popover`. The form must NOT receive the
existing `.dashboard-appearance-editor` class: that class belongs to the trigger wrapper and carries `z-index: 4`
(`DashboardAppearanceEditor.css`) and `display: none` at widths up to 768px (`App.css`), either of which would break
the panel. Nothing goes on the shared `.popover__panel` (`Popover.css`), which ActionsMenu, OutputSchemaDisclosure and
others use.

**D10 — The appearance editor is desktop-only; which instance is probed.** At widths up to 768px `App.css` hides
`.dashboard-appearance-editor` (the trigger wrapper) by product rule (no editing on phone, mobile-pwa-handoff §2), so
no instance is openable on phone. Its probe and e2e cover the desktop short windows only; probes.md records phone as
"not rendered" with that citation, and this change never un-hides it. On desktop, `DashboardAppearanceEditor` is mounted
in `CommandBar.tsx` and `DashboardMetaRow.tsx`; probes.md records which instance is visible at each probed size and
probes that one; the e2e uses the visible one. UserMenu (BottomNav `nav`) and provenance (mobile stack header) keep
their phone probes and e2e.

**D11 — Where the content observer applies, and the provenance wrapper.** UserMenu's items are static, so it gets no
content observer (no `reposition()` call); it only gets measured placement. Provenance: `.provenance-popover` is a flex
column with `gap` between its direct children, so the inner observed wrapper takes over that column layout and gap
(`display: flex; flex-direction: column; gap: var(--space-3)`) and the panel keeps only the cap and scroll, so the
visual spacing is unchanged (checked in the running app, light and dark). The appearance editor observes an inner
wrapper around its form content the same way, preserving its existing layout. A content wrapper inside a `role="menu"`
is never introduced.

**D12 — Focus-out with the editor.** D3's real-browser check includes clicking the editor's colour input (a native
picker yields a `focusout` with `relatedTarget` null, which the hook ignores) and confirms the editor stays open.

**D13 — Executor notes from the design gate (round 3).** The appearance editor has no focus-on-open today and does not
get one (its real-browser focus checks are D3/D12 only). The hel1750 rail guard is a top-level `for (theme)` loop of
tests, not a `describe`: add the new test inside that loop. If removing `position: relative` does not turn the new
last-row test red on its own, record that and raise it; never change the mutation or the assertion to force a red.
The hook's one-shot horizontal clamp also engages for right-anchored converted panels once `panelRef` is attached; it is
a no-op when the local `place` already clamps, and unit tests must not double-count it.

**D14 — Amends D13: the appearance editor moves focus into its form once placed (evaluation-2).** Attaching the hook's
`panelRef` (required for measured placement) opts the editor into the hook's close-on-focus-out. With no focus-on-open,
a keyboard user's first Tab after opening goes to the element after the trigger, outside both trigger and panel, so the
editor closes and its form becomes keyboard-unreachable (measured in evaluation-2; before this change the editor had no
`panelRef` and stayed open). Decision: once `isOpen && placed`, a layout effect moves focus to the selected preset (or
the first focusable control), keyed on `placed` exactly as D6. Rejected: detaching `panelRef` (placement depends on it)
or adding a hook option to suppress focus-out close (a second shared-file edit for a worse outcome). Proven with a
real-browser e2e: focus the trigger, press Enter, `document.activeElement` is inside the form, press Tab, the form is
still open with focus inside it; red first against commit d4969e8d9. Recorded as a behavior change in probes.md (D3).

## Risks / Trade-offs

- [Concurrent lanes edit `ProvenanceTrigger.tsx`/`ProvenancePopover.tsx` or `usePortalPopover.ts`] → keep edits to the
  placement function and the style object only; do not reformat; PR names every shared file touched.
- [Shared Playwright browser hijacked by another lane] → assert `page.url()` contains this lane's port before every
  probe/screenshot; e2e runs use their own Playwright process, not the MCP browser.
- [Measured placement hides the panel until placed — a jsdom unit test that checks visibility could regress] → the hook
  already reports `placed: true` only after `place` runs; update affected unit tests deliberately and say so.
- [Content grows after the first placement] → D7 (`reposition()` + inner-content observer), named in the PR as the
  one shared-file edit.
- [`visibility: hidden` until placed blocks focus-on-open] → D6, proven in a real browser.

## Migration Plan

Frontend-only; no data or config migration. Rollback = revert the PR.
