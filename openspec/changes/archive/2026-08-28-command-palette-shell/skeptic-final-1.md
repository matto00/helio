## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff scope**: `git diff main...HEAD --stat` on commit `e7351395` — frontend-only, matches ticket scope (command palette feature dir, `shared/chrome/shortcuts.ts`, `App.tsx`/`App.test.tsx` migration, spec deltas).
- **Registry public surface** (`frontend/src/features/commandPalette/model/commandRegistry.ts`, `hooks.ts`, `model/types.ts`): read in full. `register()`/dispose/`useCommandActions`/`useCommandQuery`/`matchesQuery` all exist as design.md D3–D6 describe. Confirmed `useCommandQuery` reads the live query via `useSyncExternalStore(registry.subscribe, registry.getQuery)`, and is settable only from `CommandPalette.tsx` itself (`useSetCommandQuery`) — matches D6's claim that a query-dependent contributor (HEL-503/519) can read the query and feed results back through `useCommandActions` without the contract changing.
- **Ranking / opt-out rule** (`model/ranking.ts`, `model/ranking.test.ts`): read implementation and tests. `rankActions` sorts scored actions by `(tier asc, index asc)`, always places `matchesQuery` (tier `undefined`) actions after all scored actions, in registrant order. Test `"an opted-out (matchesQuery) action is unscored, kept in registrant order, after scored ones"` explicitly exercises this and would fail if the ordering rule were violated (asserts registrant order `recent-1` before `recent-2`, and both after `scored`). Verified `groupBySection` in `CommandPalette.tsx` partitions the already-sorted flat list per-section, preserving the same relative order — so the "sorted after locally-matched actions within its section" claim in `types.ts`/D7 holds as an emergent, correct property of the global sort + stable partition. Ran the actual test suite: `npx jest --testPathPatterns='commandPalette|App\.test|shortcuts'` → **86/86 passed**.
- **Keyboard AC, live in browser** (Chrome via Playwright, `localhost:5928`, backend `localhost:8835`, already-authenticated session):
  - `Cmd/Ctrl+K` from `/` opens the palette (screenshot `palette-light.png`); confirmed `/login` never mounts `AppShell`/the handler (`AppRoutes.tsx:80,89-90` — `ProtectedRoute` wraps `AppShell`, `/login` is a sibling outside it).
  - Typing suppression: focused the sidebar's "Filter dashboards" `<input>`, pressed Ctrl+K — `document.querySelector('.command-palette[open]')` stayed `false`. Correct.
  - Arrow-key navigation: `ArrowDown` twice moved `data-active="true"` to the third item (`Go to Data Pipelines`), confirmed via DOM query.
  - Esc: closes the palette and **restores focus** to the exact element that had it before open (focused the "Data Sources" sidebar link, opened via Ctrl+K, pressed Esc, `document.activeElement.textContent === "Data Sources"`). Correct — this is `Modal`'s native `<dialog>` focus-restore, reused per design D1, working as claimed.
  - `Cmd/Ctrl+K` → command palette, `Cmd/Ctrl+J` → quick-launcher, confirmed both by keyboard press + screenshot, and by `App.test.tsx`'s migrated tests (`git diff` shows the old K-opens-launcher test replaced with a J test plus a new explicit "K no longer opens the launcher" test — both present and passing).
- **`shortcuts.ts` single-declaration table**: read in full — one `shortcuts` array with `command-palette`(K)/`quick-launcher`(J), `matchesCombo`, `isTypingTarget`. `GlobalCommandShortcuts.tsx` is the sole consumer wiring both bindings from this table; confirmed no residual keydown handler left in `QuickLauncherOverlay.tsx` (`grep` for `keydown`/`matchesCombo` there returns nothing) — the old inline binding was fully migrated, not duplicated.
- **Static checks**: `npx tsc --noEmit -p tsconfig.json` — clean. `npx eslint src/features/commandPalette src/shared/chrome/shortcuts.ts src/app/App.tsx` — clean, zero warnings.
- **Design tokens**: `CommandPalette.css` read in full — every color/spacing/font-size value is a `var(--app-*)`/`var(--space-*)`/`var(--text-*)` token; the only literal is a `2px` focus-ring width, which matches the codebase-wide focus-ring convention (`ActionsMenu.css`, `Modal.css` use the identical `outline: 2px solid var(--app-accent); outline-offset: -2px`). `.eyebrow` reused for section labels (visible in screenshots as "NAVIGATION"/"GENERAL"). `EmptyState` reused for the no-matches state (not separately screenshotted, but the JSX at `CommandPalette.tsx:161-166` renders the shared component with the shared `SearchX` icon, not a hand-rolled state).
- **Entrance animation**: `CommandPalette.css`'s header comment states it reuses `Modal.css`'s `.ui-modal` animation and adds none of its own — confirmed no `@keyframes`/`animation` rule anywhere in `CommandPalette.css`.

### Defect found (light-theme keyboard-navigation visual feedback is broken)

The palette's active-row highlight — the only visual indicator of which result `Enter` will run while navigating with arrow keys — is **invisible in light theme**. Verified live:

- `frontend/src/features/commandPalette/ui/CommandPalette.css:70-73`:
  ```css
  .command-palette__item:hover,
  .command-palette__item[data-active="true"] {
    background: var(--app-surface-raised);
  }
  ```
- `Modal.css:5` sets the modal body's own background to `var(--app-surface-strong)`.
- `frontend/src/theme/theme.css:190-191` (light theme): `--app-surface-raised: #ffffff` and `--app-surface-strong: #ffffff` — **identical values**. So in light mode the "active" row's background exactly matches the modal's own background: zero contrast, zero visible highlight.
- Confirmed live: opened the palette in light theme, pressed `ArrowDown` twice, confirmed via DOM (`document.querySelector('[data-active="true"]')`) that the active item was correctly `Go to Data Pipelines`, then screenshotted (`palette-light.png`/`palette-active.png`) — **no visible highlight anywhere in the list**, indistinguishable from the unfocused rows.
- Confirmed the contrast exists and the row *is* visible once dark theme is selected (`--app-surface-raised: #232019` vs `--app-surface-strong: #262320` — distinct in `theme.css:144-147`): same repro in dark theme (`palette-dark.png`) shows a clearly visible highlighted row.

This is a pre-existing token collision in the base `Modal.css`/`ActionsMenu.css` pattern (`--app-surface-raised` also equals `--app-surface-strong` in light theme generally, so any modal-hosted list item using this exact pattern has the same latent bug) — the executor did not introduce the token values. But the command palette is the one place in this ticket where this defect is squarely inside the ticket's own core acceptance criterion: "fully keyboard-operable (arrows/Enter)" implies the user can *see* which item is selected, not just that the index is tracked internally. Shipping a keyboard-navigable list whose selection is invisible in the app's default light theme is a real, user-facing regression from what "fully keyboard-operable" should mean, and it's the kind of subjective/visual defect this gate exists to catch — the evaluator's checklist (render/open/close/keyboard-index assertions) would not have caught it because jsdom doesn't compute real contrast.

### Verdict: REFUTE

### Change Requests

1. **Fix the invisible active/hover state in light theme** (`frontend/src/features/commandPalette/ui/CommandPalette.css:70-73`). Use a background token that is visually distinct from the modal's own `--app-surface-strong` in *both* themes — e.g. `var(--app-surface-soft)` (`#efece6` light / `#161514` dark, both distinct from `--app-surface-strong`), or a token specifically intended for menu/list hover contrast if one exists in `theme.css`. Re-verify live in the browser (not just visually inspecting CSS) in both light and dark themes with arrow-key navigation, since this exact token pair (`--app-surface-raised` == `--app-surface-strong`) is known to collide in light mode.
2. (Non-blocking, informational — not required for this ticket to ship, flagging for awareness) The same `background: var(--app-surface-raised)` hover pattern exists in `Modal.css:198` and `ActionsMenu.css:63`, so any other modal-hosted hover/active list item in the app likely has the same invisible-in-light-theme defect. Worth a follow-up ticket to audit/fix at the token level rather than per-consumer, but out of scope for HEL-496's own fix.

### Non-blocking notes

- Registry contract, ranking opt-out rule, keyboard suppression/wrap/focus-restore, the K→J rebind migration, and the shared-primitive reuse (Modal/EmptyState/eyebrow/sections.ts) are all sound and match design.md's claims against the real running app and real tests, not just prose.
