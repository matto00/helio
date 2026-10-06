## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD `9c41719c376b858ab9269fa6075f8b3b74acabd1`. The change dir is untracked and there are no commits beyond main. HEL-1340 has not merged (no `usePipelineStepCreation.ts`). This was a read-only review: no sbt, Jest or Playwright, and no dev-DB access.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/rootid-step-create-placement/HEL-1345`.

**Round-3 CRs: actually addressed, not reworded.**
- CR1 (reverse arrival): D5 now serializes `handleInsertStep` (both paths), `handleAddLaneStep` and the draft create on one hook-level chain. Within those three creators, a response can no longer name a reparented id that is still a temp locally, because the earlier create has already settled. The same-slot trace X then Y at the gap after A now gives A→Y→X→B on both sides. Task 3.2(c) is now explicit: it asserts that the second POST is not sent until the first settles. **Closed for that mix, but see new CR1 below.**
- CR2 (coupled guard tests): D5 lists the planned edits with a mutation-red requirement. I searched every frontend test for the coupling:
  - grep for `createPipelineStep` in `*.test.*` finds `creatingStep`, `draftCreate`, `PipelineDetailPage.test.tsx` and `addPipelineStepConfigParity` (that last file only inspects `onChange` args).
  - grep for `getPipelineSteps…toHaveBeenCalled` finds no hits.
  - The `mockResolvedValueOnce` sites that serve the post-insert GET are exactly `PipelineDetailPage.test.tsx:2038-2039` and `:2084`.
  - The `holdResync` users are `creatingStep.test.tsx:239` and `:310`. The full-resync trigger is `draftCreate.test.tsx:410-416`.
  - `e2e/hel968-multi-root-editor-flow.spec.ts:114` appends only into an empty root, which is unaffected.
  - **The list is complete.**
- Non-blocking notes from round 3 are in place:
  - local config is kept on swap (D5);
  - the D11 mechanism is named (`buildLaneGraph(stepsRef.current, roots)` plus `isTempStepId`);
  - the spec now says "at that gap".

**Live-code facts used below:**
- `stepsRef.current = steps` is assigned only during render (`usePipelineDetailPage.ts:158-159`).
- `httpClient` is `axios.create({ baseURL, withCredentials, headers })` with no `timeout` (`frontend/src/services/httpClient.ts:11-17`). No timeout is configured in `.github/workflows/cd-backend.yml` or `infra/deploy-backend.sh`, so the Cloud Run default applies.
- React is `^19.3.0`. A `setSteps` issued from a promise continuation is scheduled; it is not rendered before the next microtask.
- `syncStepsFromServer` (`:731-747`) is a wholesale `setSteps(fresh…)`. It is still called by remove (`:1185`), duplicate (`:1413`), root removal (`:1340`) and aggregate-tail (`:937`).
- `handleInstantiateShape` (`:1025`) and `handleAddOutputViaAggregateTail` (`:924`) also call `createPipelineStep`, and D5's chain does not cover them.

### Verdict: REFUTE

### Change Requests

1. **The serialized chain resolves the next create against stale state, so D5's claim that "D11's create-time resolution reads a trunk that already contains every earlier create" is false as designed. A queued insert can be silently misplaced, which is the class of bug this ticket fixes.**
   - D5 says request N+1 is sent once N's `applyCreatedStep` update "has been queued". D11 resolves from `buildLaneGraph(stepsRef.current, roots)`. `stepsRef.current` is only refreshed by a render (`:159`). The chain's next link runs in a microtask after the `setSteps`, before React renders, so it reads the pre-apply list. The same holds inside RTL `act`.
   - Trace on trunk A, B, C:
     1. Immediate insert X at the gap A|B (anchor A, `position 1`).
     2. While X is in flight, immediate insert Y at the gap B|C. Temp X renders at the lane's end, so the anchor is B.
     3. X commits as A→X→B→C, and its response reparents [B]. The apply is queued, not rendered.
     4. Y dequeues and reads the stale persisted trunk A, B, C. B is at index 1 and not last, so the POST sends `position 2`.
     5. The server reads `position 2` as "after trunk(1)", which is X. The result is A→X→Y→B→C. The user chose after B.
   - The client then shows the server's order faithfully, so nothing looks broken: the misplacement is silent.
   - Required:
     - (a) State the mechanism by which the next create's position resolution sees the previous apply. Options: `flushSync` the apply so the render refreshes `stepsRef`; a synchronously-maintained "latest steps" ref that the apply writes; or resolve against a list derived from the previous apply's output. Executor's pick, but the design must name one.
     - (b) Remove D11's ambiguity "At create time (now for the immediate path …)". Under serialization, the immediate path must resolve at dequeue time, not at click time. Resolving at click time reproduces the same trace.
     - (c) Add to 3.2 a mixed-gap queued case (X at A|B, then Y at B|C while X is in flight). Assert that Y's POST carries `position 3`, and that the final local and server order is A, X, B, Y, C. Record it red against a click-time or stale-ref resolution.

2. **"If `tempId` is gone it changes nothing" now loses a created step. That is a regression against today, and the queue widens the window.** The design treats a missing temp as "the user removed the draft". A wholesale `syncStepsFromServer` from another handler also drops it.
   - Trace:
     1. Immediate insert X is in flight or queued.
     2. The user removes or duplicates another step, and that handler's GET resolves before X commits. The GET's `setSteps(fresh)` drops temp X.
     3. X commits. Its response finds no temp, so the apply is a no-op.
     4. X exists on the server but not on screen, and the steps it reparented show stale parents until some later full sync.
   - Today the immediate path's own post-create resync heals this. D5 removes that resync.
   - This violates the spec's "The created step SHALL appear exactly once" and AC5's "steps the server reparents do not stay stale on screen".
   - Serialization makes it more reachable: a create can sit in the queue behind a slow draft create for the whole duration.
   - Separately, a draft the user removes while its create is still queued (not yet sent) is still sent later. That creates an invisible server orphan and stale reparents, and the queue makes it avoidable.
   - Required:
     - (a) Distinguish "temp removed by the user" from "temp dropped by a wholesale replace". For example, record user-removed temp ids in a ref in `handleRemoveStep`.
     - (b) When a response arrives and its temp is absent but was not user-removed, still apply the response: insert the created step if its id is not already present, and apply `reparentedStepIds`.
     - (c) When a queued create dequeues and its temp was user-removed, skip the request and settle the link.
     - (d) Add RTL cases for both.

3. **The chain has no liveness bound, and the design does not state one.** `httpClient` has no `timeout`, so one POST that never settles blocks every later create, and every queued immediate card stays disabled (`creatingStepIds`). Today a hung create blocks only its own card.
   - In production the wait is bounded only by infrastructure. The Cloud Run request timeout (default 300 s, none configured) or a browser network error eventually rejects the request.
   - The jsdom fixture `PipelineDetailPage.test.tsx:1012` already uses a never-settling create.
   - Required: state the rule in D5, choosing one:
     - a per-link bound, after which the link settles as a failure (toast, temp kept, chain proceeds), with a test; or
     - an explicit acceptance of the infrastructure bound, with the user-visible consequence written into Risks.

4. **Not every creator is in the chain, so the CR1 hazard is still open for the excluded ones. D5's "every create" wording overstates the coverage.**
   - `handleInstantiateShape` anchors its first create on trunk-last with plain splice semantics (`:1025-1037`). It adds locally only after its own response arrives (`[...prev, persisted]`).
   - A concurrent bottom-row append, which also anchors on trunk-last, can commit after the shape step and report it as reparented. If that response arrives first, the shape step is not present yet, so the reparent is skipped. The shape step is then added with its stale parent.
   - `handleAddOutputViaAggregateTail` does a wholesale sync, which feeds CR2's drop case.
   - Required: either route both through the same chain, or name them in D5 as excluded with the reason and the residual hazard in Risks.

### Non-blocking notes

- The draft path under the queue behaves acceptably. `creatingDraftIdsRef` is set and `pendingDraftMetaRef` is deleted before enqueue, so further edits while queued do not double-create. The POSTed `config` is captured at enqueue, so HEL-1321's `latest.config !== config` flush covers edits made during the queue wait as well as in flight. On failure the catch restores the meta, and the next completing edit re-enqueues. No deadlock or double-send between the chain and `creatingDraftIdsRef`.
- `markCreating(true)` at click time and `markCreating(false)` at its own settle widen the disabled window to include the queue wait. That is consistent with C1 ("never shorter").
- The chain is hook-scoped. If the editor's `id` changes while links are queued, each link uses its own closure's `id`. That is worth a one-line statement, not a defect.

### Gate-defect check (CON-160)

No report in this review relied on mtime-ordering evidence. Not applicable.
