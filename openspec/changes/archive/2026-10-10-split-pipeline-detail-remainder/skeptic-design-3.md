## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed: the uncommitted design.md and tasks.md on disk, at HEAD 744c3772000379426a699e7abae2a2543e0953ee
(= origin/main). I checked every claim below against the live tree. I ran no mutating probes, so this round produced
no new evidence artifacts. I re-read the round-1 base lint probe
(`.concertino/runs/HEL-1478/evidence/skeptic-design-1/lint-probe-base.json`).

### What I verified (with evidence)

**Round-2 CR-A (per-case red mutations, L370 regime): ADDRESSED.**
- (a) design.md L118-123 replaces "one red mutation per T1-T4" with one named, recorded red mutation per T2 case. It
  also covers reused existing tests ("A reused existing test gets its own mutation too"). Task 1.5 mirrors this ("per
  EACH T2 case ... reused tests included"). I checked each named mutation site in the live file:
  - **Host L274** is `skipNextAnalyzeRef.current = true`. Deleting it makes the seed run fall through to the 300ms
    timer. That gives a second analyze on F-105 and on its seed-at-mount variant, so both go red.
  - **Creation L370** is `pendingDraftMetaRef.current.set(stepId, meta)` in the `.catch`. Deleting it leaves the draft
    in the fingerprint after the failure.
    - Slow regime: the in-flight fingerprint was already analyzed, so the second phase dispatches nothing (red).
    - Fast regime: one stray dispatch appears (also red).
  - **Host L375** is the `sseActiveRef || analyzeStatusRef === "loading"` guard. Forcing it false dispatches during
    the run (red).
  - **Host L398-402** is the watchdog arm. Removing it means the stuck guard never force-dispatches (red).
  - **Host L336** is the draft-exclusion filter. Dropping it means adding a draft dispatches (red).
  - **The debounce timer** is the last named mutation. A mutation that does not redden its case forces the test to be
    strengthened, because each red is a recorded requirement. That makes the list self-enforcing.
- (b) design.md L115-117 requires the L370 case to state its timing regime and assert a count per phase. The example
  regime is a rejection held past the 300ms debounce: 1 analyze while in flight, then 1 more after the restore. I traced
  that example in the live code and it is correct:
  - `createDraftIfComplete` deletes the meta at L318 (fingerprint gains the draft), and the timer fires (1 dispatch).
  - The `.catch` at L367/L370 restores the meta in the same microtask as `setDraftCreateErrors`.
  - The re-render recomputes the fingerprint without the draft. That differs from `lastAnalyzedFingerprintRef`, so
    there is 1 more dispatch.
- (c) Task 2.3 keeps the post-D1c run with the L370 mirror update omitted, recorded red and then reverted. design.md
  L122-123 states the same.

**Round-2 CR-B (complete-diagnostic lint proofs): ADDRESSED.**
- D1's lint proof (design.md L66-71, task 2.4) requires the complete `--format json` output, recorded in full. It must
  be exactly one entry: the `exhaustive-deps` warning, byte-equal to base and naming only `'steps.length'`, with
  "Nothing else of any rule".
- D2's masking proof (design.md L80-82, task 3.2) imposes the same complete-list requirement on
  `usePipelineDebouncedAnalyze.ts`.
- Base reference re-read: 7 `react-hooks/refs` at 109/129/164/274/336/339/499, plus `exhaustive-deps` at 423. The
  message is "React Hook useEffect has a missing dependency: 'steps.length'...". The probe's 499 is base L500 shifted
  by the deleted suppression line, consistent with the design's L500 citation.

**Round-2 non-blocking notes: taken up.**
- Child ref callbacks are now in the reader classification (design.md L41).
- `useLayoutEffect` is to be added to `hooklib.py`'s deps extraction (design.md L133-134).

**Independent re-judgement.**
- Cited lines all hold in the live file:
  - L274 `skipNextAnalyzeRef` write, L339 fingerprint ref write, L375 guard, L423 suppression, L500 `allOutputsRef`
    write.
  - Line counts: host 816, `usePipelineStepStructure.ts` 271, `useStepCardState.ts` 602.
  - react-router is 7.18.3, matching D1's transition-basis citation.
- The D1b/D1c shapes, the STOP conditions, the D3 cluster boundaries and the D4 split-proof suite are unchanged from
  round 2, where I judged them sound. Nothing in this revision weakens them.
- The driver brief is met:
  - D1 is declared behaviour-adjacent, with its own characterization (item 1 is not a pure refactor).
  - STOP sites are escalated and filed as a follow-up (non-trivial bug → follow-up).
  - C1 allows no new eslint-disable; only the existing L423 suppression moves, and the complete-JSON masking probe
    proves it hides nothing new.
- Every AC is covered by a task: AC1 → 2.x, AC2 → 3.x, AC3 → 4.x, AC4 → C1/8.1, AC5 → 1.6/8.2, AC6 → 5.x. The
  items 4-5 follow-up is filed under 7.0.

### Verdict: CONFIRM

### Non-blocking notes
- Whichever regime the L370 case uses, it should also assert the count just before the 300ms boundary in the
  edit case. Otherwise the "remove the debounce timer" mutation may not redden a test that only samples after 300ms.
  The red requirement already forces this; noted so the executor designs for it up front.
- design.md Context still says "React 19.2.8" (package.json declares ^19.3.0). This is cosmetic.
