## Context

See proposal.md — Why. Constraints that actually shape the approach, all verified in the live tree:

- `Modal` (`frontend/src/shared/ui/Modal.tsx`) is a native `<dialog>` + `showModal()` primitive that ALREADY
  provides the Tab/Shift+Tab focus trap (HEL-716 wrap-around), Escape routed through `onClose` via the `cancel`
  event, backdrop-click close, and focus restore (native `<dialog>` returns focus to the previously focused
  element on `close()`).
- `useOverlay()` (`frontend/src/shared/chrome/OverlayProvider.tsx`) gives single-active-overlay mutual exclusion
  plus a global Escape handler. `QuickLauncherOverlay` is the reference wiring.
- `sections.ts` (`frontend/src/shared/chrome/`) is the single source of truth for route→label/icon; the
  `nav-section-registry` spec explicitly forbids a second hardcoded mapping.
- `AppShell` (`App.tsx:32-232`) is the layout route every protected page renders inside — the only correct home
  for an authenticated-only global key handler. It already hosts the `Cmd/Ctrl+K` handler being reassigned.
- Planning escalation resolved `palette-takes-k-launcher-moves`: palette takes `Cmd/Ctrl+K`, quick-launcher
  moves to `Cmd/Ctrl+J`. See ticket.md — Premise notes.

## Goals / Non-Goals

**Goals:**

- A registry surface the four blocked epic leaves (HEL-503/516/510/519) can build on without it changing.
- Reuse every existing primitive; add no new dependency and no second implementation of trap/Esc/overlay logic.
- Leave both keyboard bindings enumerable from one module so HEL-510 can list them.

**Non-Goals:**

- Async/remote action sources. The registry exposes the live query; a query-dependent contributor owns its own
  fetching and re-registers. This change ships no fetching.
- A general keyboard-shortcut *framework* (HEL-510). We add a declaration table, not a dispatcher.

## Decisions

**D1 — Build on `Modal`, hand-roll nothing.** The palette renders `<Modal size="lg">` and inherits the focus
trap, Escape, backdrop close, and focus restore. *Alternative rejected:* a bespoke overlay — it would duplicate
HEL-716's trap fix (the exact mistake that ticket was filed to correct) and drift from `modal-dismiss-interactions`.
The palette's search input is the first element in the Modal body, autofocused via ref; the Modal keeps its
normal header, titled "Command palette".

**D2 — Register with `useOverlay()`, mirroring `QuickLauncherOverlay`.** Opening the palette closes any open
popover/drawer and vice versa, satisfying `overlay-management`'s mutual-exclusion requirement for free.
*Alternative rejected:* ignoring the overlay provider, which would let the palette stack on top of an open
appearance popover.

**D3 — The registry is a plain observable store, instantiated once and shared through React context.** The store
(`commandRegistry.ts`) is a framework-free closure with `register(actions) -> dispose`, `getActions()`,
`setQuery()/getQuery()`, and `subscribe(listener)`. `CommandPaletteProvider` creates one and supplies it;
components read it with `useSyncExternalStore`, so a registration made while the palette is open re-renders it
immediately. *Alternatives rejected:* (a) a module-level global singleton — untestable without cross-test
bleed and awkward to reset; (b) plain context `useState` — forces every registrant to re-render the provider
subtree and makes imperative registration from non-component code impossible. The store being pure TypeScript is
what lets the registry and ranking be unit-tested with no rendering at all.

**D4 — `register` returns a disposer; ids are unique; duplicates warn in dev.** A disposer removes exactly the
actions that call added, is idempotent, and cannot disturb another registrant — which is what makes
deregistration correct when several features register concurrently. A duplicate id is a contributor bug, so it
is `console.warn`ed in dev and the later registration is kept out, rather than silently overwriting a working
action. *Alternative rejected:* `deregister(ids)` — forces every caller to re-derive its own id list and makes
partial-cleanup bugs easy.

**D5 — `useCommandActions(actions)` is the React entry point.** It registers on mount, disposes on unmount, and
replaces the registration when the caller's list changes. Contributors cannot leak actions. Callers memoize
their array; the hook compares by identity.

**D6 — The live query is part of the contract, not an afterthought.** `useCommandQuery()` returns the palette's
current query (empty when closed). This single field is what makes HEL-503 (search) and HEL-519 (recents)
implementable without reopening this contract: they read the query, do their own fetching/ranking, and feed
results back through `useCommandActions`. `CommandAction` therefore also carries an optional `matchesQuery`
opt-out so a contributor that has ALREADY filtered server-side is not filtered a second time locally, and an
optional `subtitle`, because search and recents entries ("Q3 Revenue" — which dashboard?) need a secondary line
of context that navigation and theme actions never do. Both are specified in `command-action-registry`, not
left as design rationale, since those two tickets will read the spec as the contract.

**D7 — Ranking is a pure, separately tested function.** `rankActions(actions, query)` scores title-prefix >
title-substring > title-subsequence > keyword match, and sorts by `(score desc, registration index asc)` so
equal-scoring results never reorder between renders. An action declaring `matchesQuery` is deliberately NOT
scored: it has no local match strength, so it keeps its registrant-supplied order and sorts after scored
actions within its section. *Alternative rejected:* scoring opted-out actions as a top tier — that would let a
search result outrank an exact-title navigation match, making the palette's own commands feel unreachable as
soon as HEL-503 lands. Kept out of the component so it is testable directly.

**D8 — One shortcut declaration table (`frontend/src/shared/chrome/shortcuts.ts`).** Exports the app's global
bindings as data — `{id, label, combo}` for the palette (`Cmd/Ctrl+K`) and the quick-launcher (`Cmd/Ctrl+J`) —
plus `matchesCombo(event, combo)` and the `isTypingTarget(target)` guard that suppresses a binding while focus
is in an input/textarea/select/contenteditable. Both `AppShell` handlers consume it. This is the coordinator's
explicit requirement and HEL-510's enumeration point. *Alternative rejected:* a second inline `useEffect` next
to the existing one — three scattered bindings by the time HEL-510 lands.

**D9 — Nav actions derive from `sections.ts`.** Built-ins map `sections.filter(isNavSection)` to actions using
each entry's own `label`/`icon`, and navigate with `useNavigate()` (client-side, no reload). The theme action
calls `useTheme().toggleTheme` and labels itself for the theme it will switch TO. An "Open assistant" action
opens the rebound quick-launcher, preserving its discoverability after losing `Cmd/Ctrl+K`.

## Risks / Trade-offs

- **Rebinding `Cmd/Ctrl+J` collides with a browser/OS binding** (Firefox: focus downloads) → `preventDefault()`
  on match, same as the existing handler; the quick-launcher keeps its always-visible command-bar trigger and
  gains a palette entry, so the shortcut is never its only route.
- **Users have muscle memory for `Cmd/Ctrl+K` opening the assistant** → the palette's "Open assistant" action is
  seeded and keyword-matched ("assistant", "chat"), so the old intent still lands in one keystroke plus Enter.
- **`App.test.tsx:1099-1200` asserts the old binding** → those tests move with the binding rather than being
  deleted; the quick-launcher's shortcut coverage must survive on `Cmd/Ctrl+J`.
- **A global keydown listener can swallow a keystroke a page wants** → the `isTypingTarget` guard is centralized
  in `shortcuts.ts` and unit-tested, not re-implemented per binding.
- **Registry re-render churn if a contributor passes a fresh array each render** → documented in the usage
  comment; the hook's identity comparison makes the failure mode visible (constant re-registration) rather than
  silent.

## Planner Notes

Self-approved: the four-capability spec split; `matchesQuery` and `useCommandQuery` as forward-compatibility for
HEL-503/519; adding `shortcuts.ts` as shared chrome rather than palette-local (it must outlive this feature to
serve HEL-510). Escalated and human-resolved: the `Cmd/Ctrl+K` ownership conflict (see ticket.md).
