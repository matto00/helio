# HEL-1477 measurements: scheduled-fire delay while a retention pass runs

All numbers are from raw logs under `evidence/` (`loop-*.log`, one line per tick or pass, prefixed `@@`). Scratch database
only (`helio_hel1477_scratch` in the container `hel1477-pg`, port 55477), torn down by exact name (`evidence/teardown.log`).

## 1. Result

**Stated bound: a scheduled pipeline fire is delayed by at most one tick interval (30 s by default) plus the tick's own
work, which can include contention from a concurrent pass. Retention's DURATION contributes zero to the tick; its contention
does not (section 3).**

| Metric (S4 deep backlog, `prod-io-base`: 0.5 vCPU, 1.7 GB, 240 MB/s) | main (3 reps) | branch (3 reps) |
|---|---|---|
| Tick wall time, first tick (retention due) | **65.6 s / 60.2 s / 63.1 s** (= the pass) | **44 ms / 37 ms / 37 ms** |
| Tick wall time, idle baseline (retention unwired) | 35-169 ms | 38-162 ms |
| **Fire delay of a schedule that became due 5 s into the first pass** (AC metric) | **90.7 s / 85.5 s / 88.3 s** | **25.2 s / 25.2 s / 25.2 s** |
| Worst fire delay over every fire in the run | 90.7 s | 25.2 s |
| Idle fire delay (retention unwired), same loop | 25.2 s | 25.2 s |
| Tick wall time while a pass is in flight (ticks 2..n) | 14.3-23.7 s (each carries its own pass) | 0.18-4.8 s (median 0.2 s) |
| First-pass wall time | 65.5 / 60.2 / 63.1 s, then 14-23 s | 66.0 / 73.0 / 68.0 s, then 14-22 s (first pass about 5-20% longer while overlapping scheduled runs) |

The bound holds with margin: worst measured delay 25.2 s <= 30 s tick interval + 4.8 s (the slowest tick observed) = 34.8 s,
against 90.7 s on main. The 25.2 s is the tick interval minus the 5 s the schedule was due after the loop started, i.e. exactly the
idle-baseline delay: the branch adds nothing on top of it.

## 2. Method (design D5)

`RetentionTickMeasure` (`backend/src/test/scala/com/helio/services/pipelines/RetentionTickMeasure.scala`, a hand-run driver, not a
spec) builds the REAL `PipelineSchedulerService` and `OutputHistoryRetentionService` (production defaults: 25,000 rows, 500
Outputs, 20 batches, 60 min interval) against the scratch database, with one interval schedule (`20s`) on a trivial static pipeline
that becomes due 5 s after the loop starts. It drives ticks exactly like `PipelineSchedulerActor`: the next tick is armed 30 s
after the previous tick COMPLETES. The clock is the seed anchor plus real elapsed time. Fire delay = (start of the tick that
fired the schedule) - (the schedule's `next_run_at`). The retention service is a subclass that only timestamps each
`purgeIfDue` call. The same driver and seed ran on both code versions; the main runs were taken before any production change.

- Seed: S4 of HEL-1435 (300 Outputs, 5,533,209 history rows, deep backlog, `VACUUM (ANALYZE)` after seeding), reseeded from a
  template clone before every repetition (`evidence/rep.sh`). Seed log: `evidence/seed-S4.log`.
- Host safety: `nice -n 19`, MemAvailable ~52 GB throughout, one container, sbt at `-J-Xmx3g`.
- Premise (task 1.3): on main the tick DOES await the pass (tick 1 = 65.6 s with a 65.5 s pass in the same log), so the design
  stands. Refusal tests for the driver and the seed script: `evidence/refusal-test.txt`, `evidence/seed-refusal-test.txt`.

## 3. What the change costs: contention

Retention still runs, now concurrently with later ticks and the runs they fire, on 0.5 vCPU. Ticks that overlap the heavy first pass
took 0.18-4.8 s (idle 0.1 s) on the branch. The scheduled RUN itself was also slower when it overlapped the first (heaviest) pass:
run durations on the branch were 1.8 s and 3.3 s (r2), 2.5 s and 4.4 s (r3), 0.12 s and 0.10 s (r1), against 0.03-0.25 s on main
(where the first fire only happened after the pass had ended, and later fires overlapped the lighter 14-23 s passes) and 0.03-0.06 s
idle. This is the price of not holding the tick; it is bounded by the pass length (about 70 s here).
The run and tick are delayed by contention, not by waiting for the pass.

## 4. Deviations, labelled

- **Profiles:** `prod-io-base` only. The design listed `desktop` for continuity; it was not run (it needs the pre-change code
  back in the tree for a main comparison, and the prod-class profile is the AC's proxy). No `prod-io-strict`/DIRECT cold run.
- **S2 not seeded or measured:** task 1.2 allowed "S4 (and S2)". Only S4 (the deep backlog, the scenario the ticket cites) was run; S2 is a shallow steady-state seed whose passes are seconds, so it adds no information about a minutes-long stall.
- **Repetitions:** 3 per version on S4, as planned. A first main repetition and a first idle repetition were discarded
  (`*-fire-broken.log`): the driver's JDBC URL lacked `stringtype=unspecified`, so the scheduled run could not be inserted. Their
  tick/pass timings (62.8 s tick, 62.8 s pass) agree with the kept repetitions. The idle baseline is 1 repetition on main and 1 on the branch.
- **Lock-held skips:** none observed. A started pass returned `Some(n)` in every log; the only `None` results are the immediate
  (0-1 ms) returns of a busy or not-due call. Payload-trim contention (a run holding the retention lock shared) did not produce
  a skip in these runs.
- **Run duration (design (e)):** reported in section 3 from `@@RUNDUR`; not a controlled experiment.
- Loop lengths differ (4 ticks on main, 6 on the branch) because the branch passes outlive 4 ticks.

## 5. Why detach rather than a wall-clock budget

A budget "stop starting batches after T seconds" bounds the stall at T + one batch. One batch is data-dependent and cannot be
smaller than one Output: the longest S4 batch is 8.0 s on this profile and 77-172 s under the cold strict-IO model
(HEL-1435 measurements, section 6.2). Detaching removes retention from the tick whatever the data shape or IO model, as section 1
shows, and needs no new setting.
