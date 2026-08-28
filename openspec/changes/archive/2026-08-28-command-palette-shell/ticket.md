# HEL-496: Command palette shell (Cmd/Ctrl+K) + action registry

## Description

Helio has no keyboard-driven command surface. Navigation is mouse-driven through the sidebar (`frontend/src/shared/chrome/SidebarBody.tsx`) and React Router routes (defined in `frontend/src/app/AppRoutes.tsx`, rendered from `frontend/src/app/App.tsx`). A command palette is the backbone for fast navigation, search, quick-create, and shortcuts. This ticket builds the shell and a typed action registry only; search, quick-create, shortcuts help, and recents are separate tickets that plug into it.

This is the first leaf of epic HEL-348 (Command Palette & Global Search). HEL-503 (global search), HEL-516 (quick-create actions), HEL-510 (shortcut system + help overlay), and HEL-519 (recents) are all blocked by this ticket and will register into the action-registry contract landed here. The registry's public surface is therefore a deliberate design decision, not an incidental one.

## Premise notes (validated against the live tree, 2026-08-28)

**The ticket's opening claim — "Helio has no keyboard-driven command surface" — is FALSE as written.**
`Cmd/Ctrl+K` is already bound and shipped: `AppShell` (`frontend/src/app/App.tsx:108-117`) opens the assistant
`QuickLauncherOverlay` on that exact combination (design decision D7, backed by the `chat-quick-launcher` spec,
covered by `App.test.tsx:1099-1200`). This was escalated during Planning and resolved by the human:

> **Resolution (2026-08-28, `palette-takes-k-launcher-moves`):** the command palette takes `Cmd/Ctrl+K`. The
> assistant quick-launcher rebinds to `Cmd/Ctrl+J`, and the palette seeds an "Open assistant" action so the
> launcher stays reachable from the palette itself. Both bindings must be declared in ONE discoverable place
> rather than a second scattered `useEffect`, because HEL-510 (keyboard shortcut system + help overlay) will
> enumerate them.

The existing `chat-quick-launcher` spec requires only that the overlay be reachable by "a keyboard shortcut" and
never names a key, so the rebind breaks no spec requirement — it is an implementation + test change only.

Other corrections to the ticket's stated context:

- `AppShell` **does** exist — as a component inside `frontend/src/app/App.tsx` (lines 32-232), not as its own
  file. It is the layout route every protected page renders inside, so it is the correct and
  authenticated-only home for the global key handler, exactly as the ticket says.
- The route set has grown since filing. Live authenticated routes include `/`, `/sources`, `/sources/:id`,
  `/pipelines`, `/pipelines/:id`, `/connectors`, `/registry`, `/registry/:id`, `/metrics`, `/metrics/:id`,
  `/chat`, `/settings`, plus proposal/patch-set review routes. The ticket's enumeration is illustrative.
- Routes live in `frontend/src/app/AppRoutes.tsx`, not `App.tsx` as the ticket states.
- Shared primitives exist at `frontend/src/shared/ui/`: `Modal.tsx`, `TextField.tsx`, `EmptyState.tsx`.
  `Modal` already provides the focus trap, Esc routing, backdrop-click close, and native-`<dialog>` focus
  restore, so the palette must reuse it rather than hand-roll any of that.
- `frontend/src/shared/chrome/OverlayProvider.tsx` provides `useOverlay()` single-active-overlay coordination.
- Theme toggling is available via `useTheme().toggleTheme` (`frontend/src/theme/ThemeProvider.tsx`).
- `frontend/src/shared/chrome/sections.ts` is an established route registry; the `nav-section-registry` spec
  forbids a second hardcoded route→label map, so nav actions must derive from it.

## Scope

- Build a `CommandPalette` overlay (new `frontend/src/features/commandPalette/` feature dir) opened by `Cmd/Ctrl+K` from anywhere in the authenticated shell (register the global handler in a root effect; must not fire while typing in an input/textarea unless the palette itself is focused).
- Render on the shared `Modal`/overlay pattern (DESIGN.md §6, opaque `--app-surface-strong`, `--app-overlay` backdrop, one entrance animation §3). A single text input at top (reuse `TextField`/input tokens) filters a scrollable, keyboard-navigable results list (arrow keys, Enter to run, Esc to close, focus trap, restore focus on close).
- Define an **action registry**: a typed `CommandAction` interface (`id`, `title`, `keywords`, optional `section`/`group`, `icon` from lucide, `run()`), plus a registry module and a hook to register/deregister actions. Seed it with static navigation actions (Go to Dashboards / Sources / Pipelines / Type Registry, toggle theme) so the palette is useful on its own.
- Fuzzy/substring filtering over title+keywords with sensible ranking; results grouped by section with mono `.eyebrow` section labels (§3). Empty query shows a default list; no matches renders `EmptyState` (§7).

## Acceptance criteria

- `Cmd/Ctrl+K` opens the palette from any authenticated route; `Esc` closes and restores focus; fully keyboard-operable (arrows/Enter), focus-trapped (§8).
- The assistant quick-launcher is rebound to `Cmd/Ctrl+J` and still opens correctly; both bindings are declared
  in one shared, enumerable place; an "Open assistant" action in the palette opens the quick-launcher.
- Seeded navigation + theme actions run and route/act correctly; filtering ranks matches reasonably.
- Overlay uses shared Modal/overlay tokens (opaque surface, overlay backdrop, single entrance); no hardcoded colors/spacing/type; correct in light and dark.
- Action registry API supports register/deregister so later tickets can contribute actions; documented with a short usage comment.
- No matches shows `EmptyState`. Unit tests for the registry + filtering and a render test for open/close/keyboard; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

- Searching resources (HEL-503), quick-create actions (HEL-516), the shortcuts help overlay (HEL-510), and recents (HEL-519) — this ticket only makes them pluggable.

## Dependencies

None. Foundation for the other HEL-348 tickets.
