## Standing Constraints

- [C1] (amended after evaluation-1 CR1, orchestrator) D3 certification runs single-CPU as production does (Cloud Run `--cpu=1`, SerialGC; `taskset -c <one cpu>`, `maxMemory 742` under forked `-Xmx768m`): >= 20 repeats each of baseline and boundary across >= 2 JVMs; certify only if every boundary repeat <= 192 MB AND 164.4 + max(mean boundary-minus-baseline shift, boundary max - baseline max) <= 192. No per-index pairing. G1 multi-CPU runs are not representative and do not certify.
- [C2] Build the D3 boundary wide cell from 3-byte UTF-8 characters (e.g. `中`), so the driver's UTF-8 encode cost is in the measurement.
- [C3] The HTTP-response follow-up candidate names both reproducers: the 200-row long-text shape and the D3 wide-row boundary shape; the hand-back discloses that a row rendering wider than the certified `MaxRowRenderChars` is now refused.

## Run Rules (driver brief, binding)

- sbt testFull only under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sbtfull.lock`
- Heap probes: forked `-Xmx768m`, one probe at a time, under the same sbtfull lock; load gate (1-min load > 10: sleep 60 s, recheck, <= 30 min)
- At most 2 workers, `nice -n 19`; `HELIO_JEST_MAX_WORKERS=2`; Bash `timeout: 600000` on long calls
- No kill/pkill/pgrep/killall; servers via `scripts/concertino/stop-servers.sh`; Postgres via `pg_ctl -D <exact dir> stop`
- Scratch: `/home/matt/Development/helio/.concertino/scratch/HEL-1679/`; `files-modified.md` lists every path explicitly

### Backend

- [x] 1.1 Red first: add the D6 long-text shapes to `RunPathHeapSpec` and measure on unchanged main code; persist summary
- [x] 1.2 Add `JsonTextLength` (exact compactPrint chars + UTF-8 bytes, no rendering) next to `PipelineRowJson` (D1)
- [x] 1.3 Size-capped batches in `NodeSnapshotRepository.overwriteRowsActionRendering` with `SnapshotBatchMaxChars` (D2)
- [x] 1.4 `RunLimits.MaxRowRenderChars` (measured) checked in `refuseOverPostWalkBudget` over Output + terminal rows (D3)
- [x] 1.5 Same check (`exists(len > MaxRowRenderChars)`) in `PipelineRunBackfill.persistBackfilledRows`, logged recover (D3)
- [x] 1.6 `NodePayloadHistoryRepository.writeAction` measures with `JsonTextLength` before rendering; WARN unchanged (D4)

### Tests

- [x] 2.1 `JsonTextLength` equality spec over adversarial values, incl. engine rows via `anyToJsValue` (D1, D3)
- [x] 2.2 Extend `NodeSnapshotBatchedWriteSpec` with the size-ahead render-counting case (D5)
- [x] 2.3 `PipelineRunLimitsServiceSpec`: a too-wide row fails the run with the run-limit step error, no snapshot (D3)
- [x] 2.4 Payload repository spec: an over-cap node is never rendered; under-cap round-trips (D5)
- [x] 2.5 Backfill: specs showing it writes through the size-capped path and refuses a too-wide row writing nothing
- [x] 2.6 `RunLimitsGuardSpec`: tripwire on `MaxRowRenderChars`, boundary accepted, +1 refused, AC6 pin unchanged (D5)
- [x] 2.7 Record each D5 mutation red then green in `mutations.md`
- [x] 2.8 Green measurement: every D6 shape <= 192 MB (or cleanly refused), >= 2 repeats; persist summaries
- [x] 2.9 Run CI script checks locally (incl. `check:node-root-encoding`) and `sbt testFull` under the lock
- [x] 2.10 List follow-up candidates (response-path render, reproducers `fewrows-utf16-200` AND the D3 wide-row boundary shape `rowwidth-at-limit`; backfill copies; single-CPU re-measurement of HEL-1660's limits). A row whose rendered JSON is wider than the certified `MaxRowRenderChars` is now refused with the run-limit step error
