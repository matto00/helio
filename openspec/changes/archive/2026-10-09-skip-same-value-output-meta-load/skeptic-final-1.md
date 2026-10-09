## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `3f8d8e46399a04a660a3e0fd2a2a93f4ec3a28f2`. Base resolved live with `resolve-review-base.sh` (main/origin): `ecaa1a532dcbf10b8d7f3664335bff392fd59554` (exit 0). The branch has one commit.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/output-meta-redundant-render/HEL-1380`.
- **Diff scope:** `git diff --stat BASE...HEAD` shows 4 frontend files (the hook, the new GUARD test, the new mountRenders test, and comment edits in PanelCard.test.tsx) plus this change's own artifacts. No other code changed.
- **AC1 (skip the same-value update).** `useOutputMeta.ts:32-35` mirrors the committed state into a ref, and the sync effect is declared before the fetch effect.
  - `:44` queues the null-branch reset only when `output !== null || isLoading`.
  - `:58` queues `setIsLoading(true)` only when the cache misses and the hook is not already loading.
- **AC2 (red before, green after), reproduced myself:**
  - I replaced only `useOutputMeta.ts` with its base version. Both tests in `PanelCardBody.mountRenders.test.tsx` then failed: the PanelCardBody cache-miss test with `Expected: 2 / Received: 3`, and the null wrapper test with `Expected number of calls: 2 / Received number of calls: 3`. Result: 2 failed, 7 passed. The 7 GUARD tests stayed green on the base hook, which is correct for behaviour pins.
  - I restored the hook with `git checkout HEAD --`. Its sha1 `98dfb69f...` matches `git show HEAD:<file>`.
  - With the fix in place, both proofs pass. The drop is exactly one render, as the ticket requires.
- **AC3 (no change in loading behaviour):**
  - The GUARD tests pin every transition: cache-miss mount, resolve, reject, null mount, cache-hit with no flash, loaded→uncached id, loaded→null, and loading→null.
  - I traced each transition through the hook by hand.
  - I probed the one plausible regression myself with a temporary test file, since deleted. In that case A's fetch resolves with its update still pending, then a real discrete click switches to uncached B, with the act environment off. The fixed hook and the base hook logged the same sequence: `[["o1",null,true],["o2","o1",false],["o2","o1",true]]`.
- **HEL-1392 cache/staleness tests:** `jest src/features/panels src/features/dashboards src/test` gave 195/195 suites and 1776/1776 tests. That run covers outputMetaCache, PanelGrid/MobilePanelStack remountReuse, usePanelData.remountReuse, pipelineRunFanout.remount and panelRowsReuse.
- **Full gates, run fresh** (`nice -n 19`, `--maxWorkers=3`): lint exit 0, typecheck exit 0, format:check exit 0. Full frontend jest gave 495/495 suites and 5168/5168 tests.
- **Public hook shape:** the signature `(outputId: string | null): OutputMetaResult` and the `OutputMetaResult` interface are unchanged in the diff. Only internals changed, so the parked HEL-1394 branch is unaffected.
- **C1:** the red/green proofs run at PanelCardBody level (through a harness, counted via the `usePanelPolling` mock) and in a wrapper with a second update pending at mount. Counts are exact (3→2). The bare `renderHook` tests are labelled GUARD, and the file header names the mutation that makes them fail. The evaluator ran that mutation and reported it failing; I did not re-run it.
- **C2:** the ref is written only inside a `useEffect`. `useRef(initial)` is not a write during render, and lint is clean.
- **HEL-1215 comment (D3):** the comment is corrected and the absorbing `rerender` is kept (PanelCard.test.tsx ~L595-611). The suite passes.
- **AC4 (sequencing):** HEL-1365 is already merged; this is recorded in ticket.md's premise validation.
- **UI judgment (step 4):** no visual or DOM change. The change only removes a render that React was already bailing out of. Every view that uses the hook needs a login, and the run constraint forbids dev DB writes, so I did not drive it in a browser. No design-standard surface is touched.

### Verdict: CONFIRM

### Non-blocking notes
- `PanelCardBodyHarness` leaves out `mountOwnership` compared with the real `PanelCard` wiring (the evaluator noted this too). A one-line comment explaining why would stop the harness drifting unnoticed.
- Pre-existing behaviour, not introduced here: when switching from a loaded Output to an uncached one, `output` keeps the previous Output while `isLoading` is true.
