## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: f5f47fc01f4361de4ef01dbfd5ffb3929ce365aa. Base: 917c89172c1644a0bc08a4f55ec8bf413633bbff (resolved live with resolve-review-base.sh).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (A logs out, B logs in without a reload, no cache or slice serves A's data, with a test per cache) is met:
  - Root-reducer reset (D1) is in `store.ts`. `SELF_RESETTING_SLICES` holds only `auth` and `sourceSamples`, and toasts reset.
  - The single registry (D3) is `shared/session/sessionReset.ts`, run by one `clearAuth` listener.
  - The session epoch (D2) is bumped in the middleware. The exempt list matches design D2a exactly.
  - The per-cache jest tests are in `signOutReset.caches.test.tsx`, the per-slice and late-response tests in `signOutReset.slices.test.ts`, and the storage, Home dot and Home summary tests in `signOutReset.storage.test.tsx`.
- AC2 (recents keyed by user, or cleared on logout) is met. `helio.recentVisits` is cleared, and so is its in-memory snapshot.
- The driver scope additions are met:
  - The inventory is committed and persisted to `.concertino/runs/HEL-1634/evidence/client-state-inventory.md`.
  - The guard has a static half and a runtime half. The keep allowlist gives a reason for every entry, and theme and accent survive.
  - The e2e ran red first: commit 5baa9da40 precedes the implementation, and `red-run/e2e-red.txt` shows A's ids in B's requests.
  - The change is frontend-only.
- Tasks 1.1 to 5.1 are all marked done and match the code. Task 5.1 items checked:
  - The epoch is bumped in the middleware.
  - The guard header states how coverage is collected and names the multi-line literal limit.
  - The `via` check exists.
  - The `helio-appearance` reason is present.
- Constraints are honoured:
  - C12: the red commit came first.
  - C14: the lane DB was used.
  - The sibling-lane rule holds: no pipeline page component was edited. `useSavedOutputRows.ts` and `keptDraft.ts` are a hook-level cache and a state module, not page components.

### Phase 2: Code Review — PASS
Gates, run fresh by the evaluator in WORKTREE_PATH:
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- Root `jest`: 70 suites and 617 tests passed.
- `npm --prefix frontend test` (3 workers, nice 19): 881 suites and 10,392 tests passed. Transcript: `.concertino/scratch/HEL-1634/eval-jest-full.txt`.
- `npm --prefix frontend run build`: exit 0.

Review notes:
- The generation-reset hole is closed. `loadHistory` and `loadProvenance` now check the epoch as well as the generation. The production hooks (`clearForSessionEnd`) notify subscribers and keep the subscriber sets, as D3 requires. The test-only seams are unchanged.
- The declared-coverage mechanisms are real:
  - `clearWarmState` clears `lists`, `ownWrites`, `fetchStarts` and the restore markers, and calls `resetServerClock()`.
  - The `clearAuth` listener in `dashboardTabsListeners.ts` resets `hydratingFor` and calls `cancelTabsWrite`.
- The `(… as { status: string })` casts at `recentVisitsListeners.ts:75-76` are required. I probed this in a throwaway detached worktree (since removed): without them `tsc` fails with TS2339. The wrapped root reducer means a generic `RootState[K]` index no longer resolves `.status`. The casts are a narrow widening, but they carry no comment (see suggestions).
- No security, error-handling or dead-code problems in the source. Hook exceptions are isolated per hook.

### Phase 3: UI Review — PASS
- Servers were started with `start-servers.sh` on `helio_hel1634` (`ANTHROPIC_API_KEY` empty) and stopped with `stop-servers.sh`.
- Evaluator e2e runs (full spec files, 2 workers):
  - Run 1: `hel1634-logout-user-switch.spec.ts` plus `auth-cookie-migration.spec.ts`, 9 passed (`.concertino/scratch/HEL-1634/eval-e2e-1.txt`).
  - Run 2: `hel1575-dashboard-tabs-warm-and-palette.spec.ts`, `hel1783-shared-dashboard-tabs.spec.ts` and `hel1634-logout-user-switch.spec.ts`, 16 passed (`eval-e2e-2.txt`).
- Manual browser probe: register, sign out, land on `/login`.
  - No console error during sign-out. The only error was the expected 401 on `/api/auth/me` before login.
  - Browser storage after sign-out held only `helio-theme` and `helio-accent`.
  - The probe user was deleted by exact id with `buildUserDeleteSql`. The residue query for `hel1634-%` users returns 0.
- No visual or layout changes in this diff, so the breakpoint check does not apply.

### Overall: PASS

### Non-blocking Suggestions
- `frontend/src/shared/session/sessionResetGuard.test.ts:173` and `:184` are two identical copies of the test "every cleared key names a registered hook or a known mechanism". Delete one.
- `frontend/src/features/commandPalette/state/recentVisitsListeners.ts:75-76`: add a one-line comment saying why the cast is needed (the wrapped root reducer's generic indexed access), or type `registerPruneListener`'s state parameter so that no cast is needed.
- `frontend/src/shared/session/sessionStateAllowlist.ts` is 547 lines, over CONTRIBUTING's ~400-line threshold for proposing a split. It is a data list, so a split is optional. Mention it in the PR body as CONTRIBUTING asks.
- Accepted limit to track in a follow-up ticket once HEL-1661 merges. The inventory lists pipeline page continuations that are not epoch-gated: `usePipelineStepStructure.ts:126-136` dispatches `fetchOutputs({pipelineId})` and `previewOutput` after awaits, and `usePipelineDraftSave.ts:160-169` dispatches `draftSaveRun*`.
  - The thunk lifecycle actions are dropped by the middleware. A request started after the epoch bump would still be sent with A's pipeline id during B's session (narrow race, 404 for B), and `draftSaveRun*` would write A's pipeline id into B's `pipelines` slice.
  - The "no request carries A's ids" spec scenario cannot be fully met on the pipeline page until these are gated. File it as a Follow-up ticket related to HEL-1634.
