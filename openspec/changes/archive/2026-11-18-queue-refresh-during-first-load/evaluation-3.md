## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: 3ade2cf2f18967097d868accd4fe61fa23b5483e. Base: f2358c16d (resolved live). This cycle's changes: def6d92a9..3ade2cf2f.

### Phase 1: Spec Review — PASS

- evaluation-2 CR1 (stranded queue) is fixed. A `.finally` whose request was replaced by a same-panel request this hook did not send now hands the queue to that request.
  - If the panel entry is still loading, it waits on it through `subscribeWait`.
  - Otherwise it sends the queued refresh at once.
  - Its own newer request (an Output rebind) still sends the queue from its own `.finally`.
- evaluation-2 CR2 is fixed. Each new test ends with "one press after the round sends exactly one request".
- design.md D2 and red-first-evidence.md describe the new branch accurately.
- ACs, scope and spec delta are unchanged since cycle 2 and still met.
- CONSTRAINTS C1-C14 are honoured.

### Phase 2: Code Review — PASS

**Gates (run fresh in WORKTREE_PATH; jest and e2e not run at the same time):**
- lint, format:check, typecheck: OK.
- `npm test`: root 66/66 suites (579 tests). Frontend 813/813 suites (9860 tests). Exit 0.
- `npm --prefix frontend run build`: exit 0.

**Strand probe, re-run.** I ran the evaluation-2 probe and an extended set of six probes against 3ade2cf2f, in a throwaway detached worktree that I removed afterwards. All passed.

| Probe | Result |
|---|---|
| P1: own refresh in flight → queue → foreign sort; own settles first, foreign later | queued request sent once after the foreign one settles; `isRefreshing` true throughout, then false; next press sends exactly 1 |
| P2: foreign settles first, own later | queued request sent once, at own settlement |
| P3: foreign request rejected | queued request still sent; ends false |
| P4: unmount while handing off | no request after unmount |
| P5: poll `refresh()` and another `queueRefresh()` during the hand-off wait | dropped/coalesced; exactly one queued request |
| P6: own R1 → queue → own rebind R2 → foreign F (double hand-off path) | exactly one queued request after F; ends false; later plain refresh sends 1 |

Probe source: /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval3/probeCycle3.test.tsx.txt

**Mutations, re-run by me** (`usePanelData*` jest files, 54 tests):

| Mutation | Result |
|---|---|
| M10: remove the hand-off branch | red (3 failed) |
| M11: hand-off sends the queue at once even while the foreign request is pending | red (3 failed) |
| M2: remove the store-listener `drain()` | red (4 failed) |
| M4: always send the queue in `.finally` (`if (true) drain()`) | red (4 failed) |
| M5: `return;` instead of `return retry;` | red (1 failed) |
| M9: remove `dropQueued()` (no-key branch) | red (1 failed) |
| M7: `setQueued(false)` at drain time | red (2 failed) |
| M8: `isRefreshing` without `\|\| queued` | red (2 failed) |
| M12: hand off even for this hook's own newer request | survives (see suggestions) |
| M13: retry request id not recorded as own | survives (see suggestions) |

**Sibling-path hunt.** I looked for other same-panel requests this hook does not send.

- **Load-more** (`PanelCardBody.tsx:184` `handleLoadMore`): it is guarded by `!paginationEntry.isLoadingMore`. So it cannot start while this hook's request is in flight, while a hand-off is waiting, or while the queued request is in flight. If one is already in flight when `queueRefresh()` finds this hook idle, our refresh dispatches as before and becomes the latest (pre-existing refresh semantics). No queue is involved.
- **Sort, filter or cross-filter refetch** (`usePanelSortFilter.ts:143`): this is the cycle-2 case. It is covered by the hook's tests and by P1-P5.
  - A cross-filter change can fire this hook's own re-dispatch and the foreign refetch together. That is the P6 shape: one queued request, no double.
- **Detail modal** (a second `usePanelData` instance): its dispatch is foreign to the stack instance and is handed off the same way (covered by the executor's third test).
  - A modal instance that joins an identical pending request uses `subscribeWait` and sends nothing.
  - Only the stack calls `queueRefresh`, so the modal never queues.
- **Rejected foreign request**: the `.rejected` reducer clears `isLoadingMore` for the latest request, so the hand-off listener fires (P3).

I found no remaining strand or doubled-request path.

### Phase 3: UI Review — PASS

- Servers were started via start-servers.sh on 7170/10077. The backend was on `helio_hel1738` only (checked in its log). assert-phase: PASS.
- **Full e2e run** (2 workers, nothing else running) of `e2e/hel1738-refresh-during-first-load.spec.ts`, `e2e/hel1681-refresh-control.spec.ts` and `e2e/hel1656-pull-to-refresh.spec.ts`: **39 passed** (1.8 m).
  - This covers touch 375 and 430 and mouse 375, in light and dark, plus the 1280 check (no button, 3 first-load requests).
  - The fixture deleted the throwaway users by recorded id.
- Screenshots from this run, checked by eye: busy spinner on the button and settled data in both themes; no layout breakage. Persisted:
  - /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval3/busy-touch-375-dark.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval3/busy-touch-430-light.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval3/settled-mouse-375-light.png
- Servers were stopped with stop-servers.sh.

### Overall: PASS

### Non-blocking Suggestions
- **M12 and M13 survive.** The `ownRequestIdRef` distinction ("own newer request drains itself, foreign gets a hand-off") has no test that tells it apart from handing off in every case. My reading is that the two are behaviourally near-equivalent: the listener fires on R2's reducer, before R2's `.finally`. Under M12, R2's `.finally` then clears `inFlightRef` while the queued refresh is about to be sent, which is a brief guard hole. The real code avoids that hole.
  - Either add a test that tells the two apart (a poll `refresh()` landing in that window), or simplify.
  - M13 (retry id not recorded as own) only matters when an older own request settles after a CROSS_FILTER retry. That is very unlikely.
- **Stale comment.** `usePanelData.ts:214` still says the settled branch "runs synchronously on mount, before any `queueRefresh()` can exist". `subscribeWait` is now also called from the `.finally` hand-off, with a queue present. It only does so when the entry is `isLoadingMore`, so the branch is still not taken there. Reword the reason, e.g. "never reached with a queue: the hand-off subscribes only while the entry is loading".
- **Second subscription on the P6 path.** The hand-off calls `subscribeWait` without unsubscribing an earlier hand-off subscription, so `unsubscribeWait.current` is overwritten. The earlier one removes itself when it settles, and after unmount it cannot send (mounted check) or set error state (`waitedId` undefined). It is harmless, but consider unsubscribing the previous subscription first.
- **File size.** `usePanelData.ts` is now 502 lines. Propose a split in the PR description (CONTRIBUTING ~400-line rule).
