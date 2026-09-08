# HEL-510: Keyboard shortcut system + help overlay

## Description

Shortcuts are currently registered ad-hoc per component (e.g. layout undo/redo in `features/layout/hooks/useLayoutUndoRedo.ts`, palette open, panel copy/paste from the HEL-347 tickets), with no central registry and no discoverability. Users can't see what shortcuts exist. This ticket introduces a small shortcut registry and a help overlay listing all bindings.

## Premise correction (Setup, CON-136 — minor-staleness)

The ticket's premise is **partly stale** and the plan must account for it. HEL-496 (Done, PR #461) already shipped `frontend/src/shared/chrome/shortcuts.ts`: a `ShortcutDeclaration[]` table plus `matchesCombo` (platform Cmd/Ctrl normalization) and `isTypingTarget` (input/textarea/select/contenteditable guard), governed by the existing `keyboard-shortcut-declarations` spec whose rule is **"no global binding may exist that isn't listed here"**. That module's header comment explicitly names HEL-510 as the consumer that will enumerate off this array.

Consequences that are binding on the design:
- **Extend `shared/chrome/shortcuts.ts`; do NOT create a sibling registry** under `features/commandPalette/`. A second registry would directly violate the "exactly one enumerable module" requirement of the existing spec.
- The single global keydown listener, the Cmd/Ctrl normalization, and the typing guard **already exist** — this ticket adds to them rather than reinventing them.
- A third global binding the ticket predates already exists and **must appear in the overlay**: `quick-launcher`, `Cmd/Ctrl+J` (assistant), added by HEL-496's `palette-takes-k-launcher-moves` escalation.
- `useLayoutUndoRedo.ts` carries its **own private `isEditableFocused` duplicate** of the shared guard and tests key properties inline (`event.metaKey || event.ctrlKey`, `event.key === "z"`, `event.shiftKey`) — i.e. it is an existing violation of the declarations spec. Migrating it onto the declaration is in scope.
- No shipped HEL-347 panel copy/paste/nudge binding exists yet, so none can be listed. The ticket already hedges this with "as they land".

## Acceptance criteria

* `?` opens the shortcuts help overlay listing all registered shortcuts grouped by area; a palette action opens it too; `Esc` closes.
* At least palette-open and undo/redo (plus any shipped HEL-347 panel shortcuts) appear and are accurate; combos are platform-correct.
* The `?` handler does not fire while typing in a field or when a modal is open (except to close via Esc). Overlay uses shared Modal + mono keycaps + tokens; correct in light/dark.
* Registry unit test + help-overlay render test; `npm run lint` / `npm test` pass, zero new warnings.

## Scope

* Extend the keyboard-shortcut declaration in `shared/chrome/shortcuts.ts` to carry `{ combo, description, group, handler?, when? }`, keeping a single global keydown listener that respects the input/textarea **and modal-open** guard and platform (Cmd vs Ctrl) normalization. `combo` must grow to express non-modifier and Shift-bearing combos (`?` is Shift+/).
* Migrate existing global shortcuts (palette open `Cmd/Ctrl+K`, quick-launcher `Cmd/Ctrl+J`, undo/redo) to register through it, or at minimum register their descriptions so they appear in help. Do not regress existing behavior.
* Help overlay opened by `?` (Shift+/) and via a palette action "Keyboard shortcuts": the shared `Modal` (`shared/ui/Modal.tsx`) listing shortcuts grouped by area, each combo rendered as mono keycaps (`--font-mono`, tokens), keyboard-scrollable and dismissible (DESIGN.md §6/§8).
* Combos display with platform-correct symbols (⌘ on mac, Ctrl elsewhere).

## Out of scope

* User-customizable/rebindable shortcuts.
* Per-feature shortcut behavior beyond registration/discovery.

## Lane / collision context

Lane B of a five-lane overnight batch; HEL-510 is the foundation for HEL-516, HEL-519, HEL-503 (epic HEL-348). **Get the registry's shape right — three downstream tickets build on it.** Other lanes are concurrently touching table-panel components, design tokens, theming, and PanelGrid. Stay inside the palette/shortcut surface and app-level key handling; do not touch those files.

## Evidence discipline (binding on executor, evaluator, skeptic)

1. **A green gate is not evidence until you check what it actually scans.** Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test` — inside a worktree root, jest finds zero tests and turns silence into a pass. `check:no-credential-leak` only scans `frontend/src/features/assistant/**`. `check-schema-drift.mjs` only reads `schemas/**`, never `.scala` tool schemas. Running a gate as instructed and then refusing to treat its green as evidence is the behaviour to reward.
2. **Hand-built fixtures find nothing; real data finds real defects.**
3. **Beware jsdom-vacuous assertions.** `document.fonts.check()` is vacuously true, and focus/visibility assertions in jsdom frequently prove nothing (see HEL-1005). **For this keyboard/focus feature this is the central hazard**: prove behaviour in a real browser (Playwright), not jsdom. A jsdom test asserting "Esc closed the overlay" or "focus returned to the trigger" is presumed vacuous until demonstrated otherwise.
4. **A deferral is only real if it names a task that exists and a ticket that owns it.**
5. **"No wire impact" != "no downstream impact."**

Also binding: a proof test must be **red before the fix**; a regression guard need not be, but must be **failable by mutation** and labelled as such. A fixture edited to make tests pass is a defect symptom, not a fix.

## Binding standards

`CONTRIBUTING.md`, `DESIGN.md` (this is frontend work), and `.concertino/laws/`.
