## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round-1 finding 1 (kind-mismatch) — the `clearBlessedSlot` fix is correct for its target case.**
   Re-read `ProposalPanelSupport.scala` in full: `bindingCandidate(panel) = panel.dataTypeId.orElse
   (nonFlatConfigDataTypeId(panel))`, `nonFlatConfigDataTypeId` returns `None` outright when
   `DashboardProposalService.DataPanelKinds.contains(panel.type)` (`ProposalPanelSupport.scala:150-158`;
   `DataPanelKinds = Set("metric","chart","table","collection","timeline")`,
   `DashboardProposalService.scala:200`). Traced tasks.md 4.2's `clearBlessedSlot` chain against a
   `chart` panel with flat `dataTypeId = None` and `config: {"dataTypeId": "$pipelineOutput"}`: the
   "flat == sentinel" branch is false (`None != Some(sentinel)`), and the "type outside DataPanelKinds"
   branch is also false (chart is IN the set) — so the panel is returned unchanged, the sentinel survives
   the re-serialization scan, and the panel is correctly rejected pre-apply. **This closes round-1
   finding 1 for the case it was written against.**

2. **Round-1 finding 2 (duplicate occurrence) — the re-serialize-and-rescan approach is sound.**
   Traced the "legitimate sentinel in `dataTypeId` + a second literal `\"$pipelineOutput\"` in
   `fieldMapping` on the same panel" case: `clearBlessedSlot` clears the one legitimate slot, and the
   rescan still finds the sentinel in `fieldMapping` (never touched by `clearBlessedSlot`) → rejected.
   Confirmed against `proposalPanelFormat.write` (`DashboardProposalProtocol.scala:65-87`), which
   serializes `fieldMapping` verbatim as part of the panel's JSON — the substring scan would actually see
   it. **This closes round-1 finding 2 for the case it was written against.**

3. **A new residual precedence-fidelity gap in the SAME `clearBlessedSlot`/`resolveOutputRefs`
   algorithm, found by re-deriving it against `bindingCandidate`'s real `Option.orElse` semantics rather
   than trusting the design doc's English restatement — see Change Request 2 below.** `bindingCandidate`
   only ever consults `config.dataTypeId` when the flat `panel.dataTypeId` is **absent** (`Option.orElse`
   only evaluates its argument when the receiver is `None` — this is not "when the flat value doesn't
   equal the sentinel"). Design.md D2's literal wording ("clear the flat `dataTypeId` if it equals the
   sentinel; **else**, only for a non-`DataPanelKinds` panel, clear `config.dataTypeId` if it equals the
   sentinel") and tasks.md 4.2/4.3's identical phrasing both branch on "flat equals the sentinel," not on
   "flat is present at all" — these are not equivalent when the flat field holds a real, non-sentinel
   value. Traced a concrete counter-example (below) where this produces a false negative — the sentinel
   check passes a panel it should reject, per the design's own stated intent ("the ONE blessed position
   `bindingCandidate` would actually read for that panel's kind").

4. **spec.md was not updated alongside design.md/tasks.md — internal contradiction between the spec
   delta and the (now-corrected) design/tasks.** Re-read `specs/combined-proposal-apply/spec.md` in full.
   Requirement 2 ("wherever it appears in a panel's flat `dataTypeId` or its `config.dataTypeId`") and
   Requirement 3 ("appears anywhere in that panel's JSON representation **other than** its flat
   `dataTypeId` or its `config.dataTypeId`") both still state the blessed positions as *unconditionally*
   both slots, for every panel — this is exactly the kind-unaware framing round-1 refuted (D2/D3 before
   revision). The change's own artifact set now disagrees with itself: design.md/tasks.md correctly
   describe a kind-conditioned check; spec.md, the authoritative "spec delta" that becomes the living
   requirement text for this capability, still describes the un-conditioned (already-refuted) one. See
   Change Request 1.

5. **Non-blocking notes from round 1 were genuinely fixed.** `PanelResponse.fromDomain(panel: Panel,
   dataAsOf: Option[String] = None)` confirmed at `backend/src/main/scala/com/helio/api/protocols/
   PanelProtocol.scala:112` (defaulted second param, matches tasks.md 4.4's now-explicit-lambda
   instruction). `panelSchema` confirmed exported from `proposal.ts` per tasks.md 6.4's corrected
   attribution (not independently re-verified against `helio-mcp/src/tools/proposal.ts` this round since
   round 1 already did so and the wording is now consistent with that finding).

6. **Spot-checked D4/D5/D6 claims (unchanged from round 1) for continued validity.** `PipelineProposalService.scala`
   still exposes `rollbackAll`/`rollbackSourceOnly` (private) and `dataTypeRepo.findBySourceId` at the
   call sites round 1 cited — the new public `rollback` method's design still composes cleanly.
   `DuplicateDashboardResponse(dashboard: DashboardResponse, panels: Vector[PanelResponse])` confirmed
   unchanged at `DashboardProtocol.scala:35`. No regressions found in the untouched sections.

### Verdict: REFUTE

Round-1's two findings are correctly fixed in design.md/tasks.md for the exact scenarios they were
written against (items 1–2 above). But the round surfaced two further problems in the same area: the
"corrected" algorithm still has a real, narrower precedence-fidelity gap relative to `bindingCandidate`'s
true `orElse` semantics (Change Request 2), and — separately but more importantly — the spec.md delta,
which is part of the planning artifact set and the actual normative text for this new capability, was
never updated to match the corrected design and still asserts the already-refuted kind-unaware rule
(Change Request 1). Both are concrete and actionable; neither is a restatement of round 1's findings.

### Change Requests

1. **Update `specs/combined-proposal-apply/spec.md` Requirements 2 and 3 to state the kind-aware
   precedence, not "flat `dataTypeId` or `config.dataTypeId`" unconditionally.** As written:
   - Requirement 2: "The service SHALL substitute the reserved sentinel `"$pipelineOutput"`, wherever it
     appears in a panel's flat `dataTypeId` or its `config.dataTypeId`, ..."
   - Requirement 3: "...any panel where the sentinel `"$pipelineOutput"` appears anywhere in that panel's
     JSON representation other than its flat `dataTypeId` or its `config.dataTypeId`..."

   Both list `config.dataTypeId` as an unconditional blessed slot for every panel, which is exactly the
   round-1-refuted behavior (a sentinel in `config.dataTypeId` on a `chart`/`metric`/`table`/`collection`/
   `timeline` panel would read as "blessed" per this spec text, even though `bindingCandidate` never
   consults it there). Reword both to reference the actual precedence, e.g.: "...the one position
   `ProposalPanelSupport.bindingCandidate` would actually read for that panel's kind: the flat
   `dataTypeId`; or, only when the panel's type is outside `DashboardProposalService.DataPanelKinds`
   (`metric`, `chart`, `table`, `collection`, `timeline`) and the flat field is absent, `config.dataTypeId`."
   Without this, spec.md — the artifact meant to be the durable requirement record after archive —
   contradicts the design/tasks it is supposed to summarize, and a reader consulting spec.md alone (its
   stated purpose) would implement the wrong, already-refuted rule.

2. **Fix the remaining `orElse`-fidelity gap in `clearBlessedSlot`/`resolveOutputRefs`: branch on whether
   the flat `dataTypeId` is *absent*, not on whether it *doesn't equal the sentinel*.** Concrete
   counter-example: a non-`DataPanelKinds` panel (e.g. `type: "text"`) with flat `dataTypeId =
   Some("real-existing-type-id")` (a genuine, non-sentinel, resolvable id — nothing in `ProposalPanel`'s
   shape restricts the flat field to `DataPanelKinds` panels) **and** `config: {"dataTypeId":
   "$pipelineOutput"}` (a leftover/erroneous sentinel). Per real `bindingCandidate` (`panel.dataTypeId
   .orElse(...)`), `config.dataTypeId` is **never** consulted here — `Option.orElse` only evaluates its
   argument when the receiver is `None`, and the receiver is `Some("real-existing-type-id")` — so
   `config.dataTypeId` is not a blessed position in this configuration, sentinel or not. But
   `clearBlessedSlot` as literally described (design.md D2 / tasks.md 4.2: "clear the flat `dataTypeId`
   if it equals the sentinel; **else**, only for a non-`DataPanelKinds` panel, clear `config.dataTypeId`
   if it equals the sentinel") falls into the "else" branch here (flat `!= sentinel`, even though flat
   IS present) and clears/treats `config.dataTypeId` as the blessed slot — so the rescan finds nothing,
   and the dangling sentinel silently passes the pre-check instead of producing the `400` spec.md
   Requirement 3 promises. Practical severity is narrower than round-1's findings (in this specific
   scenario the eventual write is likely inert — `ProposalPanelSupport.mergeConfig` forcibly re-applies
   the flat `dataTypeId` over whatever `config.dataTypeId` ends up holding whenever the flat field is
   defined, so no wrong id is actually persisted) — but it is still a genuine violation of the stated AC
   ("an unresolved/dangling ref is a 400 that creates nothing") and of design.md's own claim to mirror
   `bindingCandidate`'s "EXACT precedence": the pipeline/source get created for a proposal containing a
   panel that should have been rejected pre-apply. tasks.md 4.3 explicitly inherits "the SAME kind-aware
   precedence as 4.2," so `resolveOutputRefs` has the identical gap. Fix: branch on `panel.dataTypeId
   .isEmpty` (true `Option` absence) before even considering `config.dataTypeId`, e.g.: `if
   (panel.dataTypeId.contains(sentinel)) clear flat; else if (panel.dataTypeId.isEmpty && panel.type is
   outside DataPanelKinds) clear config.dataTypeId if it equals the sentinel`. Add a task 7.4c test
   scenario: a non-`DataPanelKinds` panel with a real, resolvable flat `dataTypeId` AND `config.dataTypeId
   = "$pipelineOutput"` → `400` naming the panel, creating nothing — distinct from 7.4a (flat absent,
   kind-mismatched panel) and 7.4b (duplicate occurrence within the SAME blessed-slot type).

### Non-blocking notes

- None beyond the items already resolved from round 1 (confirmed fixed in item 5 above).
