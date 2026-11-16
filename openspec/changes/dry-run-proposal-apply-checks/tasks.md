## Standing Constraints

- [C1] Never read, cat, grep, source or print any `.env` file (incl. backend/.env); never dump env (`env`, `printenv`, `sbt show ...envVars`).
- [C2] Multi-line shell text only via quoted heredocs (`<<'EOF'`) or Write/Edit; no backticks or `$(...)` inside echo strings.
- [C3] No pkill/pgrep/killall; stop servers with scripts/concertino/stop-servers.sh; kill only exact, confirmed-own PIDs; delete DB residue by exact id only.
- [C4] Resource caps: jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g and `nice -n 19` on heavy runs; check `free -g` before committing if another lane is testing.
- [C5] `timeout: 600000` on every Bash call that can run hooks or CI (git commit, sbt testFull, squash, PR checks).
- [C6] Read the ScalaTest summary for every red/green claim; sbt can exit 0 with `*** N TESTS FAILED ***`.
- [C7] No live Anthropic calls; prove with fixtures/scripted transports.
- [C8] Do not touch infrastructure/ai/ClaudeClient.scala, ClaudeProtocol.scala, ClaudeModels.scala; do not change any assistant tool input_schema shape (HEL-1639 release hold).
- [C9] Red first: each new behavioural test is shown failing on the unmodified code before the fix.
- [C10] The discriminating REST queryParams/parameters parity entry uses a local HTTP stub that records the composed request (endpoint after templating + ordered query pairs), not `fetchOverride` (which sees the un-templated config).
- [C11] The dry-run REST fetch is issued through `issueAndParse` (HEL-879 SSRF choke point); the PR states the new propose-time egress.
- [C12] Every propose-time live source fetch (inline rest/sql dry-run schema inference) is charged to the existing source-fetch limiter budget (SOURCE_FETCH_RATE_LIMIT_PER_WINDOW, same InMemoryRateLimiter instance and principal key as sourceFetchRateLimitDirective); exhaustion rejects the propose (assistant sees is_error); never unbounded; PR states it. If it cannot be bounded cleanly, stop and return an ESCALATION (coordinator directive).

## 0. Probe

- [x] 0.1 Re-verify `apply-check-inventory.md` rows 1.2, 1.4-1.6, 1.9-1.12 and section 2/3 against the code; record any difference in `apply-check-inventory.md` under "D0 corrections" and report it.
- [x] 0.2 Decide D1.6 (cycle guards read-only?) and D2 sentinel-controls (validator usable without a persisted Output?) from the code; record the outcome and reason in the inventory.

## 1. Red tests

- [x] 1.1 `PipelineProposalServiceValidateSpec`: Output maps a column dropped by an upstream select, and one never in the source → expect apply's column message. Red on current code.
- [x] 1.2 `CombinedProposalServiceValidateSpec`: same column case; layout overlap; sentinel with 2 Outputs; non-sentinel panel bound to a missing Output. Red.
- [x] 1.3 `AssistantToolExecutorSpec`: propose_pipeline column case returns `Left` naming the available columns and captures nothing. Red.
- [x] 1.4 Dashboard/patch-set panel config that `panel.validateConfig` rejects passes `validate`/`preview` today. Red. (validate: evidence/red-1.4.txt; the test is held as evidence/red-1.4-test.patch and lands with its fix in 3.2; preview red lands with 3.3.)

## 2. Pipeline dry run (D1)

- [x] 2.1 Extract inline-source pre-insert checks into `validate*` functions called by `createSql`/`createRest`/`createStatic`; existing source specs green.
- [x] 2.2 Extract `outputNodeSchemas` (NodeStepInputs with `enabled`, `analyzeNodes`, root fallback) and `outputMappingProblem`; `createTransactional`/`buildOutputsAction` call them.
- [x] 2.2a Extract `createRest`/`createSql` config build + inference arguments into shared pure functions; factor `buildResolvedRequest`'s post-`resolveConnector` part to take a `Connector` value; dry run infers through it with the unpersisted Auto connector (url) or the real connector (connectorId). Ephemeral path untouched. The factored composition takes the credential value as an argument (`""` for the NoAuth Auto connector); `resolveConnector`, the pending guard and decrypt stay in the persisted-path caller (skeptic-design-3 note 1).
- [x] 2.3 `PipelineCreateDryRun` (originally named `PipelineProposalDryRun`) (D1 steps 1-7, per-root order, round-1 fetch-failure rule); `validate` and `apply` call it.
- [x] 2.5 D1b: extract `PipelineRootWrites` inline-branch checks (its messages) into functions it calls; `resolvePipelineCreate` runs D1 steps 1-7 with the patch-set policy, in `PipelineCreateWrites.checkedCreate`'s order (root shape/ownership, preflight, cross-owner refs, then inline create checks) and with `edit N:` prefixes (skeptic-design-3 notes 3, 5); red tests first (missing column; inline static root existing vs missing column).
- [x] 2.6 Direct `POST /api/pipelines` regression test for the disabled-step fix.
- [x] 2.4 Static root schema uses apply's runtime column types.

## 3. Combined, dashboard, patch set (D2, D3)

- [x] 3.1 Combined validate: layout, sentinel count, non-sentinel bindings/controls, sentinel-bound panel checks per 0.2.
- [x] 3.2 Split `buildForCreate` into pure + binding parts; `dryRunForCreate` with `Real`/`Sentinel` binding; `DashboardProposalService.validate` runs it per panel.
- [x] 3.3 Patch-set `resolvePanelCreate` (non-`$ref`) and panel update resolve run the panel service checks.

## 4. Assistant and parity (D5, D6)

- [x] 4.1 `ProposalDryRunParitySpec`: >= 16-proposal corpus incl. every D6 must-include case; validate accepts iff apply succeeds, messages equal; mutation proof of `outputNodeSchemas` and `outputMappingProblem` recorded in evidence.
- [x] 4.2 Assistant loop test (scripted transport, `AssistantStandingsFixture`, Sleeper-shaped rosters + users sources): first propose maps `display_name` at the rosters node → `isError` tool_result naming available columns; second propose (lookup against users) is captured. No live calls.

## 5. Routes and MCP (D4)

- [x] 5.1 Three validate routes + route specs (auth, 200, apply's error status/message) + `schemas/` + OpenAPI.
- [x] 5.2 helio-mcp `propose_pipeline`/`propose_dashboard` call the routes; tests for rejection (`isError`) and unchanged success shape.

## 6. Close-out

- [x] 6.1 Full backend `sbt testFull` (summary read), helio-mcp tests, lint/typecheck; schema-drift check green.
- [x] 6.2 `apply-check-inventory.md` final: every apply check marked dry-run / apply-only-with-reason.
- [x] 6.3 Follow-up filed by the orchestrator as HEL-1722 (patch-set step add/update and data-source edit checks).

## 7. Cycle 2 (evaluation-1.md)
- [x] 7.1 CR1 PAT principal key in SourceFetchBudget, test red first (evidence/red-cycle2-CR1-pat-key.txt), C12-bounded.md updated.
- [x] 7.2 CR2 stale PipelineProposalService scaladoc rewritten.
- [x] 7.3 CR3 stale C12-note and inventory section marked superseded.
- [x] 7.4 CR4 route test asserts the first request is not 429.
- [x] 7.5 Suggestion (b): PipelineStepOwnership object shared by createTransactional's path and the dry run.
- [x] 7.6 Suggestion (c): required budget on PipelineProposalService, PatchSetPreviewService, PatchSetApplyContext.build.
- [x] 7.7 Full testFull re-run (evidence/6.1-testFull-summary.txt, cycle 2 appended).
