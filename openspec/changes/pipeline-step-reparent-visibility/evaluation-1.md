## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit 42b3cc5c13c2d64255ccbd32d4bd2f359affcd8e.

### Phase 1: Spec Review — PASS
Issues: none. AC1 (no silent re-parent; loud 422 naming ids, nothing written), AC2 (run_pipeline returns runId/stepRowCounts/warnings/stepCountsAvailable), AC3 (schema, docs/agent-native.md, helio-mcp README, tool descriptions, openspec deltas) all addressed. Task 4.0 (follow-up tickets) is the only unchecked task; it is a post-delivery orchestrator step, not code. `openspec validate` passes.

### Phase 2: Code Review — PASS
Gates run fresh by me in the worktree:
- `cd backend && nice -n 19 sbt testFull`: 5200 tests, 0 failed, 359 suites.
- `npx jest helio-mcp`: 34 suites / 341 tests pass. `npm run lint` clean, `format:check` clean, helio-mcp typecheck clean. (frontend/** untouched, frontend build/test not applicable.)

Specific checks:
- Red-first / mutation: forcing the backend guard off (`if (false && existingChildren.nonEmpty)`) makes 4 of the 9 new backend tests fail (parentStepId, rootId, no-anchor, attachAsTail-without-parent); the other 5 are the non-rejection/create-only cases, correctly passing. MCP mutations (drop `rejectIfReparents:true` default, drop the attachAsTail-needs-parentStepId check, break primary-root rule, disable shape child pre-read) fail 13 MCP tests. Mutations reverted; worktree clean.
- Zero writes on rejection: `DBIO.failed(ReparentRejected)` occurs after the read of existingChildren and before `stepsTable += newRow`, inside `transactionally`; tests assert step count and parent unchanged.
- Create-only `reparentedStepIds`: merged by `createdStepJson` in the POST route only; GET/PATCH/duplicate unchanged (test "create-only" covers it). `addStep` retained, delegates and discards; `duplicateStep` still uses `spliceInsertAtInternal` (wrapper, no flag).
- Splice call sites: rootId, parentStepId, no-anchor trunk-last, position-index in the service all use the reporting variant with the flag; attachAsTail path never rejected; wrapper covers duplicate.
- Run warnings vs spec: disabled-parent walk-up, non-primary-root skip, malformed config skip (never throws), empty counts => `stepCountsAvailable:false` with no `warnings` key, lane input via `secondaryInput` all implemented and tested.
- Schema/doc/tool descriptions updated.

### Phase 3: UI Review — N/A
No frontend/** changes; schemas/** change is description text plus an additive optional field; no UI behaviour. No live server run was needed; I created no dev-DB rows (nothing to clean up).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `add_outputs_from_shape` with no `stepId` on a pipeline whose trunk-last has tails returns the backend 422 whose text says "anchor with parentStepId and attachAsTail=true". The shape tool does not expose attachAsTail, so the wording is slightly off. It is not misleading enough to block: the actionable remedy (pass `stepId`, which the shape handler then auto-attaches as a sibling when it has children) is reachable and the tool description states the behaviour. Consider a shape-specific rewrap of the message ("pass stepId of an existing step") in a follow-up.
- The guard's absent-flag path on rootId needs `parentStepId = last step` to append to a populated root; documented in the tool description.
