## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: f5f47fc01f4361de4ef01dbfd5ffb3929ce365aa. Base: 917c89172c1644a0bc08a4f55ec8bf413633bbff, resolved live with `resolve-review-base.sh` (exit 0). HEAD was unchanged when the review finished.

### What I verified (with evidence)

- **AC1: B is served none of A's data after a same-tab switch. Met.**
  - Root reducer (`frontend/src/store/store.ts`): on `clearAuth`, every slice except `auth` and `sourceSamples` gets `undefined` and so returns to its initial state. Both exceptions have a stated reason. A new slice is covered by default.
  - Epoch middleware (`shared/session/sessionEpochMiddleware.ts`): it is prepended ahead of the listener middleware and bumps the epoch on `clearAuth`. It drops a thunk's `fulfilled`/`rejected` action when the thunk started in an earlier session. The exempt list is exactly the six lifecycle thunks from design D2a.
  - One registry (`shared/session/sessionReset.ts`), run by a single `clearAuth` listener. The hooks clear data and keep subscriber sets. I read `outputHistoryCache.ts` and `provenanceCache.ts`: each calls `clearForSessionEnd`, notifies subscribers, and checks the epoch on late load. This closes the generation-reset hole.
  - The logout thunk no longer calls the resets directly. The 401 path reaches the same hooks through `clearAuth`.
- **AC2: recents are cleared on logout. Met.** `recentHistoryStore.clear()` empties the in-memory snapshot, removes `helio.recentVisits` and notifies subscribers. It is registered as the `recentHistory` hook.
- **Gates, run fresh by me:**
  - `jest` on `src/shared/session`, `features/auth`, `panels/history`, `panels/provenance`, `commandPalette` and `useDashboardViewStamp` (3 workers, nice 19): 49 suites and 505 tests passed, exit 0.
  - `npm run typecheck`: exit 0. `npm run lint`: exit 0.
  - Prettier on the changed ts/tsx files: all clean. The one "no files" message is for the deleted `keptDraftListeners.ts`.
  - I did not re-run the full jest suite. The evaluator's pasted transcript (`.concertino/scratch/HEL-1634/eval-jest-full.txt`, 881 suites and 10,392 tests passed) is unambiguous.
- **e2e, run fresh by me:**
  - Setup: `start-servers.sh` on ports 7066/9973 with `DATABASE_URL` pointing at `helio_hel1634`, `DB_USER=matt` and `ANTHROPIC_API_KEY` empty. `assert-phase servers` returned PASS.
  - `npx playwright test e2e/hel1634-logout-user-switch.spec.ts e2e/auth-cookie-migration.spec.ts --workers=2`: 9 passed.
  - I read the full HEL-1634 spec. It asserts:
    - no request URL or body in B's session carries any of A's 5 ids;
    - A's board, panel and value are absent from the DOM;
    - `recentVisits` and `dashboardSeen` hold none of A's ids;
    - no document load happened, checked by both a document-request listener and a window sentinel.
  - Red evidence: `red-run/e2e-red.txt` and `red-run/README.md` are committed in 5baa9da40, before the implementation.
- **Live probe of the rejected-session path (spec scenario 3), my own run in the browser:**
  1. Registered user A, opened A's dashboard.
  2. Ended the session server-side with a raw `POST /api/auth/logout` fetch, which does not dispatch `clearAuth`.
  3. Clicked "Data Pipelines". The 401 interceptor signed the client out and SPA-navigated to `/login`.
  4. Result: localStorage went from {accent, theme, signedIn, dashboardSeen (A's id), onboarding-dismissed-<A id>, appearance, recentVisits (A's id)} to {`helio-accent`, `helio-theme`, `helio-onboarding-dismissed-<A id>`}. The onboarding key is user-keyed and on the keep list. sessionStorage was empty.
  5. The only console error was the expected pre-login 401 on `/api/auth/me`.
  6. I deleted the probe user by exact id with `buildUserDeleteSql`. Residue query `users where email like 'hel1634-%'` returned 0.
- **The guard can fail.** The three committed mutation transcripts each fail and name the identifier or key:
  - `zzGuardMutation.ts#leakedByUser`;
  - `helio.zzUnlistedKey`;
  - a second Map in an already-registered file, `provenanceCache.ts#secondMap`.
  - I did not re-run the mutations myself, because I do not modify code. The transcripts are specific and match the guard's design.
- **UI judgment:** this diff has no visual change (no CSS; the two TSX edits are logic-only epoch gates), so there was no design-language review to do. Device preferences (theme, accent) survive sign-out, which I observed live.

### Judgment on the accepted limit (pipeline page hooks not epoch-gated)

The limit does not block shipping. Reasons:

1. **The server-side window is effectively unreachable.** The ungated sites are:
   - `usePipelinePageLoad` `.then` continuations, which may dispatch `analyzePipeline(id)`;
   - `usePipelineStepStructure:132-136`, which dispatches `fetchOutputs` and `previewOutput` after awaiting `createOutput`;
   - `usePipelineDraftSave:160/169`, which dispatches `draftSaveRunPending`/`Settled`.

   Each fires only if a request of A's was in flight when A signed out. A request fired before B signs in has no cookie, gets a 401, and the interceptor resets again. To name A's id in **B's** session, A's request would have to stay in flight through B's whole login. Even then, the server authorizes by B's cookie, so A's data is never returned (B gets 404, or B's own legitimate grant).
2. **No data of A's is shown to B.** These requests carry ids only. The thunk lifecycle actions of anything A started are dropped by the middleware. `draftSaveRunSettled` is a no-op after the reset, because `runPipelineId` is null and does not match. The only residual state write is `draftSaveRunPending`, landing between two awaits: it puts A's pipeline id and `runStatus: "queued"` into the reset `pipelines` slice. That is an id, not content.
3. **It deviates from the letter of the spec, so it must be tracked.** The scenario "No request after the switch carries the previous user's resource ids" and design D2b ("each one gets the epoch check") are not met for these three hooks. It is a narrow race and is disclosed in the inventory. Fold it in after HEL-1661 merges.

### Verdict: CONFIRM

### Non-blocking notes

- **File a Follow-up ticket (relatedTo HEL-1634)** to epoch-gate the post-await dispatches in `usePipelinePageLoad.ts` (67-77, 142-146), `usePipelineStepStructure.ts:132-136` and `usePipelineDraftSave.ts:160,169`.
- **The sibling-lane justification is only partly accurate.** I checked branch `bug/pipeline-grantee-run-banner/HEL-1661` against origin/main: it modifies `usePipelineDraftSave.ts`, but NOT `usePipelinePageLoad.ts` or `usePipelineStepStructure.ts`. The real basis for deferring those two is the design-time constraint "Do not edit pipeline page components" (tasks.md:12), not file ownership. Say this accurately in the PR body and the follow-up.
- **Evaluator's carry-over notes:**
  - The duplicate test "every cleared key names a registered hook or a known mechanism" (`sessionResetGuard.test.ts:173` and `:184`) should be deleted once.
  - The uncommented casts at `recentVisitsListeners.ts:75-76` should get a comment.
  - `sessionStateAllowlist.ts` is 547 lines; mention it in the PR body.
- **Untracked file:** `evaluation-1.md` is untracked in the worktree (`git status`), so it needs committing at delivery if it is meant to ship with the change dir.
