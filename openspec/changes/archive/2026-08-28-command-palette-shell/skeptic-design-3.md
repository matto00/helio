## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

1. **Round 2's change request (`matchesQuery`/`subtitle` missing from spec) — confirmed closed.**
   Read `specs/command-action-registry/spec.md` in full. The "Every palette entry conforms to one typed
   action contract" Requirement now enumerates `subtitle` and `matchesQuery` as optional fields, with a
   new scenario "A subtitle disambiguates entries sharing a title." A new Requirement "A registrant can
   opt out of local query filtering" was added with two scenarios ("A pre-matched action is not filtered
   out locally", "Actions without the opt-out are filtered normally"). `design.md` D6 (lines 65-70) now
   states both fields are part of the spec rather than left as rationale, and explains why `subtitle`
   exists (search/recents entries need a secondary line). This matches round 2's report's characterization
   exactly — re-verified against the live file, not the prior report's claim.

2. **Round 1's two change requests (rebind/shared-module contract, "Open assistant" action) — spot-checked,
   still closed.** `specs/keyboard-shortcut-declarations/spec.md` still carries the three Requirements
   round 2 described (declared in one module, typing-guard, palette owns K / launcher moves to J).
   `specs/command-palette-navigation-actions/spec.md` still carries the "Open assistant" action
   Requirement. No regression between round 2 and now.

3. **Escalation resolution fidelity** — `ticket.md` and `design.md` both still state
   `palette-takes-k-launcher-moves` consistently; no drift.

4. **New finding — the `matchesQuery` opt-out's interaction with result ranking is unspecified anywhere
   in the artifact set, not merely missing from the spec.** I traced this across every artifact:
   - `specs/command-action-registry/spec.md`'s opt-out Requirement says only that an opted-out action "SHALL
     be displayed ... without re-testing its title and keywords, **while still placing it in the result
     ordering**" — it never says where in that ordering.
   - `specs/command-palette-filtering/spec.md`'s "Results are ranked with stronger matches first"
     Requirement defines ranking purely in terms of title/keyword match strength (title-prefix > contiguous
     substring > subsequence > keywords-only) — a scale that has no defined value for an action that was
     never matched against title/keywords at all (that's the entire point of the opt-out). This Requirement
     and the opt-out Requirement do not cross-reference each other.
   - `design.md` D7 ("Ranking is a pure, separately tested function... scores title-prefix >
     contiguous-substring > subsequence > keywords-only") likewise never mentions the opt-out case.
   - `tasks.md` 2.4 (`rankActions(actions, query)`) and 6.8 (unit-test ranking) are scoped to the same four
     title/keyword tiers only — no task authors or tests the opted-out case's position in the list.
   - I grepped every spec file and design.md for "matchesQuery" cross-referenced with "rank"/"order" —
     zero co-occurrence anywhere.

   This differs from round 1 and round 2's pattern in a way that makes it *more* severe, not equally severe:
   those were cases where a decision **existed** in design.md/tasks.md prose but wasn't promoted to spec text.
   Here, no artifact — spec, design, or tasks — states the answer at all. Since design.md D6 explicitly names
   `matchesQuery` as "what makes HEL-503 (search) and HEL-519 (recents) implementable without reopening this
   contract," and both of those tickets exist specifically to supply pre-ranked (server-ranked / usage-ranked)
   results through this exact field, this is squarely load-bearing: whichever of HEL-503/HEL-519 lands first
   will have to invent an answer (interleave by original order? always sort last? always sort first?) that the
   other ticket, and any future palette maintainer, has no contract basis for matching — precisely the
   "reopen this contract" outcome D6 says the field exists to avoid.

### Verdict: REFUTE

Round 2's change request is genuinely and faithfully closed — I re-verified the spec text directly. But the
revision that closed it introduced a fresh, unresolved seam between the newly-added opt-out Requirement and
the pre-existing ranking Requirement, and it is a real design decision that has not been made anywhere in
this artifact set yet — not a case of "make it formal," but "decide it."

### Change Requests

1. **Specify where an opted-out (`matchesQuery`-declaring) action is placed in the ranked result list,
   relative to title/keyword-matched actions, in both `specs/command-action-registry/spec.md`'s opt-out
   Requirement and `specs/command-palette-filtering/spec.md`'s ranking Requirement (cross-reference each
   other).** At minimum this needs one of: (a) opted-out actions retain the order the registrant supplied
   them in and are interleaved into the ranked list by registration/insertion position (with a rule for how
   that interacts with sectioning), or (b) opted-out actions form their own tier relative to the four
   title/keyword tiers (e.g., ranked as if they were the strongest/weakest tier, or kept in their own
   sub-group). Update `design.md` D6/D7 to state the same decision, and extend task 2.4's `rankActions`
   scope and task 6.8's test coverage to include at least one scenario exercising an opted-out action's
   position among matched results.

### Non-blocking notes

- The rest of the artifact set remains unusually well cross-referenced to the live tree (Modal,
  OverlayProvider, sections.ts, AppShell line ranges, App.test.tsx line ranges — all previously verified
  against ground truth by round 1 and spot-checked again here with no drift found).
- Two full rounds have now closed exactly the pattern of "prose decision not promoted to spec" — that
  specific failure mode appears converged. This round's finding is a different, narrower failure mode
  (an internal seam between two Requirements added in different rounds) and should not be read as evidence
  the artifact set is diverging; it is the kind of gap that specifically appears once two independently
  correct Requirements are read against each other.
