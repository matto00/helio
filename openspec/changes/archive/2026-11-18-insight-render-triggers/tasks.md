## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; no env-dumping commands. scripts/concertino/.concertino.env may be read by scripts, never printed.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh; DB residue deleted only by exact id (guarded buildUserDeleteSql).
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout 600000 on long calls; use sbt testFull and read ScalaTest's own pass/fail line, not the exit code.
- [C6] Budget exhausted means escalate.
- [C7] Merge only through the auditor with gh pr merge --squash --match-head-commit; never --auto.
- [C8] No prod actions, no release cut, no concertino sync.
- [C9] No claude.ai session link in the PR or commits.
- [C10] Phase 4 runs cleanup.sh --phase4 from the main checkout; confirm run.end; delete the local branch if skipped.
- [C11] Known-flake rule: rerun only the failed job once and name it in the PR; a second failure escalates.
- [C12] RED FIRST: write each test before its code and record the red run in evidence; every guard has a recorded mutation; reviewers run full affected spec files.
- [C13] Scratch only in .concertino/scratch/HEL-1743/.
- [C14] Dev-DB residue cleaned by exact id; prefer the lane-private DB helio_hel1743 (drop at Delivery).
- [C15] (cycle 2: ONE MORE render approved on the same terms after the D14 fix) Live gate PRE-APPROVED by the owner 2026-11-18 (no escalation needed) on exact terms: ONE render on claude-haiku-5-5 only, from a dev/lane backend never prod; assert the model id is claude-haiku-5-5 before the call AND from the response; projected cost <= $0.50 hard cap; at most the renderer's single validator retry; record actual tokens and cost_micros in evidence/live-check.md. Any deviation (other model, a second render, estimate over $0.50, extra retry) -> stop and escalate. Sonnet/Opus live calls forbidden.
- [C16] The run path never awaits a render: the hook is outside the writes chain (design D1).
- [C17] Owner chose proceed-to-execution after design round 6; round-6 points ER1/ER2 are execution requirements the evaluator verifies (tasks 4.16/4.17). Fold-ins D13 are in scope.
- [C18] Never read or print the API key; the live check uses the lane backend started by start-servers.sh (HEL-1755 mechanism).

## 1. Backend: model key and billing seam

- [x] 1.1 InsightConfig: parse optional `model` with an is-selectable predicate (null clears); add to Keys; update L1 key tests.
- [x] 1.2 OutputConfigValidation owns lazy isSelectableModel (ClaudeModelCatalog.fromEnv); required param threaded to InsightConfig.parse and InsightReadsCheck (no default).
- [x] 1.3 AiPipelineQuotaGate.checkAndIncrement gains `weight: Int = 1`; Live forwards it; AI-step callers unchanged.
- [x] 1.4 InsightModelRequest gains `model: Option[String]`; ClaudeInsightClient resolves via catalog, sets ClaudeToolRequest.model, reports the API response's model.

## 2. Backend: render service

- [x] 2.1 InsightRenderer: split into prepare (built prompt or PackTooLarge) and send(model) carrying the resolved model into the retry; render = composition.
- [x] 2.2 InsightRenderService: input recipe D2 (read set, head, compares, windows, preset inference), model resolve before guards, timestamp-free digest (D3), guards digest -> hourly -> quota -> send, 30 s Promise-raced timeout, model on every sent row (D4), in-flight set.
- [x] 2.3 renderForRun for on_run insights of the pipeline; InsightRunTrigger trait with no-op default.
- [x] 2.4 Hook in PipelineRunSucceededWrites after publishTerminalAfter succeeds (design D1), Future.delegate + recover.
- [x] 2.5 DbContext.withSystemPinnedSession (no transaction); tickPass: aligned 15-min gate, in-flight guard, pinned advisory lock + cleanUp unlock, daily 06:00 UTC, on_run catch-up via pipelines.last_run_*, 10-render cap; start in runPasses.
- [x] 2.6 InsightRendered event + listener list; latestFor(outputId); skip-row coalescing (UPDATE created_at by id); purge doc comment updated.
- [x] 2.7 Wire service, catalog and trigger in ApiRoutes/Main (one catalog instance shared with chat).

## 3. Backend: routes and reads

- [x] 3.1 OutputInsightReadService: caller role (owner/editor full, viewer reduced); viewer omits model/tokens/cost/runId/inputDigest and sees skipped_quota/skipped_budget as not_updated (R3b); update the shape spec.
- [x] 3.2 POST /api/outputs/:id/insight/refresh: owner/editor 202 + async render, viewer 403, others 404; own limiter INSIGHT_REFRESH_RATE_LIMIT_PER_WINDOW.
- [x] 3.3 Schemas: new output-insight-refresh-response.schema.json {outputId, started}; not_updated in both read schemas' status enums; insight config `model`; viewer-optional fields; drift check passes.
- [x] 3.4 Docs: CLAUDE.md endpoint list (refresh, role-shaped reads), env table (INSIGHT_REFRESH_RATE_LIMIT_PER_WINDOW), daily 06:00 UTC, HELIO_BETA_MODEL_WEIGHTS row now names insight renders.

## 3b. Fold-ins (D13)

- [x] 3b.1 Refresh route optional body {"trigger":"pin"}; GET /insight adds canRefresh; schemas updated.
- [x] 3b.2 useAskPin calls refresh with trigger pin after a successful create; failure never fails the pin.

### Frontend

- [x] 3b.3 Insight panel Refresh button (canRefresh), refreshPending + bounded poll.
- [x] 3b.4 deriveInsightState: skipped_quota -> quota for whoever receives it; skipped_budget, not_updated -> notUpdated; actor-neutral wording.
- [x] 3b.5 InsightKindFields model selector after preset from GET /api/assistant-models, Server default clears; 403 hides it.
- [x] 3b.6 e2e: refresh path to keyless failed state and pin -> pin attempt via the real route; psql seed kept only for ok states.

## 3c. Cycle 2 (owner answers)

- [x] 3c.1 D14: insight max_tokens 4096 (client + limits); test pins it on the recorded wire request.
- [x] 3c.2 Failed render after a send records usage and cost_micros on its row; test.
- [x] 3c.3 Update the archived forbidden-classification.md entry for the new Forbidden producer.
- [x] 3c.4 Run e2e/hel1743-insight-refresh.spec.ts (Playwright 2 workers, lane DB) and record the result.
- [x] 3c.5 One more live render on the approved terms; evidence/live-check.md.

## 4. Tests (each written and recorded red BEFORE its code, per C12)

- [x] 4.1 Run unaffected by render failure and by a never-completing render (succeeded, event timing = no-insight baseline); late result after timeout writes no row.
- [x] 4.2 Dry run and draft preview: zero sends on a fake transport.
- [x] 4.3 Free-tier owner: zero sends, ONE coalesced skipped_quota row across runs with CHANGING data, for on_run, daily and manual.
- [x] 4.4 Ten identical REAL runs (real writes), awaiting each render before the next run: one send, one ok + one coalesced skipped_unchanged row; mutation hashing serialized turns it red.
- [x] 4.5 Hourly throttle (no row), failing model throttled (model recorded), catch-up by the tick pass; catch-up with OVERLAPPING runs and with success-then-failed runs;  manual bypasses throttle.
- [x] 4.6 Weighted quota: Haiku 1, Sonnet 4, Opus 8, env override, owner uncounted, AI-step weight still 1.
- [x] 4.7 Model key: outside-catalog 400 on create, update, draft save, POST /api/pipelines; absent with non-catalog or narrowed default renders ok + expected weight; unselectable -> failed, counter unchanged; keyless no charge; no forbidden wire params.
- [x] 4.8 Daily pass: 05:59 none, 06:00 one, 06:10 and 06:30 none; two instances one send; lock held -> skip; pass failure never fails the tick.
- [x] 4.9 Refresh route: owner and editor 202 then a manual row, started false when in flight, viewer 403, stranger/unknown/non-insight 404, own rate limit 429.
- [x] 4.10 R3 + R3b: owner/editor/viewer on both GET routes: cost fields, and not_updated for viewer quota/budget skips (fail-first per role).
- [x] 4.11 InsightRendered published only for ok; latestFor returns newest ok.
- [x] 4.14 Inputs: auto preset infers delta with a metric+compare sibling, read Output on another node leaves it unchanged, disabled ops ignored; absent reads.outputs reads node siblings; dangling id skipped.
- [x] 4.15 Null-model failed merges only into a null-model failed row; a modelled failed row is never altered.
- [x] 4.16 ER1 (round 6): catch-up with overlapping runs and with success-then-failed run.
- [x] 4.17 ER2 (round 6): no-model failed merges only into a no-model failed row (same as 4.15, named for the evaluator).
- [x] 4.18 Fold-in tests: pin trigger, canRefresh per role, refresh button/poll, quota wording per role, model selector (jest + e2e).
- [x] 4.12 Recorded mutation per guard (digest, throttle, quota, hook placement, role shape) in evidence.
- [x] 4.13 Full backend sbt testFull; live check (C15) with evidence/live-check.md; drop helio_hel1743.
