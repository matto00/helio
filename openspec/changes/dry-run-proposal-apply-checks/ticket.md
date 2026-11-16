# HEL-1638: Assistant proposals: dry-run the apply-time checks before presenting, so a proposal never fails on apply

## Description

### Symptom (owner, prod, 2026-10-16)

The assistant presented a proposal (a Sleeper standings dashboard). Applying it failed with:

> fieldMapping references column(s) not present at this node: display_name. Available columns: co_owners, keepers, league_id, metadata, owner_id, player_map, players, reserve, roster_id, settings.fpts, settings.fpts_decimal, settings.losses, settings.ties, settings.total_moves, settings.waiver_budget_used, settings.waiver_position, settings.wins, starters, taxi

The agent mapped an Output slot to `display_name`, a column that doesn't exist at that node. It looks like a field from Sleeper's users endpoint, not rosters, so the agent guessed. The user only found out at apply time, after reviewing a proposal that could never have worked.

### Cause (driver's reading; verified at Setup, see evidence/premise-validation.md)

* `OutputBindingSpec.validateFieldMappingColumnsExist` (`backend/.../domain/panels/OutputBindingSpec.scala:193`). Since HEL-1639 it is wrapped by `OutputFieldMappingCheck.validate`, called by pipeline create (apply), by `analyze_pipeline_proposal` (reported as a per-Output `validationError`, not a rejection) and by patch-set output create (preview and apply).
* Proposal validation (`propose_pipeline` -> `PipelineProposalService.validate`, `propose_combined` -> `CombinedProposalService.validate`) checks slot names but never checks that the mapped columns exist at the target node.
* So a proposal passes every proposal-time check and shows as valid in Proposal Review, then fails on apply.

### Desired behaviour

**Every check the apply path runs, the proposal path runs first, as a dry run.**

* Before a `propose_*` result goes to the user, validate it against the same rules apply uses. At minimum: the column-existence check for each Output's `fieldMapping` against the target node's schema (the pipeline's symbolic analyze, HEL-1092, already produces per-node schemas without reading rows), plus slot eligibility, binding and nodeStepId resolution, and layout validity.
* Better still, run apply's validation itself in dry-run mode (validate everything, write nothing), so the two paths can't drift apart. Decide in design between sharing apply's validator and a dedicated dry-run.
* Errors go back to the agent, not the user. A failure becomes a `tool_result` with `is_error` and the same message (it already names the available columns), so the agent fixes the mapping within the same turn. Until HEL-1637 lands it uses a hop.
* A proposal shown in Proposal Review applies cleanly unless the workspace changed in between (stale data stays a separate, clearly-messaged case).
* Same guarantee for MCP: `propose_*` / `analyze_pipeline_proposal` / `apply_*` through helio-mcp share the validator, so external agents get the dry-run errors too.

## Acceptance Criteria

- [ ] A test that fails on the current code: a proposal whose Output maps a slot to a column missing at its target node (for example, one dropped by an upstream select/aggregate, or never present in the source) is rejected at propose time with the column-existence message. Today it passes propose and fails apply.
- [ ] A parity test: for a corpus of proposals, the dry run accepts a proposal if and only if apply succeeds (or the design's shared validator makes this true by construction, with a test that the same function runs on both paths).
- [ ] An assistant-loop test: after a dry-run failure the agent gets an `is_error` tool result naming the available columns, and can retry in the same turn.
- [ ] Live check: reproduce the Sleeper case (a rosters source, with standings that need owner names from users). The assistant either proposes a correct pipeline (for example, a join or lookup against the users source) or says it can't, and never presents a proposal that fails on apply. (Driver directive for this run: NO live Anthropic calls; this AC is proven with a fixture/scripted-model replay, and any live check needs an escalation with a cost estimate.)

## Notes

* Related: HEL-1637 (tool-loop failure budget), HEL-1636 (same Claude client tool loop; parked, avoid ClaudeClient/ClaudeProtocol/ClaudeModels), HEL-1639 (merged fd7064f7d; this change sits on top of it), HEL-1092 (symbolic analyze).
* Release hold inherited from HEL-1639: do not change the shape of tool input_schemas unless required.
