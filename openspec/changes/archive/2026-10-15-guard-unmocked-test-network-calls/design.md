## Context

Baseline (main 519f06d5f, full frontend suite, `env -u CLAUDECODE -u AI_AGENT npx jest --maxWorkers=3
--reporters=default`, 611 suites / 7265 tests pass): 342 `Error: AggregateError` blocks in 22 files. Inventory by file:
`.concertino/runs/HEL-1600/evidence/baseline-aggregate-by-file.txt`. Without the env override, jest 30 detects the agent
environment and prints only the summary, so the same run shows **zero** -- see Decision 5.

All app HTTP goes through one axios instance (`frontend/src/services/httpClient.ts`, XHR adapter in jsdom). No msw,
nock or axios-mock-adapter in the repo. Precedent for the fix: `PipelineDetailPage.createPlacement.test.tsx` (HEL-1353)
mocks only `outputService.listOutputs` with a `requireActual` spread.

Lanes: parked HEL-1575/1578/1579 branches edit 8 of the 22 files (cycle 2 adds HEL-1576's DesktopPanelGrid.processedWidth, found by the guard inventory) (`App.test.tsx`, `AppShell.rail.test.tsx`,
`CommandPalette.test.tsx`, `PanelList.test.tsx`, `PipelineDetailPage.test.tsx`, `.creatingStep`, `.draftCreate`,
`.stepsError`). Concurrent HEL-1599 edits `PanelCard.crossFilter.test.tsx`'s chart-settle helper and adds
`frontend/src/test/settleChartMount.ts`; it does not edit `jest.setup.ts`.

## Goals / Non-Goals

**Goals:** zero real network attempts from the 14 editable files; a guard that keeps it that way for every file not on
the allowlist. **Non-goals:** see proposal.md.

## Decisions

1. **Fix seam: the service module function, per test file.** `jest.mock("<service>", () => ({ ...requireActual,
   fn: jest.fn(...) }))` for exactly the functions the test reaches, resolving to a value that matches what the test
   already expects (usually empty/`null`). Each mock gets a one-line why-comment naming the URL it stood in for.
   Rejected: mocking `httpClient` or axios globally (hides which service a test depends on, and changes every test's
   failure mode at once); a shared msw server (new dependency, out of proportion).
   Identify each call by instrumenting, not by reading: a scratch, uncommitted probe that logs method+URL from
   `XMLHttpRequest.prototype.open` -- the jsdom stack has no URL.

2. **Global guard: yes.** HEL-1353 fixed one file and the class grew to 22 files; only a mechanical check stops
   recurrence. Module `frontend/src/test/networkGuard.ts`, installed from `jest.setup.ts`:
   - Wrap `XMLHttpRequest.prototype.open` to capture method+URL and `send` to record a violation `{method, url,
     testName}` and **not** call the real `send` (no socket). The request must still settle -- never hang -- as an
     ordinary network error: dispatch a `ProgressEvent("error")` on the XHR (axios rejects with `ERR_NETWORK`). Do not
     use `this.abort()`: the design-gate probe showed the axios request never settles after it. Wrap `globalThis.fetch` the same way only if jsdom defines it;
     a test that assigns its own `fetch` mock replaces the wrapper, which is correct.
   - `afterEach`: if violations were recorded, clear them and throw an Error listing each `METHOD URL` and the fix
     ("mock the service function at its module; see networkGuard.ts"). Throwing in `afterEach` fails that test.
   - `afterAll`: same check, for requests that fire after the last test's `afterEach`.
   - Requests fired after jsdom teardown cannot be caught; a request fired late by test N is reported on test N+1 --
     the message carries the URL, which identifies the source.
   - Exported `takeNetworkViolations()` (returns and clears) for the guard's own self-test.
   - **Inventory of record is the guard, not the console.** The baseline counts *logged* AggregateErrors, which vary
     with timing (one file logged 1 vs 2 across runs); the guard counts every request sent. So the full-suite run with
     the guard installed and no allowlist (task 2.1) is the inventory of record. Every file it flags is handled by one
     rule: an editable file gets the Decision 1 fix; a file edited by a parked lane's branch (HEL-1575/1578/1579,
     checked with `git diff --name-only $(git merge-base main <branch>) <branch>`) goes on the allowlist with its
     owning ticket (e.g. `PipelineDetailPage.createPlacement.test.tsx` if flagged -- HEL-1579 edits it).
   Rejected: failing inside `send` by throwing (the axios adapter's promise swallows it, and app code then sees a
   non-AxiosError); console-based detection (agent-mode reporters hide it, and it is exactly "silencing the
   console" in reverse).

3. **Allowlist for parked-lane files, with expiry.** Parked-lane files (the 8 above, plus any the Decision 2 inventory
   adds by the same rule) stay unedited (standing instruction: don't touch
   parked lanes' files). They are listed in `networkGuard.ts`, each with the owning ticket. In an allowlisted file the
   guard passes requests through unchanged (today's behaviour exactly) and does not fail on them, but records them; in
   `afterAll`, an allowlisted file that recorded **zero** requests fails with "remove this file from the allowlist" --
   the pin goes red when it stops matching (MISTAKES.md: "an exception pinned in a guard must be able to expire").
   A standalone follow-up ticket drains the allowlist after those lanes merge.

4. **Proof.** (a) Red-first: commit order puts the guard before the per-file fixes in evidence (not necessarily in
   commits): with the guard installed and fixes absent, run `PanelCard.crossFilter.test.tsx` and one other file -- red,
   naming the URLs; after the fix -- green. Transcripts persisted. (b) Self-test `networkGuard.test.ts`: issue a real
   `httpClient` request with nothing mocked, assert `takeNetworkViolations()` returns its method+URL and that no
   socket was opened (no AggregateError / ECONNREFUSED), and that the `httpClient` promise **rejects** with a network
   error (so a hanging request fails the self-test), then leave nothing pending so `afterEach` passes. (c) Mutation:
   with the `afterEach` throw removed, the red-first run goes green -- proving that line is the enforcement. (d)
   Allowlist expiry: temporarily add a clean file to the allowlist -- red. (e) Full suite green with the guard, plus a
   default-reporter run showing 0 `AggregateError` outside allowlisted files.

5. **Agent-mode reporter trap.** With `CLAUDECODE`/`AI_AGENT` set, a **multi-file** jest 30 run prints only the summary
   (the console output of passing suites is hidden); a single-file run still prints it. Every multi-file console
   measurement here runs with `env -u CLAUDECODE -u AI_AGENT ... --reporters=default`. The `MISTAKES.md` entry states
   exactly that scope -- multi-file runs -- and no more.

## Risks / Trade-offs

- [A concurrent or parked lane adds a new unmocked call in a non-allowlisted file] → its CI goes red with the URL named;
  that is the guard's purpose. The message states the fix.
- [Merge conflict with HEL-1599 in `PanelCard.crossFilter.test.tsx`] → this change touches only the `jest.mock` block
  near the top; HEL-1599 touches the settle helper. Merge resolves textually.
- [A test intentionally relies on a real request failing] → it now fails the guard; mock the service to reject instead
  (that states the intent). No opt-out API is added unless a real case needs it (none known).
- [Allowlist expiry flakes on a file whose request count is timing-dependent] → expiry counts requests *sent* (the
  guard sees them before any socket, so not subject to log timing). Before pinning, run each allowlisted file 3 times
  under the guard; a file that sends zero in any run is not pinned and the case is reported in measurements.md.
- [Parked lanes go red after rebasing onto the guard if their branches add new unmocked calls] → intended; the
  failure names the URL and the fix. Noted in the PR body.

## Planner Notes

- Self-approved scope expansion from 1 file to 14 (+ guard): directed by the delivery brief, test-only, revertible.
- Self-approved allowlist instead of editing parked-lane files: the brief forbids touching them.
