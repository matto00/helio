## Skeptic Report - design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Re-read all artifacts and compared against code at 9a57f7aa: useLayoutSave.ts (full), dashboardsSlice.ts fulfilled reducer (:310), layoutHistorySlice.ts, CommandBar.tsx:117-131, canonical specs. `openspec validate consolidate-layout-undo-persistence` -> valid.

Round-1 change requests:
1. Stuck pending (D5/3.2): RESOLVED. D5 now recomputes pending in both directions in persistLayout's .then and syncs layoutPendingDispatchedRef; task 3.2 adds the equal-to-server test; spec has the "response already matches newer local layout clears pending" scenario. Matches the code (today's .then only sets the baseline, so the fix is real, not reworded).
2. AC5 coverage: RESOLVED. Deltas now exist for panel-drag-perf (MODIFIED "Layout persistence is unchanged during drag", header matches canonical:19), write-path-audit (MODIFIED "...documents the layout debounce", matches :47), frontend-layout-persistence (REMOVED panel-flush-debounce requirement + ADDED shared-flush). The remaining non-requirement 250 ms text (write-path-audit :62, :79, :184; Purpose) is covered by tasks 5.2/D6 with a grep verification. Spec grep confirms the only 250/debounce hits are those handled.
3. Hand-edited canonical Purpose: RESOLVED (D6 + task 5.2 state it is intentional and retained at archive).
4. Scenario wording: RESOLVED ("no further layout PATCH ... since the undo"; same-layout no-op traversal scenario).

New-defect check on revisions:
- D2 (`applied` + revision) is implementable and closes the stale-revision hole; useLayoutSave needs an appliedRef like revisionRef (implementation detail).
- D4 prefix/new-panelId detection is consistent with createPanel's write (store layout + placements); falls back to re-baseline otherwise. D5 reference-keeping preserves HEL-1028 (no RGL re-sync) and HEL-1023 (no write on view); buildLayoutPatch untouched keeps HEL-1071. No backend/sources/connectors/migration touched. D1 thunk is a clean consolidation; layout feature currently has no thunks file, adding one is fine.
- Deferred-flush choice is offered by the ticket; self-approval is acceptable.

### Verdict: CONFIRM

### Non-blocking notes
- Narrow race in D5: create lands while a PATCH is in flight and the server processed the PATCH before the create. The response baseline then lacks the placement, local has it, so pending goes true and the next flush sends a (idempotent) PATCH after a pure create. This bends AC4's "create with no pending edit does not mark pending" only in that race. Acceptable; consider noting it in a code comment or accepting in the test.
- Task 2.2's test must construct the reference-identical no-op case explicitly (round-1 note, still applies).
- Task 6.2 fallback is now specified; record the decision in files-modified.md if used.
