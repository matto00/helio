## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-baseline confirmed: `git log --oneline -3` → `6b081b86 HEL-1022 …`. All facts below re-derived
from this tree, not from round 1 and not from the executor's narrative.

**Round-1 CR disposition, verified individually:**

- **CR1 (portalled modals) — RESOLVED.** `grep -rn 'aria-modal' frontend/src` returns exactly two
  hits: `RefinementChatDrawer.tsx:231`, `MobileNavSheet.tsx:339`. I also checked both actually
  **unmount** when closed (`RefinementChatDrawer.tsx:217` `if (!open) return null`;
  `MobileNavSheet.tsx:279` `if (!open) return null`) — so `[aria-modal="true"]` cannot match a
  closed-but-mounted sheet and dead-lock global shortcuts. The guard selector is sound.
- **CR2 (per-binding guard policy) — RESOLVED.** Decision 4 now carries the full 5-binding table;
  palette/quick-launcher/undo/redo do not opt in; only `help-overlay` does. Task 3.1 restates it.
  Spec has a matching scenario ("A binding that does not opt in is unaffected").
- **CR3 (option set) — RESOLVED.** `ShortcutOptions` is frozen in Decision 1 with all three fields,
  both guards defaulting to today's behavior, and task 2.2 forbids widening it without escalation.
  The palette's typing exemption is expressible via the `allowWhileTyping` predicate.
- **CR4 (`?` / shift tri-state) — NOT RESOLVED IN THE IMPLEMENTABLE ARTIFACT.** See CR1 below.
- **CR5 (one listener) — RESOLVED in intent.** Decision 3 is now unambiguous ("exactly one",
  `GlobalCommandShortcuts` loses its `addEventListener`), matching task 3.1. But the supporting
  factual claim is wrong — see CR3 below.
- **CR6 (committed Playwright) — RESOLVED.** Task 5.1 requires a committed
  `e2e/hel510-keyboard-shortcuts.spec.ts`, cases (a)–(g), `npm run e2e` + `npm run check:e2e-types`.
- **CR7 (KeyCap as a shared primitive) — RESOLVED.** `grep -rniE "kbd|keycap|key-cap"` over
  `frontend/src` still returns zero hits (re-verified on the new baseline); `grep -rn "2px 7px"`
  still returns the 5-file HEL-680 pile. Decision 5 makes it `shared/ui/KeyCap.tsx` and rejects both
  alternatives with reasons. Task 5.2 covers hover/focus in both themes.
- **CR8 (deferral) — RESOLVED.** Reworded as a permanent accepted trade-off with the round-1 wording
  explicitly withdrawn; no unowned "deferred" remains.

**HEL-1022 focus contract (Decision 6) — every cited fact checked:**
`theme.css:294` is `--app-focus-ring: 2px solid var(--app-accent);` ✔.
`CommandPalette.css:80-82` is `.command-palette__item:focus-visible { outline: var(--app-focus-ring);
outline-offset: -2px; }` ✔. `DESIGN.md` §8 lines ~640-664 carry the always-`:focus-visible` rule, the
"outline-offset is NOT part of the token" clause, and the persistent/modality-independent carve-out ✔.
Decision 6 characterizes all three correctly, and task 4.3a turns it into a grep-checkable gate.

**Running-app cohesion inventory (done this round — dev 5942 → 200, backend 8849/health → 200):**
- `palette-dark.png`, `palette-light-hover.png` — command palette in both themes, with a row hovered.
  Family signature: shared `Modal` shell (titled header + `×`), uppercase letter-spaced group headings
  ("NAVIGATION", "GENERAL"), icon+label rows, soft `--app-surface-soft` hover. Light-theme
  modal-hosted hover reads correctly here — I found no HEL-866 collision on this surface.
- `appearance-light.png` — dashboard appearance popover, the nearest existing pill dialect.
- **Cohesion judgment:** the planned overlay (task 4.1 on `shared/ui/Modal`, grouped by `group`,
  focus ring matched to `CommandPalette.css:80-82`) will read as a member of this family. Task 5.2's
  before/after inventory + stop-and-escalate clause is the right gate. No REFUTE on cohesion — but
  see the owner-tiebreaker item under Non-blocking notes.

### Verdict: REFUTE

CR3 and CR7 from round 1 are genuinely fixed and the design is materially stronger. But the
**tasks file — the artifact an executor implements from — still contains round-1's CR4 defect
verbatim, in two places**, and one of them makes a task in the same file (3.3) unsatisfiable. Plus
the design never mentions an existing shared primitive it must either use or consciously bypass.

### Change Requests

1. **CR4 is unresolved in `tasks.md`: task 1.3 declares `help-overlay` as `{ key: "?", shift: true }`,
   which design.md Decision 2 explicitly rejects.** Decision 2 states `?` is declared `{ key: "?" }`
   with `shift` omitted, and that "declaring `shift: true` would have thrown [layout independence]
   away, which is exactly what CR4 caught." `tasks.md:38` declares exactly that. Since the executor
   implements the tasks, round-1's defect ships as written. Fix `tasks.md` task 1.3 to
   `{ key: "?" }`. Also correct `proposal.md` ("a `combo` shape able to express … Shift-bearing
   combinations (`?` is Shift+`/`)"), which still carries the withdrawn layout-dependent framing.

2. **Task 1.3 declares `layout-undo` as `{ key: "z", mod: true }` — omitting the `shift: false` that
   design.md Decision 2 calls load-bearing — which makes task 3.3 fail by construction.** Decision 2:
   "undo is `{ key: "z", mod: true, shift: false }` … Writing `shift: false` on undo is load-bearing,
   not decoration — omitting it would make undo don't-care and let it swallow redo." Task 1.3 omits
   it; under the tri-state rule that is don't-care, so `mod+shift+z` matches **both** undo and redo —
   and task 3.3 ("`mod+shift+z` triggers redo and never undo") cannot pass. Fix task 1.3 to
   `{ key: "z", mod: true, shift: false }`.
   Related spec gap, fix in the same pass: `specs/keyboard-shortcut-declarations/spec.md`'s combo
   requirement has scenarios for "declares and matches" and "extra modifier prevents a match" but
   **no scenario for the omitted/don't-care state** — now the newly load-bearing third case, and the
   one both defects above turn on. Add one (a `?` binding that omits `shift` still matches a
   Shift-bearing `?` event), and reword the "A Shift-bearing, modifier-free binding matches" scenario,
   whose "declaring exactly that" phrasing reads as `shift: true`.

3. **The design never mentions `shared/chrome/OverlayProvider` / `useOverlay()`, the app's existing
   single-active-overlay primitive — which this feature must either register with or consciously
   bypass.** Ground truth: `shared/chrome/OverlayProvider.tsx` exports `useOverlay(): { isActive,
   open, close }` over a context `activeId`, is listed in `shared/README.md:9` as a chrome primitive,
   and **every** overlay in the tree registers with it — `CommandPalette.tsx:45` ("Registers with
   `useOverlay()` (design.md D2)"), `QuickLauncherOverlay.tsx:28`, `MobileNavSheet.tsx`,
   `RefinementChatDrawer.tsx`, `shareDialogContext.tsx`. Two consequences the design must resolve:
   (a) does the new help overlay register with `useOverlay()` like every sibling (it should, or say
   why not) — this is what makes overlays mutually exclusive and keeps Escape coordination consistent;
   (b) `isOverlayOpen()`'s DOM query is a **second, parallel** answer to "is an overlay open" that can
   disagree with `activeId`. Either justify the DOM query as deliberate (defensible — it also catches
   surfaces that never registered) *in the design, naming `useOverlay`*, or key the guard off the
   provider. Silently introducing a duplicate mechanism is the "reusable behavior lives in one place"
   rule this repo enforces.
   In the same pass, correct design.md's Context: "Two global listeners exist today" is false.
   `grep` for `window.addEventListener("keydown"` returns three — `GlobalCommandShortcuts.tsx:37`,
   `useLayoutUndoRedo.ts:53`, **and `OverlayProvider.tsx:24`** (the global Escape handler). Decision 3's
   "exactly one listener" is still achievable as scoped to *global shortcuts*, but say so explicitly
   and state that OverlayProvider's Escape listener survives, so an implementer chasing "exactly one"
   does not delete it.

4. **`design.md` has two sections both numbered "Decision 5"** (KeyCap primitive, and platform
   detection), followed by a "Decision 6". `tasks.md` task 4.2 cites "design.md Decision 5" for the
   KeyCap rule, which is now ambiguous, and three downstream tickets will cite these numbers.
   Renumber (platform detection → Decision 7, or reorder) and fix the cross-reference.

### Non-blocking notes

- **Owner-tiebreaker item, flagged not resolved (per the cohesion mandate).** `palette-dark.png`
  shows the command palette listing "Open assistant" — a binding that has a real shortcut
  (Cmd/Ctrl+J) — with **no key cap**, and the palette shows none for any action. Shipping a shared
  `shared/ui/KeyCap` used by exactly one surface leaves the palette as a visible gap of precisely the
  kind the mandate says not to create. Adding caps to palette rows is **beyond this ticket's scope**
  and I am not resolving it by agent judgment: this is an owner call. Task 5.2's stop-and-escalate
  clause is the right place for it to surface if the executor sees it too.
- Decision 4's `dialog[open]` risk note (a future non-modal `show()` dialog) is accurate — I found no
  non-modal `<dialog>` in the tree.
- Task 6.1's `--passWithNoTests` note and task 6.2a's re-baseline/re-screenshot requirement are both
  correct and worth keeping verbatim; 6.2a in particular already caught this round's re-baseline.
- Task 1.1's rename note about `shortcuts.test.ts` correctly incorporates round-1's non-blocking note,
  so the required `meta`→`mod` edit is not mistaken for the fixture-edited-to-pass defect symptom.
