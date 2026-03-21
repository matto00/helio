## Context

The app has four floating UI components: `ActionsMenu` (used in both the dashboard sidebar and panel grid), `DashboardAppearanceEditor` (in the app header), and `PanelAppearanceEditor` (in the panel grid, always in controlled mode). Each manages its own `isOpen` state independently with no knowledge of the others.

Existing click-outside is handled via a full-screen invisible `button.popover__scrim` rendered behind the popover panel. This works per-component but doesn't prevent two components from being open at the same time.

## Goals / Non-Goals

**Goals:**
- Escape key closes any currently open overlay
- Opening overlay A closes overlay B (mutual exclusion)
- Consistent behavior across all four overlay components
- No new external dependencies

**Non-Goals:**
- Nested/stacked overlays (no use case currently)
- Focus trapping or full ARIA modal behavior (deferred to modal work in HEL-48)
- Server-side or cross-session state

## Decisions

### Decision 1: Lightweight `OverlayProvider` context over Radix UI

**Chosen**: Custom `OverlayProvider` React context with a single `activeId: string | null`.

**Rationale**: The current overlay components use a custom scrim pattern with `Popover.css`. Adopting Radix UI would require restructuring all component markup and CSS. A context-only solution leaves the rendering and styling untouched; only the open/close logic changes. Radix UI remains a viable future option (e.g., for HEL-48) when a full component library migration is warranted.

**Alternatives**:
- **Radix UI `Popover` / `DropdownMenu`**: Gets all behavior for free but requires markup restructuring and a new dependency. Better suited for a broader component library migration.
- **Event-based (CustomEvent broadcast)**: Avoids prop drilling but harder to test and less idiomatic in React.

### Decision 2: Single `activeId` string rather than a stack

**Chosen**: `activeId: string | null` — only one overlay can be active at a time; opening a new one replaces the previous.

**Rationale**: The UI has no use case for nested overlays. A single ID is the simplest state shape and makes mutual exclusion automatic.

### Decision 3: `useId()` for stable overlay IDs

**Chosen**: Each overlay component calls `useId()` to generate a stable, unique ID per component instance.

**Rationale**: Avoids requiring callers to pass IDs, keeps components self-contained, and works naturally with multiple `ActionsMenu` instances.

### Decision 4: Global Escape listener in `OverlayProvider`

**Chosen**: `OverlayProvider` attaches a single `keydown` listener on `window` that calls `closeAll()` when Escape is pressed.

**Rationale**: Centralizing the Escape handler avoids duplicate listeners across components and ensures consistent behavior regardless of which element has focus.

**Note for `PanelAppearanceEditor` controlled mode**: When `PanelAppearanceEditor` is controlled (open state managed by parent `PanelGrid`), its own `isOpen` is not tracked by `OverlayProvider`. It still needs Escape handling, which is handled by adding a `useEffect` listener inside the component that calls `onClose?.()` on Escape when `isOpenExternal === true`. Mutual exclusion from the parent side: `PanelGrid` sets `customizePanelId` in response to menu item clicks, and the `ActionsMenu` click calls `openOverlay` which will close its menu — this is naturally handled since the `ActionsMenu` closes on item click already.

## Risks / Trade-offs

- **Controlled `PanelAppearanceEditor` outside the context**: When opened from `PanelGrid`, the panel appearance editor is not registered as an overlay in `OverlayProvider`. If another overlay opens, `PanelAppearanceEditor` won't auto-close. Mitigation: `PanelGrid` can close `customizePanelId` when another overlay opens — but this adds coupling. Accepted trade-off for now: `PanelAppearanceEditor` handles Escape itself; cross-component close is a known limitation documented in the ticket.
- **`useId()` requires React 18**: Already in use in the project, no concern.
