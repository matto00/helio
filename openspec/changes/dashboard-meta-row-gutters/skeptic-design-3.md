## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The change dir is untracked, so I read the artifacts from the working tree. Scope under review: whether group 1 (gutter token, DESIGN.md bullet, content-fit check) and task 3.1 (`useDashboardMeta` with live update, not mounted visibly) can run now, while 2.x, 3.2-3.4 and 5.1 wait for escalation HEL-1576-1792053980784-c95b08.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/dashboard-meta-row-gutters/HEL-1576`.
- **Blocking matches the plan:** workflow-state.md `OPEN_ESCALATION` is still c95b08 with three sub-questions and `blocks: "tasks 2.x, 3.2-3.4, 5.1"`. This agrees with D0 and the BLOCKED markers in tasks.md.
- **Round-2 CR1 (D2 live-update mechanism) is fixed and works against the code.**
  - D2 and task 3.1 now name one path: the hook keeps local summaries filled by the service `getPipelineById`. It reads them on mount, on a change to the feeding set, and on a terminal event. It never touches the pipelines slice, `fetchPipelines` or `fetchPipelineById`.
  - `getPipelineById(id): Promise<PipelineSummary>` exists at `frontend/src/features/pipelines/services/pipelineService.ts:57` and hits `GET /api/pipelines/:id`.
  - That endpoint returns `roots` with `dataSourceName` (`PipelineServiceSupport.scala:206`) plus `lastRun*`, through `PipelineRepository.rowToSummary`.
  - `subscribeToPipelineTerminal` is at `frontend/src/features/panels/services/pipelineRunFanout.ts:117`. It fires on succeeded and failed except on first observation (`:226-233`). D2 says this, and uses the mount read to cover it.
  - Race check (my own probe, not in the artifacts): the backend persists before it publishes. `PipelineRunTerminalWrites.publishTerminalAfter` (`:29-40`) publishes the terminal event only after the durable writes, including the `pipelines.last_run_*` write (`:69`). So a `getPipelineById` triggered by the terminal event reads the new `lastRunAt`, not the old one.
  - The tests in task 3.1, (a) stale-on-mount, (b) terminal event without remount, (c) out-of-order responses per id, (d) unmount, and (e) 403/404, cover the failure modes I raised in round 2.
- **Round-2 CR2 is fixed.**
  - Task 4.3 now lists only D6, D2 copy and the D3 threshold as overnight decisions. It names D1, D4 and D8 explicitly as owner decisions.
  - The Risks bullet now routes placement to the owner (D0, question 1).
- **Round-2 CR3 is fixed.** The spec directory is `specs/dashboard-layout-edit-toggle/`, which matches the proposal's capability name. Its Purpose line distinguishes it from `panel-edit-mode`.
- **Round-2 CR4 is fixed.** The Escape requirement lists every D4 guard (editable element; dialog, popover or menu open; `defaultPrevented`). It also has an "Escape closes an open menu first" scenario.
- **MODIFIED deltas match their archived headers exactly:**
  - "Users can undo and redo layout changes via toolbar buttons" matches `openspec/specs/layout-undo-redo/spec.md:53`.
  - "Undo and redo visibly move the rendered grid" matches `:80`.
  - "Grid layout sizing baseline" matches `openspec/specs/panel-content-sizing/spec.md:75`.
- **Group 1 still holds.** The design and tasks text is unchanged from round 2, which I verified against the code then: one source at `panelGridConfig.ts:34`, the skeleton follows the config, and `--space-3: 0.75rem` with the rem conversion is stated. The delta arithmetic (5·52 + 4·12 = 308) is correct.
- **Round-2 non-blocking notes:**
  - Merge-order (AC1) is now in Risks and in 4.3.
  - Ghost vs secondary is now named in D3 (Edit layout ghost, Share secondary).
  - Not addressed: the empty-`outputId` skip and the form-panel/sources decision (see the notes below).

### Verdict: CONFIRM

Group 1 and task 3.1 are sound to execute now. Neither depends on any of the three escalation answers. The blocked scope is clearly fenced off.

### Non-blocking notes

- D2 / task 3.1 should skip panels whose `outputId` is `""`, the unbound default at `panel.ts:344`. As written, `fetchOutputMeta("")` would issue `GET /api/outputs/` and rely on the failure path to omit it. Add a test case. Raised in round 2 and still open.
- State in D2 that form panels, which bind a dataset by `dataSourceId` rather than through an Output, do not contribute to "sources". Then it is a recorded decision, not an accident. Raised in round 2 and still open.
- Each feeding pipeline costs one `GET /api/pipelines/:id` per dashboard open. A shared/public dashboard viewer would get 401/404 there, and D2 already omits the facts in that case. When 3.2 mounts the hook, confirm it is not mounted on the public route, or accept the extra failed reads knowingly.
