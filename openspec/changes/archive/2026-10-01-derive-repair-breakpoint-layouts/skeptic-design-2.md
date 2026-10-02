## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Read ticket.md (owner ruling), proposal.md, design.md, tasks.md, both spec deltas, prior skeptic-design-1.md, and current dashboardLayout.ts.
- Prior CRs 1-4 are addressed: Decision 3 now always calls markLayoutChanged(candidate) with a drag-away-and-back test (3.3); skeleton consumers added (2.4); precedence 2b->2d and repaired-form sources stated in Decision 2; resolver-level always-compact mutant (2.2a) and createPanel test (2.5) added.
- Every AC and ruling bullet traces to a task; HEL-1028 safety and referential stability are covered.

### Verdict: REFUTE

### Change Requests
1. Spec delta contradicts design on the derivation source. specs/breakpoint-layout-resolution/spec.md ("A breakpoint with no authored layout is derived...") says the source is the nearest breakpoint "whose saved layout is valid" (and valid is defined by the first requirement as covering every panel, in bounds, non-overlapping), and that default positions are used "if no breakpoint has a valid layout". design.md Decision 2 instead uses the repaired (compacted) form of an overlapping layout, and lets a merely partial breakpoint serve as source for the panels it holds, falling through to the next nearest. Under the spec text, a dashboard whose only authored bp is overlapping, or only partial (the createPanel case), would be derived from defaults, which is exactly what Decision 2 and prior CR 3b intend to avoid. Revise the spec requirement to match the design (source = nearest non-empty, in-bounds-after-repair breakpoint; per-panel fall-through to next nearest; default placement only when no breakpoint holds any usable entry) and add scenarios for (a) only authored bp overlapping keeps reading order at other bps and (b) saved layout both overlapping and partial (anchors compacted, then missing panels derived). Tasks 2.2b already test these; the spec must state them so spec and tests agree.

### Non-blocking notes
- Heuristic 2a (any x+w>cols discards in-bounds siblings) is acknowledged in Risks; acceptable.
- Confirm in implementation that the active-bp computed in handleLayoutChange uses the shifted breakpoints and the same width RGL receives.
