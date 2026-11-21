## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed HEAD: 85beaeed7d8275f73162b7baa419922b51ea48f2.
- Base: afc2a687286a73b22660e613adef2dbb85d0d517, resolved live.
- Cycle-2 delta (62b6615a0..HEAD): only tasks.md, design.md and final-1x-x5.txt changed, plus evaluation-1.md was committed. `e2e/hel1683-regex-main-thread.spec.ts` is byte-identical to the version reviewed in cycle 1.

### Phase 1: Spec Review — PASS
Both cycle-1 change requests are resolved.
1. In tasks.md, items 1.1-1.3, 2.2 and 3.1-3.4 are now ticked. 4.1 (Delivery) is still open, which is correct. 3.1 notes that the "new" shape was tried and reverted under C10.
2. design.md has "Superseded by owner ruling margin-note (C10)" notes under Decision 2 and Decision 6. The notes say:
   - no reshape shipped;
   - the bound stays 100;
   - attribution logging is kept;
   - the throttle is diagnostic-only and off by default;
   - the PR states the margin and cause.

Every point from cycle 1 that checks C10 against the code still holds, because the spec file did not change.

### Phase 2: Code Review — PASS
Gates, re-run fresh in WORKTREE_PATH:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `tsc --noEmit -p e2e/tsconfig.json` | exit 0 |

Live run of the full spec file at 1x:
- Setup: lane DB with `?user=matt`, empty ANTHROPIC_API_KEY, 2 workers, servers on 7240/10147.
- Result: 2 passed. Control, probe and overrun were 0.0 ms, and so was the long-cell probe.
- Evidence: /home/matt/Development/helio/.concertino/scratch/HEL-1808/eval2-1x.txt.
- Servers stopped afterwards; working tree clean.

The AC2 mutation was re-run by me in cycle 1: the probe went red at 483 ms and the long-cell probe at 1137 ms. The spec has not changed since, so that result still applies.

Is the re-capture of final-1x-x5.txt genuine?
- It now carries the `requests: POST .../draft-preview;` segment the spec prints, and a header saying it is grep-filtered with ANSI codes stripped.
- It names 10 unique pipeline ids.
- None of them appears in:
  - the cycle-1 committed version of final-1x-x5.txt;
  - my own cycle-1 scratch runs (eval-1x-x3.txt, eval-mutation-decline.txt);
  - attribution-*.txt;
  - mutation-*.txt.
- Independent check: the ids 45eb7820-..., 1dc67ab1-... and 54b8038f-... appear in the lane's backend log (`.concertino-backend.log`, from the server instance the executor ran after my cycle-1 runs). This is content-based corroboration; it does not rely on file mtimes.

### Phase 3: UI Review — N/A
No trigger paths changed. Only one e2e spec and openspec artifacts were touched.

### Overall: PASS

### Non-blocking Suggestions
- None.
