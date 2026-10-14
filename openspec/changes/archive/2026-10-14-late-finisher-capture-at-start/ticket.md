# HEL-1565: LateFinisherRunSpec: GatedRunRepo reads terminalWritten at callback time, so a late write can complete the next test's promise

## Description

Found by HEL-1544 (PR matto00/helio#1009) and not filed there.

`GatedRunRepo` in `LateFinisherRunSpec` reads the `terminalWritten` promise when the write's callback fires, not when
the write starts. So a write that finishes after its own test ends could complete the *next* test's promise.

No current test is affected. The fix is about one line: capture the promise at write start. Fold it into the next
change that touches the spec if that comes first. Verify against the code before acting.

## Driver premise update (2026-10-14)

HEL-1564 (PR #1018, merged as 27a30bb97) split `LateFinisherRunSpec` into `LateFinisherSpecBase`, `LateFinisherRunSpec`
and `LateFinisherDeleteAfterWonSpec`, and added forced-ordering seams. Re-derive the hazard against that structure: it
may have moved, been fixed, or now affect more specs. Drop it, with evidence, if it no longer exists. Any fix must be
proven red-first under forced orderings, never with sleeps. Test-only, backend.

## Acceptance Criteria

- The hazard is re-derived against the post-HEL-1564 code, with evidence of where it lives now and which seams share it.
- Every `LateFinisherSpecBase` seam that dereferences per-test mutable state AFTER an asynchronous boundary captures that
  state when the call starts, so a call that outlives its test can only touch its own test's state.
- A regression test proves this red-first under a forced ordering (gate/promise sequencing; no sleeps, no timing).
- A mutation (reverting a capture) turns the regression test red; recorded as evidence.
- `LateFinisherRunSpec` and `LateFinisherDeleteAfterWonSpec` stay green; no production code changes.
