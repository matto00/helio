## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Head reviewed: c6fb73fa4f4f4339f3af22e13744a6c7063e6198

### What I verified (with evidence)
- Re-ran `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: 5902 tests, 411 suites, 0 failed, 0 aborted; no FirstRunRoutesSpec timeout (only the benign DatabaseConnectionTimeoutSpec hikari warn). sbt client shut down.
- Diff vs live base 2f495650: Main.scala untouched; ApiRoutes hunk = 3 small edits (import, optional service wiring, two constructor args); JsonProtocols = one mixin line; no migration file; no new SQL (OutputHistoryService calls L1 listRecent / nearestAtOrBefore / earliest only).
- D6: OutputHistoryService.resolveBaseline uses `head.capturedAt.minus(w)` (latest point, not now); repo uses `capturedAt <= at` (point exactly at latest-window is selected), ties broken by (captured_at desc, id desc). Spec fixture puts T >= 3d before now with distinct T-9d/T-8d/T-6d so now-relative and earliest-relative mutants are killable; no-baseline -> null + availableFrom = earliest + w asserted with earliest/current+w distinct.
- previous_run = second-newest retained point; limit=1 still fetches 2 (max(limit,2)); documented in specs/schema.
- Explicit nulls: hand-written write-only formats put every nullable field on the wire as JsNull; spec asserts `fields.get(k) shouldBe Some(JsNull)` and a schema guard test that rejects an omitted availableFrom; seam test also validates a response from REAL PipelineRunService runs.
- Non-grantee 404: spec asserts app pool is non-superuser/non-BYPASSRLS (SET ROLE), then 404 body byte-identical to unknown id; grantee viewer gets 200.
- compare validation: OutputCompare.parse (regex first, rejects signed/lowercase/week/month/overflow/zero/>365d); wired into OutputService.validateConfig (create + update/merge), PipelineService single-call create/proposal path (checked before the no-fieldMapping early return) and PatchSetPreviewProjection (shared). PatchSetUndo reinserts prior (already valid) config. Stored-bad compare degrades to no comparison, never 500; compare is read at request time so a changed compare between runs resolves against current config.
- Bounded queries: CountingDataSource spec asserts identical execute counts at 3 vs 150 points (<=7 authenticated, <=9 public) across both pools.
- Public variant: separate allowlist type (capturedAt,rowCount,summary; no runId/triggerSource/outputId), keySet equality asserted, leak markers grep'd, same resolvePanelOutput gate as output-meta (private/mismatched/unbound/deleted all 404). Response size bounded by limit<=100 and L1's capped summary.
- Schemas: output-history-response, public-output-history-response added; create/update output request schemas gained compare.

### Verdict: CONFIRM

### Non-blocking notes
- No dedicated test pins a point exactly at latest-window (inclusive `<=`); behavior is correct by the L1 query but unguarded in this lane.
- Public summary exposes historical aggregates (past runs) that the rows endpoint (latest only) does not; this is the owner-ruled D8 "summary, never payloads" behaviour.
- Public route returns 400 for malformed limit/since before the ACL gate (no existence leak, since it is independent of the dashboard).
