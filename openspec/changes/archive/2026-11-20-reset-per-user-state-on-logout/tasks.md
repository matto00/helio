## Standing Constraints

- [C1] NEVER read/cat/grep/source/print/copy any .env file (backend/.env, frontend/.env, infra/.env.deploy, etc.), not even to compare, and never copy a directory tree that contains one (cp -a, rsync, hardlinks). No env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Scripts may read scripts/concertino/.concertino.env, but it is never printed.
- [C2] Quoted heredocs only (<<'EOF'), even when the body looks harmless.
- [C3] No pkill/pgrep/killall. Use exact PIDs only. Stop servers with scripts/concertino/stop-servers.sh. Delete e2e test residue by exact id with buildUserDeleteSql. Use plain emails.
- [C4] jest at most 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000. No background run that outlives the tool timeout.
- [C11] Known e2e flakes, matched on test title: hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184 and :217, hel1665-home-phone-stability:437, hel1573-motion-grid-chart:104. Candidates: hel1656-pull-to-refresh:340, hel1573-motion-primitives:272, hel1684-draft-structural:427, hel1668-schema-panel-copy:112. An unlisted CI failure unrelated to the diff gets ONE literal `gh run rerun --job <id>`, named in the PR. If the permission system refuses a command, do not retry or work around it: park and report.
- [C12] Red first, with mutations. Run full spec files. Record and COMMIT the red run before writing implementation code.
- [C13] Scratch goes in /home/matt/Development/helio/.concertino/scratch/HEL-1634/. Anything a follow-up must reference goes in /home/matt/Development/helio/.concertino/runs/HEL-1634/evidence/.
- [C14] Use the lane-private DB `helio_hel1634` (`createdb helio_hel1634`). Pass `DATABASE_URL` to both start-servers.sh and Playwright, and `DB_USER` when the URL has no credentials. Start the backend with `ANTHROPIC_API_KEY` exported empty, so no model call is made. The orchestrator drops the DB at Delivery.
- Do not edit pipeline page components (sibling lane HEL-1661). Frontend only, no migration.

## 1. Inventory and red

- [x] 1.1 Re-run the inventory commands from `/home/matt/Development/helio/.concertino/scratch/HEL-1634/client-state-inventory.md` in the worktree. Re-verify each row as a claim and correct it where it is wrong. Commit the corrected inventory to `openspec/changes/reset-per-user-state-on-logout/client-state-inventory.md` and persist it with `scripts/concertino/persist-evidence.sh HEL-1634 <path>`. Also enumerate by script (commit the command and its output into the same file): every `dispatch(` after an `await` in thunk bodies and listener effects, and every component `.then` continuation that dispatches or writes a cache (D2b). Verify: the file is committed and evidence/client-state-inventory.md exists.
- [x] 1.2 Write the jest tests from design D6, one per RESET row of the inventory: slices, module caches and storage keys. Include every D6 test: late-response tests (every async cache; `fetchPanels`; `auth/updateUserPreferences`; `redeemInviteCodeThunk` keeps B's `currentUser`; the combined-proposal apply), subscriber preservation per cache, the sticky-toast reset, the Home shelf dot and Home summary request tests, and a root-reducer test that every `RootState` key except `SELF_RESETTING_SLICES` resets. Write the guard test (D5, static plus runtime halves). Run the full files red against unmodified code and save the output to the scratch dir. Verify: each new test fails for the stated reason (A's data still served), not for a compile or import error.
- [x] 1.3 Write `e2e/hel1634-logout-user-switch.spec.ts` (D6). Start the servers on the lane DB per C14 and run it red against unmodified code. Include the assertion that B's Home summary request carries none of A's dashboard ids. Verify: it fails on A's data being visible to B, or a request carrying A's id.
- [x] 1.4 Commit the red tests and the red-run transcripts (jest and e2e) before any implementation code. Verify: `git log` shows the red commit first.

## 2. Central reset

- [x] 2.1 Add `shared/session/sessionEpoch.ts` and `shared/session/sessionReset.ts` (D2, D3), with unit tests for hook isolation and idempotent registration. Verify: those tests pass.
- [x] 2.2 Wrap the root reducer with D1's `SELF_RESETTING_SLICES` (auth and sourceSamples only; toasts reset). Verify: the root-reducer test from 1.2 passes and every existing slice test still passes.
- [x] 2.3 Add the epoch middleware (D2a), exempting only `auth/rehydrateAuth`, `auth/login`, `auth/register`, `auth/handleOAuthCallback`, `auth/verifyMfa` and `auth/logout`. Add `dispatchIfSameSession` and route every post-await dispatch from 1.1's enumeration through it (D2b). Verify: the late-thunk, preferences, invite-redeem and combined-proposal tests pass, and the logout/login tests still pass.
- [x] 2.4 Register the single `clearAuth` listener (bump epoch, then run resets). Migrate the existing alternative reset paths into the registry (D3): `outputFreshness` with its `onFreshnessReset` subscribers, the warm clear, the tabs `clearAuth` listener and kept drafts, each declaring identifier coverage. Remove the logout thunk's direct `resetOutputFreshness()` and `clearKeptDrafts()` calls, keeping `await awaitWarmClear()`. Verify: existing authSlice, warm and kept-draft tests pass.

## 3. Register every per-user cache and key

- [x] 3.1 Register a production `clearForSessionEnd` hook (D3: clear the data, notify subscribers, keep the subscriber sets; the test-only resets stay as they are) with `covers`, and add the D2c epoch late-load check, for each module cache in the inventory: provenanceCache, outputHistoryCache, useSavedOutputRows, filterCapabilitiesStore, insightChromeStore, metricComparisonStore, usePipelineOwnership, the useContextListLayout pending write timer, and any others 1.1 finds. Verify: the per-cache and subscriber-preservation tests from 1.2 pass.
- [x] 3.2 Clear `helio.recentVisits`, `helio.dashboardSeen` and `sessionStorage` `helio.refinement.conversationId.*` on sign-out (D4). For the two stores that keep an in-memory snapshot, clear and notify that snapshot too. Verify: the storage, Home shelf dot and Home summary request tests pass.
- [x] 3.3 Add `shared/session/sessionStateAllowlist.ts` (D5): the four lists, a reason per entry, and per-identifier accounting covering all the declaration shapes D5 lists. Make the guard pass. Prove it red with three mutations, each named in the failure: an unregistered `new Map()` in a new file, an unlisted `localStorage.setItem` key, and a second unregistered Map in provenanceCache.ts. Revert all three. Verify: the mutation transcripts are saved to the scratch dir and the guard is green on the real tree.

## 4. Verification

- [x] 4.1 Run the e2e from 1.3 green twice in a row on the lane DB, plus the existing logout-related e2e files (`hel1575-dashboard-tabs-warm-and-palette.spec.ts`, `hel1783-shared-dashboard-tabs.spec.ts`, `auth-cookie-migration.spec.ts`), as full spec files. Verify: all green, with transcripts saved.
- [x] 4.2 Run the full frontend jest suite (3 workers), lint, typecheck and format:check. Verify: all pass.
- [x] 4.3 Delete the e2e users by exact id. Verify: a residue query returns zero rows.

## 5. Design-gate round-2 notes (address in the tasks above)

- [x] 5.1 Mark the lifecycle dispatches as exempt from `dispatchIfSameSession` in the enumeration: `logout`'s `clearAuth` and `rehydrateAuth`'s `setAuth`/`clearAuth` (D2a reasoning). Make the guard check that every coverage `via` names a real registered hook or mechanism. State in the guard's header how registered coverage is collected, and name the multi-line object-literal limit. The `helio-appearance` keep reason must say that `useAppearanceState` clears it while signed out. Bump the epoch in the epoch middleware on `clearAuth`, not in a listener. Verify: each item is visible in the code or the guard header.
