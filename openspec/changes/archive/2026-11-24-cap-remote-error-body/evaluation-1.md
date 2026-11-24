## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `cc1c15874603c91f923b2e18bf46ea1846bdd65d` against live-resolved base `2ce5a8f23334b44c5ab448ea928535bc33b5d709`
(commits 5a50a75b2 red tests, cc1c15874 implementation).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (one shared cap, no new value, used by `PipelineRootDryRun`): `RemoteErrorText.cap` in
  `backend/src/main/scala/com/helio/domain/connectors/RemoteErrorText.scala:18-20`. It has the same body as HEL-1727's
  `capFetchError` (the `codePointCount` guard, then `offsetByCodePoints`), and `PipelineRootDryRun.scala:32` delegates to it. A grep
  of `backend/src/main` finds only one definition of `500` and of the ` … [truncated]` marker
  (`RemoteErrorText.scala:9,12`). `capFetchError` and `FetchErrorMaxCodePoints` are gone with no remaining references. The other
  `[truncated]` markers in main (`WorkspaceContextComputations`, `PipelineRunNotifyBus`) are unrelated and were there before this change.
- AC2 (both builders): `RestApiConnectorDriver.scala:367` (`issueAndParse`) and `:391` (`issueTest`) wrap the whole
  `HTTP <code>: <body>` string. This follows design Decision 2.
- AC3 (red-first test per path, including the surrogate case): driver (`RestApiConnectorDriverErrorCapSpec`, fetch and test-connection),
  `test_connection` (`AssistantToolExecutorRemoteErrorCapSpec`) and apply (`PipelineApplyProposalRemoteErrorCapSpec`).
- AC4 (helio-mcp): no helio-mcp change. The grep result is recorded in `files-modified.md`.
- AC5 (PR states the side effect): this is a PR-time item. The text exists in proposal.md ("Side effect: ...") for the PR body.
- Constraints:
  - C1 honored. The test builds `AssistantToolExecutor.execute("test_connection", ...)` with a real `SourceService(null, driver)`
    and the real `RestApiConnectorDriver` (localhost admitted through the `isBlocked` override), against `RemoteErrorBodyStub`.
  - C2 honored. The proposal has `"steps":[]` and no Outputs, and the stub returns 500 on every path. The test asserts
    `run.blockedReason` and the stored `error_log` read via `latestPipelineRun`, with status `failed`.
  - C3 honored. `SurrogateBody = 489 'a' + astral + ...`, so in `"HTTP 500: " + body` the astral character sits at UTF-16 units
    499-500. The apply test asserts `expected + " — fix the source"`, which pins the cut inside the error segment of
    `PipelineProposalService.scala:616-622`'s reason.
- Spec delta `specs/fetch-error-envelope/spec.md` matches the implemented behavior. No scope creep: the diff to main code is three files.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (run by me, fresh, in WORKTREE_PATH, lane DB `helio_hel1841`, `sbt -J-Xmx3g`, `nice -n 19`; sharded per lane
constraint C5 instead of a single `sbt testFull`, which would not finish within the tool timeout):

| Shard | Specs | Result |
| ----- | ----- | ------ |
| 1 | RemoteErrorTextSpec, RestApiConnectorDriverErrorCapSpec, AssistantToolExecutorRemoteErrorCapSpec, PipelineApplyProposalRemoteErrorCapSpec, ProposalDryRunFetchHardeningSpec, ProposalDryRunRestSchemaSpec, RestApiConnectorDriverBodySpec, AssistantToolExecutorSpec, ProposalDryRunParitySpec | 89 passed / 0 failed |
| 2 | PipelineApplyProposalSpec, PipelineApplyProposalRollbackSpec, PipelineApplyProposalRunCapSpec, PipelineProposalRollbackConnectorSpec, SourceServiceSpec, CreateSourceEnvelopeSpec, SourceCreatePostInsertCleanupSpec, InProcessPipelineEngineSpec | 262 passed / 0 failed |
| 3 | RestApiConnectorSpec (in RestApiConnectorDriverSpec.scala), RestApiConnectorDriverConnectorResolutionSpec, ApiRoutesSpec | 198 passed / 0 failed |

Repo checks, also run by me:

- `check:scala-quality` is clean (soft warnings only, none new on the changed main files beyond pre-existing file size).
- `check:openspec`, `check:spec-structure`, `check:test-temp-dir-hygiene`, `check:repo-integrity` and `format:check` all pass.
- No `frontend/**` files changed, so the frontend gates were not triggered.

Red and mutation evidence, verified:

- `evidence/red-run.txt` shows 8 failed and 2 passed (the short-error cases). Every failure is a ScalaTest equality or `include`
  assertion: an uncapped `HTTP 500: xxxx...` (or `aaaa...`) was received where capped text was expected. There are no
  compile errors.
- `evidence/mutation-issueTest-uncapped.txt` recompiles one source and fails exactly the two driver `issueTest` cases and the
  two `test_connection` tool cases (4 failed). This shows the tool path runs through `issueTest`.
- I did not rerun an `issueAndParse` mutation. The red run already records that state, because the main-code diff to the driver
  is exactly the two wrap sites, and the fetch-path and apply tests fail there.
- The literal expected strings catch a UTF-16 (non-code-point) cut. `substring(0,500)` would end at the high surrogate
  and fail the `ExpectedSurrogate` equality.

Code quality:

- No inline FQNs and imports are clean.
- The tests deliberately spell the expected strings literally rather than deriving them from the helper, as documented
  in `RemoteErrorBodyStub.scala:7-9`.
- An idempotence test is present (`RemoteErrorTextSpec.scala:29-31`).
- The `restDriver` hook in `PipelineApplyProposalSpecBase` is a minimal, default-preserving extension point.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The delta lives under `openspec/changes/`.

### Overall: PASS

### Non-blocking Suggestions
- tasks.md 3.2 is ticked, but the PR does not exist yet. Make sure the PR body actually carries both the side-effect statement
  (stored source `fetchError` and run `error_log` are now capped) and "no helio-mcp change, no MCP redeploy".
- `PipelineApplyProposalSpecBase.scala` grows to 275 lines (soft budget 250; it was already over).
- `AssistantToolExecutorRemoteErrorCapSpec` constructs the executor with six `null` collaborators. If the tool ever touches
  another collaborator, this fails with an NPE rather than a clear message. This is acceptable for a focused test.
