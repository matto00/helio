# HEL-1274: HEL-918 L4: MCP get_output_history and compare on Output config

## Description

Child L4 of epic HEL-918 (snapshot history & deltas on every Output). Expose L3's (HEL-1273) history + delta read
surface through helio-mcp — never re-implement it — and document `compare` on the Output config write tools.

Epic owner rulings relevant here (HEL-918, 2026-10-05):

- D2 `compare` lives on `outputs.config.compare` (`previous_run | 1d | 7d | 30d | custom:<ISO-8601 duration>`), not on
  the panel, and not on `place_outputs`.
- D3 the headline metric value is computed server-side over ALL rows.
- D6 baseline = nearest point at or before (latest point captured_at − window), measured from the latest snapshot; none →
  baseline null plus `availableFrom`. `previous_run` = the second-newest point.
- D4 history is thinned on purge (≤1 point/5 min within 24h, ≤1/hour 1–7d, ≤1/day beyond, up to tier max age).

Driver-supplied constraints (verified in premise-validation.md):

- Non-metric Outputs return `value: null` (HEL-1273).
- After thinning, "previous" is the previous *surviving* point; final semantics are open in HEL-1285, so no MCP tool
  description may promise "previous run".
- Dependencies stay unchanged (helio-mcp has a moderate `npm audit` gate, HEL-1204).
- Do not touch `.github/workflows/ci.yml` (HEL-1287/HEL-1288 in flight). No migration (V116 earmarked for L6).
- Test against a freshly built helio-mcp in the worktree, never the session's MCP tools.

## Scope

- A new helio-mcp tool, `get_output_history`: the last N values in one call.
- Document `compare` in `create_pipeline` `outputs[].config`, `add_output`, `update_output` and the proposal schemas.
  NOT `place_outputs`.

## Acceptance Criteria

- A handler unit test.
- The `server.test.ts` tool registry is updated.
- `scripts/verify.ts` / `verifyPayloads` cover the new tool, and a live verify run shows 30 values in one call.
- README updated.

## Touches

helio-mcp/src/tools/outputs.ts, outputsHandlers.ts, helioApi.ts, tools/pipelines.ts, server.test.ts,
scripts/verify*.ts, README.md.

## Depends on

L3 (HEL-1273, merged at 94e996d3).

## Driver rules (binding on every role this run)

- Backend tests, if run at all: `nice -n 19 sbt testFull`, Bash timeout 600000, at most 2 workers. Run
  `sbt --client shutdown` as its own Bash call.
- New route specs extend `com.helio.testkit.HelioRouteTest` (none are expected; this change is helio-mcp only).
- Never create, update or delete anything under `~` outside the repo and its worktrees.
- Never pick deletion targets (DB rows, users, files, processes) by pattern, name or time window. Use only exact
  ids/paths/PIDs you created and recorded.
- Use your own headless browser context and this run's allocated ports (dev 6706, backend 9613).
- Do not touch `.github/workflows/ci.yml`. Do not add a migration. Keep dependencies unchanged.
- Test against a freshly built `helio-mcp/dist` in this worktree, never the session's MCP tools.
- Report any FirstRunRoutesSpec timeout or CI "Java heap space" failure. Known flaky e2e specs
  `hel1260-orphan-owner-repair` (HEL-1289) and `hel958-join-step-editor`: report if hit, do not edit.
