## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD edd3a028fa070f126d36993eba7fb8afa27c7d37 (= origin/main; change dir untracked). Artifacts: ticket.md, proposal.md, design.md, tasks.md, specs/mobile-dashboard-pull-refresh/spec.md, plus skeptic-design-1.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/phone-refresh-control-tidyups/HEL-1681`.
- **Round-1 CR1 (provider placement): resolved.**
  - `PanelList.tsx` has exactly one JSX `return` (`:298`). The other `return`s at `:221`, `:237`, `:258`, `:269`, `:272` and `:293` are inside effects and handlers. So "wrap the ENTIRE returned `<section>`, DOM-less, unconditional" is implementable as written. It cannot change the position of `.panel-list__zoom-container` (`:430`) in the tree.
  - Dispose ownership is now single: the provider owns it, and the stack falls back to its own instance only when there is no provider.
  - The status region has one owner (the stack).
  - The 768px-crossing node-identity check is in D1 and task 2.2.
  - Lifetime: `pullRefreshRegistry.ts`'s `register()` cleanup deletes the panel from the round and calls `settleIfDone()`. If the stack unmounts mid-round, every entry unregisters and `end()` fires. So once the registry outlives the stack, busy cannot get stuck after the stack's `dispose()` call (today `MobilePanelStack.tsx:178-181`) is removed.
- **Round-1 CR3 (`IconButton` vs hand-rolled): resolved.** DESIGN.md §5 (the "Icon-only buttons" bullet list) allows a hand-rolled control for "a sub-24px compact size". D3 now invokes that exception and gives a 19.2px painted box, a 14px `ICON_SIZE.sm` glyph, both `aria-label` and `title`, and a code-comment citation.
- **Round-1 non-blocking notes: resolved.**
  - proposal.md now says item 2 involves "no requirement change".
  - The updates to `DashboardRefreshLine.test.tsx` are planned in D3, and their intent is kept.
- **Round-1 CR2 (hit expander): only partly resolved.**
  - Fixed: the escape from the clip (moving `overflow: hidden` to the inner span), the 44px hard floor, and the `elementFromPoint` measurement in task 2.4.
  - Not fixed: the anchoring rule D3 now specifies does not fit the real geometry. See below.
- **Geometry, from the tree:**
  - `.panel-list` has **`overflow: hidden`** (`PanelList.css:8`), with phone padding `var(--space-5) var(--space-3)` = 20px / 12px (`PanelList.css:108`). It is the first in-flow child of `.app-content` (`App.tsx:264`; the sr-only `<h1>` is absolutely positioned).
  - `.dashboard-refresh-line` is 1.6 × `--text-xs` (0.75rem) = 19.2px tall with `margin-bottom: var(--space-2)` = 8px (`DashboardMetaRow.css:95-104`).
  - The chip row is 44px, and each chip's `::after` covers the row from its top edge (`DashboardChipRow.css:8-11,62-71`).
  - Relative to the `.panel-list` top: the line spans y=20 to 39.2 and the chip row starts at y=47.2.
- **Spec delta and AC coverage, re-checked fresh:**
  - Items 1-5 map to D1-D4/D9, D7, D6, D5 and D8.
  - The e2e test fails first on base (task 1.1).
  - No placeholders. Non-goals match the run constraints.
  - D2's `start()` contract matches `pullRefreshRegistry.ts` as it stands.

### Verdict: REFUTE

### Change Requests

1. **D3 "44px hard floor, anchored upward": the rule as written cannot be met, so it forces an escalation the geometry does not need.**
   - **Block axis.**
     - D3 requires the expander's bottom edge to be "no lower than the line's bottom edge" (y ≤ 39.2). A 44px expander then has its top at y = 39.2 − 44 = **−4.8px**, above the `.panel-list` box.
     - `.panel-list { overflow: hidden }` (`PanelList.css:8`) clips those 4.8px, so the real hit height is at most 39.2px.
     - D3's own escape clause ("if 44x44 cannot fit without … leaving the page's top padding … the executor stops and escalates") then fires every time. That is a non-reversible escalation, in overnight mode, for a placement that fits.
   - **What does fit.** The tap area can occupy y from 0 (the padding's top edge) to 47.2 (the chip row's top). That is a 47.2px window: a 44px area fits with 3.2px to spare.
   - **Required revision:** state the placement as that window, not "bottom ≤ line bottom". For example, set the expander's top edge flush with the `.panel-list` padding top, i.e. `top: calc(-1 * var(--space-5))` relative to a button that fills the line's height. Its bottom then lands 4.8px into the 8px gap and 3.2px above the chip row.
   - **Inline axis.**
     - A centred 44px expander on a 19.2px button flush at the line's inline end reaches (44 − 19.2) / 2 = 12.4px past the content edge. The inline padding is only 12px.
     - So 0.4px falls outside `.panel-list` and is clipped, leaving 43.6px. That is below §3's `44 − samplingStep` floor (43.75px at 0.25px).
     - D3's own sample point "22px right of the glyph centre" lands at x = viewport + 0.4px, which is off-viewport. `elementFromPoint` returns `null` there, so task 2.4 would fail on a correct build.
   - **Required revision:** anchor the expander to the button's inline-end (for example `right: 0`, `width: 44px`, so it grows inline-start only). Alternatively, inset the button by at least 0.4px. Then rewrite the task 2.4 sample points against the expander's actual box: bisect both axes with `elementFromPoint` to ≥ 44 − step, keep every point inside `.panel-list`, add a point 1px into the chip row that hits the chip, and keep the existing "chip tap area unchanged" check. Keep the escalate-don't-shrink clause; it is correct once the window is right.

### Non-blocking notes

- **Font-size dependence.** The 3.2px slack depends on the root font size, because the padding, line and gap are rem tokens while 44px is fixed. The window is 2.95rem, which is at least 44px only when the root font size is 14.9px or more. Record this in the CSS comment next to the expander.
- **Stack `busy` on remount.** `MobilePanelStack` initialises `busy` with `useState(false)` and learns about changes only through the subscription. Once the registry outlives the stack, seed it from `registry.busy`, so a stack that mounts during a round never shows a stale idle state.
- **Reversible UI choices.** The `RotateCw` and `Check` glyphs, the trailing placement, and the button-round indicator suppression (D4) are correctly marked as reversible UI choices for the PR's "UI decisions taken overnight". Nothing here needs owner escalation.
