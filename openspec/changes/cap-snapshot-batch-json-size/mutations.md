# Guard mutations (HEL-1679)

Each mutation was applied to the finished code, the named spec run (`sbt testOnly`, under the sbtfull lock), the result recorded, and the
mutation reverted. "Green" is the same spec on the unmutated code (every named spec passes in `evidence/green-testfull.summary.txt`).
The raw transcript of the run is `evidence/mutation-run.txt`.

| # | Mutation | Spec that turns red | Red test(s) |
|---|----------|---------------------|-------------|
| M1 | `compactPrint` moved out of the deferred `flatMap` (`acc.andThen(insertBatch(batch))`: every batch rendered while the action is built) | `NodeSnapshotBatchedWriteSpec` | "never render more than one batch ahead (450 rows)", "never hold more rendered text than the batch budget ahead (12 rows of ~300,000 characters)", "render a row wider than the budget alone" |
| M2 | batch by count only (`batchesOf(rows, Long.MaxValue)`: the size cap ignored) | `NodeSnapshotBatchedWriteSpec` | the 12-row and the 3-row wide cases |
| M3 | batch boundary off by one (`chars + len > maxChars` became `>=`) | `NodeSnapshotBatchedWriteSpec` | "close a batch exactly when the next row would pass the character budget" |
| M4 | the at-least-one-row guard dropped (`count > 0 &&` removed: an empty batch before a wide row) | `NodeSnapshotBatchedWriteSpec` | "always put at least one row in a batch, however wide" |
| M5 | the run's widest-row check dropped (`if (false && rowTooWide(widest))`) | `PipelineRunLimitsServiceSpec` | "fail a real run cleanly with the run memory-limit error ... and write no snapshot" |
| M6 | limit compare off by one (`rowTooWide`: `>` became `>=`) | `RunLimitsGuardSpec` | "treat exactly the limit as writable and one character more as too wide" |
| M7 | terminal frame skipped by `widestRetainedRowChars` | `RunLimitsGuardSpec` | "accept a row of exactly the limit and refuse one character over (terminal frame)" |
| M8 | retained Output frames skipped (terminal only) | `RunLimitsGuardSpec` | "see a too-wide row in a retained Output frame even when the terminal is narrow" |
| M9 | the backfill's widest-row check dropped | `PipelineRunLimitsServiceSpec` | "make backfill write nothing" |
| M10 | `MaxRowRenderChars` raised past the certified value (2,000,000 -> 3,000,000) | `RunLimitsGuardSpec` | the tripwire ("at or below the certified value (2,000,000)") |
| M11 | the payload rendered before it is measured (`render(rows)` then `getBytes`) | `NodePayloadHistoryWriteSpec` | "never render an over-cap node's payload text" |
| M12 | `JsonTextLength` off by one for an escape class (a tab counted as one character) | `JsonTextLengthSpec` | the adversarial-string and nested-value equality cases |
| M13 | `JsonTextLength` surrogate pair counted as 3 UTF-8 bytes, not 4 | `JsonTextLengthSpec` | the string, nested and engine-row equality cases |
| M14 | the payload byte cap measured in characters, not UTF-8 bytes | `NodePayloadHistoryWriteSpec` | "measure compact-JSON UTF-8 BYTES, not characters" |

Heap-level companion to M11 (`evidence/red-payload-rendered-first-xmx768m.summary.txt`, forked `-Xmx768m`): with the payload rendered before it is
measured, `fewrows-payload-200` (the 200-row long-text shape with a history payload opted in) peaks at 361.6 MB in one of two repeats (97.7 MB in the
other; swing 264 MB); with the measure-first code it is 96.9 MB in all three repeats.
