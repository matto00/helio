## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Round-2 item 1 (CR4 in tasks.md) — RESOLVED.** `tasks.md` task 1.3 now reads
  `help-overlay = { key: "?" }` with "**`shift` OMITTED, not `shift: true`**" and the layout-independence
  rationale spelled out. `proposal.md` reworded to "tri-state Shift ... `?` ... with Shift left don't-care".
  No occurrence of `{ key: "?", shift: true }` remains in the change dir.
- **Round-2 item 2 (`shift: false` on `layout-undo`; missing don't-care scenarios) — RESOLVED.** Task 1.3
  writes `layout-undo = { key: "z", mod: true, shift: false }` with the "load-bearing / swallows redo /
  breaks task 3.3's guard" note, and adds two labelled anti-recurrence assertions to its Verify clause.
  `specs/keyboard-shortcut-declarations/spec.md` now contains both new scenarios ("An unstated Shift
  requirement matches regardless of Shift", "A stated absence of Shift is enforced").
- **Round-2 item 3 (OverlayProvider) — the rejection's measurement is TRUE; I re-derived it.**
  - `useOverlay()` call sites in the tree (excluding the provider): exactly four —
    `features/commandPalette/ui/CommandPalette.tsx:45`, `features/assistant/ui/QuickLauncherOverlay.tsx:28`,
    `shared/chrome/MobileNavSheet.tsx:118`, `features/dashboards/ui/RefinementChatDrawer.tsx:64`.
  - `grep -rl "<Modal" --include=*.tsx frontend/src | grep -v test` → **21** consumers, of which exactly
    **2** (`CommandPalette`, `QuickLauncherOverlay`) register with `useOverlay`. Design.md says 20/2/18;
    the true figure is 21/2/19 — off by one in the conservative direction, immaterial to the argument.
    Every non-registrant named in Decision 4a exists: `AddSourceModal`, `PanelDetailModal`,
    `CreatePipelineModal`, `pipelines/ui/outputEditor/OutputEditorSheet.tsx`, `PatchSetReview`,
    `settings/ui/MfaEnrollModal.tsx` (the last two import `Modal` via `shared/ui/index`, which is why a
    naive `shared/ui/Modal` grep undercounts).
  - **Superset claim holds.** All four `useOverlay` registrants are already caught by the DOM query:
    `CommandPalette`/`QuickLauncherOverlay` render `shared/ui/Modal`, which is a native `<dialog>` driven by
    `showModal()`/`close()` (`Modal.tsx:105-113`) → `dialog[open]`; `MobileNavSheet.tsx:339` and
    `RefinementChatDrawer.tsx:231` set `aria-modal="true"` → second selector. So `activeId` would be a
    strict subset and would miss 19 modal surfaces. Rejection stands on evidence.
  - The Decision 4a scoping paragraph is **honest**, not a hand-wave: it declines to claim a ticket owns the
    tree-wide migration rather than inventing one. That satisfies evidence rule 4 (a deferral that names no
    ticket is stated as such, not dressed up).
  - New task 4.1a exists and correctly separates registration-for-coordination from the `isOverlayOpen()`
    guard.
- **Round-2 item 4 (duplicate "Decision 5") — RESOLVED.** `grep -n "^### Decision"` yields 1, 2, 3, 4, 4a,
  5 (KeyCap), 6 (focus ring), 7 (platform detection) — all unique. Task 4.2's citation of Decision 5 is now
  unambiguous.
- `npx openspec validate keyboard-shortcut-help-overlay --type change` → "is valid". (Noted as structural
  only; it does not read requirement prose for semantic contradiction — which is where the finding below
  came from.)

### Verdict: REFUTE

One blocking finding. It is a **NEW** finding, introduced by the round-3 edits themselves: the two new
scenarios were added under a requirement whose normative prose was not updated with them, so the spec delta
— the artifact that gets archived into `openspec/specs` and that HEL-516/519/503 will read as the contract —
now contradicts itself on precisely the CR4 point.

All four round-2 items are resolved. Nothing else regressed.

### Change Requests

1. **`specs/keyboard-shortcut-declarations/spec.md`, requirement "The declared combination shape expresses
   non-modifier and Shift-bearing bindings" — the requirement sentence forbids what the new scenario
   requires.** It currently reads:

   > Matching SHALL be exact with respect to the modifiers a combination declares: an event carrying a
   > modifier the combination does not declare SHALL NOT match it.

   Shift is a modifier. `help-overlay` is declared `{ key: "?" }` and therefore does not declare Shift; a
   US-layout `?` event carries Shift; by this sentence it "SHALL NOT match" — so the shipped `?` binding
   would never fire. That directly contradicts the sibling scenario "An unstated Shift requirement matches
   regardless of Shift" added in the same round, and it is the exact defect CR4 identified, now relocated
   from `tasks.md` into the normative spec. Rewrite the sentence to scope exactness to the platform
   modifier and to state the Shift tri-state explicitly, e.g.: "Matching SHALL be exact with respect to the
   platform modifier: an event holding the platform modifier SHALL NOT match a combination that does not
   declare it. The Shift modifier SHALL be tri-state: required when the combination declares it required,
   forbidden when the combination declares it forbidden, and unconstrained when the combination does not
   state it." (Wording must agree with design.md Decision 2's table.)

   Same requirement, first scenario — "**WHEN** an event for `?` (Shift and the `/` key, with no platform
   modifier) is tested against a combination declaring **exactly that**" — reads as a combination that
   declares Shift, which is the rejected `shift: true` shape. Reword so the combination under test is the
   one that actually ships (`?` with Shift unstated), or drop "exactly that" in favour of naming the `?`
   character combination.

### Non-blocking notes

- `tasks.md` task 2.1 parenthesises Decision 3 as "*exactly one listener exists after this change*". Design
  Decision 3's body scopes this correctly ("exactly one `window` keydown listener **for global shortcuts**")
  and the Context section names `OverlayProvider.tsx:24`'s Escape listener as surviving, but the bare task
  wording is the round-2-corrected false claim resurfacing in the artifact that ships. Adding "for global
  shortcuts (OverlayProvider's Escape listener is out of scope — Decision 4a)" to task 2.1 would close it.
  Not blocking: task 4.1a requires *using* `useOverlay`, so nothing tasks an executor to delete it.
- Decision 4a's "20 `<Modal>` consumers / 18 non-registrants" is really 21 / 19. Worth correcting for
  accuracy; the argument is unaffected.
- Per orchestrator instruction, the command-palette-shows-no-key-caps cohesion gap is left to the owner and
  is not treated as a CR here.
