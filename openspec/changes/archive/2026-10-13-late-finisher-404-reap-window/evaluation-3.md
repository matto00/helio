## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit `70c3bf17b0774a29410ccefccf43b9210395f703`, compared against cycle 2's `326bf324b`. The base, re-resolved live, is `f3490d1d8`.

### Phase 1: Spec Review — PASS

**Diff since cycle 2.** `git diff 326bf324b 70c3bf17b --name-only -- backend frontend schemas` lists 0 files, which confirms the executor's "no code changed" claim. Only three files changed:
- `design.md` (D7)
- `specs/pipeline-run-reaper/spec.md`
- `evaluation-2.md`, the committed cycle-2 report

**Cycle-2 change request (resolved).** The "Pipeline deleted while its run executes" scenario now says:
- the run answers 404 and publishes no `succeeded` event wherever the deletion lands;
- it writes nothing when the deletion lands before the early open-check;
- when the deletion lands later, no node is written after it. Node snapshots and write-back rows already committed remain, and history and payload rows go with the cascade.

This matches the cycle-2 probe (`node_snapshots=6 history=0 payload=0`, 404, no `succeeded`) and the code.

D7 in `design.md` states the same limit, records that cleaning up `node_snapshots` is out of scope, and points to HEL-1541. The orchestrator reports it added the orphan note to HEL-1541; I did not check that against Linear.

**Other spec scenarios.** I re-read every scenario in the delta. None claims more than the code does:
- "Stalled instance … reaped" covers a reap before the success chain.
- "Reap lands after the last node's write" claims only `failed`, no `succeeded` and a 409.

**Prior cycles.** Every acceptance-criteria and task item from earlier cycles still holds. Tasks 1.1–5.2 are all ticked, and constraint C1 is honoured.

### Phase 2: Code Review — PASS

No code changed since `326bf324b`, so cycle 2's fresh full-suite run (7754 passed, 0 failed, every suite covered) still applies to this tree. Re-checked fresh this cycle:
- `testOnly com.helio.services.pipelines.LateFinisherRunSpec` (HELIO_TEST_JVM_XMX=3g, `-J-Xmx3g`, nice -n 19, foreground): 10 succeeded, 0 failed. The hel1468-guard summary reports `failed=0 aborted=0 unreadable=0`.
- `check-openspec-hygiene.mjs`: clean.
- `openspec validate late-finisher-404-reap-window --strict`: valid.
- `check-spec-structure.mjs`: passed, 0 issues.

### Phase 3: UI Review — N/A
The change is backend and docs only; no UI trigger matches.

### Overall: PASS

### Non-blocking Suggestions
- `LateFinisherRunSpec.scala` is about 350 lines, over the 250-line soft budget. Consider splitting out the D3 lock-behaviour cases.
