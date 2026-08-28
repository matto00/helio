## Why

Helio has no keyboard-driven command surface: every navigation is a mouse trip through the sidebar. A
command palette is the backbone for fast navigation, global search, quick-create, and shortcuts. Four
already-filed tickets (HEL-503 search, HEL-516 quick-create, HEL-510 shortcuts, HEL-519 recents) are blocked
on the action-registry contract this change lands, so the registry's public surface is the primary
deliverable — the palette UI is what proves it works.

## What Changes

- New `frontend/src/features/commandPalette/` feature: a `CommandPalette` overlay built on the shared `Modal`
  pattern, opened by `Cmd/Ctrl+K` from any authenticated route via a root-level effect, closed by `Esc` with
  focus restored to the previously focused element.
- A single text input filters a scrollable, keyboard-navigable result list (arrows move the active item,
  Enter runs it), grouped into sections with mono `.eyebrow` labels. An empty query shows the default list; a
  query with no matches renders the shared `EmptyState`.
- A typed **action registry**: a `CommandAction` contract (`id`, `title`, `keywords`, `section`, `icon`,
  `run()`) plus register/deregister with a disposer-return, a `useCommandActions` hook for React callers, and
  a way for registrants to observe the live query so query-dependent contributors (search, recents) can plug
  in later without reworking this contract.
- Seeded navigation actions derived from the existing `frontend/src/shared/chrome/sections.ts` registry
  (never a second hardcoded route→label map, per the `nav-section-registry` spec), plus a theme-toggle action.

## Capabilities

### New Capabilities

- `command-palette-shell`: the overlay's open/close/focus/keyboard behavior and its visual contract.
- `command-action-registry`: the typed `CommandAction` contract and the register/deregister API that later
  tickets contribute through.
- `command-palette-filtering`: matching and ranking over title + keywords, section grouping, and the
  empty-query / no-match states.
- `command-palette-navigation-actions`: the seeded navigation, theme, and "Open assistant" actions, derived
  from the nav section registry.
- `keyboard-shortcut-declarations`: global keyboard bindings declared as data in one enumerable module, the
  shared typing-context guard, and the `Cmd/Ctrl+K` (palette) / `Cmd/Ctrl+J` (quick-launcher) assignment.

### Modified Capabilities

None. No existing requirement changes. `nav-section-registry` and `overlay-management` are consumed as-is, and
`chat-quick-launcher` requires only that the quick-launcher be reachable by "a keyboard shortcut" without naming
a key — so rebinding it to `Cmd/Ctrl+J` needs no delta against that spec.

## Impact

- Frontend only; no backend, schema, API, or dependency changes. `lucide-react`, `react-router`, the shared
  `Modal`/`TextField`/`EmptyState` primitives, and `ThemeProvider` are all already present.
- Touches the root shell (`frontend/src/app/`) to mount the provider, the global key handler, and the overlay
  inside the authenticated route tree only.
- Adds Jest unit tests for the registry and filtering, plus a render test covering open/close/keyboard.

## Non-goals

- Resource search (HEL-503), quick-create actions (HEL-516), the shortcuts help overlay (HEL-510), and
  recents (HEL-519). This change only makes them pluggable.
- Persisting palette state, fuzzy-matching beyond title+keywords, and any server-side work.
