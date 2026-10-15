## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md (uncommitted; worktree HEAD 519f06d5fca8783c2c5d7637386038e7a2b8c292).
I ran no probes that write anything. This report is the only file I wrote.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/mock-unmocked-test-network-calls/HEL-1600`.
- **Baseline inventory, re-checked:** `baseline-aggregate-by-file.txt` has 22 lines that sum to 342 (`awk` sum). This matches the design's Context section.
- **Parked-lane overlap, re-derived:** I ran `git diff --name-only $(git merge-base main B) B` for each of the HEL-1575/1578/1579 branches.
  - Exactly 8 of the 22 baseline files are on a parked branch: App, AppShell.rail, CommandPalette, PanelList, PipelineDetailPage, .creatingStep, .draftCreate and .stepsError.
  - None of the three branches touches `jest.setup.ts`, `jest.config.cjs` or `MISTAKES.md`, so the guard wiring will not conflict with them.
  - Parked branches also edit some files outside the baseline: DataGrid, CommandBar, ShareDialogFocusRestore, DashboardList and createPlacement. The new Decision 2 rule covers these if the guard flags them.
- **Setup wiring is feasible:** `frontend/jest.config.cjs` has `testEnvironment: "jsdom"` and `setupFilesAfterEnv: [src/test/jest.setup.ts]`, so `afterEach`/`afterAll` registered from the setup file run in every suite. No `@jest-environment node` file exists under `frontend/src`.
- **Round-1 CR1 (settlement):** addressed.
  - Decision 2 now fixes the mechanism as dispatching `ProgressEvent("error")`. It explicitly forbids `this.abort()` and cites the probe.
  - Decision 4(b) and task 3.1 require the self-test to assert that the `httpClient` promise rejects with a network error. A hang now fails the self-test.
- **Round-1 CR2 (files outside the baseline):** addressed.
  - Decision 2 makes the guard-on full run (task 2.1) the inventory of record.
  - The rule is stated: an editable file gets the Decision 1 fix, and a parked-branch file is allowlisted with its owning ticket. Decision 3 extends the allowlist by the same rule.
  - Task 2.5 implements this, standing constraint C2 records it, and createPlacement is given as the worked example.
  - Residual: the proposal's Impact line still says "14 frontend test files" (see notes).
- **Round-1 CR3 (count):** addressed. Task 2.3 names PanelGrid plus the 5 DesktopPanelGrid files, which is 6, plus PanelContent. Tasks 2.2, 2.3 and 2.4 together cover all 14 editable baseline files:
  - crossFilter
  - PanelGrid
  - the 5 DesktopPanelGrid files
  - PanelContent
  - runHistory
  - identity
  - CreatePipelineModal
  - StepCard
  - StepCard.blurNoRepatch
  - SourcesPage
- **Round-1 CR4 (MISTAKES.md accuracy):** addressed in the binding artifacts.
  - Decision 5 limits the trap to multi-file runs and says a single-file run still prints the console. It requires the entry to state "exactly that scope ... and no more".
  - Task 3.4 says "multi-file runs only", and constraint C1 encodes it.
  - Residual: the proposal's What Changes bullet is still unscoped (see notes).
- **Round-1 non-blocking note (expiry flake):** taken up. The Risks section and task 2.5 require each file to be run 3 times under the guard, with a nonzero send count, before it is pinned.
- **Fresh review:**
  - No TODO, TBD or deferred decisions.
  - AC1 maps to task 2.2.
  - AC2 maps to tasks 2.1–2.5.
  - AC3 maps to Decisions 2–4 and tasks 1.1, 1.2, 3.1 and 3.2: red-first, mutation, expiry and no breakage of unrelated suites.
  - AC4 maps to task 3.3.
  - AC5 is covered by the non-goals and the rejected console-based detection.
  - No production, API or schema change, so `skip_specs` is justified. HEL-1599 does not edit `jest.setup.ts`, and its region of crossFilter is separate from the `jest.mock` block.

### Verdict: CONFIRM

All four round-1 revisions are addressed in design.md and tasks.md, which are the documents the executor follows. The plan is concrete enough to implement unattended. The leftover proposal wording below conflicts with the more specific design text, and the design text clearly controls.

### Non-blocking notes

1. **Two stale lines in proposal.md (fix at archive or in the PR body):**
   - Impact: "14 frontend test files" should be "14 + any the guard-on inventory (task 2.1) flags".
   - What Changes, last bullet: it should say *multi-file* runs, to match Decision 5. If the executor writes the MISTAKES.md entry, it must follow Decision 5 and task 3.4, not this bullet.
2. **Mutation 4(c) and task 3.2 are under-specified on the afterAll path.** "Remove the afterEach throw → red-first run goes green" only holds if the mutation removes the throw and *keeps* the clear. If afterEach stops clearing, the afterAll check still catches the violations and the run stays red. The executor should state which mutation was applied. Nothing proves the afterAll-only path; a second mutation (a request fired after the last test) would cover it.
3. Write the allowlist as worktree-relative path suffixes, not basenames. Parked branches add same-family files such as `PipelineDetailPage.*.test.tsx`, and a basename/prefix match could pin the wrong file.
4. Synchronous `dispatchEvent` inside `send` rejects inside the axios promise executor. Round 1 measured this as `ERR_NETWORK`, so it is fine. The self-test in task 3.1 is the regression check for it.
