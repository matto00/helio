## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- Read `skeptic-design-3.md`, then re-derived everything from the live tree.
- **Round-3 item 1 (`DataPanelKinds`).** Live source:
  `DashboardProposalService.scala:211` = `Set("metric","chart","table","collection","timeline")`
  (note: no `markdown` — design.md:156 misquotes the hypothetical set, harmless).
  Consumers re-read in full: `ProposalPanelSupport.scala:37` (unbound-data-panel
  rejection), `:157` (`nonFlatConfigDataTypeId` escape hatch),
  `CombinedProposalService.scala:123` (`configIsBlessed`). Under a
  `kind ∈ {output,text,markdown,image,divider}` discriminator, `Set("output")`
  preserves all three semantics exactly (require binding on the one data-bearing
  kind; allow the `config.dataTypeId` escape hatch on content kinds only).
  **The chosen value is correct**, and `["output"]` for the two `.ts` mirrors is
  correct because `check-schema-drift.mjs:220-227` derives their canonical set by
  parsing `DataPanelKinds` out of the Scala file — they must match it literally.
- **Round-3 item 2 (line citations).** Verified against the live files:
  `proposal.ts:28` (`export const PANEL_TYPES = [`, file is 211 lines) ✔,
  `proposalValidation.ts:19` ✔ (`:44` use ✔), `ProposalReview.tsx:29,60,146` ✔,
  `DashboardProposalService.scala:211` ✔, `ProposalPanelSupport.scala:37,157` ✔,
  `CombinedProposalService.scala:123` ✔, `CombinedApplyProposalDanglingRefSpec.scala:39` ✔.
  Script-internal cites: `:195-199` ✔, `:205` ✔; `:232-263`/`:255-263`/`:275-297`
  are each within a few lines of the real constructs (231-256 / 258-271 / 283-312)
  — unambiguous, non-blocking.
- **Round-3 item 3.** `grep` for the superseded round-2 decision text and for
  `output | text | markdown | image | divider` in design.md/tasks.md → **no hits**;
  design.md:94-96 is now descriptive prose only. **Fixed.**
- **Round-3 item 4.** `tasks.md:59-63` (3.1) and `:69-72` (3.5) now carry the actual
  domain-field removals (`AlertRule.targetDataTypeId`, `Pipeline.outputDataTypeId`).
  **Fixed.**
- **Round-3 item 5.** `tasks.md:101-111` (3.11a) names the 10 rewire specs and the 2
  deleted ones, plus the stale doc comments; design.md:243-256 is consistent with it.
  **Fixed.**
- `npx openspec validate outputs-model-migration --type change --strict` → **valid**.
- Coverage partition not re-litigated (closed in round 3); no evidence it changed.

### Verdict: REFUTE

Rounds 1-3's five findings are all genuinely fixed. **Nothing below is a repeat** —
findings 1 and 2 are new defects introduced/exposed by the round-4 edits themselves,
so the "same item survived a round" escalation rule does not apply.

### Change Requests

1. **`panel.kind` does not exist, and tasks 3.10 and 5.4(d)/5.7 now contradict each
   other about it.** `ProposalPanel` (`DashboardProposalProtocol.scala:14-16`) has a
   field `` `type`: String `` and no `kind`. Task 3.10 (`tasks.md:85-87`) instructs
   the three call sites to change `panel.type` → `panel.kind`, which requires renaming
   that case-class field — and since spray-json derives the wire name from the field
   name, that renames the JSON property too. But task 5.4(c) is explicit that only the
   three *panel* schemas move `properties.type` → `properties.kind`, while 5.4(d)/5.7
   keep `dashboard-proposal.schema.json`'s `$defs.ProposalPanel.properties.**type**.enum`
   (merely re-valuing its enum), and design.md:141-143 reserves every other change to
   that schema for P1.4. Both cannot hold. Resolve it explicitly: the correct minimal
   answer is that `ProposalPanel.`type`` keeps its **name** in P1.1 and only its **value
   domain** becomes the kind set — so all three call sites are byte-for-byte unchanged
   and only the constant's value moves to `Set("output")`. Fix the `panel.type` →
   `panel.kind` wording in tasks 3.10 and design.md:164-165 accordingly (or, if the
   rename is really wanted, say so and re-point 5.4(d)/5.7's JSON pointer, which
   contradicts the P1.4 boundary).

2. **`DataPanelKinds` is not the only kind-valued predicate in these files — its three
   siblings suffer the identical silent-validation-loss and are unowned.** Same class as
   round-3 finding 1, different constants, and the round-4 edit fixed only the one it
   named. Once `` panel.`type` `` carries kinds rather than visualization types, every
   one of these becomes permanently false:
   - `ProposalPanelSupport.scala:39` `panel.type == "chart"` → `validateChartType` never runs
   - `ProposalPanelSupport.scala:49` `panel.type == "chart"` → `ChartPanel.rejectsAggregation` never runs
   - `ProposalPanelSupport.scala:46` and `:217` `== DashboardProposalService.TimelineKind`
     → timeline `sort` validation and its config derivation never run
   - `ProposalPanelSupport.scala:209` `== MetricKind` → metric `label`/`unit` derivation never runs
   - `ProposalPanelSupport.scala:136` `MetricIdSupportedKinds` (`DashboardProposalService.scala:219`)
     → moot once metrics are deleted, but must be *deleted*, not left dead
   Task 3.9's bare "rewire panel resolution to Outputs" does not name any of these, and
   task 5.7 still asserts "No other change to these files' logic/UX." Add to task 3.10
   (or a new 3.10a) an explicit decision for each: where the visualization type now lives
   post-collapse (presumably the Output's `OutputKind`/panel config, not `panel.type`),
   and whether each check is re-pointed there or removed — plus the specs that cover them.

3. **Task 5.4(d) and 5.7 disagree on the exact enum for `dashboard-proposal.schema.json`.**
   5.4(d) (`tasks.md:159-162`) says "updated to the new kind set" (5 values, includes
   `divider`); 5.7 (`:180-182`) says `agentFacingKinds` (4 values, `divider` dropped).
   `check-schema-drift.mjs:258-271` compares that pointer against `agentFacingPanelTypes`
   (canonical minus `divider`), so 5.4(d) as written fails the pre-commit gate. Make 5.4(d)
   say `agentFacingKinds` (or make it a pure cross-reference to 5.7 — the two tasks also
   duplicate ownership of the same edit).

### Non-blocking notes

- design.md:156 states the round-3 naive set as including `"markdown"`; the live
  `DataPanelKinds` has no `markdown` arm, so the "true only for markdown" narrative is
  about a superset that never existed. Cosmetic; the decision it justifies is still right.
- Script-internal line cites in tasks 5.4(c)/(d)/(e) are each a few lines off the real
  constructs (real: 231-256, 258-271, 283-312). The named constructs are unambiguous.
- Round 3's non-blocking notes (checklist "13 wholesale REMOVED" prose, the
  "Round 1/2 (16 capabilities)" heading, `proposal.md`'s `data-source-persistence`
  listing) appear unaddressed. Still non-blocking.
