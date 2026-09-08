## 1. Extend the shortcut declaration (foundation — get this shape right)

- [x] 1.1 Change `ShortcutCombo` in `frontend/src/shared/chrome/shortcuts.ts` from `{ key, meta? }` to
      `{ key, mod?, shift? }`. `mod` is exactly matched. `shift` is **tri-state** per design.md Decision 2:
      `true` = must be held, `false` = must not be held, **omitted = don't-care**. Verify: `shortcuts.test.ts`
      covers all three states, and specifically that `{key:"z",mod:true,shift:false}` does NOT match a
      `mod+shift+z` event — that assertion must fail if `shift: false` enforcement is removed (state the
      mutation check in the test's comment).
      NOTE: `shortcuts.test.ts` currently asserts `toEqual({key:"k",meta:true})`; the `meta`->`mod` rename
      makes that fail. Editing it is a REQUIRED rename, not the "fixture edited to pass" defect symptom —
      the unmodified-test discipline in 3.1/3.2 does not extend to this file.
- [x] 1.2 Extend `ShortcutDeclaration` with required `description: string` and `group: string`. Verify:
      `tsc --noEmit` fails until every existing declaration supplies both.
- [x] 1.3 Add declarations, using the TRI-STATE `shift` rule from design.md Decision 2 EXACTLY as written:
      `help-overlay` = `{ key: "?" }` — **`shift` OMITTED, not `shift: true`**. Omitting it is what preserves
      layout independence (the `?` character already encodes Shift on a US layout, and on layouts where `?`
      needs no Shift, `shift: true` would reject it). Group "General".
      `layout-undo` = `{ key: "z", mod: true, shift: false }` — **`shift: false` is load-bearing and MUST be
      written explicitly**; omitting it makes undo don't-care, so undo swallows redo and task 3.3's
      regression guard cannot pass. `layout-redo` = `{ key: "z", mod: true, shift: true }`. Group "Layout".
      Give the existing palette/quick-launcher entries a description and group.
      Verify: a unit test asserts every declaration has a non-empty description and group and that ids are
      unique, PLUS an explicit assertion that `help-overlay`'s combo does NOT carry a `shift` property and
      that `layout-undo`'s is `false` — these two assertions exist to stop the round-1/round-2 defect
      recurring, so label them as such in the test.
- [x] 1.4 Add `isOverlayOpen()` — `document.querySelector('dialog[open], [aria-modal="true"]') !== null`
      (design.md Decision 4). The `aria-modal` half is REQUIRED, not belt-and-braces: `MobileNavSheet.tsx`
      and `RefinementChatDrawer.tsx` are portalled divs, NOT native `<dialog>`, so a `dialog[open]`-only
      guard misses them and `?` would stack the overlay on top of an open sheet. Comment must record that
      the guard keys off the a11y contract, so a future portalled surface missing `aria-modal` is an a11y
      bug. Verify: unit test covers all three cases — `<dialog open>`, `[aria-modal="true"]` div, neither.
- [x] 1.5 Add `isMacPlatform()` and the pure formatter `formatCombo(combo, { mac }): string[]` returning
      discrete cap tokens (⌘/Ctrl, ⇧/Shift, and the key). Verify: unit test asserts both `mac: true` and
      `mac: false` output for a `mod+shift` combo, with no `navigator` stubbing.

## 2. Runtime binding layer (`useShortcut`) — the API three downstream tickets consume

- [x] 2.1 Add a shortcuts provider owning THE single `keydown` listener (design.md Decision 3: exactly one
      listener exists after this change) that resolves each event against the declaration via `matchesCombo`,
      applies `isTypingTarget` and `isOverlayOpen` per each binding's registered options, and dispatches to
      registered handlers. Verify: unit test that a registered handler fires for its combo and not for a
      near-miss combo.
- [x] 2.2 Add `useShortcut(id, handler, opts)` with the option set FROZEN by design.md Decision 1:
      `{ when?, allowWhileTyping?: boolean | (target) => boolean, guardWhileOverlayOpen?: boolean }`.
      Both guard options default to preserving today's behavior. Throw a descriptive dev-time error when
      `id` is absent from the declaration — this is what enforces the spec's "no binding outside the
      declaration" rule. Verify: unit tests cover the unknown-id throw, `when: false`, the predicate form of
      `allowWhileTyping`, and `guardWhileOverlayOpen: true` suppressing while an overlay is open.
      Do NOT change this signature during execution — three downstream tickets consume it; if it proves
      inexpressible, STOP and escalate rather than widening it unilaterally.
- [x] 2.3 Document `useShortcut`'s contract in a header comment (it is the reviewed public surface for
      HEL-516/519/503 — say so explicitly, per design.md Decision 1).
- [x] 2.4 Mount the provider in `AppShell` so it is authenticated-route-only, matching
      `GlobalCommandShortcuts`. Verify: existing `App.test.tsx` still passes.

## 3. Migrate existing bindings (no behavior change)

- [x] 3.1 Move `GlobalCommandShortcuts.tsx`'s palette and quick-launcher handling onto `useShortcut`,
      DELETING its own `window.addEventListener` (Decision 3 — it becomes a pure consumer, or disappears
      into `AppShell`; pick the smaller diff). Preserve the palette's typing exemption via the
      `allowWhileTyping` predicate, and do NOT set `guardWhileOverlayOpen` on either binding — the palette
      renders AS a Modal, so guarding it would kill Cmd/Ctrl+K while the palette is open. Verify:
      `CommandPalette.test.tsx` and `hooks.test.tsx` pass **unmodified**, and add a guard test that
      Cmd/Ctrl+K still fires while the palette is open.
- [x] 3.2 Rewrite `useLayoutUndoRedo.ts` to use `useShortcut("layout-undo"/"layout-redo", ...)`, deleting its
      private `isEditableFocused` in favor of the shared `isTypingTarget`. Verify:
      `useLayoutUndoRedo.test.ts` passes **without being edited** — if that test needs changing, treat it as
      a defect symptom and stop (design.md Risks).
- [x] 3.3 Add a regression guard that `mod+shift+z` triggers redo and never undo, labelled in-file as a
      regression guard and failable by mutation. Verify: flipping the Shift exactness from task 1.1 makes it
      red.

## 4. Help overlay

- [x] 4.1 Build the overlay component on `shared/ui/Modal`, deriving rows from the declaration alone and
      grouping by `group`. Verify: a render test asserts one row per declaration entry, so adding a
      declaration entry changes the test's count without touching the component.
- [x] 4.1a Register the help overlay with `useOverlay()` from `shared/chrome/OverlayProvider`, exactly as its
      sibling `CommandPalette.tsx:45` does, so it participates in the app's single-active-overlay/Escape
      coordination. This is SEPARATE from the `isOverlayOpen()` guard (design.md Decision 4a) — do not
      conflate them. Verify: opening the palette while the help overlay is open behaves like every other
      overlay pair in the app.
- [x] 4.2 Build `shared/ui/KeyCap.tsx` + `KeyCap.css` as a NEW SHARED primitive rendering a semantic `<kbd>`
      (design.md Decision 5 — NOT an overlay-local class, NOT a StatusChip variant). Draw padding from the
      same spacing tokens the existing chip surfaces use; do NOT hand-copy `padding: 2px 7px`, which would
      add a sixth entry to the HEL-680 pile. Render combos through it from `formatCombo`, using `--font-mono`.
      Verify: a `KeyCap.css.test.ts` asserts no hardcoded color/px literals. NOTE this token check is
      NECESSARY BUT NOT SUFFICIENT — it does not establish visual cohesion; task 5.2 is what does that.
- [x] 4.3 Wire `?` via `useShortcut("help-overlay", handler, { guardWhileOverlayOpen: true })` — this is the
      ONE binding that opts into the overlay guard — and make the list region scrollable.
- [x] 4.3a Any focus ring introduced by the overlay or `KeyCap` MUST use `:focus-visible` (never bare
      `:focus`) and `outline: var(--app-focus-ring)` — never a hand-rolled value (DESIGN.md §8, HEL-1022;
      design.md Decision 6). Match the sibling surface `CommandPalette.css:80-82`. Verify: grep the new CSS
      for a bare `:focus` ring and for any literal outline value; both must return zero hits.
- [x] 4.4 Add a "Keyboard shortcuts" action to `features/commandPalette/model/builtInActions.ts` opening the
      same overlay. Verify: extend `builtInActions.test.tsx` to assert the action exists and runs.

## 5. Real-browser evidence (the jsdom hazard — the central risk for this ticket)

- [x] 5.1 Write a COMMITTED Playwright spec `e2e/hel510-keyboard-shortcuts.spec.ts` (the repo already has
      `e2e/`, `playwright.config.ts`, `npm run e2e`, and the directly analogous
      `e2e/hel1003-actions-menu-keyboard-reach.spec.ts` — follow its shape) proving in a REAL BROWSER:
      (a) `?` opens the overlay from an authenticated route; (b) `Esc` closes it; (c) focus returns to the
      previously-focused element; (d) Tab/Shift+Tab stay inside the overlay; (e) `?` does nothing while
      focus is in a text input; (f) `?` does nothing while another modal is open; (g) Cmd/Ctrl+K still opens
      the palette while the palette is already open. Verify: paste `npm run e2e` output AND
      `npm run check:e2e-types`. A one-off transcript does NOT satisfy this — the epic's foundation needs
      committed regression protection, and jsdom proves nothing here.
- [x] 5.2 VISUAL COHESION (owner-mandated, first-class gate — a token check does NOT substitute). In the
      running app via Playwright: FIRST inventory and screenshot the overlay/modal/sheet surfaces that
      ALREADY exist (the command palette, panel sheet, output editor sheet, other `Modal` consumers), THEN
      screenshot the new help overlay beside them and state explicitly whether it reads as a MEMBER of that
      family or as a new variant. Capture RESTING, HOVER, and FOCUS states in BOTH light and dark —
      hover/focus specifically, because HEL-866 is open on modal-hosted hover token collisions in light
      theme and an overlay is the surface it bites; a state that looks right in dark can be invisible in
      light. Verify: all screenshots attached. If cohesion appears to require touching an adjacent surface
      beyond this ticket's scope, do NOT widen the diff and do NOT ship the incohesive version — STOP and
      escalate with the screenshots for the owner's ruling.
- [x] 5.3 In the real browser, confirm layout undo AND redo still work on a dashboard after the migration.
      Verify: transcript showing a layout change reverted and reapplied.

## 6. Gates and handoff

- [x] 6.1 Run `npm run lint`, `npm run typecheck`, and `npm test` **from `frontend/`** — note that root
      `npm test` is `jest --passWithNoTests && npm --prefix frontend test`, which in a worktree root turns
      silence into a pass. State which command was actually run and what it scanned.
- [x] 6.2 Run `openspec validate keyboard-shortcut-help-overlay --type change` to exit zero.
- [x] 6.2a Re-check that `origin/main` has not moved again (a separate owner thread is closing UI/UX gaps on
      frontend files). If it has, rebase and RE-RUN the task 5.2 visual comparison — stale screenshots do
      not establish cohesion against a moved baseline.
- [x] 6.3 Write `files-modified.md` and COMMIT. Staging without committing is an incomplete handoff.
