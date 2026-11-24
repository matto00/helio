## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 71e2802bbc1acb3b59c60291c6f16431fb404165. The change dir is untracked, so I read the artifacts from the working tree: ticket.md, proposal.md, design.md, tasks.md, specs/user-ui-preferences/spec.md, skeptic-design-1.md and skeptic-design-2.md. I checked every claim about the code against the tree.

### What I verified (with evidence)

**Round-2 change requests:**
- **A (D3a vs the AC and the spec): closed by removing the split.** D3a now says "accepted, no split … no request is ever re-sent". The spec says "A failed request SHALL NOT be re-sent". The proposal says failed saves are never re-sent, so the AC "at most one in flight, plus one trailing" holds on every path. Task 2.1 says "D3a: no split". The reasons given are concrete and match the tree:
  - every writer sends values from a closed set;
  - `UserPreferencesRoutes.validate` really is all-or-nothing. It is a single for-comprehension over width, collapsed, typeStyle, density, motion, tabs and assistantModel, and an unknown key is a `Left`.
- **B (split-before-pending ordering): moot.** No split path remains.
- **C (outcome of a trimmed writer group): moot, and the D6 half of it is closed.** D6 now updates the confirmed value only from a `"saved"` outcome's `sent.assistantModel`, never from the caller's own value. D1's outcome type is `{status, sent}`, and callers resolve in queue order. Case (c) and "a superseded caller's saved never records its own value" are named jest cases.
- **D (keepalive classification): closed by D4a.**
  - `!response.ok` and a rejected `fetch` both count as `"failed"`; only `ok` counts as `"saved"`.
  - There is a jest case for a keepalive `400`.
  - There is a mutation: "treat keepalive !ok as saved".
  - Current `tabsPersistence.ts:55` awaits `fetch` without checking `ok`, so this rule is a real change and is needed.
- **Round-2 notes:** outcomes now carry `sent` and resolve in order (D1). Task numbering is fixed (2.1/2.2/2.3). The cross-writer red is described as failing on count and concurrency only (D8).

**Round-1 change requests still closed:**
- D6: sequence number, newest-only rollback, restore the confirmed value.
- D5: the generation rule.
- Red first through existing APIs: D8, C101 and task 1.1.
- Regression scope: tasks 5.2 and 5.3, C102.

**I traced the D6 cases again with the new rule:**
- (a) Sequence X1, Y, X2. X1 fails but is not the newest. The trailing request {X} succeeds, so Y and X2 resolve with `sent` = X and confirmed becomes X. Local and server both hold X.
- (b) X fails and is not the newest. Then Y fails as the newest and the value is restored to P.
- (c) X succeeds and confirmed becomes X. Then Y fails as the newest and the value is restored to X, which is what the server holds.

All three are correct.

**Tree claims:**
- Writers: `grep me/preferences frontend/src` (non-test) finds only `authService.ts:61` (`patchShellPreferencesRequest`), `authService.ts:68` (`patchDashboardTabsRequest`) and `tabsPersistence.ts:55` (keepalive `fetch`). This matches the design table.
- `saveAppearancePreferences` and `saveShellPreferences` call `patchShellPreferencesRequest` and catch the error (`authSlice.ts:176-196`). `saveAssistantModelPreference.ts` captures `previous` and uses the session epoch, as D6 assumes.
- `mergePrefs` exists (`UserPreferenceRepository.scala:155`).
- `registerSessionReset` is exported (`shared/session/sessionReset.ts:40`) and is already used by `useContextListLayout.ts`, `outputFreshness.ts` and `insightChromeStore.ts`.
- `logout` awaits `logoutRequest()` before `clearAuth` (`authSlice.ts:147-158`), as D5 says.
- The CDP throttle precedent exists (`e2e/hel1683-regex-main-thread.spec.ts:229-230`).
- All 7 e2e files in task 5.3 exist. All jest suites named in 5.2 exist:
  - `tabsPersistence.test.ts`, `tabsBrowserTriggers.test.ts`, `AssistantModelSection.test.tsx`, `authSlice.test.ts`, `sessionResetGuard.test.ts`;
  - `signOutReset.{caches,slices,storage}`.
  - `saveAssistantModelPreference` has no test file of its own. It is covered through `AssistantModelSection`, and task 3.2 adds its tests.
- The D8 red is achievable. With Mono held until after Sans and Serif, the unpatched code stores Mono with 3 requests in flight.

**New-defect probe.** I found no new substantive defect. The only issue is leftover wording from the dropped split (first note below). It contradicts D3a in one sentence, but D3a, the spec, the proposal, task 2.1 and a D8 jest case all pin "no re-send". A split implementation would fail that D8 test ("a multi-writer 400 resolves every rider failed with no re-send"), so the contradiction cannot change what gets built.

### Verdict: CONFIRM

### Non-blocking notes
- **Clean up the leftover split wording before or during execution:**
  - design.md D3 ends "A failed request is not retried, except for the D3a split". Drop "except for the D3a split".
  - D5's `reset` "drops … any queued D3a split requests", and an old-generation settle "never splits". Both refer to a mechanism that no longer exists. Remove them.
- Risks has two bullets about unloading during an in-flight request: one paragraph and one "→ accepted, see D4". Merge them.
- D6 does not say what happens to the local value when an assistant-model save resolves `"dropped"`. The existing session-epoch check already covers it, because "dropped" only happens at sign-out, after the epoch bump. One sentence saying so would close the question.
