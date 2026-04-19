Spawn the `linear-orchestrator` agent to drive the end-to-end Helio ticket
delivery workflow for the Linear ticket referenced in `ARGUMENTS`.

**Use this workflow** any time a Linear ticket identifier is referenced and
the goal is to implement it end-to-end.

---

## Arguments

`ARGUMENTS` contains a Linear ticket ID (e.g. `HEL-26`). Extract it.

---

## What to do

Make a single `Agent` call with `subagent_type: linear-orchestrator`. Prompt:

> TICKET_ID=`<extracted-id>`. Run the full Helio ticket delivery workflow
> end-to-end: Setup → Planning → Execution/Evaluation loop → Delivery →
> Post-merge cleanup. Surface any `ESCALATION`, `BLOCKER`, or final PR
> presentation back to me so I can relay to the human.

When the orchestrator returns:

- Relay any `ESCALATION` or `BLOCKER` to the human and collect their answer.
- If the orchestrator pauses awaiting human input (e.g. after PR creation,
  before Phase 4 cleanup), wait for the human's "merged" confirmation and
  then **SendMessage** the same orchestrator agent to continue — do not
  re-spawn. The orchestrator keeps state in
  `openspec/changes/<CHANGE_NAME>/workflow-state.md` and can resume from any
  phase.

Do not implement, plan, or evaluate yourself — that is the orchestrator's
job. Your role here is the seam between the user and the orchestrator agent.
