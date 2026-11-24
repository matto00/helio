## Standing Constraints

## 1. Tests first (red)

### Tests
- [x] 1.1 Add `ProposalDryRunEgressGuardSpec` (D2), incl. the admitted-host sanity case; run it on main code and record
  the result (expected: guard case already green on main; prove it by the D2 mutations, each recorded red then reverted)
- [x] 1.2 Add cap specs (D1): oversized (100,000-char HTTP error body via `fetchOverride`) truncated to 500 code points +
  ` … [truncated]`; <=500 unchanged; <=500 code points but >500 UTF-16 units (e.g. 400 emoji) unchanged, no
  exception; a surrogate pair straddling the cut is not split. Red on main, recorded + committed
- [x] 1.3 Add an assistant tool-executor test: `propose_pipeline` rejected by an oversized fetch error yields an `is_error`
  tool_result whose content is bounded (red on main, recorded + committed)
- [x] 1.4 Add an order spec (D3): a proposal with an inline REST root and a preflight-rejected step is rejected with the
  preflight message, the fetch counter is 0 and the source-fetch budget is not charged (red on main, recorded + committed)
- [x] 1.5 Add a helio-mcp test: registered `propose_pipeline` description lacks "never re-validated here" and mentions
  the live schema fetch (red on main, recorded + committed)

## 2. Implementation

### Backend
- [x] 2.1 `PipelineRootDryRun.capFetchError` + apply it in `rootSchema` (D1); 1.2/1.3 go green
- [x] 2.2 Reorder `PipelineProposalService.dryRun`: preflight, roots, checkOutputs; update its doc comment (D3); 1.4 green
- [x] 2.3 helio-mcp `pipelineProposal.ts` description (D4); 1.5 green

## 3. Verification

### Tests
- [x] 3.1 Run in full: the new specs, `ProposalDryRunRestSchemaSpec`, `ProposalDryRunParitySpec`,
  `PipelineProposalServiceValidateSpec`, `CombinedProposalServiceValidateSpec`, `PatchSetPreviewServiceSpec`,
  `AssistantToolExecutorSpec`, `RestConnectorEgressGuardSpec`; helio-mcp test suite
- [x] 3.2 Record the D2 mutation runs (both red) and the D1/D3 mutations (revert cap / revert order -> red) as .txt evidence
