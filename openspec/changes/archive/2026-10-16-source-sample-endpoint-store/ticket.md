# HEL-1628: Live draft preview (b): 1,000-row source sample endpoint, client sample store and sample label

## Description

Split from HEL-1581 by owner ruling `split-and-restate` (2026-10-16). Design: `docs/live-draft-preview.md` §4 and §12 item (b) (HEL-1580 spike). Parent epic HEL-1570.

### Why

The client evaluator (HEL-1581, merged 95b3c9fd9) runs over a cached sample of a source's rows. No endpoint returns a 1,000-row REST/SQL sample today, and today's preview re-reads the live source on every edit. The owner wants that behaviour gone.

### What

* **New read-only endpoint** returning `{rows, capturedAt, sourceRowCount, truncated}`.
  * The rows are the **engine-loaded rows** (`InProcessPipelineEngine.loadRowsWithStats`, including REST/SQL flattening and row typing), head-first, at most `SAMPLE_MAX` = 1,000. They are not raw source JSON and not `GET /data-sources/:id/preview`.
  * Owner ruling D (HEL-1580): `head-1000-manual-refresh`.
* **Mounted under the HEL-505 source-fetch limiter** (inside the `SourcePreviewRoutes`/`DataSourcePreviewRoutes` `rateLimited` scope, 30/min per user).
  * It must never consume the pipeline-run guard (a sample is not a run).
* **Client in-memory sample store**, per owner ruling C (`client-memory`).
  * Automatic first capture when the pipeline editor opens with nothing cached, then a manual refresh only.
  * Never re-fetched per edit.
* **Labels** (§4):
  * Every non-static source (REST, SQL, connectors, a CSV with a live URL) always shows "sample · N rows · fetched 3m ago", or "sample · first 1,000 of N rows · fetched 3m ago".
  * Any source with more than 1,000 rows (static included) shows "first 1,000 of N rows" plus the caveat that counts and aggregates describe the sample.
  * Only a static source with an exact sample keeps "Static · N rows".

## Acceptance criteria

- [ ] The endpoint returns the engine-loaded head (≤1,000 rows) with `capturedAt`, `sourceRowCount` and `truncated`, for REST, SQL, CSV and dataset sources. Access is checked like the existing source preview routes.
- [ ] Requests count against the source-fetch limiter (a spec proves the 31st request in a window gets 429) and never against the run guard.
- [ ] The client store captures once on editor open, refreshes only on the button, and holds nothing across a page reload.
- [ ] The label rules above render for: a non-static exact sample, a non-static prefix sample, a static source over 1,000 rows, and a static exact sample.

## Driver brief (binding house rules for this run)

- Endpoint response JSON Schema lands in `schemas/` in this same change, with a seam test where both the Scala server and the TS client validate against the committed schema.
- RLS isolation proven by a test on the restricted (non-BYPASSRLS) role used in production, not only as superuser (MISTAKES.md, RLS testing parity gap). Never log row contents. REST/SQL credentials handled exactly as the existing engine fetch path.
- Store API shaped so HEL-1631 (e) can feed rows to the HEL-1581 evaluator; do NOT wire the evaluator into the UI.
- Label placement on the HEL-1579 pipeline page is a reversible visual choice recorded in the PR body. Accent only on primary action/selection/active indicators/focus. DESIGN.md v3 binding; verify on the running app in both themes.
- Scratch: ONLY /home/matt/Development/helio/.concertino/scratch/HEL-1628/ (absolute). Durable evidence: /home/matt/Development/helio/.concertino/runs/HEL-1628/evidence/.
- Load gate: if 1-min loadavg > 10, sleep 60 and re-check (≤30 min). Full Playwright under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock <cmd>`; full `sbt testFull` under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sbtfull.lock <cmd>`. jest/Playwright ≤2 workers, heavy work `nice -n 19`, Playwright traces only on failure.
- Never signal processes; never pkill/pgrep/killall. Stop servers only with scripts/concertino/stop-servers.sh.
- Shared DB `helio` at V136. No migration expected; if one is needed use next free after V136. Isolated DB name if needed: helio_hel1628.
- Specs stay under 120/60s per-user /api and 30/min source-fetch limits. Known main flake HEL-1633: record and rerun once.
- No claude.ai session link or Claude-Session trailer anywhere.
