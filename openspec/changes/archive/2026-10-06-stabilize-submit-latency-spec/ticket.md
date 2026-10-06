# HEL-1344: Flake: DatasetWriteSubmitLatencySpec p50/p95 timing assertion ('25 was not greater than or equal to 31')

## Description

origin_kind: followup
origin_ticket: HEL-1333

During HEL-1333, an executor's `nice -n 19 sbt testFull` failed once in `DatasetWriteSubmitLatencySpec` (p50/p95
timing test): `25 was not greater than or equal to 31`. HEL-1333 doesn't touch that spec. It then passed 3/3 on its
own and didn't fail again. A wall-clock latency assertion inside the unit suite is fragile under contention, the same
class of problem as HEL-1341.

## Acceptance Criteria

* Root-cause it with a probe, and reproduce it under contention.
* Decide whether this latency check belongs in the default suite at all. One option is moving it behind an opt-in like
  HEL-1326's `HELIO_MEASURE=1`.
* Alternatively, make it robust, for example by asserting on counts or ordering rather than raw percentiles. Do not
  just loosen the threshold.
* Show 20 or more green runs under contention.

## Driver constraints (this run)

* Do not loosen the threshold. If removing the check from the default suite would drop coverage of an owner-set
  requirement, escalate.
* Do not touch `.github/workflows/ci.yml`, `frontend/playwright.config.ts`, `.gitignore`.
* `nice -n 19 sbt testFull` with Bash timeout 600000 and at most 2 workers; contention repros use at most 3-4 workers
  in total, load processes killed only by recorded PID. Scratch logs live in the session scratchpad
  (`/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad`), never the change
  dir. Never create/modify anything under `~` outside the repo/worktrees. Never pick deletion targets by pattern.
* Report any `FirstRunRoutesSpec` timeout or "Java heap space" seen during any run.
* At most one CI run at a time.
