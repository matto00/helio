## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `0d1d09c4883293f3db1afc1015fd51ec03ca20c0`, base `d3059b6114f7735e210a4a1675737585d8dae5c8` (resolve-review-base.sh).
Cycle-2 delta since `d83050003`: `regexInputCost.test.ts` only. Also changed: `mutations.txt`, `e2e-green-run.txt`, and the committed `evaluation-1.md`. `regexInputCost.ts` is unchanged, so cycle 1's soundness review and calibration reproduction still apply.
Evaluator scratch: `/home/matt/Development/helio/.concertino/scratch/HEL-1823/eval2/`.

### Phase 1: Spec Review — PASS
- AC1: red run verified in cycle 1. The tests that fail first are unchanged.
- AC2: decision identity was verified in cycle 1 (soundness argument; group H/I calibration reproduced). The implementation is unchanged since then.
- AC3: re-run fresh by the evaluator (Phase 3).
- Tasks and artifacts are consistent. No scope creep. CONSTRAINTS honored.

### Phase 2: Code Review — PASS
Gates (fresh, in WORKTREE_PATH, on the `npm ci` install with `echarts-for-react` 3.1.0):
- lint, format:check, typecheck and `npm --prefix frontend run build` pass.
- Root jest passes.
- Frontend jest, 3 shards x 3 workers: 920/920 suites and 10,610 tests pass. Shard 3 takes 26.9 s, down from 201 s in cycle 1.

Cycle-1 CR 1 (property test runtime) is resolved:
- The property test now takes 1.29 s (jest `--json`), down from 194.5 s.
- Both regex spec files together take 4.5 s.

Mutations re-run by the evaluator against both full spec files (57 tests):
- count-only-first-lone: red, the property test and "doubles an unpaired surrogate". The rewritten property test keeps its mutation power.
- pairs-as-lone: red, astral body.
- `lengthBound` stage removed: red, the new "does not count the unpaired surrogates of cells whose tested bound is certain to miss" test. That stage is now pinned by a test.

These match `mutations.txt`.

Issues: none.

### Phase 3: UI Review — PASS
- Cycle-1 CR 2 (fresh AC3) is resolved. I used the repo's documented lane flow, which the orchestrator sanctioned for this step only:
  1. `stop-servers.sh`
  2. `DEV_PORT=7255 BACKEND_PORT=10162 scripts/e2e-backend.sh lane-start` (DB `helio_hel1823`, `ANTHROPIC_API_KEY` empty)
  3. `npm run e2e:prod-build -- e2e/hel1683-regex-main-thread.spec.ts`
  4. `stop-servers.sh`
- Result: 4 passed (21.7 s). That covers the prod-build guard and the 3 long-task tests. Every "longest long task" reading was 0.0 ms. The anchored test made no draft-preview request, so it was evaluated on the client. The long-cell test was declined to the server.
- The 3 throwaway users were deleted. Servers were stopped and `/health` no longer answers.
- Transcript: `/home/matt/Development/helio/.concertino/scratch/HEL-1823/eval2/e2e.txt`.
- No rendered UI changed.

### Overall: PASS

### Non-blocking Suggestions
- The property test now draws only 150-300 character cells, over 40 decisions. Short cells, including cells that are just one lone surrogate, are covered by the existing fixed tests rather than the generator. That is acceptable given the mutation results.
