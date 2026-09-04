## Evaluation Report — Cycle 2 (evaluation-2.md)

Scope: re-review of `36f4f176` (on top of `5f646f2e`), addressing cycle 1's CR1, per the escalation/ruling `omit-unconsumed-field`. Only what `36f4f176` disturbed is re-checked; D2/D3, the falsifiable second-root test, the dedupe, and the gate results already confirmed in cycle 1 are not re-derived except where the diff touches them.

### Phase 1: Spec Review — PASS
- CR1's ruling (`omit-unconsumed-field`) is correctly implemented: `RootSourceSchema` is now `{ rootId, sourceSchema }` — the name field is dropped, not renamed again.
- `design.md` D4 is rewritten, not appended to: the old "type that omits sent fields is the same class of drift" reasoning is explicitly labeled "*Revised after evaluation cycle 1...* This decision originally rejected omission on the grounds that... That reasoning was written before the real collision was known and does not survive it" — the superseded reasoning does not stand unqualified anywhere in the file. Confirmed by reading the full diff hunk.
- `proposal.md` non-goals updated to name HEL-975 (backend naming-inconsistency spinoff) and HEL-976 (pre-existing spec drift in `pipeline-list-api`/`pipeline-edit-flow`), consistent with `design.md`'s Planner Notes.
- `files-modified.md` updated with one path per bullet, cycle-2 annotations describing the delta — consistent with the actual diff (spot-checked against `git diff 5f646f2e..36f4f176 --stat`).
- Backend untouched: `git diff 5f646f2e..36f4f176 -- backend/` is empty — confirms HEL-975 (the backend field-naming realignment) was correctly left out of scope.

### Phase 2: Code Review — PASS
Gates re-run fresh in `WORKTREE_PATH`:
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (254 suites / 2615 tests)
- `npm --prefix frontend run build` — PASS

CR1-specific checks:
1. Confirmed the name field is genuinely gone from `RootSourceSchema` (`frontend/src/features/pipelines/types/pipelineStep.ts:484-487`, now just `{ rootId: string; sourceSchema: SchemaField[] }`) — not renamed, not present under an alias, not optional-with-a-name.
2. The old doc comment justifying the `dataSourceName` rename ("Named `dataSourceName` to match... rather than the wire field literally...") is fully replaced. The new comment explains the omission and names HEL-975 without reintroducing an AC3 hit — verified by running the grep below over the replacement comment's own file.
3. Ran `grep -rn "sourceDataSourceId\|sourceDataSourceName" frontend/src` myself: zero hits.
4. Both fixtures that previously set the dropped field are updated and consistent: `pipelinesSlice.test.ts` (removed `dataSourceName: "Sales API"` line from its `sourceSchemas` fixture) and `PipelineDetailPage.test.tsx` (three occurrences, all with the field removed, including the two later in the file at the "select step config round-trip" and "rename step config" describe blocks). No remaining test asserts on `sourceSchemas[].dataSourceName`/`.sourceDataSourceName` (confirmed via the same grep, which also covers test files).
5. `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` re-run myself against a live backend (fresh `start-servers.sh`/`assert-phase.sh servers`, both healthy) — 2 passed, not trusted from the executor's report.
6. Confirmed no `backend/**` files appear in `git diff 5f646f2e..36f4f176 --stat`.

No other Phase 2 issues in the cycle-2 diff. The change is narrowly scoped to the CR1 fix plus its own planning-artifact bookkeeping; no scope creep, no dead code, no new type-safety gaps.

### Phase 3: UI Review — PASS
Servers already healthy (reused). Re-ran the load-bearing e2e proof directly (not trusting the executor's report):
```
DEV_PORT=6401 BACKEND_PORT=9308 npx playwright test e2e/hel910-pipeline-to-dashboard-flow.spec.ts --reporter=line
→ 2 passed (12.7s)
```
No multi-root UI introduced; scope unchanged from cycle 1.

### Overall: PASS

### Non-blocking Suggestions
- None beyond cycle 1's already-resolved suggestion.
