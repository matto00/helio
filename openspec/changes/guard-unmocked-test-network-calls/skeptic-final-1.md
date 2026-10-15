## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 4288129ae1224f69f832a62766cd9bbef6be17f1. Base resolved live via `resolve-review-base.sh` (exit 0): 519f06d5fca8783c2c5d7637386038e7a2b8c292.
cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/mock-unmocked-test-network-calls/HEL-1600`.

### What I verified (with evidence)

- **Diff shape.** `git diff --stat base...HEAD` shows 55 files, 1465 insertions. `git diff --numstat | awk '$2!=0'` prints nothing, so there are **zero deleted lines anywhere**. No existing assertion, fixture or expectation changed. The 30 edited test files each only gain `jest.mock(<service>, () => ({ ...jest.requireActual(...), fn: jest.fn(() => Promise.reject(...)) }))` blocks.
- **Seam.** Every added stub is a service-module function: outputService getOutputById/getAssertionStatus/getOutputRows/listOutputs/getFilterCapabilities/listOutputPanels, outputHistoryService.fetchOutputHistory, dataSourceService.fetchSources, connectorService.listConnectors and connectorEntityService.fetchConnectors. Each uses a requireActual spread, matching the HEL-1353 precedent. No file mocks the same module path twice (I scanned every edited file for duplicate `jest.mock("...")`).
- **No console silencing.** I grepped the added lines for `console`. The only hits are the guard self-test, which spies on `console.error` to assert it was **not** called, and doc comments.
- **AC1 (crossFilter).** Scratch mutation: I removed the crossFilter `jest.mock` block and ran the file alone. Exit 1, `Tests: 2 failed, 5 passed`. The guard named `GET /api/outputs/output-1/history` for both metric-describe tests and printed no AggregateError. I restored the file and `cmp` confirmed it byte-identical. With the mock present, the file passes in the full runs below.
- **XHR path enforces.** A scratch probe test (deleted afterwards) issued a raw `XMLHttpRequest` GET. It failed in `afterEach` with `Unmocked network request(s) ... GET /api/zz-xhr`.
- **fetch path.** The same probe printed `FETCH TYPE undefined`: jest-environment-jsdom defines no `fetch`, so `installFetchGuard` is a no-op here, exactly as design.md Decision 2 says ("only if jsdom defines it"). Without a global `fetch`, an unmocked app `fetch` call throws a ReferenceError and opens no socket. The wrapper is dormant code, not a gap (see note 1).
- **Allowlist expiry.** Scratch mutation: I added the clean `PanelCard.crossFilter.test.tsx` to `NETWORK_ALLOWLIST` and ran it. Exit 1 with `... is on the networkGuard allowlist (HEL-0000) but made no network request: remove it from NETWORK_ALLOWLIST`. I restored it with `git checkout`, and `git status` shows only the evaluator's untracked evaluation-2.md.
- **AC4: full suite, local caps.** Command: `env -u CLAUDECODE -u AI_AGENT nice -n 19 npx jest --maxWorkers=3 --reporters=default` from the worktree's `frontend/`.
  - Exit 0, `Test Suites: 612 passed, 612 total`, `Tests: 7268 passed, 7268 total`, with 1161 lines under `/HEL-1600/frontend/`.
  - I attributed the 245 AggregateError lines to the preceding PASS header. All are in allowlisted files: PipelineDetailPage 130, CommandPalette 57, App 23, stepsError 14, draftCreate 12, creatingStep 4, PanelList 2, reorderGuard 2, AppShell.rail 1. No other file has any.
  - The stub reject messages ("unmocked request stubbed") appear 0 times in the log, so the stubs do not just move the noise somewhere else.
- **CI behaviour.** I ran the same command with `CI=true` (the local caps are dropped; workers held at 3 per the resource rule). Exit 0, 612/612 suites, 7268/7268 tests, 0 guard messages.
  - AggregateErrors appeared only in allowlisted files. reorderGuard logged 0 this time but still passed the expiry check, which shows the guard counts requests sent, not log lines.
  - In two full runs plus the evaluator's three allowlist runs, no non-allowlisted file produced a false failure.
- **Parked/concurrent lanes.** For every local and remote branch of HEL-1572/1575/1576/1578/1579/1583/1599/1606, `git diff --name-only $(git merge-base main B) B` intersected with this change's file list is empty.
- **Gates.** `npm run lint` exit 0, `npm run typecheck` exit 0, `npm run format:check` clean, and `prettier --check MISTAKES.md` clean.
- **MISTAKES.md entry.** It is scoped to multi-file runs, as Decision 5 requires.
- **AC3.** The guard was proven red-first (my crossFilter mutation reproduces it). It breaks no unrelated suite (two full runs green), and its exceptions expire (my allowlist mutation reproduces that).
- **AC2.** The inventory of record covers it: 40 flagged files, 30 fixed and 10 allowlisted. Every non-allowlisted file passes under the guard, which is itself the proof that none of them makes an unmocked XHR.
- **Evidence-mtime gate defect check.** Not applicable. Neither report discloses unsound mtimes, and this verdict rests on no mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
1. `installFetchGuard` never activates under jsdom, because there is no global `fetch`. The module docblock says the guard wraps `fetch` "when the environment defines it", which is accurate, but nothing exercises that branch. If a later setup adds a global `fetch` polyfill, add a self-test for the fetch path at the same time.
2. HEL-1583 adds new test files (`PanelList.phoneShell.test.tsx`, `DashboardChipRow.test.tsx`) that have never run under the guard. If they reach unmocked services, they go red when that lane rebases onto this change. That is intended per design.md Risks, and the PR body should say so.
3. design.md Decision 1 says stubs resolve "usually empty/null", but the implementation rejects with a plain Error. That keeps the tests' prior failure mode (a network error) and so does not change what they assert. It is a reasonable deviation, but design.md wording drifts from the code.
4. HEL-1599's uncommitted edits sit next to the mock blocks in three files (see evaluation-2.md). Whichever lane merges second should re-run the guard.
