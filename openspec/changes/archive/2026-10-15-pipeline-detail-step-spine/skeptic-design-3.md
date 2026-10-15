## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `cd64409ad828d9024074f907a7ea32800ab71ff3`. The planning artifacts are untracked in the change dir and there is no code diff yet.

### What I verified (with evidence)

**Setup**
- **Spawn guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/pipeline-detail-step-spine/HEL-1579`.
- **Change validates:** `openspec validate pipeline-detail-step-spine --type change` → "Change 'pipeline-detail-step-spine' is valid".
- **Owner rulings:** `.concertino/runs/HEL-1579/events.jsonl` has 7 lines. It still holds one raised/answered escalation pair plus my two prior REFUTE verdicts. No new ruling arrived since round 2, so the round-2 ruling check still holds.

**Round-2 CR1 (blocking): stale preview and the race with the flushed save. Resolved.**
- **(a) Settled reuse:** D8 now says "page-scoped **in-flight-only** dedupe keyed by `stepId + configFingerprint` … a settled response is never reused, so every selection … fetches fresh". The round-2 self-contradiction is gone. Task 3.6 states the same thing. Test (a) is the exact scenario I asked for: select step 3, edit step 1, re-select step 3, and a new GET is issued.
- **(b) Save ordering:** D8 now says the newly selected step's GET waits until every pending step save has settled, using a page-level pending-saves tracker. Test (b) is planned.
- **Is the tracker feasible against the tree?** Yes.
  - Every config PATCH from an editor is issued in one place: `useStepCardPersist.ts:88` (`void updatePipelineStep(step.id, newConfig)`). The only other `updatePipelineStep` caller is `usePipelineDraftCreate.ts:86`, the draft-create follow-up, and a creating step is never previewed per D8.
  - Registering that promise with a page-level tracker therefore needs one new hook argument (or a context). No restructuring is needed.
  - The D7 flush runs in the focused card's `useEffect` cleanup. React runs passive cleanups before passive setups within one commit, so if the flush registers synchronously when it dispatches, the registration exists before the table's fetch effect for the new selection runs.
- **No same-step race either:** `onConfigChange` (which updates the page-level `step.config`) is called only from `useStepCardPersist.ts:94` (after the PATCH resolves) and `:124` (temp-id drafts only). `StepCard.tsx:88` builds `configFingerprint` from `step.config`. So a refetch caused by a fingerprint change always follows the PATCH that caused it. Today's `useStepCardPreview` already depends on this, and the extracted shared hook keeps it.

**Round-2 non-blocking notes: all addressed.**
- **D9 dry run:** the table row now chooses one option. The run row gets NULL (not plumbed) and the pipeline column is untouched, because dry runs never call `updateLastRun`.
- **Risks wording:** now says "`CommandBar.tsx` overlap with HEL-1575".
- **D3 "Run to update":** right-aligned under Run, in the strip below the header, with warning tokens and no accent.
- **D5 last-row Insert:** routed to `handleAddStep`. I checked the claim that this is equivalent to inserting after the last root-0 trunk step:
  - Client: `handleAddStep` → `handleInsertStep(op, stepsRef.current.length)` (`usePipelineStepCreation.ts:221-225`). `isAppend` is true, so `anchor = undefined` and `insertWireArgs` returns `{ rootId: roots[0].id }` with no position and no parent (`insertAnchor.ts`).
  - Server: a create carrying only `rootId` resolves through `PipelineService.resolveRootTrunkAnchor(…, position = None)`. That walks the root's position-0 chain and returns `trunk.lastOption` (`PipelineService.scala:401-413`). Its parent is the last trunk step of root 0, which is the same placement as "Insert step after" on that row.
  - It is also today's "+ Add transformation step" path, so this adds no new insertion semantics, as D5 claims.
- **Grep scope:** task 5.2 now uses `grep -rl … e2e/`, which includes `e2e/support/remountBurstSeed.ts`.
- **D12 accent scope:** the `accent-color` override is scoped to `.pipeline-detail-page--spine`, so C4 (phone unchanged) holds for it.

**New issues introduced by the revision:** none blocking. Two wording points are below.

### Verdict: CONFIRM

The design is sound enough to implement. The round-2 blocking defect is fixed in the design, the tasks and the planned tests. I checked the revision's two load-bearing feasibility claims (the pending-saves tracker and the `handleAddStep` equivalence) against the tree, and both hold.

### Non-blocking notes
- **The spec text still contradicts D9 on dry runs.** `specs/pipeline-run-step-row-counts-persistence/spec.md` says the new columns are written "under the same conditions as the existing row counts". `insertDryRunInternal` does write the run row's `row_count`, but D9 now writes `step_row_counts` as NULL for dry runs. Add "except dry runs, whose run row records NULL" to the requirement so the spec and D9 agree.
- **Two tracker details to make explicit during implementation.**
  - The flush must register its PATCH promise synchronously when it dispatches, inside the unmount cleanup. If registration happens after an `await` or in a later tick, the table's effect can read an empty tracker. Test (b) will catch that if it is written against real effect ordering, not a mocked tracker.
  - D8's "any other in-flight step PATCH" is open-ended. `updatePipelineStepEnabled` (`usePipelineRootAndToggleActions.ts:120`) is the obvious other candidate. Either include it or state that it is excluded; today the enabled-flip is covered by the debounced refetch keyed on `enabledBits`.
- **D12 has a residual phone effect.** Accent removals in shared op-editor CSS also apply on the phone. D12 accepts that explicitly as removal-only. Record it in the PR's "UI decisions taken" so C4 reviewers are not surprised.
