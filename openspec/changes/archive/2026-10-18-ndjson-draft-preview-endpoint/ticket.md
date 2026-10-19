# HEL-1630: Live draft preview (d): NDJSON draft-preview endpoint for server-only steps, with its own limiter exempt from the general /api bucket

## Description

Split from HEL-1581 by owner ruling `split-and-restate` (2026-10-16). Design: `docs/live-draft-preview.md` §6 and §12 item (d).
Parent epic: HEL-1570. Blocked by HEL-1581 (a) and HEL-1628 (b), both merged. (e) HEL-1631 and (f) HEL-1632 depend on it.

### Owner rulings (do not re-ask)

* HEL-1580 ruling A (transport): "whichever is most efficient in terms of latency and cost". Pick: **POST with an NDJSON
  streamed response over HTTP/2** (§6.3).
* HEL-1580 ruling F: `never-before-save`. AI steps (`analyzewithai`, `generatetext`) and everything downstream of them are
  never previewed.
* HEL-1630 escalation (answered by the owner 2026-10-18, `HEL-1630-1792286604081-68f920`):
  1. `owner-or-editor`: only the pipeline owner or an editor may call draft-preview; a viewer gets 403.
  2. `never-read-sources`: the endpoint never reads any data source, primary or secondary. It evaluates only frames the
     client supplies. A step whose source secondary is not supplied (or not complete) gets a per-step `unavailable` line
     with a reason in the stream contract, so (e) can render "runs on Save & run" without guessing.

### What

* **Endpoint.** `POST /api/pipelines/:id/draft-preview`. Body: the draft configs from the first server step downward, plus
  the input frame that step needs (the client's own cached frame; the source is never re-fetched). It reuses the engine's
  execution over the supplied rows. The response is a chunked `Source[ByteString]`: one NDJSON line per step
  (`{step, count, schema}`), then a final `{rows}` line.
* **Which steps use it.** The server-only kinds (`chunkbytokencount`, `convertformat`), plus any config the HEL-1581
  evaluator's `clientEvaluable` declines.
* **Client** (built here, wired into the draft UI by (e)): fetch + `ReadableStream` like `pipelineRunFanout.ts`;
  single-flight with an `AbortController`; trailing debounce ~300-400 ms and a floor of ~600 ms between sends (a continuous
  drag sends at most ~100 requests/min).
* **Limiter.** Its own `RateLimitDirective` instance, bucket and env var (default 120 per 60 s per principal). Exempt from
  the general `/api` bucket through a path exemption inside the general directive. Still applies authentication (session or
  PAT), the CSRF header on POST, and `confineScopedToken`. Never consumes the HEL-505 run guard (nothing written to run
  history). Document the new env var in CLAUDE.md.
* **Access.** The HEL-1516 access re-check runs before every evaluation.

## Acceptance criteria

- [ ] The NDJSON stream emits per-step lines before the final rows line. A spec asserts the line order and that the source
      is never read.
- [ ] Draft-preview requests do not decrement the general `/api` bucket and do decrement their own. The 121st request in a
      window gets 429. PAT-scoped hook tokens are refused (`confineScopedToken`), and a POST without the CSRF header is
      refused.
- [ ] A superseded request is aborted client-side, and the server observes the abort.
- [ ] The client never exceeds the send floor during a simulated continuous drag (count measured).
- [ ] AI steps are never executed by this endpoint (a spec asserts zero AI client calls).
- [ ] (owner ruling 1) A viewer is refused 403; an editor succeeds under RLS (NOBYPASSRLS spec); the HEL-1516 re-check runs
      before every evaluation (a revoked grant mid-flight is refused).
- [ ] (owner ruling 2) No data source is ever read; a step whose source secondary is not supplied completely yields an
      `unavailable` line with a reason.
- [ ] Request and NDJSON line schemas are committed in the same change, with a seam test on both sides; oversize bodies
      are refused with a clear 413; request rows never appear in logs.
