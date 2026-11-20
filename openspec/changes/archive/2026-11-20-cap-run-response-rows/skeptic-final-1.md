## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `137d5b407e6242e6637004ad6a0f404f5c1287b8`. The base `fef01cda9c089e90c2f93f65e1b59ee1f11d8a16` was resolved live by `resolve-review-base.sh` (exit 0). There are 3 commits: the red run, the implementation, and the CR cleanup.

### What I verified (with evidence)

**Diff read in full (non-test code).**
- One helper, `RunResultResponse.preview`, with `PreviewRows = 10` (`PipelineProtocol.scala`). It is used at the executor and at both `PipelineRunPreview` sites.
- `grep "RunResultResponse("` in `backend/src/main` finds 4 builders. The fourth, `PipelineRunService.scala:250`, is the empty never-attempted run, so the default `rowsTruncated = false` is correct there.
- Executor (D2): the preview is computed inside `followUp.map`, after the terminal writes have received the full `jsRows`.
- `runStatus` renders only `rows.take(10)` and sets the flag from the total. The route copies it, and the hand-written `RunStatusResponse` writer and reader both carry it.
- No internal server consumer reads `RunResultResponse.rows`. I grepped `PipelineProposalService`, `DraftSaveService`, `HookTriggerService`, the scheduler and the auto-run firer.

**AC1, Cloud Run behaviour documented.**
- The evidence file `/home/matt/Development/helio/.concertino/runs/HEL-1696/evidence/.concertino/scratch/HEL-1696/cloud-run-chunked-response-limit.md` exists. It quotes the quotas row verbatim ("Limit applies if not using `Transfer-Encoding: chunked` or streaming") and the response-streaming section, gives the fetch date, and states that HTTP/2 and prod were not probed (C8).
- design.md Risks repeats the quote.
- Per the owner instruction this AC is docs-backed only, and the PR body will quote it.

**AC2, cap applied with seam tests on both client and server.**
- `PipelineRunResponseCapSpec` (7 cases) covers:
  - run and dry run with 25 rows: 10 rows, rowCount 25, rowsTruncated true;
  - the persisted node snapshot holds all 25 rows, which proves D2;
  - the exactly-10 case is false;
  - `/preview` and `/steps/:id/preview`;
  - `GET /runs/:runId`;
  - the shared fixture, compared as a whole JSON value.
- The apply and combined-apply specs assert the embedded run is capped.
- Fresh run: `sbt -J-Xmx3g "testOnly *PipelineRunResponseCapSpec *PipelineApplyProposalRunCapSpec *CombinedApplyProposalRunCapSpec *RunResponseChunkedRoutesSpec"` gave "Tests: succeeded 12, failed 0" and "All tests passed".
- Client seam: `SpineRunStatus.runCap.test.tsx` reads the same fixture, sends it through `submitPipelineRun.fulfilled`, and renders the chip. It expects "Snapshot replaced: 25 rows" and "Preview: 25 rows".
- Fresh frontend run of 31 affected suites (pipelines slice, detail page, spine, mobile, guard, outputs): 470/470 passed.

**My own mutation (C12, scratch copy, restored).** It is not in the executor's mutation table.
- Mutation: removed `.take(PreviewRows)` from `PipelineRunQueries.runStatus`. Result: `cap GET /runs/:runId ... *** FAILED *** ... had size 25 instead of expected size 10 (PipelineRunResponseCapSpec.scala:191)`, 6 passed and 1 failed.
- Restored: the sha256 is `87e58d94…` both before and after, and `git status` shows no source change.

**AC3, MCP and helio-news.**
- MCP handlers are pass-through, matching the owner ruling. The type gains `rowsTruncated?` with a doc comment, and both apply-tool descriptions name the 10-row preview, `rowsTruncated` and `get_output_rows`.
- `runCapSeam.test.ts` feeds the shared fixture through both tools.
- Fresh run: `npx jest helio-mcp/src/tools` passed 39/39 suites and 337 tests.
  - My first attempt ran jest from `helio-mcp/` without the root config, and every suite failed with 0 tests. That was a measurement error, not the work. Re-running through the root config passed.
- `run_pipeline` (`helioApi.ts` `runPipeline`) uses `result.rowCount`, never `rows`.
- helio-news (`/home/matt/Development/helio-news/news/*.py`) calls only `run_pipeline` and never reads its rows. It needs no change.

**Owner rulings (C15)** are all honoured: the cap is 10; MCP passes the capped run through; `GET /runs/:runId` is capped; the flag is named `rowsTruncated`.

**C16.** The one backend test changed, `RunResponseChunkedRoutesSpec`, keeps every chunking assertion. It now gets its size from 12 wide rows and adds the cap assertions. It passed fresh (2 cases).

**Contracts and specs.**
- `schemas/pipelines/pipeline-preview-response.schema.json` types `preview` as an open `object`, so no schema delta is needed.
- Five spec deltas. For every MODIFIED requirement, a scenario-heading comparison against `openspec/specs` showed no scenario dropped.
- `openspec validate cap-run-response-rows`: "is valid". `npm run check:openspec`: "openspec/ is clean".

**Other gates (fresh):**
- `npm run lint`: exit 0.
- frontend typecheck: exit 0.
- helio-mcp `tsc --noEmit`: no output.
- `npm run format:check`: clean.
- The backend `sbt testFull` was not re-run in full by me. The evaluator's cycle-1 6-shard run at `59ae7d4a8` reported 10062 passed and 0 failed, and no backend file changed in `137d5b407`. My targeted backend run is above.

**UI (step 4).**
- The only UI diff is the count derivation in `SpineRunStatus.tsx`, now `sseRowCount ?? runRowCount`, plus prop threading. No JSX, class, CSS or token changed.
- So there is no new visual surface to judge against DESIGN.md. The chip text is identical in shape, and the jest seam test verifies the rendered text.
- I did not start servers or take screenshots. No visual claim in this report rests on them, so no evidence was persisted.

### Verdict: CONFIRM

### Non-blocking notes
- `openspec validate --strict` exits 1, but only on tasks.md warnings: the group headings "### Backend/Frontend/MCP/Tests" are not "## N." groups. The non-strict validate and the hygiene check pass. Renumber if strict is wanted at archive.
- `pipelinesSlice.setRunStatus` still writes `runResult` from `rows` and never sets `runRowCount`. It has no caller (`grep setRunStatus` finds only its definition and export), so this is dead and harmless. A future caller would leave the chip count unclaimed rather than wrong.
- The Cloud Run evidence sits at an awkwardly nested durable path (`.../evidence/.concertino/scratch/HEL-1696/`). The PR body should quote it inline, as planned, and state the BREAKING `rows` change and the release-time MCP redeploy.
