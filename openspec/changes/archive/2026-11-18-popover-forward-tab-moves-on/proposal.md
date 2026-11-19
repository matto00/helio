## Why

HEL-1759 made every keyboard Tab out of an opted-in portalled popover return focus to the trigger. For forward Tab that is wrong: the owner ruled (2026-11-18) that forward Tab off the actions menu must close it and move on to the next control after the trigger (the menu-button pattern), and only Shift+Tab returns to the trigger.

## What Changes

- Forward Tab that moves focus out of an opted-in popover's panel closes the popover and puts focus on the next tabbable control after the trigger, as if the panel sat in the DOM right after its trigger (the portal moved it to the end of `<body>` or of the enclosing `<dialog>`).
- Shift+Tab out of the panel keeps HEL-1759's behaviour (close, focus the trigger).
- The rule lives in the shared `usePortalPopover` hook, so it applies to every consumer whose keyboard focus can actually Tab out of its panel. Consumer review:
  - **ActionsMenu: changes** (the ruling).
  - **DashboardAppearanceEditor: changes** (forward Tab off Save, its last control). Same rule and same reasoning: a non-modal disclosure whose content is logically right after its trigger; Shift+Tab off the first preset still returns to the trigger.
  - **OutputSchemaDisclosure: changes** (found at the final gate; `OutputSchemaDisclosure.tsx:47,70` destructures the hook's `panelRef` and attaches it to its portalled `role="dialog"` panel). Its panel holds a filter input and "Show all N" buttons, so forward Tab off the last control now closes the panel and moves on to the control after the "N fields" trigger. Same non-modal disclosure reasoning as the appearance editor; Shift+Tab off the first control still returns to the trigger.
  - **Select: no change** - a virtual-focus combobox; its options are `tabIndex={-1}` (`Select.tsx:203,241`), so real focus never enters the panel and the panel listener's `panel.contains(event.target)` test never matches.
  - **ProvenancePopover: no change** - its own panel keydown wrap (`ProvenancePopover.tsx:103-125`) `preventDefault`s Tab at the last element, and the hook stands down on `defaultPrevented`; pinned by real-host tests in `ProvenanceTrigger.test.tsx`.
  - **UserMenu: no change** - it uses its own local `panelRef` (`UserMenu.tsx:79-80`), never the hook's. **IconButton: no change** - it only forwards `ref` for hook-driven triggers (`IconButton.tsx:58`) and has no panel.
- The hel1759 e2e spec gains forward-Tab cases (actions menu on desktop and inside the phone step sheet; appearance editor on desktop), and OutputSchemaDisclosure.test.tsx pins the disclosure that fail on main first.

## Capabilities

### New Capabilities

### Modified Capabilities
- `portal-popover-hook`: the "Keyboard focus leaving an opted-in popover's panel returns to the trigger" requirement is split by direction: Shift+Tab returns to the trigger, forward Tab moves to the next control after the trigger.

## Impact

- `frontend/src/hooks/usePortalPopover.ts` (+ its unit test).
- `e2e/hel1759-popover-keyboard-focus.spec.ts` (new forward-Tab cases).
- No consumer component should need changes; no backend, schema or migration change.
