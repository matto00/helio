## ADDED Requirements

### Requirement: A due schedule whose pipeline has a misconfigured enabled step records a failed run without executing

When a due schedule fires, the scheduler SHALL evaluate the pipeline's enabled steps with the shared schema-independent step-config check (`PipelineAnalyzeService.stepConfigProblem`) before submitting. If any enabled step is misconfigured, the scheduler SHALL NOT submit or execute the run and SHALL NOT consume the pipeline-run rate-limit or concurrency budget. Instead it SHALL persist a failed, never-attempted run with trigger source `scheduled` whose error names the misconfigured step(s), trim the pipeline's run history to the same retention as a normal run, set the pipeline's last-run status to `failed`, and advance the schedule (`next_run_at` recomputed, `last_run_at` set) exactly as for a normal fire. Schema-derived analyze errors SHALL NOT gate a scheduled run. A disabled misconfigured step SHALL NOT gate.

#### Scenario: Pipeline made invalid after its schedule was saved
- **WHEN** a pipeline's schedule is saved while the pipeline is valid, an enabled step is later made misconfigured, and the schedule then becomes due
- **THEN** no run is submitted, a failed run with trigger source `scheduled` and a step-config error is recorded, the owner's rate-limit window count is unchanged, and the schedule's `next_run_at` advances

#### Scenario: Schema-derived analyze error does not gate a scheduled run
- **WHEN** a due schedule's pipeline has no step-config problem but analyze would report a schema-derived error
- **THEN** the run is submitted as before

#### Scenario: Fire-time evaluation fails
- **WHEN** the step-config evaluation for a due schedule fails with an error (including a stored step config that cannot be decoded)
- **THEN** no run is submitted, the error is logged, and the schedule advances to its next fire time, so it is not retried every tick

#### Scenario: Run history stays capped
- **WHEN** a schedule on a misconfigured pipeline fires more than ten times
- **THEN** at most ten runs are retained for that pipeline
