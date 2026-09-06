## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit 304cb1af. Cold read of `git diff main...HEAD`, the source files, and re-run gates.
No `frontend/**` files in the diff → UI/design judgment section not applicable (verified via
`git diff main...HEAD --stat`: backend + helio-mcp + openspec only).

### What I verified (with evidence)

**Emitted shape (the central question).** Read `helio-mcp/src/helioApi.ts:96-135` and the mapping
at `:628-641`. The `RunOutcome` an agent actually receives (`guarded`/`jsonResult` stringify it
verbatim) is now:
`{ pipelineId, status, rowCount, primarySourceRowCount, truncated, primaryAvailableRowCount,
truncationNotice, truncatedReads }`. On the ticket's field case the reader gets `truncated: true`
+ a one-entry `truncatedReads` with `rowsRead: 1000 / availableRowCount: 3114`, alongside
primary-scoped scalars that are *named* primary. That is a correct, self-consistent,
machine-readable account. **AC1 delivered:** no unqualified `availableRowCount`/`sourceRowCount`
survives on the result (grep across `helio-mcp/`, `docs/`, `README.md` returns only the backend
wire type `types.ts:568/575`, `TruncatedRead`'s own per-entry field, and test fixtures — all
correct). The decision is documented in design.md D1 and normatively in the spec delta.

- `rowCount` (the design gate's flag) does survive unqualified, but it is the run's *produced*
  row count, not a truncation scalar of a different scope, and the tool description explicitly
  qualifies it ("rowCount is NOT guaranteed to be the source's complete row count"). It cannot
  form the misleading `availableRowCount >= sourceRowCount` pair the ticket describes. Not a defect.

**AC2** — `truncatedReads` declared in `types.ts:572-575`, mapped `result.truncatedReads ?? []`
(`helioApi.ts:640`), required (not optional) on `RunOutcome`. Present-and-empty on a complete run,
asserted at `runPipelineTruncation.test.ts:86`.

**AC3/AC5** — new backend test `PipelineRunServiceSpec.scala:1536-1566`: a **real run** (not a
fixture) with primary under the cap and a `lookup` secondary over it. Asserts
`sourceTruncated=true`, `sourceRowCount=1`, `sourceAvailableRowCount=Some(1)` (legitimately equal),
and the secondary entry's `rowsRead=1000` / `availableRowCount=Some(3303)` plus
`available > rowsRead`. Expected values are genuine fixture literals: `3303` is `RestBigTotalRows`
(`:61`, stub connector), `1000` is `MaxRunRows` — neither re-derived from the implementation.
Distinct source names via `seedRestDsNamed` avoid the dedupe-by-name vacuity.
MCP-side `runPipelineTruncation.test.ts:93-128` asserts the emitted object field-by-field against
independently-written literals, plus `expect(outcome).not.toHaveProperty("availableRowCount")` /
`("sourceRowCount")` — i.e. it pins the emitted structure, not a weaker key-presence check.

**Mutation (ii), reproduced myself** — applied
`sink.reads.map(_.copy(availableRowCount = None))` at the `sink.reads` arm of `truncationFields`
(`PipelineRunService.scala:132`) and ran `sbt "testOnly ...PipelineRunServiceSpec"`:
`Tests: succeeded 72, failed 1`, the single failure being the new test with an **assertion**
failure (`None was not equal to Some(3303) (PipelineRunServiceSpec.scala:1564)`) — not a compile
error, and it did NOT redden the pre-existing line-1513 or line-1573 cases. Reverted from a
pre-mutation copy; `git status --porcelain` clean (only the untracked `evaluation-1.md`), and the
re-run is `Tests: succeeded 73, failed 0, All tests passed`. Mutation (ii) is a genuine, isolated,
independent axis from (i).

**AC4** — read the rewritten description at `helio-mcp/src/tools/write.ts:357-373`. It names every
returned field, states `truncated` is RUN-WIDE, states
`primarySourceRowCount`/`primaryAvailableRowCount` are PRIMARY-ONLY with the explicit warning not
to conclude "nothing was lost", and states that `truncatedReads` **includes the primary when the
primary itself was truncated, so a one-entry array is not necessarily a secondary**. I verified
that claim against ground truth: `truncationFields` prepends `primaryRead` into `allReads` before
mapping to `TruncatedReadResponse` (`PipelineRunService.scala:125-140`) — the description is
accurate, not aspirational.

**Stale readers** — grepped `RunOutcome` / `run_pipeline` / the old field names across `*.ts`,
`*.tsx`, `*.md`, `*.scala` (excluding `node_modules`, `openspec/changes`, `.concertino/runs`).
No stale string reference: `docs/agent-native.md` and the e2e drivers reference the tool by name
only; `helio-mcp/README.md`'s "truncation" hits are the unrelated `get_workspace_context` byte-budget
`truncation` object.

**Gates re-run by me:** `helio-mcp` `npm run typecheck` clean; `npx jest --testPathPatterns=helio-mcp`
→ 24 suites / 239 tests passed; `npm run lint` (eslint `--max-warnings=0`) clean;
`npx openspec validate secondary-source-truncation-reporting --strict` → valid;
backend `PipelineRunServiceSpec` 73/73.

### Verdict: CONFIRM

### Non-blocking notes

1. `helio-mcp/src/helioApi.ts:96-102` — the `RunOutcome` doc block is now orphaned: the new
   `TruncatedRead` interface (with its own adjacent JSDoc, which correctly wins for `TruncatedRead`)
   was inserted between it and `RunOutcome`, so `RunOutcome` itself now has no attached hover doc.
   Judged non-blocking: purely an in-repo IDE-hover loss, zero effect on the agent-facing contract
   (the tool description carries that load) and all load-bearing per-field docs on `RunOutcome`
   are intact. Worth a two-line move next time this file is touched.
2. The MCP test is a pure passthrough test against a hand-built fixture; it can only catch a drop
   or a mangle. That is exactly the defect class here, and the backend test supplies the real-run
   measurement, so the pair is adequate — but neither side alone would be.
