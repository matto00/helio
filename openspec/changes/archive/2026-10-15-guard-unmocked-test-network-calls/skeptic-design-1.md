## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md (uncommitted, worktree HEAD 519f06d5fca8783c2c5d7637386038e7a2b8c292).
Probes ran with scratch jest configs outside the worktree (scratchpad), so no worktree file changed. I wrote only this report.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/mock-unmocked-test-network-calls/HEL-1600`.
- **Baseline inventory claim (342 across 22 files):** `.concertino/runs/HEL-1600/evidence/baseline-aggregate-by-file.txt`
  has 22 lines. The counts add up to 342, so the claim holds.
- **Parked-lane overlap claim (8 of 22):** for each branch I ran `git diff --name-only $(git merge-base main B) B`. The 22 files
  that also appear on HEL-1575/1578/1579 are exactly App, AppShell.rail, CommandPalette, PanelList, PipelineDetailPage,
  .creatingStep, .draftCreate and .stepsError. Confirmed. HEL-1599's worktree has only
  `?? frontend/src/test/settleChartMount.ts` plus its change dir, and no `jest.setup.ts` edit. Consistent with the claim.
- **14 editable files:** 22 − 8 = 14. These are PanelGrid, the 5 DesktopPanelGrid.*, PanelContent, PanelCard.crossFilter,
  runHistory, identity, CreatePipelineModal, StepCard, StepCard.blurNoRepatch and SourcesPage. Every one appears in a task
  (2.2/2.3/2.4). Count correct, but see CR3.
- **Guard enforcement mechanics (jest 30.3.0, jsdom 26.1.0, axios 1.20.0):** I ran a scratch setup file that wraps
  `XMLHttpRequest.prototype.open/send`.
  - Throwing in `afterEach` fails the test that issued the request: `● issues xhr  unmocked: GET /api/z`.
  - Throwing in `afterAll` fails the file: `● Test suite failed to run  afterAll violation`. Decision 2's enforcement
    path works.
  - `typeof fetch` is `undefined` in this jest-environment-jsdom, so the conditional fetch wrap is a no-op. That is
    harmless.
- **Settlement mechanism (Decision 2: "`this.abort()` or a dispatched `error` event, executor's choice"):** I raced an
  axios xhr-adapter GET against a 500 ms timer.
  - `send` replaced by `this.abort()` → **`abort: HUNG`**. The request never settles: before the real `send` runs, the
    send() flag is unset, so `abort()` fires no events.
  - `send` replaced by `dispatchEvent(new ProgressEvent("error"))` → `rejected:ERR_NETWORK:Network Error`.
  - So one of the two options the design offers produces exactly the hang the design forbids, and the planned self-test
    does not assert settlement. See CR1.
- **Is the inventory complete?** I added a probe setup that logs the method and URL of each `open` (real jest config
  spread):
  - Seven files ran: createPlacement, DashboardList, CommandBar, ShareDialogFocusRestore, DataGrid, PanelCard.crossFilter
    and StepCard. A PanelGrid.unmountFlush path was also passed, but that file exists only on HEL-1575's branch, so it did
    not run.
  - Only crossFilter (`GET /api/outputs/output-1/history`) and StepCard (`GET /api/data-sources`) opened an XHR. Both are
    in the inventory.
  - The counts are timing-sensitive, though. With 3 workers, crossFilter opened 1 request in one run and 2 in two others.
    One AggregateError-count measurement over the same 3 files gave 5 in one run and 3 in the next. AggregateError counting
    is not a reliable inventory, and the guard (which counts opens/sends) may flag files the baseline missed. See CR2.
  - Observed URLs: AppShell.rail → `GET /api/connectors`; PanelList → `GET /api/data-sources`, `GET /api/pipelines`.
- **Agent-mode reporter claim:** the claim is only partly reproduced.
  - With `CLAUDECODE=1 AI_AGENT=...` set, a **single-file** plain run of PanelCard.crossFilter printed
    `console.error Error: AggregateError` twice.
  - A plain **3-file** run printed 0, while the same 3 files under `env -u CLAUDECODE -u AI_AGENT --reporters=default` printed 3–5.
  - So console output is hidden only in multi-file runs. See CR4.
- **AC coverage:**
  - AC1 → task 2.2.
  - AC2 → tasks 2.1–2.4 (gap: CR2).
  - AC3 → Decisions 2–4 and tasks 1.1, 1.2, 3.1, 3.2.
  - AC4 → task 3.3.
  - AC5 → the non-goals rule out console filtering, and the guard throws instead of suppressing.
  - No TODO/TBD placeholders. No production code or contract change, so no API/schema delta is needed (`skip_specs` is
    justified).

### Verdict: REFUTE

The plan is sound in shape. Guard-plus-seam-mocks is the right call, and its enforcement mechanics are proven to work in
this jest version. It has one probe-proven trap and one unhandled inventory case that an unattended executor would have
to resolve by guessing.

### Change Requests

1. **design.md Decision 2 / tasks.md 3.1: remove `this.abort()` as a settlement option and make the self-test assert
   settlement.**
   - Measured: a wrapped `send` that calls `this.abort()` leaves the axios promise pending forever (`abort: HUNG`).
     Dispatching a `ProgressEvent("error")` rejects with `ERR_NETWORK`.
   - Pin the mechanism: dispatch `error` (and `loadend` if needed), or another mechanism proven to settle.
   - Task 3.1's self-test must `await expect(httpClient.get(...)).rejects` (e.g. `code: "ERR_NETWORK"`) inside the test.
     Recording the violation and the absence of a socket is not enough. A hang would pass the planned self-test silently
     and turn unmocked calls into stuck thunks across the suite.
2. **design.md Decision 3 / tasks.md: state what happens when the guard flags a file outside the 22-file baseline.**
   - The baseline is an AggregateError count, which is timing-sensitive (measured above) and undercounts requests that
     are still pending at teardown. The guard counts every send.
   - Task 3.3 can therefore go red on files nobody planned for, including files owned by parked lanes outside "the 8"
     (e.g. `PipelineDetailPage.createPlacement.test.tsx` for HEL-1579, `DashboardList.test.tsx` for HEL-1575,
     `CommandBar.test.tsx` for HEL-1578/1579).
   - Decision 3 currently fixes the allowlist at "the 8 files above". Add an explicit rule:
     - A newly flagged editable file gets the same service-seam fix.
     - A newly flagged parked-lane file goes on the allowlist with its owning ticket.
     - The guard-on full run (task 3.3, or an earlier guard-on full run) is the inventory of record.
   - Proposal/Impact's "14 frontend test files" becomes "14 + any found by the guard run".
3. **tasks.md 2.3: fix the count.** "the PanelGrid / DesktopPanelGrid files (5)" covers 6 files: PanelGrid plus
   DesktopPanelGrid.layoutCommit, .inflightResponse, .placementVersion, .layoutPatch and .layoutConflict. Name them, so
   no file is skipped without anyone noticing.
4. **proposal.md / tasks.md 3.4: make the MISTAKES.md entry accurate.**
   - Measured under `CLAUDECODE=1`/`AI_AGENT` set: a single-file jest run still prints the AggregateError; only
     multi-file runs drop passing suites' console output.
   - The entry should say exactly that. "Zero in the log" means nothing for a multi-file run unless it used
     `env -u CLAUDECODE -u AI_AGENT ... --reporters=default`.
   - An overstated trap entry is itself a MISTAKES.md defect.

### Non-blocking notes

- Risk 4's rationale ("clean only in some orderings") points at the wrong cause. The variance is timing within a file:
  crossFilter opened 1 vs 2 requests across runs at 3 workers. For allowlisted files with a single request
  (AppShell.rail: 1 `GET /api/connectors`), the zero-request expiry could flake under load. Consider having task 3.2/3.3
  run the allowlisted files twice and confirm a non-zero count each time.
- Parked lanes add many new test files (e.g. the HEL-1578 home/*, HEL-1575 tabs/*, HEL-1579 spine tests). When they
  rebase onto this guard, any unmocked call will turn their CI red. The design accepts this (Risk 1). The follow-up/drain
  ticket should mention it so those lanes aren't surprised.
- The ticket's `/api/output...` URL never showed up in any probe. crossFilter only opened
  `GET /api/outputs/output-1/history`, twice. Task 2.1's instrumentation should confirm which URL is real before mocking.
