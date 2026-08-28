## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round 1's change request #1 (rebind + shared module not captured as a spec Requirement)** —
   confirmed closed. Read the new `specs/keyboard-shortcut-declarations/spec.md` in full: it has three
   ADDED Requirements — "Global keyboard bindings are declared in exactly one enumerable module,"
   "A shared guard suppresses global bindings while the user is typing," and "The command palette owns
   Cmd/Ctrl+K and the quick-launcher moves to Cmd/Ctrl+J" — each with concrete scenarios covering the
   human-resolved outcome (`palette-takes-k-launcher-moves`) verbatim: palette takes K, launcher moves to
   J and stays reachable by shortcut/command-bar/palette, one enumerable declaration module,
   `preventDefault` on both.

2. **Round 1's change request #2 ("Open assistant" action has no spec scenario)** — confirmed closed.
   Read `specs/command-palette-navigation-actions/spec.md`: it now has a dedicated Requirement, "An 'Open
   assistant' action keeps the quick-launcher reachable from the palette," with two scenarios (the action
   opens the quick-launcher and closes the palette; the action is findable via "chat"/"assistant"
   keywords).

3. **Task 1.3 phrasing nit** — confirmed fixed. `tasks.md` 1.3 now reads "verified by 6.6 asserting
   Cmd/Ctrl+J DOES open it and Cmd/Ctrl+K does not," closing the positive-assertion gap round 1 flagged
   as non-blocking.

4. **`proposal.md` Capabilities section** — confirmed updated: lists `keyboard-shortcut-declarations` as a
   fifth new capability, and the Modified Capabilities section explicitly states why `chat-quick-launcher`
   needs no delta (it names no specific key today, so the rebind is implementation-only against that spec).

5. **Escalation resolution fidelity** — read `ticket.md`'s Premise notes and `design.md`'s Context/D8/D9/
   Planner Notes. Both consistently state the resolved outcome
   (`palette-takes-k-launcher-moves`: palette=K, launcher=J, one shared declaration module, seeded "Open
   assistant" action) and it now also lives in the spec deltas verified above — not just in prose. No
   drift between ticket.md, design.md, tasks.md, and the specs on this point.

6. **Cross-checked the registry's public surface against ground truth** — read `Modal.tsx`,
   `OverlayProvider.tsx`, `sections.ts`, `App.tsx` lines around 108-117, and `App.test.tsx:1099-1200`
   directly (not merely trusting design.md's citations) to confirm the claimed line ranges and existing
   `Cmd/Ctrl+K` handler are real and match what round 1 and this round's design.md assert.

7. **New finding — a genuinely load-bearing field is asserted in design.md but absent from its own
   spec's Requirement text.** `design.md` D6 states: *"`CommandAction` therefore also carries an optional
   `matchesQuery` opt-out so a contributor that has ALREADY filtered server-side is not filtered a second
   time locally,"* and explicitly frames this as the mechanism that makes two of the four blocked
   siblings implementable: *"This single field is what makes HEL-503 (search) and HEL-519 (recents)
   implementable without reopening this contract."* `tasks.md` 2.1 lists `matchesQuery?` (and `subtitle?`)
   as fields of `CommandAction`. But `specs/command-action-registry/spec.md`'s Requirement "Every palette
   entry conforms to one typed action contract" enumerates the contract's fields explicitly — "a stable
   unique `id`; a human-readable `title`; optional `keywords`...; an optional `section` grouping label; an
   optional icon; and a `run` behavior" — and stops there. Neither `matchesQuery` nor `subtitle` is
   mentioned anywhere in any spec delta (I grepped all five spec files for `matchesQuery` and `subtitle`:
   zero hits outside design.md/tasks.md). Nor does `command-palette-filtering/spec.md` describe any
   opt-out from local matching/ranking — its filtering requirements are stated as unconditional over "each
   action's title and keywords."

   This is exactly the kind of gap the round-1 pattern already flagged once (load-bearing contract detail
   living only in design/tasks prose, not in the spec HEL-503/510/516/519 will actually read as the
   registry's contract) — and it recurs here for a field design.md itself calls out as specifically
   necessary for two of the four blocked tickets. An implementer of HEL-503 or HEL-519 reading only
   `command-action-registry/spec.md` (the artifact that governs what "the registry's public surface" is)
   would have no formal basis for `matchesQuery` existing at all, and either (a) discover mid-implementation
   that they need to modify this already-shipped spec's Requirement to add a field it deliberately omitted,
   or (b) reimplement ad hoc local-suppression logic because the sanctioned mechanism isn't documented as
   part of the contract — precisely the rework risk the task brief asked me to hunt for.

### Verdict: REFUTE

Round 1's two change requests are both genuinely and faithfully closed — I re-verified each against the
actual spec text, not the round-1 report's characterization of it. The design remains well-grounded
against the live codebase. But there is one new, load-bearing gap of the same shape as round 1's: a
detail design.md itself asserts is necessary for two of the four blocked sibling tickets is missing from
the one spec that governs the registry's public contract.

### Change Requests

1. **Add `matchesQuery` (and, for completeness, `subtitle`) to `command-action-registry/spec.md`'s
   "Every palette entry conforms to one typed action contract" Requirement**, either by listing them as
   additional optional fields in the existing Requirement text, or as a new Requirement/scenario pair
   (e.g. "A registrant can opt out of local query filtering") mirroring the "Registrants can observe the
   palette's live query" Requirement's own justification ("query-dependent contributors — resource search
   and recents among them — can plug into this contract without it having to change"). Since design.md D6
   explicitly names this field as the HEL-503/HEL-519 unlock mechanism, it belongs in the spec those
   tickets will read as the registry's contract, not only in this change's design rationale.

### Non-blocking notes

- `tasks.md` 2.1 still lists `subtitle?` with no corresponding spec mention or scenario anywhere (unlike
  `matchesQuery`, design.md never explains why `subtitle` exists or which sibling ticket needs it). Worth
  either giving it the same spec treatment as `matchesQuery` or dropping it from the task if it's not
  actually needed by this ticket's own scope — as written it's an unexplained, unspecified field on the
  public contract.
- The design is otherwise unusually well cross-referenced to the live tree (Modal, OverlayProvider,
  sections.ts, AppShell line ranges, App.test.tsx line ranges all checked and correct) — a comparatively
  strong artifact set to build the remaining epic leaves on once this one gap closes.
