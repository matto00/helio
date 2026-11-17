# HEL-1729 probe evidence

## D0.1 CI artifact (recovered, not expired)
PR #1129 CI run 43982387385, attempt 1, shard e2e(1), artifact playwright-report-shard-1 (trace.zip for
"History view ... (dark)"). History responses in the trace:
- 23:59:58.714Z GET history (spec's own API check): 3 points, all `manual` (23:59:57.53, 23:59:58.00, 23:59:58.68).
- 00:00:03.496Z/.649Z GET history (the History dialog's fetch): 4 points; the 4th is
  `capturedAt 2026-11-17T00:00:03.664879Z, triggerSource "auto-run", hasPayload false`.
The last PUT rows was at 23:59:58.214Z, so fire_at ~00:00:03.2Z and the tick fired it ~0.5 s later.
So the extra point IS an auto-run point (C1 satisfied: this is the CI failure itself, not just a mechanism repro).
The midnight timing is coincidence: a 6 s test whose dialog fetch landed just after a tick.

## D0.2 UTC-boundary theory ruled out
OutputHistoryRetentionService / thin SQL only DELETEs (every `INSERT`-free; keeps newest 101 points);
bucketing by age never adds a point. No code path is keyed on the UTC day.

## D0.3 forced repro: red-forced-repro.txt (both themes: 4th point `auto-run` after 6.4 s / 19.0 s; slider Expected "2" Received "3")
## Fix verification: green-forced-wait.txt (50 s poll, points stay 3), green-repeat20.txt (80 passed = 20 x 2 tests x 2 themes, --retries=0, 2 workers)
