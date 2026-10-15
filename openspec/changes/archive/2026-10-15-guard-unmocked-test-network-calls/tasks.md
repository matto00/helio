## Standing Constraints

- [C1] Every multi-file jest run whose console output is cited as evidence runs as `env -u CLAUDECODE -u AI_AGENT npx jest ... --reporters=default`; a plain multi-file run hides passing suites' console.
- [C2] The full-suite run with the guard installed is the inventory of record for unmocked calls, not the AggregateError log count.

## 1. Frontend -- guard

- [x] 1.1 Add `frontend/src/test/networkGuard.ts` (allowlist keyed by repo-relative path suffix, never basename; XHR + optional fetch wrap, violations, allowlist with owning tickets, afterEach/afterAll checks, `takeNetworkViolations`) and install it from `jest.setup.ts`; verify by tasks 3.1-3.2
- [x] 1.2 Red-first: with the guard installed and no file fixes, run `PanelCard.crossFilter.test.tsx` and `PanelGrid.test.tsx`; verify both fail naming method+URL; persist transcript

## 2. Frontend -- mock the unmocked calls

- [x] 2.1 Full frontend suite with the guard installed and an empty allowlist = inventory of record (method+URL per file); classify each flagged file editable vs parked-lane (git diff against parked branches); persist the inventory
- [x] 2.2 Mock the reached service functions in `PanelCard.crossFilter.test.tsx` (jest.mock block only); verify the file is green under the guard
- [x] 2.3 Same for `PanelGrid.test.tsx`, `DesktopPanelGrid.{layoutCommit,inflightResponse,placementVersion,layoutPatch,layoutConflict}.test.tsx` (6) and `PanelContent.test.tsx`; verify each green under the guard
- [x] 2.4 Same for `PipelineDetailPage.runHistory`, `usePipelineDetailPage.identity`, `CreatePipelineModal`, `StepCard`, `StepCard.blurNoRepatch`, `SourcesPage`; verify each green under the guard
- [x] 2.5 Any other editable file the 2.1 inventory flags gets the same fix; parked-lane files go on the allowlist with owning ticket, each run 3x under the guard to confirm a nonzero send count before pinning

## 3. Tests

- [x] 3.1 Add `frontend/src/test/networkGuard.test.ts` self-test (unmocked httpClient request is recorded with method+URL, no socket, and its promise rejects with a network error); verify it passes
- [x] 3.2 Mutations, each red then restored: remove the afterEach throw but keep its clear (red-first run goes green); remove the afterAll check and show a late request is then missed; allowlist a clean file (expiry fails); persist transcripts
- [x] 3.3 Full frontend suite with the guard (`--maxWorkers=3`, `nice -n 19`): all suites pass; default-reporter run shows 0 AggregateError outside allowlisted files; persist both
- [x] 3.4 Add the agent-mode reporter entry to `MISTAKES.md` (Verification; multi-file runs only); verify `npm run format:check` passes
