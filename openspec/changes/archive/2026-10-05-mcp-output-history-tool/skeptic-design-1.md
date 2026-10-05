## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Ran the cwd guard: READY ambient=/home/matt/Development/helio branch=feature/mcp-output-history/HEL-1274.
- L3 wire shape (OutputHistoryProtocol.scala): response {outputId, compare, current, baseline, delta, pct, availableFrom, sparkline[], points[]};
  points carry {capturedAt, runId, triggerSource, rowCount, summary}; sparkline oldest-first {capturedAt, value}; nulls are explicit. Matches design Context.
- OutputHistoryQueryParsing: limit 1..100 default 30, never clamped; since via Instant.parse. Matches D3 (client limit bound mirrors backend).
- OutputHistoryService:59-60 `listRecent(max(limit,2))`, `take(limit).filter(since)` -> `since` narrows after limit (claim correct). Line 85 `recent.lift(1)` -> previous_run = second-newest retained point (claim correct).
- Non-metric value null: OutputSummaryReducer sets metric only for OutputKind.Metric; D4 discloses it. Metric config keys (fieldMapping.value, aggregation.agg) confirmed against reducer `metric()` and OutputBindingSpec.Metric (required slot `value`, Numeric; `revenue` is integer in the fixture).
- Schemas: schemas/outputs/create-output-request.schema.json carries the compare property+pattern the design says to copy verbatim; the transactional-output schema has bare `config: {type: object}` and is $ref'd by pipeline-proposal.schema.json:27 and create-pipeline-request.schema.json:91. D5 plan is accurate and description-only.
- helio-mcp patterns: thin-shell split in outputs.ts, `guarded`, VERIFY_WRITE_BUILDERS in verifyPayloads.ts:90, drift test iterates it (verifyPayloads.test.ts:112-122). httpClient retries 429 up to MAX_RATE_LIMIT_RETRIES=5 honoring Retry-After (cap 60s), except CHAT_LIMIT_REACHED. Design's claim holds; its extra verify-level wait is belt-and-braces and bounded.
- update_output semantics: OutputService.mergeConfig merges only legend/tooltip/seriesColors/axisLabels; every other key (incl. compare) is replaced, so "replaced outright; null clears" is accurate. add/update both go through validateConfig -> OutputCompare (backend sole validator).
- No tool description currently mentions compare (grep helio-mcp/src); place_outputs description untouched; "previous run" ban is test-asserted (4.3).
- L3 is reused, not re-implemented: one GET, no arithmetic; summary-trim is a field omission and disclosed in the spec scenario.
- L2 thinning vs. "30 values": thinning only runs in OutputHistoryRetentionService.purgeIfDue (first tick per process always claims, then every purge interval). With <=1 point/5min, a purge mid-run would collapse 30 runs made within minutes; the design's mitigation (raise OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES on the worktree backend, startup tick fires before the runs, read immediately, fail loud naming the count and thinning, rerun not weaken) is sound and honestly records the shared-DB risk. Rate limit: 30 runs at 10/min = >=3 min; handled by client retry + 6-min cap (and optional env raise).
- Scope: ACs (handler test, server.test.ts registry, verify/verifyPayloads, live 30 values, README) each map to tasks 2.3/4.2, 4.3, 2.6/4.4/4.5, 2.7. No placeholders, no TBD. Constraints (no deps, no ci.yml, no migration) checked in 3.1/1.1.
- Repo-root e2e/: only auth-cookie-migration.spec.ts matches "helio-mcp"-ish greps; nothing history/compare related, so no e2e change needed (agrees with design's claim).

### Verdict: CONFIRM

### Non-blocking notes
- docs/agent-native.md:154 holds a tool-mapping table that lists get_output_provenance; it is not in the ticket's Touches or the tasks. Add a get_output_history row (and a compare mention) in the same change, or note it as a deliberate omission.
- Task 2.6 should record the exact env for the live run and confirm the metric add_output with root-bound (no nodeStepId, no rootId) gets a live 201 before building further on it, as D6 already says.
- One-timestamp risk: all 30 runs happen within minutes; if a different dev backend's purge hits the shared DB between run 30 and the read, rerun. Evidence file should include the pre-read count so a pass is not a lucky timing.
- Spec requirement says compare documented on propose_pipeline; analyze/apply planned conditionally. Fine, but keep the server.test.ts assertion scoped to the four named tools only.
