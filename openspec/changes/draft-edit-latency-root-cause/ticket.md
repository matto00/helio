# HEL-1691: Flaky e2e on main: hel1631-draft-mode.spec.ts:177 edit-latency budget (edit 10 at 97.6 ms vs 50) — fix the measurement or the cost

## Description

origin_kind: followup / origin_ticket: HEL-1631 (observed on main after HEL-1689 merged)

Main push CI run 39560107292 (e88acadb9) is red: e2e (3) failed `hel1631-draft-mode.spec.ts:177`, edit 10 at 97.6 ms
against the 50 ms budget (owner ruling: edit 1 under 100 ms, edits 2–10 under 50 ms). It also failed in HEL-1632's PR run
39504418263. Other runs passed at 24–59 ms, so single spikes push a max-based assertion over.

The same family as HEL-1632's `hel1632-live-output.spec.ts:259` (PR #1075, parked). Its lane suspects the measurement:
a MutationObserver scope, and a max instead of a robust statistic on a shared CI runner.

## Triage

1. Capture a CDP trace on the CI runner for a failing edit. Is the spike app work on the edit path, or runner contention
   (GC, another worker)?
2. If it's app work, fix it.
3. If it's contention, the measurement or budget change is an owner call (for example the median plus a looser max).
   Escalate rather than relax it silently.

No retries.

## Acceptance Criteria

- A root cause backed by a CI trace.
- The test is green on main across 10 CI runs, or the owner has ruled on the measurement.

## Orchestrator-verified observations (premise validation, 2026-10-21)

- Failing main runs (all e2e shard 3) and their per-edit latencies (ms):
  - 39560107292: 37.4, 32.6, 39.3, 21.7, 27.9, 40.6, 40.1, 61.5, 40.4, 97.6
  - 39583908105: 117.8, 78.7, 63.5, 62.1, 76.0, 84.9, 27.5, 31.6, 36.7, 39.5 (edit 1 also over its 100 ms budget;
    five consecutive slow edits — a sustained slow period, not a single spike)
  - 39615405498: 86.6, 50.9, 30.1, 27.8, 29.7, 24.7, 25.1, 25.0, 28.5, 41.0
- CI's e2e job runs the Vite DEV server (React development build, `<React.StrictMode>`), the sbt backend and Postgres on
  one `ubuntu-latest` runner with 2 Playwright workers.
- CI runs only on `pull_request` and main pushes: CI-side evidence requires a (draft) PR.

## Owner ruling (2026-10-21, escalation HEL-1691-1792612629199-452050, answer `prod-build-measurement`)

Root cause (evidence.md): on the CI runner the React DEVELOPMENT build's steady edit costs ~40-50 ms of main-thread CPU
(~60% React dev runtime), at the 50 ms budget; the production build is ~2.3x cheaper. Ruling and scope:

- Run the draft-edit latency assertion (`hel1631-draft-mode.spec.ts` burst test, line 177 on main) against a production build (`vite build` +
  `vite preview`) in CI, budget unchanged (edit 1 < 100 ms, edits 2-10 < 50 ms).
- Design it so other latency specs can opt in (HEL-1632's `hel1632-live-output.spec.ts:259`, PR #1075, must be able to
  use the same harness when it resumes; #1075's branch is not edited here).
- Keep the D1 breakdown; remove the D2 trace capture or keep it behind its default-off switch.
- CI cost: e2e shards are at 24-25 min against a 25 min timeout (HEL-1667 parked). If a prod build adds meaningful
  minutes to a shard, escalate rather than raise timeouts.

## Acceptance Criteria (revised)

- Root cause backed by a CI trace (done: evidence.md).
- The opted-in latency assertion runs in CI against a production build, budget and assertions unchanged, and is green
  on the PR's CI; no e2e shard's duration grows meaningfully (escalate otherwise).
- A second spec can opt in by a tag alone, proven by a check that fails when a tagged test would run on the dev server
  in CI or an untagged test would run in the prod-build job.
- AC2: 10 green main runs — watched by the driver after merge.
