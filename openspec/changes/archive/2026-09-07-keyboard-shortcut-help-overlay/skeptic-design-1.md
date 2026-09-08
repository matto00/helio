## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Premise correction CONFIRMED, independently.** `frontend/src/shared/chrome/shortcuts.ts` exists on
  this branch and contains `ShortcutCombo {key, meta?}`, `ShortcutDeclaration {id,label,combo}`, a
  two-entry `shortcuts` array (`command-palette` = `k`+meta, `quick-launcher` = `j`+meta),
  `matchesCombo`, and `isTypingTarget`. Its header names HEL-510 as the enumerating consumer.
  `openspec/specs/keyboard-shortcut-declarations/spec.md` exists and carries the "no global binding
  outside the declaration" rule. The ticket's "no central registry" premise is stale exactly as
  Setup recorded; "extend, do not create a sibling registry" is the right consequence.
- **`useLayoutUndoRedo.ts` is an existing spec violation, as claimed.** Lines 12-19 hold a private
  `isEditableFocused`; lines 38-39 test `(event.metaKey || event.ctrlKey) && event.key === "z"` and
  `event.shiftKey` inline. Migration is correctly in scope. Its only call site is
  `app/CommandBar.tsx:109`, which is inside `AppShell` — so task 2.4's provider mount point is valid.
- **`shared/ui/Modal.tsx` read in full.** Native `<dialog>` + `showModal()`, `cancel`-event Esc
  routed through `onClose`, HEL-716 Tab/Shift+Tab wrap trap, HEL-590 focus capture/restore. Design's
  characterization is accurate, and Decision 4's claim that Esc is unaffected by the global listener
  holds.
- **Existing `matchesCombo` already rejects a held modifier when `meta` is unset** (line
  `if (!combo.meta && modifierHeld) return false;`) — Decision 2's "extending existing behavior to
  Shift" is an accurate characterization, not a rationalization.
- **`e2e/` exists with 18 committed Playwright specs**, `playwright.config.ts` (`testDir: ./e2e`),
  `npm run e2e`, and `npm run check:e2e-types` — including `hel1003-actions-menu-keyboard-reach.spec.ts`,
  a directly analogous committed keyboard-reach spec.
- **Cohesion inventory, code level.** `grep -rn "kbd\|keycap\|key-cap"` over `frontend/src` returns
  **zero hits** — no key-cap primitive exists anywhere today. `shared/ui/` contains a `StatusChip`
  primitive, and `grep -rn "2px 7px"` finds **5 hand-copied chip padding literals** across
  `PipelineDetailPage.css`, `PanelDetailModal.binding.css`, `PanelGrid.css`, `DashboardList.css`
  (the HEL-680 pile).
- **Running-app visual inventory NOT performed.** Dev port 5942 / backend 8849 were polled for
  ~2 minutes (`curl` → `000` on all 12 attempts, dev and backend). Per the addendum I am not
  treating that as a design defect, and I have not based any finding on it; CR7 pushes that
  inventory onto the executor as a task instead.

### Verdict: REFUTE

The change is well-researched and the shape is broadly right, but four of the findings below are
ground-truth contradictions of stated design assumptions (CR1, CR2, CR3), and CR4/CR7 are gaps in
the very API surface the ticket says is the primary deliverable.

### Change Requests

1. **Decision 4's stated assumption is false against ground truth: not every modal surface is a
   `<dialog>`.** `frontend/src/shared/chrome/MobileNavSheet.tsx:58-62` says in-file that the sheet
   "isn't built on the native `<dialog>` `Modal` primitive (it's a portalled div, for the
   drag-to-dismiss gesture)". `document.querySelector("dialog[open]")` therefore returns `null`
   while the mobile nav sheet is open, so `?` would fire and stack the help overlay on top of it —
   exactly the AC "does not fire ... when a modal is open". Revise Decision 4 and task 1.4 to
   either (a) cover the portalled-sheet case explicitly (e.g. also test for the sheet's root
   selector / an `aria-modal="true"` element), or (b) state as an accepted, documented limitation
   with the mobile-sheet case named. Do not leave the design asserting a fact the tree contradicts.

2. **The modal guard, as scoped, silently regresses the palette's own typing exemption.**
   `features/commandPalette/ui/CommandPalette.tsx:131-138` renders the palette *as a `Modal`*
   (`className="command-palette"`), so `dialog[open]` is truthy whenever the palette is open. Task
   2.1 applies `isModalOpen` "for surface-opening bindings"; `command-palette` and `quick-launcher`
   are surface-opening bindings. Under that reading Cmd/Ctrl+K stops working while the palette is
   open, contradicting the `command-palette-shell` exemption that task 3.1 promises to preserve and
   that `GlobalCommandShortcuts.tsx:24-28` implements today. Design.md never resolves which
   bindings the guard applies to. Make the guard policy **explicit and declarative** — e.g. a field
   on `ShortcutDeclaration` or an option on `useShortcut` — and state the policy for each of the
   five bindings (palette, quick-launcher, help-overlay, layout-undo, layout-redo).

3. **`useShortcut(id, handler, { when? })` cannot express a call site the plan already has.** Task
   3.1 requires preserving the "focus inside the palette's own input" exemption from the shared
   typing guard, but the reviewed signature offers no way to opt out of `isTypingTarget`. As written,
   task 3.1 is not implementable without changing `useShortcut`'s signature — which design.md itself
   names as "a breaking change across the epic" (Risks, last bullet). Settle the option set **now**,
   in this design, before HEL-516/519/503 consume it: at minimum decide whether the exemption is an
   option (`allowWhileTyping` / `typingExempt`) or a declaration-level property, and record it in
   Decision 1 and task 2.2.

4. **Decision 2's `?` rationale contradicts its own exactness rule.** Decision 2 says `?` is matched
   by `event.key === "?"` "because `key` already accounts for layouts where `?` is not Shift+`/`",
   and then declares `{ key: "?", shift: true }` under exact modifier matching. Those cannot both
   hold: on any layout that produces `?` without Shift, exact matching rejects it — reintroducing
   precisely the layout dependency the `key`-based approach was chosen to avoid. Resolve it
   explicitly: either declare `{ key: "?" }` and define Shift as don't-care for printable-symbol
   keys, or keep `shift: true` and drop the layout-independence claim. Whichever way, the rule for
   how a printable key whose `key` value already encodes Shift is matched must be written down —
   three downstream tickets will add bindings against it.

5. **Decision 3's heading is contradicted by tasks 3.1 + 3.2.** Decision 3 is titled "Keep two
   listeners ... do not force one physical listener", but task 2.1 gives the provider ONE listener,
   3.1 moves `GlobalCommandShortcuts` onto `useShortcut`, and 3.2 moves `useLayoutUndoRedo` onto it —
   leaving exactly one listener. Decision 3 half-admits this ("in practice does collapse it onto
   that one listener"). State the end state unambiguously, and say explicitly whether
   `GlobalCommandShortcuts.tsx` retains its own `window.addEventListener` or becomes a pure
   `useShortcut` consumer. An implementer can currently read this both ways.

6. **The Playwright evidence is not committed, and the repo convention says it should be.** Task 5.1
   asks only for a "transcript/screenshots" from a manually driven browser. This repo already has
   `e2e/` with `playwright.config.ts`, `npm run e2e`, `npm run check:e2e-types`, and a directly
   analogous keyboard spec (`e2e/hel1003-actions-menu-keyboard-reach.spec.ts`). A one-off transcript
   evaporates and leaves the epic's foundation with zero real-browser regression protection, while
   jsdom is (correctly, per design.md Risks) declared to prove nothing about focus. Change task 5.1
   to require a committed `e2e/hel510-*.spec.ts` covering (a)-(f), run via `npm run e2e` with pasted
   output, plus `npm run check:e2e-types`.

7. **Visual cohesion: the key-cap is a brand-new primitive and the plan does not treat it as one.**
   `grep -rn "kbd\|keycap\|key-cap"` over `frontend/src` returns zero hits — nothing in the app
   renders a key cap today, so this change invents the dialect. Meanwhile `shared/ui/StatusChip`
   exists and five files hand-copy `padding: 2px 7px` (HEL-680). Task 4.2 asks only for "no
   hardcoded color/px values", which a fresh, overlay-local chip recipe passes while still adding a
   sixth entry to that pile. A token check and visual cohesion are different claims. Require:
   (a) an explicit decision, recorded in design.md, on whether the key cap reuses/extends
   `StatusChip` or lands as a new `shared/ui/` primitive — it must be shared either way, since
   HEL-516's search surface will want it; (b) a task to open the running app and inventory the
   existing overlay/modal/sheet surfaces (panel sheet, output editor sheet, `Modal` consumers)
   with screenshots, confirming the help overlay is a member of that family and that
   `shared/ui/Modal` is the right family member rather than a bespoke shell; (c) task 5.2 extended
   to capture **hover/focus states** in BOTH themes, not just the resting overlay — HEL-866 is open
   on modal-hosted hover token collisions in light theme, which is exactly this surface.

8. **The Decision 1 deferral is self-contradictory as worded.** It says route-inert filtering is
   "explicitly deferred — not to a vague 'later' ... no ticket is claimed to own it today." A
   deferral with no owning ticket is an unowned hand-wave regardless of how honestly it is labelled.
   Pick one: reword it as a **permanent accepted trade-off** of the discoverability goal (legitimate,
   needs no ticket), or file a follow-up ticket and name it. Do not leave the word "deferred" next
   to "no ticket owns it".

### Non-blocking notes

- Decision 1's static-declaration + `useShortcut`-by-id split is, in substance, the right call, and
  the dev-time throw on an undeclared id is a genuine enforcement mechanism for the spec's
  "no binding outside the declaration" rule rather than a comment. My objections to it are about
  the option set (CR3) and guard policy (CR2), not the split.
- Task 1.1's mutation-check comment requirement and task 3.3's labelled regression guard correctly
  satisfy the "failable by mutation, labelled as such" rule. Task 3.2's "if the existing test needs
  editing, stop" framing is exactly right.
- Task 6.1 correctly names the root-`npm test` `--passWithNoTests` trap and forces the command to be
  run from `frontend/`.
- `shortcuts.test.ts` currently asserts `palette.combo` `toEqual({key:"k",meta:true})`; the
  `meta`→`mod` rename makes that assertion fail. That is expected and correct (a rename, not a
  behavior change) — but it means the "existing tests pass unmodified" discipline of tasks 3.1/3.2
  does NOT extend to `shortcuts.test.ts`. Worth stating so the executor does not mistake a required
  rename edit for the defect symptom that clause is guarding against.
