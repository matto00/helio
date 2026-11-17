## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: 9383a6092974e9a5ac4b898c9202d0dea53f14f8. The diff base was resolved live: 46ab3251e0677951520fe948f21bc9f716fc9369. The cycle-2 delta reviewed is `a59bd053e..9383a6092`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/draft-structural-operations/HEL-1684`.

### Fresh gate runs (mine, in WORKTREE_PATH)
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0. `npm --prefix frontend run build`: exit 0.
- `npm test`: root 66 suites / 579 tests, frontend 776 suites / 9520 tests, all passing (maxWorkers 3). That is 2 new suites and 5 new tests since cycle 1.
- e2e on this run's servers (`DEV_PORT=7116 BACKEND_PORT=10023`, 2 workers): `hel1684-draft-structural` plus `hel1631-draft-mode` gave **36 passed**.
  - Both reused servers' cwd is this worktree.
  - Vite serves the cycle-2 `useSpineStepActions.tsx`: the `isTempStepId(step.id) ? reason` line is present.

### Phase 1: Spec Review — PASS
- **CR1:** RESOLVED.
  - `useSpineStepActions.tsx:180` now passes `reason` only when Branch is disabled.
  - `PipelineDetailPage.draftMode.test.tsx` asserts that Move down, Insert before/after and Branch are enabled with no `title` and an empty accessible description.
  - Add output keeps the reason.
- **CR2:** RESOLVED.
  - `hooks/usePipelineDraftSave.dropped.test.tsx` covers the refusal path: an op anchored on a missing step means `saveDraft` is never called and the notice is `{kind:"dropped", count:1}`.
  - It also has a positive control: when every op applies, `saveDraft` is called once. That proves the test reaches the replay rather than exiting early on the base check.
  - Mutation recorded in `evidence/mutations-cycle2.txt`: removing `usePipelineDraftSave.ts:309-312` gives "Expected 0 / Received 1". The control makes this red credible.
- **CR3:** RESOLVED.
  - `verifyBody` now checks the Save & run body:
    - insert: `parentStepId=ids[0]`, `position 0`, and the old step 2 carries `parentClientId`;
    - duplicate: the clone sits under `ids[1]` at position 0 with type `sort`, and `ids[2]` is re-parented to the clone;
    - lane: under `ids[0]` at `position >= 1`, and step 2 stays at `ids[0]`/position 0.
  - The recorded mutation (lane routed to `insertStep`) fails on `position >= 1`.
- **CR4:** RESOLVED.
  - `evidence/green-run.txt` is now the hel1684 spec: `Running 26 tests`, `26 passed (4.1m)`.
  - `evidence/guard-mutation.txt` names the file, the function and the before/after of the mutation.
  - The PNGs are in `/home/matt/Development/helio/.concertino/runs/HEL-1684/evidence/openspec/changes/draft-structural-operations/evidence/`.
- **Suggestions the executor took:**
  - The 4.5 hook test: `hooks/usePipelineDraft.dropped.test.tsx`.
    - A base change prunes the op and counts it once.
    - A stale-restored draft is not pruned, and `rebase` then reports 1.
    - An edit while stale keeps its ops.
  - `keepOps` while stale: `pruneOverlay(..., keepOps)` threaded through `withConfig`/`withEnabled`/`withOp`/`withDeleted`, driven by `staleRestoredRef`.
    - `rebaseOverlay` still prunes with the default `false`.
    - `staleRestoredRef` is reset on rebase and on discard (`usePipelineDraft.ts:186,196`).
    - So D1's "not pruned while stale" now holds on the edit paths too.
- **Not taken** (acceptable; these were non-blocking):
  - clearing `?step=draft-…` after Discard;
  - the head/append root-exists check;
  - the file split, which the orchestrator says is deferred to HEL-1704 by the driver's instruction.
- CONSTRAINTS is `[]`. No scope change.

### Phase 2: Code Review — PASS
- The `keepOps` change is minimal and correct:
  - an entry for a gone step is kept only when `keepOps` is set;
  - an entry equal to its step's value is still pruned;
  - the structure-equality reset is skipped only while stale, where Save is refused anyway until Reload.
- New tests are meaningful, and each has a recorded red or a positive control.
- No dead code, no type escape hatches beyond test doubles (`as never`/`as unknown as PipelineDraft` in the test harness only), and no design-token changes.
- Non-blocking: `usePipelineDetailPage.ts` (562 lines) and `usePipelineDraftSave.ts` (433 lines) are still over the CONTRIBUTING.md:24 soft budget. The split is deferred to HEL-1704, and the PR body should say so.

### Phase 3: UI Review — PASS
- Cycle 1's live verification still applies. The cycle-2 UI delta is the Branch item's title and accessible description only, and that is covered by the component test plus my green e2e run (36/36).
- Cycle 1 covered desktop and phone, light and dark, Discard with no requests, no `draft-` id on the wire, no new console errors, and no overflow at 1440/1100/768/375.
- Evidence from cycle 1 is persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1684/evidence/openspec/changes/draft-structural-operations/evidence/eval-1-*.png`.

### Overall: PASS

### Non-blocking Suggestions
- After Discard with a new step selected, clear or replace `?step=draft-…`. The selection already falls back, but the URL still names a dead client id.
- `head`/`append` anchors on a root removed elsewhere: refuse in `applyOp`, or note that the server's 400 is the backstop.
- In the PR body, carry:
  - the HEL-1704 split deferral;
  - note 7.4: a pending AI step's deferred create drops a reorder;
  - the incomplete-config duplicate 400 note.
