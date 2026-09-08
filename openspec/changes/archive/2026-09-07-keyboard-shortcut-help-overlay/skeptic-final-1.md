## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every finding below is derived from the diff, the source files, or the running app at
`http://localhost:5942` — not from evaluation-1/2.md or the design gate reports.

### What I verified (with evidence)

**Gates — run from `frontend/`, not the worktree root (the `--passWithNoTests` trap).**
- `npx jest` (full frontend suite, from `frontend/`): **276 suites / 2801 tests passed**. This is the
  real scan; the root `npm test` would have been vacuous.
- `npm run lint` (`eslint src --max-warnings=0`) — clean. `npm run typecheck` (`tsc --noEmit`) — clean.

**Regression guard is genuinely failable (I ran the mutation myself, not the evaluator's word).**
- Mutated `shortcuts.ts:67` `combo: { key: "z", mod: true, shift: false }` → `{ key: "z", mod: true }`
  (the exact mutation the test's header names), ran
  `useLayoutUndoRedo.regression.test.ts`: **1 failed, 1 passed**, failing at line 108
  `expect(getLayout(store)).toEqual(layoutB)`. Reverted; `git status` confirms the tree is clean
  (only the evaluator's untracked `evaluation-2.md` remains). The guard discriminates, and it is
  labelled as a guard, not as proof.

**Real-browser proof (jsdom proves nothing here — HEL-1005).**
- `DEV_PORT=5942 npx playwright test e2e/hel510-keyboard-shortcuts.spec.ts` → **6 passed (14.4s)**
  against the running dev server. I read the spec: the assertions discriminate rather than merely
  pass — (e) types `?` into a real input and asserts the input *received* the `?` while the overlay
  stayed closed (a removed typing guard flips it); (f) asserts `.help-overlay[open]` count is `0`
  while the palette is open (a mis-applied `guardWhileOverlayOpen` flips it); (g) asserts the
  palette's query survives a second Cmd/Ctrl+K (a wrongly-added guard on `command-palette` flips it).
  (d) exercises both Tab and Shift+Tab, and first asserts `focusableInDialog > 0` so the loop is not
  vacuous.

**Acceptance criteria traced to running behavior, not to code reading.**
- `?` opens the overlay: pressed `?` in the live app; `.help-overlay[open]` present, title
  "Keyboard shortcuts", 5 rows in 2 groups (screenshots `hel510-help-dark.png`,
  `hel510-dark-zoom.png`, `hel510-light-zoom.png`).
- Palette action opens it: Cmd/Ctrl+K → typed "keyboard" → the "Keyboard shortcuts" action appears
  under GENERAL (`hel510-palette.png`) → Enter →
  `{ help: true, palette: false }`. The palette closes and the overlay opens, in one step.
- Esc closes + focus restores: covered by e2e (b), passing.
- Bindings listed and accurate: command palette (Ctrl K), quick-launcher (Ctrl J), help (?), layout
  undo (Ctrl Z), layout redo (Ctrl Shift Z) — all five declarations render, one row each, matching
  `shortcuts.ts`. `formatCombo` is platform-branched and unit-tested on both branches without
  stubbing `navigator`.
- Guards: verified live and in e2e (typing target, modal-open, palette exemption).
- Console: **0 errors** across the whole session (`browser_console_messages level=error`).

**API surface as a published contract (three downstream tickets inherit it).**
- `ShortcutOptions` = `{ when?, allowWhileTyping?, guardWhileOverlayOpen? }`, frozen and documented;
  both guards default to today's behavior, so the `useLayoutUndoRedo` / `GlobalCommandShortcuts`
  migrations really are pure refactors (I diffed both — no behavior added at the call sites).
- `useShortcut` throws a descriptive dev-time error for an undeclared id, which is what actually
  enforces the `keyboard-shortcut-declarations` spec's "no binding outside the declaration" rule.
- Tri-state `shift` is coherent: `matchesCombo` enforces `true`/`false` exactly and ignores omission,
  and the omission on `help-overlay` is what preserves layout independence for `?`.
- `KeyCap` is a real shared primitive (`shared/ui`, semantic `<kbd>`, token-only CSS), not an
  overlay-local one-off. Correct home for HEL-516/519/503.

**Deferrals are real (Law 4).**
- HEL-1028 (grid does not visually revert) — exists in Linear, Backlog/High, correctly scoped as
  pre-existing and reproduced through the untouched `CommandBar` buttons.
- HEL-1029 (Modal heading focus ring) — exists, Backlog/Medium, with the structural diagnosis.

### UI cohesion judgment (my domain)

**The dark-theme keycap call routed to me — it SHIPS as-is.** Measured in the running app:
`.ui-keycap` background `rgb(35,32,25)` on a `rgb(38,35,32)` modal. Looked at it rather than ruling
from hex: at the rendered 12px mono size with `--app-border-strong` at `rgba(242,239,233,0.18)`, the
3-unit luminance delta is imperceptible; the border and the mono glyphs carry the cap entirely
(`hel510-dark-zoom.png`). Light theme reads unambiguously raised (`hel510-light-zoom.png`), so
parity holds. Crucially it uses `--app-surface-raised` rather than a hand-picked literal, so if that
token is ever corrected the caps follow for free. Hard-coding a lighter value here to win 3 units of
contrast would be the wrong trade.

**Leaving HEL-1029 unworked-around is the right call.** I confirmed the mechanism myself rather than
accepting it: `.help-overlay h2` is `tabIndex="-1"`, is `document.activeElement` at rest, and its
computed outline is `rgb(249,115,22) solid 2px`; the `<h2>` is the *first* focusable-ish descendant
in every `Modal`, and the overlay passes no `titleKey` and has no `autofocus` element. So it is
structural to `Modal`, exactly as filed. A local `HelpOverlay.css` override would suppress a focus
indicator (DESIGN.md §8 violation) and hide a shared defect behind one consumer's stylesheet.

**Hover/focus (HEL-866):** the overlay defines no hover styles and has no focusable row content, so
there is no modal-hosted hover-token collision to inherit. The one focus rule present
(`.help-overlay__row:focus-visible`) correctly uses `:focus-visible` + `var(--app-focus-ring)`.

**But the overlay is not yet a member of the app's list family — see CR1.**

### Verdict: REFUTE

### Change Requests

1. **`frontend/src/shared/chrome/HelpOverlay.css` — `.help-overlay__rows` is an unstyled `<ul>`, so
   the rows inherit user-agent spacing instead of tokens, and are visibly misaligned.**
   Measured in the running app:
   ```
   ulPaddingInlineStart: "40px"   ulMargin: "16px 0px"   listStyleType: "disc"
   groupLabel.left: 531   row.left: 571
   ```
   Consequences, all visible in `hel510-dark-zoom.png` / `hel510-light-zoom.png` in both themes:
   - Every shortcut row sits **40px to the right of its own "GENERAL" / "LAYOUT" eyebrow**, an indent
     nothing in the design asked for. The sibling command palette this overlay explicitly claims to
     mirror does not do this — its items are flush with their group label (`hel510-palette.png`).
   - The UA `margin: 16px 0` fights the declared rhythm: the gap under a group eyebrow is
     `var(--space-2)` + 16px, and the gap between groups is `var(--space-4)` + 16px + 16px, so
     neither spacing token means what the file says it means.
   - `list-style-type` is still `disc`; markers are suppressed only incidentally, because each `<li>`
     happens to be `display: flex`.
   This also falsifies the file's own header comment ("tokens only, no hardcoded color/spacing/type
   (DESIGN.md §6/§7)") — the two largest spacing values in the component are UA literals. Nothing
   caught it because `KeyCap.css.test.ts`'s "no hardcoded px" scan reads `KeyCap.css` only and never
   `HelpOverlay.css`.
   **Required:** add the reset every other list in this codebase already carries — e.g.
   `.help-overlay__rows { list-style: none; margin: 0; padding: 0; ... }`, matching
   `CommandPalette.css:45-52`, `PipelineShareDialog.css:18-25`, and ~20 further siblings — and
   re-check the group/row alignment and vertical rhythm in the running app, both themes.

### Non-blocking notes

- **`design.md:43` is now stale on a doc three downstream tickets will read.** It says `useShortcut`
  "registers into a **provider-held** `Map<shortcutId, handler>`" and rejects "a mutable
  `registerShortcut()` module singleton" as the alternative; the shipped `useShortcut.ts:37` *is* a
  module-level singleton `Map` (and says so in its own comment). The substance is fine — the
  rejection's stated harms were about *enumeration*, and the overlay enumerates the static
  `shortcuts` array, never the registry, so neither harm materializes. But the design doc should be
  corrected to describe what shipped before it is archived as the reference for HEL-516/519/503.
- **One handler per shortcut id, silently.** `registry` is keyed by id, so if two components ever
  mount `useShortcut("same-id")`, the second silently replaces the first, and when the second
  unmounts the first is left permanently dead (the identity check in the cleanup correctly prevents
  the reverse, but nothing restores the displaced registration). This is the right model for
  app-global bindings, but a dev-time `console.error` on a duplicate registration would turn a silent
  dead binding into a loud one for the panel-scoped bindings HEL-516/519/503 will add.
- The overlay renders `description` and never `label`, so `label` is currently write-only in
  `ShortcutDeclaration`. Worth either surfacing or dropping before three more tickets populate it.
- The descriptions read as full sentences with trailing periods ("Search and run any action."), which
  is slightly heavier than the palette's terse action titles. Purely stylistic; not blocking.
