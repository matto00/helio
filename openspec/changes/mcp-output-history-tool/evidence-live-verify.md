# Live verify evidence (HEL-1274)

- Fresh `npm run build` in worktree `helio-mcp`, then `npm run verify` (tsx scripts/verify.ts) -> exit 0, "VERIFY OK".
- Backend: worktree's own, started via `scripts/concertino/start-servers.sh <worktree> 6706 9613 HEL-1274`
  with env `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES=1440 PIPELINE_RUN_RATE_LIMIT_PER_WINDOW=1000`
  (launcher bash PID 416781, sbt 416858, backend JVM listening on 9613 PID 418170; all stopped afterwards by exact PID).
- Auth: bootstrap PAT `2d5821fb-00af-4dc0-ac18-75351863765a` (dev account, minted for this run, revoked by exact id afterwards);
  verify minted and revoked its own token `6c071656-efb7-4ed7-87ea-ba0ee1b06505`.
- Metric add_output payload (root-bound, `fieldMapping.value=revenue`, `aggregation.agg=sum`, `compare=previous_run`)
  was accepted live (the run proceeded; output id 05f89dba-310f-4bca-955a-9da6fbdc7587, echoed `compare=previous_run`).
- Pre-read retained point count (limit 100) = 30; the one `limit:30` call returned points=30, sparkline=30 (all numeric).
  The metric is constant (sum revenue = 975) so delta=0; the proof is count/shape, not variation.

## Raw verify output (history section)

```
get_output_history — add a metric Output with config.compare, run 30x, read once
========================================================================
  • metric Output 05f89dba-310f-4bca-955a-9da6fbdc7587 compare=previous_run
  • 30 real runs succeeded
  • pre-read retained point count (limit 100): 30
  • ONE get_output_history call: points=30 sparkline=30 compare=previous_run current=975 baseline=975 delta=0
    2026-10-05T18:47:44.081388Z -> 975
    2026-10-05T18:47:44.242085Z -> 975
    2026-10-05T18:47:44.405188Z -> 975
    2026-10-05T18:47:44.543478Z -> 975
    2026-10-05T18:47:44.682259Z -> 975
    2026-10-05T18:47:44.835550Z -> 975
    2026-10-05T18:47:44.972379Z -> 975
    2026-10-05T18:47:45.102407Z -> 975
    2026-10-05T18:47:45.243846Z -> 975
    2026-10-05T18:47:45.378150Z -> 975
    2026-10-05T18:47:45.508127Z -> 975
    2026-10-05T18:47:45.651554Z -> 975
    2026-10-05T18:47:45.771433Z -> 975
    2026-10-05T18:47:45.892534Z -> 975
    2026-10-05T18:47:46.030883Z -> 975
    2026-10-05T18:47:46.145360Z -> 975
    2026-10-05T18:47:46.265088Z -> 975
    2026-10-05T18:47:46.392285Z -> 975
    2026-10-05T18:47:46.508492Z -> 975
    2026-10-05T18:47:46.648179Z -> 975
    2026-10-05T18:47:46.767682Z -> 975
    2026-10-05T18:47:46.903890Z -> 975
    2026-10-05T18:47:47.019661Z -> 975
    2026-10-05T18:47:47.153541Z -> 975
    2026-10-05T18:47:47.272830Z -> 975
    2026-10-05T18:47:47.405835Z -> 975
    2026-10-05T18:47:47.520557Z -> 975
    2026-10-05T18:47:47.632638Z -> 975
    2026-10-05T18:47:47.761633Z -> 975
    2026-10-05T18:47:47.904701Z -> 975

========================================================================
```
