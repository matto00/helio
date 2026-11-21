## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 9c2b5ba8ea1749c1db1b4e61b53ea4ebab09b134 (the change dir is untracked).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/freshness-fact-flake/HEL-1812`.
- I read ticket.md, proposal.md, design.md, tasks.md, .openspec.yaml (`skip_specs: true`), skeptic-design-1.md and
  the premise evidence.
- **Round-1 CR1 (settle signal) is resolved.** design.md D2 now says that no API exposes the debounce state, and that
  "`lastRunStatus` not running/queued" is not a settle signal on its own. It replaces both with one condition: the checked
  pipeline's run history shows the armed auto-run, and that run is terminal, with a bound of about 50 s. tasks.md 3.1
  mirrors this. The pipeline-1 cancellation is now something the probe must confirm, not an assumption.
- **Round-1 CR2 (the ambiguous "compare at the time of the grantee's response" option) is resolved.** It is dropped
  explicitly, and `expectFact` keeps comparing against the owner's live view (C15).
- I checked the H1 premises against the code:
  - A row append to a `static` source arms the auto-run. `DataSourceService.triggerAutoRunAwaited` calls
    `AutoRunTriggerService.triggerAutoRun`, which runs `upsertDebounce(pipelineId, now + debounceSeconds)` for every
    pipeline rooted on that source. No type gate excludes `static`.
  - The settle signal is observable. `GET /api/pipelines/:id/run-history` exists (`PipelineRunHistoryRoutes.scala:18`).
    `PipelineRunRecord` carries `triggerSource: String` (`PipelineProtocol.scala:209`), and
    `TriggerSource.AutoRun = "auto-run"` (`PipelineRunService.scala:386`). The schema enum
    (`pipeline-run-record.schema.json:117-120`, `manual|scheduled|external`) is out of date with the server. The design
    already tells the executor to confirm this.
  - In beforeAll, the violating-row append is the only write before the checked pipeline's runs. The sources are created
    with their rows before the pipelines exist. So exactly one auto-run of the checked pipeline is armed, and a failed
    manual run does not cancel it (HEL-1739). Once that run is terminal, nothing else is pending for the checked pipeline.
  - `playwright.config.ts:191` sets `fullyParallel: false`, so the viewer and editor tests share one beforeAll and run in
    order. The editor test therefore sees whatever the viewer test left armed, and the design covers that through the
    pipeline-1 probe.
- The decision procedure is complete. H1, H2 and H3 each have a confirm signal. H2's probe runs whether or not H1 is
  confirmed (Risks). The H2 branch says to escalate if the HEL-1786 spec does not settle which fact wins, which matches the
  driver constraint. `skip_specs` flips only on H2. The ACs map to tasks: root cause to 1.2/1.3, 20/20 to 3.2, red-first
  to 2.1 and 3.1.
- No placeholders, contradictions or scope drift. The work stays in the frontend and e2e, with no backend or schema change.

### Verdict: CONFIRM

### Non-blocking notes

- **Take the settle baseline in a way that cannot already include the auto-run.** D2 says "record the run count right
  after the blocked manual run; then wait until one MORE run exists". If the count is read after the assertion-status
  poll, a scheduler tick can land between the manual run reaching terminal and the read. The count would then already
  include the auto-run, and the wait would time out: a new flake. The robust form uses the trigger source, which I verified
  is exposed as `"auto-run"`: wait until the history contains a terminal run with `triggerSource === "auto-run"`. A
  relative count is also safe if it is taken before the violating-row append, or right after the run POST returns (the
  debounce cannot become eligible until 5 s after the write). Prefer the trigger-source form.
- beforeAll already has three 30 s polls, and the new wait adds up to about 50 s. Confirm that the hook's effective
  timeout covers the worst case, and say so in the PR. The design's "inside the 90 s test timeout" covers the tests, not
  necessarily the hook.
- Consider updating the `triggerSource` enum in `schemas/pipelines/pipeline-run-record.schema.json` to include
  `auto-run`, or file it as a follow-up. The schema drifts from the server, and this lane is the first consumer to rely on
  that value.
