# HEL-1325: SparkJobSubmitterSpec: replace fixed sleeps with a poll on the run record

## Description

origin_kind: followup
origin_ticket: HEL-1287

`SparkJobSubmitterSpec` uses two fixed `Thread.sleep(3000)` calls. HEL-1287 replaced them with a poll on
`pipelines.lastRunStatus`, but its final review found a race and the owner had it reverted.
`SparkJobSubmitter.scala` writes `pipelineRepo.updateLastRunInternal` *before*
`pipelineRunRepo.updateRunTerminalInternal`, so a poll can return early while the run row still says `Running`.

## Acceptance Criteria

* Poll the run record itself, for example `listByPipeline` reaching a terminal status, with a bounded timeout.
  Leave the assertions unchanged.
* Prove it with a mutation that fails the old `lastRunStatus` poll and passes the new one, for example a delay
  inserted between the two writes.
* Report the fork time saved, which is about 6 s.

## Driver constraints (this run)

* Test-only change: no product code changes. If the write order itself looks wrong, note it as a follow-up.
* Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`.
