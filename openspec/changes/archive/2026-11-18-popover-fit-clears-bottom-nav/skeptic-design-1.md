## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD c42c7ddf3dfe87971f9ed209160cf81578a19e80 (change dir untracked; static verification against the tree).

### What I verified (with evidence)

- **Caller enumeration is complete for the shared fit.** `grep -rn "fitPanelVertically\|fitSelectPanel" frontend/src` (non-test)
  hits exactly: `useProvenancePopoverHost.tsx:39`, `ActionsMenu.tsx:28`, `Select.tsx:150` (via `selectPanelFit.ts:24`),
  `DashboardAppearanceEditor.tsx:50`. Matches design callers 1-4. Other `.bottom-nav` / `innerHeight` vertical placement:
  `outputSchemaPanelPlacement.ts:73` (caller 5) and `UserMenu.tsx:155,159` (caller 6, `bottom` anchored above the trigger).
  Other `createPortal` users checked: `ConnectorSelectField` (portals a modal), `IconButton` (no portal of its own,
  ref-forwarding only), `Toast`, `MobileNavSheet`, `RefinementChatDrawer` (sheets, not trigger-anchored popovers).
  `usePortalPopover`'s built-in clamp (`hooks/usePortalPopover.ts` ~L91-126) is horizontal only (`right`), so it is not
  a missed vertical-fit site.
- **Stacking claim (point 1) is correct statically.** `theme.css:196` `--z-popover: 100`; `Popover.css:31`,
  `inputs.css:118` use it; `BottomNav.css:27` `.bottom-nav { z-index: 5 }`, with its own comment "Below portalled
  overlays ... and the native <dialog> top layer". Provenance/Select/ActionsMenu portal to `document.body` or the open
  dialog (`ProvenancePopover.tsx:133`, `Select.tsx:74`, `ActionsMenu.tsx:102`, `useProvenancePopoverHost.tsx:125`). So a
  literal `elementFromPoint` at an overlapping last item will most likely return the item before the fix.
- **D4 is a faithful reading, not a weakening.** The AC's purpose is a point-hit red-before/green-after on the last item.
  D4 keeps the literal `elementFromPoint` check (b) unweakened, and adds (a) geometric clearance and (c)
  `elementsFromPoint` containing no `.bottom-nav` — strictly stronger, and (c) is the elementFromPoint-family assertion
  that is genuinely red when the item overlaps the nav band. D4 also forbids weakening (b)/(c) and requires recording
  which assertion went red. The alternative (make the literal check red by changing stacking) is out of ticket scope and
  would make things worse (nav over content). D0 gives an ESCALATION path if the geometry cannot be reproduced. Accepted.
- **D1 (point 2) is correct.** `panelFit.ts` computes `bottom: viewportHeight - (trigger.top - gap)` and callers apply it
  as a CSS `bottom` (`useProvenancePopoverHost.tsx` returns `{ bottom: fit.bottom }` for "above"; `ActionsMenu.tsx`
  likewise). CSS `bottom` on a fixed element is measured from the real viewport, so passing `innerHeight - inset` as
  `viewportHeight` would drop above-opening panels by the inset. Shrinking only `roomBelow` is the right seam; default 0
  is byte-identical.
- **D2 (point 3) is sound.** All app dialogs are modal (`Modal.tsx:134` `showModal()`; no `.show()` call sites;
  `shortcuts.ts:114` confirms "none exist in the tree today"), so `closest("dialog[open]")` == "inside a modal dialog".
  Nav band `innerHeight - navRect.top` reproduces caller 5's `navTop` exactly (`navTop = vh - inset = navRect.top`), and
  `navTop ?? viewport.height` in `placeSchemaPanel` (L52) means inset 0 with no nav is identical to today's `null`. The
  safe-area probe element approach (fixed, hidden, `height: env(safe-area-inset-bottom, 0px)`) is a real measurement;
  the rationale for not using a custom property is correct. jsdom rects are 0, so unit behaviour is preserved.
- **ACs covered:** AC1 → D0/D4/tasks 1.1, 4.1 (390x844 + short, light+dark, red recorded via a named mutation); AC2 →
  task 4.2 names all three spec files (`e2e/hel1750-actions-menu-viewport-fit.spec.ts`,
  `hel1756-popover-viewport-fit.spec.ts`, `hel1759-popover-keyboard-focus.spec.ts` all exist). No API/schema impact, so no
  contract delta is owed; the spec delta is under `specs/popover-viewport-fit/`.
- No TODO/TBD placeholders; proposal, design, tasks and spec are consistent.

### Verdict: CONFIRM

### Non-blocking notes

- Reproducibility risk for (c) at 390x844: with the unfixed fit and the HEL-1744 numbers (popover bottom 800, nav top
  ~776), the last item's centre may land only a few px inside the nav, or above it. D0 should pick a trigger that puts
  the popover's bottom well into the band (e.g. a capped popover reaching `vh - 8`), and confirm the item centre's x is
  within the inset capsule's horizontal range (the nav is inset from both sides).
- "Short phone viewport (390x560 or PHONE_SHORT_HEIGHT)": the existing hel1756 spec uses 390x400 ("phone short"). Pick
  one and state it; prefer reusing 390x400 for consistency.
- The spec scenarios assert only `elementFromPoint` returns the item plus the 8px clearance; consider adding the
  "`elementsFromPoint` contains no `.bottom-nav`" clause to the scenario text so the spec matches D4(c).
- The safe-area branch of `readBottomInset` is only provable by unit test with stubbed rects (Chromium in Playwright
  reports 0 safe area); say so in the PR rather than implying e2e coverage.
- `tasks.md` has an empty `## Standing Constraints` heading; fill or remove.
- Task 3.1's `--testPathPatterns` list includes names that may not match files (e.g. `Provenance`); confirm it actually
  runs the intended suites (jest prints the matched count).
