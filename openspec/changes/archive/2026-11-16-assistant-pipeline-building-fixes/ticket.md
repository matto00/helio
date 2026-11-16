# HEL-1639: Assistant can't build pipelines: ~27 of 43 tool calls failed on "add charts to Standings". Fix the guidance, tool schemas and pipeline reads

## Description

### Evidence (owner, prod, 2026-10-16, claude-haiku-4-5)

Request: "Can you add more charts to my Fantasy Football standings dashboard?" Over 7 user turns the assistant made **about 43 tool calls; about 27 failed, and none of its proposals would have applied.** The owner had to diagnose every round ("you need to create pipelines / outputs…", then pasting apply errors twice). The turn ended with "ran out of tool-call budget".

Condensed transcript, persisted as run evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1639/evidence/.concertino/scratch/driver/evidence/assistant-transcript-2026-10-16-standings.md` (original: `.concertino/scratch/driver/evidence/assistant-transcript-2026-10-16-standings.md` in the main checkout).

**The correct plan, never attempted:** the Standings dashboard (`53bc9bc1…`) has one table panel bound to the Output "Standings Table" (`5b9ce34c…`) of pipeline `d7454492…`. That pipeline already derives `display_name` (a lookup against a Sleeper users source) and `points_for`. The right move is to **add chart Outputs to that existing pipeline**, at the node that has those columns, and bind new panels on the **existing** dashboard. Alternatively, one new pipeline with the same lookup and four Outputs.

### Failure taxonomy (driver's reading of the transcript; verify each against the code before fixing)

1. **Wrong model of panels vs Outputs.** It bound chart panels straight to the existing *table* Output and put `fieldMapping`/`aggregation` on the **panel** (propose_patch_set ×5). An output-kind panel binds `outputId` only; chart shape lives on the Output (see `ProposalPanelSupport.scala` ~300-321). The prompt never establishes: source → pipeline → **Output (kind + fieldMapping)** → panel.
2. **Tool argument shape guessed by trial and error.** propose_patch_set `target.parentId` vs `patch.dashboardId` (3 failures); propose_pipeline root `{sourceId, type:"dataset"}` vs `{sourceId}` (4 failures). The JSON schemas and descriptions don't make the required shape unambiguous, and the error text didn't steer it to the fix quickly enough.
3. **Invented step types and configs.** `"type":"passthrough"` (no such step), `lookup` with an **empty** `config: {}` (accepted at propose time!), `compute` expressions `"record.settings.fpts_decimal"` and `"'settings.fpts_decimal'"` (invented grammar), and `select` naming invented columns (`metadata.team_name`, `display_name` on the raw source). The step-type enum, each step's config schema and the expression grammar with examples aren't in front of the model, or aren't strict.
4. **Couldn't read how the existing pipeline is built.** `get_resource(pipeline d7454492…)` returned `"laneTree": []`. The agent never saw the existing steps and configs. **Check what get_resource returns for a pipeline:** steps with configs plus per-node output schemas are required for this task.
5. **Used an Output as a source.** It passed the Output id `5b9c…` as `roots[].sourceId` (8 failures). It needs an explicit rule that Outputs aren't sources; to build on an Output's data, extend its pipeline.
6. **Wrong tool for "add to an existing dashboard".** propose_dashboard with `dashboardName: "Standings"` re-listed the existing table. It probably proposes a **new** dashboard rather than editing the existing one. Check this, and state in the prompt and tool descriptions which tool edits an existing dashboard.
7. **One pipeline per chart, fanned out 4× before validating one.** Guidance should say to prefer **one pipeline with several Outputs**, or extending the existing one, and to get one proposal valid before fanning out.
8. **Proposals that pass propose but fail apply** (`display_name` missing at the node). That's HEL-1638 (dry-run apply checks); this ticket gives the agent what it needs to get it right the first time.
9. **Search was literal and brittle.** find("Fantasy Football standings dashboard") and find("Fantasy Football") returned 0, while the dashboard is named "Standings". Prompt or tool guidance: short keywords, then a broader listing before asking the user.
10. **Overclaiming.** It said "Perfect! I've created a proposal…" for proposals that couldn't apply, and described the data as having "points_for, team names" when those exist only downstream in the existing pipeline.

## Scope

* **System prompt (pipeline building):** a concise, accurate model of source → steps → node schemas → Outputs (kind + fieldMapping) → panels, plus a decision procedure: inspect the existing pipeline, then extend it or build one pipeline with N Outputs, propose one, check, then add the rest. Include worked examples taken from this transcript, using real step configs. Keep it tight; no bloat.
* **Tool schemas:** strict JSON schemas with `additionalProperties: false`, a step-type **enum**, per-step config schemas (lookup, compute, select, cast, aggregate, …), the expression grammar with 2–3 examples in the compute description, and an unambiguous target shape for patch-set panel creates. Error messages say exactly which field is wrong and the valid alternatives.
* **Reads:** `get_resource(pipeline)` returns ordered steps with configs and each node's output schema (from the symbolic analyze), so the agent can see where a column exists.
* **Tool semantics:** a clear way to add an Output to an existing pipeline and panels to an existing dashboard, and to make sure that's discoverable. Check whether a propose path exists for "add Output to pipeline X at node N"; if not, scope it or file a follow-up.
* **Search:** improve `find` matching (token or partial match), or guide the agent to fall back to listing.

## Acceptance criteria

- [ ] **Replay eval:** this transcript's first request ("add more charts to my Standings dashboard"), run against a fixture workspace that mirrors it (rosters source, users source, the existing lookup pipeline and table Output), produces **one** proposal set that applies cleanly. Target: ≤ 2 failed tool calls and no user correction. Measure the before and after counts on the current prod model.
- [ ] Each taxonomy item 1–7 and 9 has a fix or an explicit "won't fix, because…" in the PR.
- [ ] `get_resource(pipeline)` returns steps and per-node schemas (test).
- [ ] The tool schemas reject `passthrough`, an empty lookup config and an Output id used as a root at the schema or propose layer, with errors naming the valid options (tests).
- [ ] Prompt changes are measured, not vibes: report failed-call rate and calls per successful proposal on a small eval set (this case plus 3–5 others), before and after.

## Ordering

Do this after HEL-1636 (Haiku 5.5 client fix) and HEL-1638 (dry-run apply checks), and run the eval on whichever model prod is on then. HEL-1637 (a failure-based budget) and HEL-721 (streaming) are related, but this ticket doesn't depend on them. (Orchestrator note: both are still Backlog at dispatch; prod is on claude-haiku-4-5-20251001, so HEL-1636 does not affect the eval. Driver dispatched explicitly; HEL-1638/1636 are not folded in.)
