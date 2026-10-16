## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `4c84404989257b79d6a1c03681257edbc448a52e`. The diff base was resolved live with
`resolve-review-base.sh` as `2a9f9e4677f7019f5f6a36c4f72e5146cf25df85`.
My own evidence is in `/home/matt/Development/helio/.concertino/scratch/HEL-1617/eval-c1/`:
`red-subprocess.out`, `red-jest.out`, `green-subprocess.out`, `green-jest.out`, `root-jest.out`, `lint.out` and `fmt.out`.

### Phase 1: Spec Review — PASS
- AC1 (both 429s, no crash, `isError` result): met. `rateLimitContextSeam.test.ts` runs a real MCP Client, the real server and a real `HelioHttpClient`. `rateLimitedContextProcess.test.ts` runs a real Node 22 child with no guard installed.
- AC2 (an Outputs-only failure gives `outputs: []` plus a signal): met. `context.ts` adds an optional `outputsError`, and `context.test.ts` covers three cases: the error is set, it survives concise mode and a tiny budget, and it is omitted on success.
- AC3 (red first, then green, both recorded): met. I re-derived both myself (see C1 below).
- AC4 (`unhandledRejection` safety net): met. `unhandledRejectionGuard.ts` is installed in `index.ts` `main()`. Its unit test uses a fake emitter. I also ran a probe: unfixed `context.ts` with the guard installed in a real process logs `helio-mcp: unhandled rejection: 429 ...` to stderr and exits 0.
- Related bullets are assessed and recorded in `design.md` (request-volume findings) and `README.md` (HEL-1524 contract-change note), with no out-of-scope fix.
- All tasks are ticked and match the diff. There is no scope creep, and the spec delta `mcp-rate-limit-handling` matches the behavior.
- **C1 (red first on unmodified context.ts): HONORED, independently re-derived.** I extracted `helio-mcp/{src,scripts}` at HEAD into the scratch dir, swapped in `git show 2a9f9e467:helio-mcp/src/context.ts`, and ran:
  - `node --import tsx scripts/rateLimitedContextRepro.ts` exits 1 with an unhandled `HelioRateLimitError` raised from `fetchAllOutputs (context.ts:176)`.
  - jest (2 workers) on the new tests: 4 failed of 42. Both HEL-1617 seam/process tests fail, and the seam test fails on the orphaned `HelioRateLimitError` from `fetchAllOutputs`. The two `outputsError` unit tests also fail.
  - The worktree was never touched; all of this ran in the scratch copy.
- **C2 (fix proven without the guard): HONORED.** In the same scratch copy with the fixed `context.ts`, the guard is installed only in `index.ts` `main()`. Neither the repro script, `createServer`, nor any test installs it. Results:
  - The subprocess run exits 0 with `survived outcome=rate-limit-error`.
  - jest passes 42/42.

### Phase 2: Code Review — PASS
Gates, run fresh in `WORKTREE_PATH` at nice 19 with 2 jest workers. No `frontend/**` or `backend/**` files changed, so I ran the helio-mcp-relevant gates:
- `helio-mcp npm run typecheck` (covers `src`, `scripts` and `e2e`): exit 0
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- root `jest` (the helio-mcp suite): 58 suites and 493 tests passed

The fix is correct and minimal. The Outputs promise self-catches at creation (`.then(ok, err)` after the build step), so it can never reject. That covers a failure in either `fetchAllOutputs` or `buildOutputSummariesByPipeline`. The misleading comment was corrected. The success payload is unchanged because `outputsError` is spread in only when defined. The guard logs to stderr only and its log line is bounded. Types are explicit, with no `any`. The tests would catch a real regression (proven red above). I found no dead code.

### Phase 3: UI Review — N/A
No trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`). The spec delta is under `openspec/changes/`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- DRY: the 500-char truncation is duplicated in `helio-mcp/src/unhandledRejectionGuard.ts:22-23` and `helio-mcp/src/index.ts:55-56`. The guard module could export a tiny `boundLogMessage(text)` for the transport-error log to reuse.
- `helio-mcp/src/context.ts` is 675 lines; it was 659 before this change. CONTRIBUTING.md says to propose a split in the PR description for files over about 400 lines. This is pre-existing, so mention it in the PR body.
- The spec scenario says the process "keeps serving further tool calls", but the seam test asserts only the first call's `isError`. A second `callTool` after the failure would pin that clause directly. Process survival is already proven by the subprocess test.
- The `reply()` 429 stub is duplicated between `rateLimitContextSeam.test.ts`, `scripts/rateLimitedContextRepro.ts` and `rateLimitSeam.test.ts`. This follows the existing per-file pattern, so it is optional.
