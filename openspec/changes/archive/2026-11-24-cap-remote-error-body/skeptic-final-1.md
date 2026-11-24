## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `cc1c15874603c91f923b2e18bf46ea1846bdd65d` against the live base `2ce5a8f23334b44c5ab448ea928535bc33b5d709`
(resolve-review-base.sh, exit 0). Two commits: 5a50a75b2 (red), cc1c15874 (impl). Backend only. The diff touches no
`frontend/` or `helio-mcp/` files (`git diff --stat` over both is empty), so there was no UI step.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/cap-remote-error-body/HEL-1841`.
- **AC1 (one shared helper, same cap, PipelineRootDryRun uses it):** `RemoteErrorText.scala` defines 500 and
  ` … [truncated]` once and keeps the codePointCount guard before offsetByCodePoints. `PipelineRootDryRun.scala:32` calls
  `RemoteErrorText.cap`. A grep for `capFetchError|FetchErrorMaxCodePoints` across `backend/src` returns nothing, so no
  second definition is left. The cap value and marker are byte-identical to HEL-1727's removed code (seen in the diff).
- **AC2 (both builders capped):** `RestApiConnectorDriver.scala:367` (issueAndParse) and `:391` (issueTest) both wrap
  the text with `RemoteErrorText.cap`. A grep for `"HTTP ` / `s"HTTP $` in `backend/src/main` finds only those two
  sites. The other `utf8String` hits are the Claude transport and request parsing, not remote-source error text.
  ContentSourceSupport builds no body-bearing error.
- **AC3 (red-first test per path, surrogate at the cut):**
  - Driver: `RestApiConnectorDriverErrorCapSpec` tests the real driver on both fetchEphemeral and testConnectionEphemeral against a local stub.
  - test_connection (C1): `AssistantToolExecutorRemoteErrorCapSpec` calls `execute("test_connection")` with a real
    `SourceService` and the real driver, then asserts the tool-result `error` field exactly.
  - Apply (C2): `PipelineApplyProposalRemoteErrorCapSpec` uses a proposal with no Outputs, so it has no fieldMapping.
    The stub returns 500 on every path. The test asserts 201 + `blocked`, that `blockedReason` includes
    `expected + " — fix the source"` (the cut sits inside the quoted error, per C3), and the same for the stored `error_log`.
  - C3: `SurrogateBody = 489 a + U+1F600`. With the 10-unit `HTTP 500: ` prefix, the astral pair sits at UTF-16 units
    499-500 of the whole string. I checked the arithmetic myself.
  - Red: the committed `evidence/red-run.txt` (in red commit 5a50a75b2, before any main-code change) shows 8 FAILED.
    The short-error cases pass and the failure values are the uncapped `HTTP 500: xxx…` text. All the expectations are
    exact-equality or `include(... marker ...)`, so the uncapped pre-fix driver must fail them. Red is established by
    construction as well as by the recorded run.
- **My own green runs** (lane DB helio_hel1841, ANTHROPIC_API_KEY empty, `nice -n 19 sbt -J-Xmx3g`):
  - Shard 1: the new specs plus RemoteErrorTextSpec and ProposalDryRunFetchHardeningSpec. `Tests: succeeded 22, failed 0`, exit 0.
  - Shard 2: all `PipelineApplyProposal*` specs (these exercise the modified SpecBase), all `RestApiConnectorDriver*`,
    AssistantToolExecutorSpec, SourceServiceSpec, CreateSourceEnvelopeSpec, SourceCreatePostInsertCleanupSpec,
    ProposalDryRunRestSchemaSpec, ProposalDryRunParitySpec and PipelineProposalRollbackConnectorSpec.
    `Tests: succeeded 186, failed 0`, exit 0.
  - Shard 3: ApiRoutesSpec and InProcessPipelineEngineSpec. `Tests: succeeded 367, failed 0`, exit 0.
  - Output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1841/skeptic/run{1,2,3}.txt`.
- **Idempotence:** the dry run re-caps text the driver already capped. `RemoteErrorTextSpec` "be idempotent" passes,
  and the reasoning holds: capped text starts with the same 500-code-point prefix.
- **AC4/AC5 (PR text):** no helio-mcp change (diff empty). The grep finding is in files-modified.md, and the
  side-effect sentence is in proposal.md. The PR does not exist yet, so these two are not yet verifiable.
- No existing test fixture was edited to accommodate the cap. The only pre-existing test file touched is SpecBase, and
  that change only adds the hook; its default still returns `stubConnector`, so the subclasses behave as before.

### Verdict: CONFIRM

### Non-blocking notes

- At PR creation, the PR body must state both of these (AC4/AC5):
  - stored source `fetchError` and run `error_log` text are now capped;
  - there is no helio-mcp change and no MCP redeploy.
  The tasks.md 3.2 checkbox was ticked before the PR existed.
- The driver still reads the whole body into memory (`toStrict(30.seconds)`) before capping. That is outside this
  ticket's scope, which covers text in context and storage, not memory.
