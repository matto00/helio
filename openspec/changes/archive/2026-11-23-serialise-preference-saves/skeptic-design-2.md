## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 71e2802bbc1acb3b59c60291c6f16431fb404165. The change dir is untracked, so I read the artifacts from the working tree: ticket.md, proposal.md, design.md, tasks.md, specs/user-ui-preferences/spec.md, and skeptic-design-1.md.

### What I verified (with evidence)

**Round-1 change requests:**

- **CR1 (D6 rollback): addressed.** D6 now uses a per-call sequence number and rolls back only for the newest assistant-model save. It restores the last server-confirmed value, never `previous`. Cases (a) A→B→A and (b) rollback-to-never-stored are named as jest cases. I traced both against the rule and both come out correct. The current `saveAssistantModelPreference.ts` captures `previous` before the optimistic apply, so "initialise from the store when nothing is outstanding" can be built.
- **CR2 (failure coupling): addressed, but it brings new defects (CR A-C below).** D3a splits a multi-writer `400` by writer. D3 now states caller outcomes, including the outcome for a superseded caller. I confirmed the premise: `UserPreferencesRoutes.validate` (l.45-93) is a single for-comprehension, so one bad key makes the whole request `400`.
- **CR3 (generation): addressed.** D5 now says what an old-generation settle may do: resolve its own callers and nothing more. It never drains, never splits, and never touches the current marker. The five-step A/reset/B#1/B#2/A-settles test is listed, and the "drop the generation check" mutation is tied to it.
- **CR4 (red first): addressed.** The red runs go through existing APIs (`saveAppearancePreferences` with a held first `httpClient.patch` and a merge-applying fake server), and must fail on assertions. This is now in D8, task 1.1 and constraint C101. The "mono" red is achievable: with Mono held until after Sans and Serif, the unpatched code stores Mono.
- **CR5 (regression scope): addressed.** Tasks 5.2 and 5.3 list the jest suites and all seven e2e files at the 2-worker cap (constraint C102).
- **Round-1 notes: addressed.** The logout window (D5), outcomes for superseded callers (D3), the throttle mechanism (`HEL1829_CPU_THROTTLE`, CDP `setCPUThrottlingRate`) and the keepalive interceptor bypass are all written down.

**Writer list still complete.** A grep of `me/preferences` in `frontend/src` (non-test) finds only `authService.ts:61,68` and `tabsPersistence.ts:55`. This matches the design table.

**New-defect probe of D3a (the orchestrator's specific question):**

- **Stored-equals-last-choice.** This holds only because the split requests drain BEFORE the newer pending patch. A key queued during a split's flight lands in `pending`, which is sent last, so it wins. The "left out of the split" rule is only an optimisation; the ordering is what carries correctness. D8 has no test and no mutation pinning that ordering (CR B).
- **"At most one in flight, plus one trailing."** In-flight ≤ 1 still holds: the splits go one at a time. But after a multi-writer `400`, one settle is followed by up to N writer splits and then the pending patch. That is more than one trailing request. The spec delta's scenario "A burst becomes one trailing request … at most one trailing request is sent" is now contradicted by D3a on the `400` path, and nothing in the spec or proposal says so (CR A).

### Verdict: REFUTE

### Change Requests

1. **(A) Reconcile D3a with the AC and the spec delta.** The ticket AC says "No extra requests: at most one in flight, plus one trailing". `spec.md` "A burst becomes one trailing request" says at most one trailing request. D3a sends up to (writers − 1) extra requests after a multi-writer `400`. design.md admits this ("at the cost of extra requests") but neither the spec nor the proposal does. Pick one:
   - **Keep D3a.** Add a spec scenario saying that a `400` on a request carrying keys from more than one writer is re-sent as one request per writer. Those requests go one at a time, before any newer pending patch, and are never split again. State in proposal.md that the AC's "no extra requests" applies to the coalescing path, and that the split is a bounded error-recovery path (at most one extra request per writer, never concurrent). The reviewer at the final gate then has a written rule to check.
   - **Drop D3a.** Accept the coupling in Risks, with a reason, as round 1 allowed.

2. **(B) Pin the split-before-pending ordering with a test and a mutation.** This ordering is what makes "stored equals last choice" true on the `400` path. Add this D8 queue test:
   - A multi-writer request R = {`typeStyle`, `assistantModel: X`} gets a `400`.
   - The split sends the appearance request S1, then the assistant request S2(X).
   - While S1 is in flight, `assistantModel: Y` is queued.
   - Assert the order S1, S2(X), pending(Y), and that the stored value is Y.

   Add the mutation "drain pending before the remaining splits". It must turn this test red: the buggy order S1, P(Y), S2(X) stores X while the UI shows Y.

3. **(C) Define the outcome of callers whose writer group is skipped or trimmed by the leave-out rule.** D3a says each caller "resolves with the outcome of its own writer's split request". When a group is empty, there is no such request. Example: `assistantModel: X` was in the `400` request and the pending patch already carries Y. State whether X's caller resolves `"failed"` at once or with the pending request's outcome (the D3 superseded rule). Also state that D6 must never record X as server-confirmed in that case. If X were recorded as confirmed and then a newest Y failed, D6 would restore X, a value the server never stored. That is the same class of bug round-1 CR1 closed. Cover it in the D6 jest cases.

4. **(D) Classify keepalive `fetch` responses.** `fetch` resolves on a 4xx or 5xx; only axios rejects. With D4, the keepalive trailing request can carry any writer's keys, including `assistantModel`. D3, D3a and D6 all branch on failed vs `400` vs saved. State that a keepalive response with `!response.ok` is a failure, and that `status === 400` is split-eligible under D3a. Otherwise a rejected keepalive request reads as `"saved"`, D6 records an unstored value as confirmed, and D3a never fires. Add one jest case for this.

### Non-blocking notes

- D6 says the confirmed value is "updated to the sent value", but `PreferencesSaveOutcome` is a bare string, so a caller cannot know the value that was sent. Setting confirmed to the caller's own value on `"saved"` works only if resolvers fire in call order. Either say the queue resolves callers in call order, or return the sent patch with the outcome.
- Task numbering: 2.3 comes before 2.2. This is cosmetic.
- The cross-writer red in D8 can fail only on request counts. Under server-side per-key merge, unordered writes of different keys cannot overwrite each other. That is fine as a red, but the description should not claim it shows an overwrite.
