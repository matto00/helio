## 1. Reproduce

### Frontend

- [x] 1.1 Reproduce live on this worktree's dev stack with a throwaway @example.test user (id recorded, /api/auth/me checked): A -> B, "+ lane" on B -> L, apply Top N at the bottom; record server before/after, POST responses, UI after apply and after reload into the run evidence dir (verify: L<-limit on server, UI differs from reload)

## 2. Fix

### Frontend

- [x] 2.1 Apply each shape step create's `reparentedStepIds` with `applyCreatedStep` via the shared create bookkeeping (design.md Decisions 1-2) in `usePipelineShapeInstantiation.ts` (verify: 3.1 passes)
- [x] 2.2 Wire the shared `applyCreated`/refs into the shape hook through `usePipelineStepStructure.ts` (verify: `npm run typecheck` and lint pass)
- [x] 2.3 Rewrite the KNOWN HAZARD comments in `usePipelineShapeInstantiation.ts` and `PipelineRiverView.tsx` to the new behavior (verify: grep shows no "KNOWN HAZARD"/"No code here guards" text left)

## 3. Tests

### Tests

- [x] 3.1 Red-first page/hook test: anchor with only a lane child, shape apply mocks two creates each reporting the lane in `reparentedStepIds`; assert local parents (sort<-B, limit<-sort, L<-limit) and rendered placement; confirmed FAILING on unfixed code before 2.1 (verify: red transcript, then green)
- [x] 3.2 Partial-apply test: second create fails; first create's reparent is applied and the partial toast shows (verify: test passes)
- [x] 3.3 Draft-survival test: a local-only draft is still present after a shape apply (verify: test passes)
- [x] 3.4 Seam check: tests use the real `createPipelineStep` response mapping (`reparentedStepIds` from the wire JSON shape the backend emits), not a hand-built `CreatedPipelineStep` that bypasses parsing (verify: test exercises the service mapping)
- [x] 3.5 Running-app check: repeat 1.1 on the fixed build; editor structure right after apply equals the structure after reload (verify: evidence JSON + screenshots in the run evidence dir)
- [x] 3.6 Full frontend gates: `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check` (verify: all exit 0)

## Standing Constraints

- [C1] The red-first test asserts the LANE's placement (L's parent = the shape's last step, and L rendered as a lane off it, not off B); an assertion only that shape cards are "not in a lane" passes on main and proves nothing.
- [C2] One shared delta path: the shape hook reuses usePipelineStepCreation's applyCreated/pendingParentRef/userRemovedTempIdsRef; no second hook-local pending-parent map.
