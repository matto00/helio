## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read the full artifact set fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/mcp-pipeline-proposal-tools/spec.md`, and the round-1 report
(`skeptic-design-1.md`), treating the latter as a claim log to re-derive, not a fact
source. Cross-checked every claim against the real code in this worktree.

**Round-1 finding 1 (D3 hoist) — CONFIRMED fully and correctly resolved.**
- Re-read `helio-mcp/src/tools/write.ts` in full: `boundPipelineStepSchema` is still at
  lines 535-538, inside `registerWriteTools` (opens line 39, closes line 928) — the exact
  problem round 1 found is unchanged in the code (as expected; only the planning docs
  were revised).
- design.md D3 now states the correct mechanical step verbatim: "hoist `const
  boundPipelineStepSchema = z.object({...})` out of `registerWriteTools` to module
  top-level scope as `export const boundPipelineStepSchema = ...`" — no longer "add
  `export` in place." tasks.md 3.1 mirrors this exactly, including the round-1
  attribution.
- Verified the "closes over nothing" safety claim by reading the declaration itself
  (`z.object({ type: z.string().min(1), config: z.record(z.unknown()).default({}) })`)
  — no reference to `server`/`api`/any other function-local. Hoisting to module scope is
  behavior-preserving; `create_bound_panel`'s reference at line 587 continues to resolve
  it via ordinary module-scope lookup regardless of textual position (module top-level
  `const` is fully initialized before `registerWriteTools` is ever invoked from
  `index.ts`).
- Verified the cited precedent is real, not invented: `write.ts:21`
  (`import { panelSchema } from "./proposal.js";`) already does cross-tool-file zod
  schema reuse today — D3's "mirroring `write.ts`'s own existing import of `panelSchema`
  from `proposal.ts`" is accurate.

**Round-1 finding 2 (untestable call-routing, false test precedent) — CONFIRMED fully
and correctly resolved.**
- design.md D4b's plan: extract a third module, `pipelineProposalHandlers.ts`,
  containing zod-free, `registerTool`-free plain async functions
  (`proposePipelineHandler`/`analyzePipelineProposalHandler`/`applyPipelineProposalHandler`)
  that a test can import without ever touching `pipelineProposal.ts` or `write.ts`.
- Verified this is actually achievable given the real dependency surface: read
  `helio-mcp/src/types.ts` (plain interfaces, no zod) and `helio-mcp/src/helioApi.ts`
  in full — confirmed zero `zod` import anywhere in `helioApi.ts` (`grep -n "^import"
  helioApi.ts`), and confirmed `analyzePipeline`/`applyProposal` are genuinely thin
  pass-throughs (`helioApi.ts:265-267`, `678-685`) matching the "mirrors the existing
  style" claim for the two new client methods (task 2.1/2.2).
  - Minor imprecision: design.md D4b calls `HelioApi` "a zod-free interface" but it is
    actually `export class HelioApi` (`helioApi.ts:154`). This doesn't affect the
    plan's validity — it's already imported as `import type { HelioApi } from
    "../helioApi.js"` in `write.ts`/`proposal.ts`/`read.ts` today, so a type-only
    import into the new zod-free handlers file carries no zod dependency either way.
    Wording nit only, not a blocker.
- Verified the TS2589 precedent this whole split is built on is real and independently
  re-derivable, not merely asserted: read `helio-mcp/src/tools/write.test.ts` (imports
  only `metricSchemas.ts`, docstring states the TS2589 reproduction "against `write.ts`
  unmodified on `main` too") and `helio-mcp/src/tools/proposal.test.ts` (imports only
  `proposalValidation.ts`, docstring states the same for `proposal.ts` + `panelSchema`).
  Both are existing, already-merged, already-passing test files — solid precedent, not
  a hypothetical the design invented.
- tasks.md section 5 (`pipelineProposalHandlers.ts`), section 6 (thin
  `pipelineProposal.ts` shell), and section 7 (tests split into
  `pipelineProposalValidation.test.ts` / `pipelineProposalHandlers.test.ts`, with a
  clearly-hedged, explicitly-optional `pipelineProposal.test.ts` for zod-shape-only
  assertions that self-documents its own TS2589 fallback in task 7.5) all match D4b
  coherently. This directly answers round 1's demand: "the design needs a workable
  mechanism, not silence."

**Non-blocking gap from round 1 (missing spec scenario) — filled.**
`specs/mcp-pipeline-proposal-tools/spec.md` now has "Neither sourceId nor inline type
set produces a warning" (lines 22-24), closing the parity gap with tasks.md 4.1(b).

**Fresh pass — re-verified the backend ground truth the whole design leans on (D1/D2/D4
mutual-exclusivity/D5/D6), not just re-trusting round 1's prior confirmation:**
- `backend/.../protocols/PipelineProposalProtocol.scala:68-105` — hand-written
  `pipelineProposalSourceFormat` still collapses exactly one of
  `csvConfig`/`restConfig`/`sqlConfig`/`staticConfig` to a single wire `"config"` key.
  D1 accurate.
- `backend/.../services/PipelineProposalService.scala:83-92` (`validateSourceSelector`)
  — confirms server-side both-set → 400 "specify either sourceId or an inline type, not
  both" and neither-set → 400 "sourceId or inline type is required." D4 item 3's
  "mirrors HEL-383's own D1 mutual-exclusivity guardrail" is accurate, and the new
  spec.md scenario matches this real backend behavior.
- `backend/.../protocols/PipelineAnalyzeProposalProtocol.scala:15-32` and
  `backend/.../routes/PipelineProposalRoutes.scala` — confirm D5's flat-step-reuse claim
  and the atomic apply route are unchanged and real.
- `helio-mcp/src/types.ts` — `PipelineSummaryResponse`, `SchemaField`,
  `PipelineAnalyzeResponse.steps`, `RunResultResponse`, `DataSourceResponse` all exist
  today with the shapes tasks.md 1.1-1.3 assume; no invented types.
- `helio-mcp/src/index.ts:18-30` — confirms task 6.5's registration pattern
  (`registerReadTools`/`registerWriteTools`/`registerProposalTools` called in sequence)
  is the real, current structure to extend.

**No placeholders / no new contradictions.** `grep -rni "TODO\|TBD\|figure out\|
placeholder"` across the artifact set turns up only the pre-existing risk-note
reference from round 1 (design.md, a legitimate risk callout, not a deferred decision).

### Minor observations (non-blocking)

1. tasks.md 6.3/6.4 don't spell out the destructuring/reassembly step (the registered
   tool's callback must destructure the flat `inputSchema` args and re-assemble them
   into the `proposal` object passed to `analyzePipelineProposalHandler`/
   `applyPipelineProposalHandler` — task 5.1's handler signatures take a single
   `proposal: PipelineProposal`, not flat args). This is implicit rather than spelled
   out, but every sibling tool in `write.ts`/`proposal.ts` follows this exact
   destructure-then-assemble pattern, so a competent implementer has abundant precedent
   to fall back on. Not ambiguous enough to block.
2. task 7.3's optional zod-shape test importing `pipelineProposal.ts` directly could
   itself re-trigger the TS2589 failure mode (since `pipelineProposal.ts` imports
   `boundPipelineStepSchema` from `write.ts`, pulling `write.ts`'s full zod surface back
   in) — but the design already hedges this explicitly ("if this still trips TS2589 in
   practice, fall back to...") and task 7.5 treats it as removable/optional, not required
   coverage. Appropriately honest, not a defect.

### Verdict: CONFIRM

Both round-1 REFUTE findings are now correctly and completely resolved, verified
against the actual code (not just the design's prose) in this fresh pass. No new
placeholders, contradictions, or acceptance-criteria gaps found. The design is sound
enough to implement.
