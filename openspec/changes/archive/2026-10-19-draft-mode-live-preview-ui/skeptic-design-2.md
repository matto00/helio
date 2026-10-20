## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `538a867d718204775f7c0844450f683889e145e3`. The change dir is untracked, and there are no implementation commits yet. I only read and grepped files; I ran no suites and no servers.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/live-draft-mode-ui/HEL-1631`.
- **Owner ruling on D2:** `.concertino/runs/HEL-1631/events.jsonl` line 11 is `escalation.answered` with t=1792451059308, `answer: block-during-draft-recommended` and `answer_source: human`. design.md D2 cites it. I did not re-litigate it.
- **Round-1 CR1 (the run inside Save & run): addressed.**
  - D9 step 3 states that the run is synchronous.
  - It adds a `draftSaveRunPending` action before posting. Its fields match the actual `submitPipelineRun.pending` reducer (`state/pipelinesSlice.ts:217-228`): `runStatus "queued"`, `runIsDry`, `runPipelineId`, a cleared `runError`, and the truncation reset.
  - It calls `setSseActive(true)` exactly as `handleRunPipeline` does (`hooks/usePipelineRunAndSaveActions.ts:65`, verified).
  - A `draftSaveRunSettled` action maps `succeeded` and `blocked` and clears the in-session counts.
  - It then calls `fetchPipelineById` so the spine falls back to the persisted counts.
  - A refused run or an error resets the run fields and calls `setSseActive(false)`.
  - The rule "disabled while a run is queued/running" is now consistent, because the pending action sets `queued`.
  - Task 3.5 asks for the reducers, unit-tested. The D15 e2e asserts the run status while the request is open and the persisted counts afterwards.
- **Round-1 CR2 (count and preview source per state): addressed.**
  - D7a's table decides both the no-draft state (unchanged run counts and saved-config preview) and the draft state (sample-only "saved → draft", never mixed with a run count, with a sample marker when truncated).
  - The MODIFIED deltas exist in `specs/pipeline-detail-spine-layout/spec.md` (the spine counts requirement with a "Draft counts" scenario, the selection requirement, and the preview table requirement, which keeps "exactly one step-preview request on open" and adds draft rows with no request).
  - `specs/pipeline-detail-mobile-layout/spec.md` covers the Steps tab counts and the draft pills.
  - Task 2.7 implements D7a. Task 4.3 keeps hel1579's one-request-on-open assertion unchanged.
- **Round-1 CR3 (explicit `enabled`): addressed.** D9 step 2 and task 1.1 require an explicit boolean `enabled` on every step, with a unit test using a disabled step. D15 also saves a pipeline with a disabled step end to end.
- **Round-1 non-blocking notes:**
  - The stale `stepRowCount.ts:278-295` citation is now fixed to `:9-26`.
  - The AC4 one-journal-row observable is strengthened in D15.
  - The neutral draft chip is kept (D7, and the accent delta in the spine spec).

### Verdict: CONFIRM

### Non-blocking notes

1. **New residual contradiction. Strike it before execution.** The last paragraph of D4 says: "With no draft ... a client-evaluable step uses its base frame (no request)." That contradicts three other places:
   - D3 ("With no draft ... NOTHING displayed changes from today").
   - D7a (no draft: "Unchanged: the saved-config step preview ... exactly one request on open").
   - The spine spec delta, which keeps "Opening the page SHALL issue exactly one step-preview request".

   Read literally, D4 would make a client-evaluable first step issue zero preview requests on open, which breaks hel1579. D7a is marked "decided", and tasks 2.7 and 4.3 and the spec delta all follow it. Task 4.3's unchanged one-request assertion would also catch the wrong reading mechanically. For those reasons I did not REFUTE on this. The executor must follow D7a; delete the sentence in D4.
2. **The new `draftSaveRunSettled` and `draftSaveRunPending` reducers should copy the HEL-1483 ownership guard** (`if (state.runPipelineId !== pipelineId) return;`) that the `submitPipelineRun` fulfilled and rejected reducers carry. Otherwise a save that settles after the user leaves the page can clobber another pipeline's run state.
3. **D9 says a refused run gets no error banner.** That deliberately differs from `submitPipelineRun.rejected`, which sets `runError`. That is fine, but the reducer unit test should assert `runError` stays null in that case.
