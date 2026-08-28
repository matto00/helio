## 1. Shared shortcut declarations

### Frontend

- [x] 1.1 Add `frontend/src/shared/chrome/shortcuts.ts` exporting the global binding table (`{id, label, combo}` for `command-palette` = Cmd/Ctrl+K and `quick-launcher` = Cmd/Ctrl+J), verified by the table being the only place either combo appears in `src/`
- [x] 1.2 Add `matchesCombo(event, combo)` and `isTypingTarget(target)` (input/textarea/select/contenteditable) to that module, verified by their unit tests in group 6
- [x] 1.3 Rebind the existing quick-launcher handler in `AppShell` (`app/App.tsx:108-117`) to consume `shortcuts.ts` on the Cmd/Ctrl+J entry, verified by 6.6 asserting Cmd/Ctrl+J DOES open it and Cmd/Ctrl+K does not

## 2. Action registry

### Frontend

- [x] 2.1 Add `features/commandPalette/model/types.ts` with the `CommandAction` contract (`id`, `title`, `subtitle?`, `keywords?`, `section?`, `icon?`, `matchesQuery?`, `run()`), verified by `npm run typecheck`
- [x] 2.2 Add `features/commandPalette/model/commandRegistry.ts` — framework-free store with `register(actions) -> dispose`, `getActions()`, `setQuery()/getQuery()`, `subscribe()`, dev-only duplicate-id warn, verified by group 6 registry tests
- [x] 2.3 Add a short usage comment at the top of `commandRegistry.ts` documenting the contract and a register/deregister example, verified by review against the `command-action-registry` spec's documentation requirement
- [x] 2.4 Add `features/commandPalette/model/ranking.ts` with pure `rankActions(actions, query)` (title-prefix > substring > subsequence > keyword; stable tiebreak on registration index; `matchesQuery` actions unscored, kept in registrant order after scored ones within a section), verified by group 6 ranking tests

## 3. Palette context and hooks

### Frontend

- [x] 3.1 Add `features/commandPalette/CommandPaletteProvider.tsx` creating one registry instance plus open/close state, exposing it via context, verified by the render tests in group 6
- [x] 3.2 Add `useCommandActions(actions)` registering on mount / disposing on unmount / replacing on identity change, verified by the leak and replace tests in 6.3
- [x] 3.3 Add `useCommandQuery()` and `useCommandPalette()` (open/close/isOpen) accessors reading the store via `useSyncExternalStore`, verified by 6.4's open-palette-sees-new-registration test

## 4. Palette UI

### Frontend

- [x] 4.1 Add `features/commandPalette/ui/CommandPalette.tsx` rendering `<Modal size="lg">` with an autofocused `TextField` and a grouped, scrollable result list, verified by the open/close render test in 6.5
- [x] 4.2 Wire arrow-key navigation with wrap-around, Enter-to-run-and-close, active-item `scrollIntoView`, and `aria-activedescendant` on the input, verified by the keyboard test in 6.5
- [x] 4.3 Register the palette with `useOverlay()` mirroring `QuickLauncherOverlay`'s wiring, verified by opening the palette closing any other active overlay
- [x] 4.4 Render section groups with the shared mono `.eyebrow` label and the shared `EmptyState` on no matches, verified by the no-match test in 6.5
- [x] 4.5 Add `features/commandPalette/ui/CommandPalette.css` using only design tokens (`--app-surface-strong`, overlay/spacing/type tokens), one entrance animation, verified by `npm run lint` and a token check for hardcoded colors

## 5. Built-in actions and mounting

### Frontend

- [x] 5.1 Add `features/commandPalette/model/builtInActions.ts` deriving navigation actions from `sections.filter(isNavSection)` (entry's own label/icon, `useNavigate()`), verified by 6.7's registry-derivation test
- [x] 5.2 Add the theme-toggle action via `useTheme().toggleTheme`, labelled for the theme it switches TO, with "dark"/"light"/"appearance" keywords, verified by 6.7
- [x] 5.3 Add an "Open assistant" action that opens the rebound quick-launcher, with "chat"/"assistant" keywords, verified by 6.7
- [x] 5.4 Mount `CommandPaletteProvider` + `<CommandPalette />` inside `AppShell` and register the Cmd/Ctrl+K handler from `shortcuts.ts` there, verified by 6.5 and by the palette being unreachable from `/login`

## 6. Tests

### Tests

- [x] 6.1 Unit-test `matchesCombo` and `isTypingTarget` including the contenteditable and select cases
- [x] 6.2 Unit-test the registry: register/dispose isolation between registrants, idempotent double-dispose, duplicate-id warning
- [x] 6.3 Unit-test `useCommandActions` unmount cleanup and list-replacement semantics
- [x] 6.4 Unit-test query exposure: `useCommandQuery` reflects typing and resets to empty on close; a registration made while open is visible immediately
- [x] 6.5 Render-test the palette: Cmd/Ctrl+K opens, Esc closes and restores focus to the prior element, arrows wrap, Enter runs exactly once and closes, no-match shows `EmptyState`, Enter with no results is a no-op
- [x] 6.6 Update `App.test.tsx:1099-1200` so quick-launcher shortcut coverage asserts Cmd/Ctrl+J and that Cmd/Ctrl+K now opens the palette instead
- [x] 6.7 Unit-test built-ins: one action per nav-visible section using its own label, navigation without reload, theme toggle, and the assistant action
- [x] 6.8 Unit-test ranking: prefix beats substring beats subsequence beats keyword-only, equal scores keep a stable order, and an opted-out (`matchesQuery`) action is unscored, kept in registrant order, and sorted after scored actions in the same section
- [x] 6.9 Run `npm run lint`, `npm run typecheck`, and `npm test` — all pass with zero new warnings
