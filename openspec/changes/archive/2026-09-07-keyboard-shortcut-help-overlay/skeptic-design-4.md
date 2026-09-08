## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Scope per orchestrator: verify the round-3 finding is fixed; check only for damage newly introduced by that
edit. Rounds 1-2 items not re-litigated (no positive evidence of regression found in what I did read).

### What I verified (with evidence)

**1. Round-3 finding — RESOLVED. The prose no longer contradicts any of its own scenarios.**
`specs/keyboard-shortcut-declarations/spec.md:17-50`. The blanket sentence "Matching SHALL be exact with
respect to the modifiers a combination declares" is gone. It is replaced by two separately-scoped bullets:

- platform modifier: exact in both directions (event holding it doesn't match a combo omitting it; event
  without it doesn't match a combo declaring it);
- Shift: three-valued — required / forbidden / unstated, and "when it is unstated, the presence or absence
  of Shift SHALL NOT affect whether the event matches."

I read each of the requirement's four scenarios against that prose:
- *"A modifier-free binding on a printable character matches"* — `?`, no platform modifier, vs a combination
  declaring that character with no platform modifier. Permitted by bullet 1 (neither side has the platform
  modifier) and unconstrained by bullet 2 (Shift unstated). **No contradiction** — this is the exact
  scenario that was self-refuting in round 3, and the rewrite fixed it on both sides (prose AND the
  scenario's own wording; the "declaring **exactly that**" phrasing that implied `shift: true` is gone).
- *"An unstated Shift requirement matches regardless of Shift"* — directly restates bullet 2's unstated arm.
- *"A stated absence of Shift is enforced"* — directly restates bullet 2's forbidden arm.
- *"Existing platform-modifier bindings are unaffected"* (`mod`+`k`) — bullet 1.
No scenario is now orphaned (each maps to a clause that survives) and none is unreachable.

**2. Three-way spec / design / tasks consistency — holds.**
- `design.md:78-105` Decision 2's table (`shift: true` = must be held / `shift: false` = must not / omitted =
  don't-care) is a term-for-term match with the spec's three-valued bullet. Decision 2's `mod` sentence
  ("exactly matched … an event holding the platform modifier never matches a combo that omits `mod`") is the
  same rule as bullet 1; the spec states the converse direction as well, which is an addition, not a conflict.
- `tasks.md:1.1` ("`mod` is exactly matched. `shift` is **tri-state** … `true`/`false`/**omitted =
  don't-care**") and `tasks.md:1.3` (`help-overlay = { key: "?" }` with `shift` OMITTED; `layout-undo =
  { key: "z", mod: true, shift: false }` as load-bearing) are consistent with both. No occurrence of
  `{ key: "?", shift: true }` anywhere in the change dir (grepped).
- Rationale sentences in the spec ("the character a key produces already encodes whether Shift was needed",
  "two bindings on the same key told apart") match Decision 2's justification and task 1.3's inline note —
  same reason given in all three artifacts, not three different ones.

**3. Nothing newly broken by the round-3 edit.**
- **No dangling reference to the old requirement title.** `grep -rn` across the change dir for the title
  fragments: the only requirement heading is `spec.md:17` itself. `design.md:19` ("modifier-free and
  Shift-bearing keys") already uses the new phrasing; `proposal.md:32` and `ticket.md:27` say "non-modifier
  and Shift-bearing", but those are descriptive prose about the combo shape, not citations of a requirement
  heading, so nothing dereferences a stale name.
- **No duplicated scenario titles** — `grep -h "^#### Scenario" specs/*/spec.md | sort | uniq -d` → empty.
- **No duplicated requirement headings** — nine unique headings across the two spec files.
- **MODIFIED-requirement anchor still valid**: the delta's MODIFIED heading "Global keyboard bindings are
  declared in exactly one enumerable module" matches the baseline heading in
  `openspec/specs/keyboard-shortcut-declarations/spec.md` byte-for-byte, so the round-3 edit did not break
  the archive path. The two other baseline requirements (typing guard, Cmd/Ctrl+K ownership) are untouched
  by this delta and are not contradicted by the new prose.
- `npx openspec validate keyboard-shortcut-help-overlay --type change --strict` → "is valid". (Cited only as
  structural; per round 3 it does not read prose for semantic contradiction — item 1 above is my own read.)

### Verdict: CONFIRM

The round-3 blocking finding is genuinely fixed, and the fix introduced no orphaned scenario, no stale title
reference, and no spec/design/tasks divergence. The design is sound enough to implement.

### Non-blocking notes (wording/polish only — NOT blocking, do not spend a round on these)

- `design.md` Migration Plan: "`matchesCombo` gains **Shift exactness**" and `tasks.md:3.3` "flipping the
  **Shift exactness** from task 1.1" are leftover phrasing from the pre-tri-state framing. Both plainly mean
  "`shift: false` enforcement" and neither is ambiguous in context, but "exactness" is the word the spec just
  deliberately stopped using for Shift. An executor could safely fix these in passing.
- Decision 4a's "20 `<Modal>` consumers / 18 non-registrants" is really 21 / 19 (round-3 measurement, which I
  did not re-run). Accuracy nit; the argument is unaffected.
- Round 3's note on task 2.1's bare "exactly one listener exists after this change" is still open. Design
  Decision 3's body scopes it correctly ("for global shortcuts") and task 4.1a requires *using* `useOverlay`,
  so no executor is tasked with deleting `OverlayProvider`'s Escape listener. Left as a note, as round 3 had it.
- The KeyCap-in-palette cohesion gap remains with the owner per instruction; not evaluated here.
