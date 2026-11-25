## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `a1f8680b478c1c11e9850b90e26b365a3f750804` against the live-resolved base `cb287223d10c5451d3ebb2045bd872f88dfb376a`.
Cycle 2 changed only these files, all text:
- design.md D3 and D4
- tasks.md 1.2 and 2.6
- evidence/mutation-J1-no-retry.txt and evidence/mutation-J2-new-key-per-attempt.txt
- evaluation-1.md, now committed

No code changed. Cycle 1's gate, backend and UI results therefore still stand for the code. Re-run on this HEAD:
`format:check` exit 0, and `check:openspec` clean.

### Phase 1: Spec Review — PASS

Cycle 1's CR1 is closed. I checked the new text against the code:

- **D3 / tasks 1.2:** matches the code.
  - `appendBuiltRowKeyed(..., stamp)` is new and public (`DataSourceRepository.scala:721-728`). It returns
    `Option[Either[FormRowBuildFailure, KeyedAppend]]`.
  - `KeyedAppend` is `Appended` or `Replayed`, and `FormRowBuildFailure.KeyConflict` is new.
  - `appendBuiltRow` keeps its signature and its `(DataSource, DatasetRowRow)` result (`:713` maps back to it).
  - Both entry points call the private action with `lookupFirst` defaulting to `true` (`:731-737`).
- **D4 / tasks 2.6:** matches the code.
  - `appendFormRow` gains `submitKey: Option[UUID] = None` and still returns `RowWriteResult`.
  - `RowWriteResult` gains `replayed: Boolean = false`.
  - `FormSubmitResult.replayed` is a `def` delegating to `write.replayed`, and `completeSubmit` reads it.
  - The no-wire-leak rationale is true (checked in cycle 1).
- **Wording nit (non-blocking):** D4 says "the four existing `appendFormRow` callers and `PanelFormFileSubmission` needed
  no change".
  - Before this change there were 5 callers: `PanelService`, `PanelFormFileSubmission` and 3 test specs.
  - `PanelService` did change. The unchanged callers are `PanelFormFileSubmission` plus the 3 specs, so 4 including it.
  - The sentence double-counts. The behaviour it describes is right.

**`lookupFirst` test seam: acceptable.**
- It is never `false` on a production path.
  - The only two production callers, `appendBuiltRow` (`:713`) and `appendBuiltRowKeyed` (`:728`), use the default
    `true`.
  - The only `lookupFirst = false` anywhere is `DatasetRowSubmitKeyRepositorySpec.scala:128`.
  - The method is `private[persistence]`, so nothing outside the persistence package can reach it.
- CONTRIBUTING.md has no rule against a test seam in production code.
- The codebase has clear precedent for labelled seams: `DraftSaveHooks.scala:24`, `RegexTimeBox.scala:41`,
  `LocalFileSystem.scala:46`, and `ApiRoutes.scala:225`.
- The flag is documented as a seam at `:730`.
- It is the least invasive way to reach the defence-in-depth unique index. Under the lock, the index is otherwise
  unreachable.

### Phase 2: Code Review — FAIL

The retry-reuses-the-key guard has a blind spot.

I ran a new mutation, J3, in a throwaway detached worktree at a1f8680b4, removed afterwards. It mints a new key in
place on each attempt:

```ts
// panelService.ts, inside the retry loop, before httpClient.post
body.submitKey = crypto.randomUUID();
```

- **Result: 7 passed, 7 total. The mutation survives every HEL-1175 jest test.**
- In the browser, axios serialises `body` when it sends each attempt, so the server would receive a different key on
  every retry. A lost acknowledgement would then double-count: exactly the defect this ticket exists to close.
- Why the tests miss it: they read the sent body from `post.mock.calls[n][1]`. That is a reference to the one object
  the implementation keeps mutating, so attempt 0 and attempt 1 are the same object and compare equal.
  - `panelService.submitKey.test.ts:33` (`bodyOf`), used at `:60` and `:68`.
  - `FormPanelView.lostAck.test.tsx:59-60`.
- The executor's J2 (a fresh object per attempt, `{ ...body, submitKey: crypto.randomUUID() }`) does turn the same 3
  tests red. I reproduced it: 3 failed, 4 passed, with the same names the updated J2 evidence lists. The guard is
  therefore failable by one spelling of "new key per attempt" but not by the other.
- Evidence:
  `/home/matt/Development/helio/.concertino/runs/HEL-1175/evidence/.concertino/scratch/HEL-1175/eval-2-mutation-J3-inplace.txt`

The rest of Phase 2 is unchanged from cycle 1 and passes: gates, backend suites, RLS spec, seam, error handling,
security.

### Phase 3: UI Review — PASS

No UI-affecting file changed since cycle 1's live lane run, which passed. That run covered:
- Flyway migrating the empty lane DB to v149
- the HTTP matrix
- a live browser lost-ack test (201 lost, then a 200 same-key replay, one row, no error)
- the plain form submit

I started no servers this cycle.

### Overall: FAIL

### Change Requests
1. **Capture each request body at send time, not by reference, in both jest files.**
   - In `frontend/src/features/panels/services/panelService.submitKey.test.ts` and
     `frontend/src/features/panels/ui/form/FormPanelView.lostAck.test.tsx`, record a deep copy when `post` is called.
     For example, `post.mockImplementation((_url, body) => { sent.push(structuredClone(body)); return next(); })`, or
     a `JSON.parse(JSON.stringify(body))` snapshot.
   - Make `bodyOf(n)`, the `[0, 1, 2]` key-set check and the lost-ack `bodies[1]` versus `bodies[0]` comparison read
     those copies.
   - Keep the existing per-call mock sequencing: reject, then resolve.
   - Then record the in-place mutation as new evidence, `evidence/mutation-J3-in-place-key.txt`: `body.submitKey =
     crypto.randomUUID();` inside the loop before `httpClient.post`. It must turn red the "re-sends the same body and
     key", "stops after 3 requests, all with the same key" and lost-ack tests.
   - No production code change is needed. The current implementation is correct; only the guard is blind.

### Non-blocking Suggestions
- design.md D4: fix the caller count. For example: "`PanelFormFileSubmission` and the three spec callers needed no
  change".
- `mutation-J1-no-retry.txt` and `mutation-J2-new-key-per-attempt.txt` are now byte-identical. That is consistent:
  both mutations fail the same 3 tests, and I reproduced both. Adding the mutation's one-line diff to each file would
  make each file self-describing.
