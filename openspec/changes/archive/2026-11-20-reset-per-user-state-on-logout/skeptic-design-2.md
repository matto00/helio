## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 917c89172c1644a0bc08a4f55ec8bf413633bbff. The change dir is still untracked, so there is no diff yet.
Files read: ticket.md, proposal.md, design.md, tasks.md, both spec deltas, skeptic-design-1.md, the scratch inventory, and
the code below.

### What I verified (with evidence)

- **Round-1 CR1 (toasts) is resolved.** D1 now resets `toasts`, and `SELF_RESETTING_SLICES` holds only `auth` and
  `sourceSamples`, each with a reason. D6 adds a sticky-toast test. I grepped every `clearAuth` consumer in `frontend/src`.
  Nothing pushes a toast on sign-out that the reset would wipe. httpClient.ts:40-44 dispatches only `clearAuth` and then
  navigates.
- **CR2 (post-await plain dispatches) is resolved in the design.** D2b lists all five named sites and requires a scripted
  enumeration, committed with the inventory, of every post-await dispatch in thunks and listener effects, plus component
  `.then` continuations. Task 2.3 routes each one through `dispatchIfSameSession`. D6 adds late-response tests for
  invite-redeem and for the combined-proposal apply. I confirmed the only other `setAuth` dispatch sites are
  settingsSlice.ts:345 and authSlice.ts:70.
- **CR3 (auth exemption) is resolved.** The exemption is now these six lifecycle thunks: rehydrateAuth, login, register,
  handleOAuthCallback, verifyMfa and logout. All six exist in authSlice.ts:65-149. `updateUserPreferences`,
  `saveShellPreferences` and `saveAppearancePreferences` are gated. That is safe, because only `updateUserPreferences`
  has a reducer (authSlice.ts:350-355), and it is the one that must be dropped. Exempting login and register matters:
  `/api/auth/login` is not excluded by the 401 interceptor (httpClient.ts:40), so a wrong password triggers `clearAuth`
  before `login.rejected`, and `login.rejected` must still land.
- **CR4 (test seams) is resolved.** D3 separates the production `clearForSessionEnd` hooks, which clear data, notify
  subscribers and keep the subscriber sets, from the test-only resets. D6 and task 3.1 add a subscriber-preservation test
  for each cache.
- **CR5 (guard holes) is resolved.**
  - Existing alternative mechanisms migrate to, or declare coverage through, the registry.
  - The cleared-by-hook keys get their own list, and the runtime test asserts they are gone.
  - The scan covers factory singletons, `new X(` and mutable array or object declarations.
  - Accounting is per `file#identifier`.
  - A third mutation (a second Map in provenanceCache.ts) proves the per-identifier accounting can fail.
- **CR6 (dashboardSeen premise) is resolved.** The proposal Impact section, D4 and task 3.2 now name the Home shelf dot and
  the `loadHomeSummary` viewed-ids parameter, and say the tab dot reads server preferences. The e2e asserts that B's Home
  summary request carries none of A's dashboard ids.
- **The root-reducer reset is safe for slices whose initial state reads storage.** I grepped every `createSlice` file
  for storage reads in their initial state and found none (onboardingSlice only mentions localStorage in a comment). A
  slice reset to `undefined` therefore cannot regress a device preference.
- **Store wiring matches the design's premises.** store.ts:31-79 has 23 reducers. The listener middleware is the only
  prepended middleware. The existing `clearAuth` listeners are the warm, tabs and kept-draft listeners, plus the
  signed-in hint listener, which follows auth status.
- **The spec deltas are well formed.** palette-recent-navigation has no existing requirement that recents persist across
  sessions (openspec/specs/palette-recent-navigation/spec.md), so ADDED is correct and does not contradict it. The new
  capability's scenarios cover both ACs and the driver's additions.
- **Every AC is traced to a task.**
  - Per-cache tests: tasks 1.2, 3.1 and 3.2.
  - Recents cleared: task 3.2 and the palette delta.
  - Inventory by script: task 1.1.
  - Central reset and registry: tasks 2.1-2.4.
  - Guard with allowlist and mutations: task 3.3.
  - Device-preference keep list: D5.
  - Red-first e2e: tasks 1.3 and 1.4.
  - Frontend only: stated in the proposal.

### Verdict: CONFIRM

The revision addresses all six round-1 change requests against the code, not only in wording. I found no new load-bearing
false premise, contradiction or uncovered AC. The remaining items are precision nits, none of which blocks implementation.

### Non-blocking notes

1. **D2b should exclude sign-out and lifecycle dispatches from `dispatchIfSameSession`.** Read literally, "every
   post-await dispatch" includes `logout`'s `dispatch(clearAuth())` (authSlice.ts:162) and `rehydrateAuth`'s
   `setAuth`/`clearAuth` (authSlice.ts:70,72). Gating `clearAuth` is meaningless. Gating rehydrate's `setAuth` contradicts
   D2a, which exempts these same thunks for the same reason. The enumeration should mark these sites as exempt.
2. **D3 calls the warm clear and the tabs `clearAuth` listener "migrate[d] into the registry", but its bullets have them
   only declare coverage `via` their existing listener.** Task 2.4 can be read either way. Either is acceptable for the
   AC. Whichever is chosen, the guard should check that each `via` names a real registered hook or mechanism, so a
   coverage declaration cannot point at nothing.
3. **D5 doesn't say how the static guard collects registered coverage.** It can parse the `covers` and
   `declareSessionResetCoverage` calls statically, or import every detected file so its registration runs. A coverage set
   that is accidentally empty would show up as a red guard, not a vacuous pass, and mutation 3 proves the per-identifier
   path works. Still, state the method in the guard.
4. **`helio-appearance` sits in `STORAGE_KEYS_KEPT`, but `useAppearanceState.ts:57` clears it whenever no user is signed
   in.** The runtime test ("kept key unchanged") passes only because no React tree is mounted. The allowlist reason should
   say this, so nobody reads it as "survives sign-out".
5. **Optional robustness choice:** bump the epoch inside the epoch middleware when it sees `clearAuth`, instead of in a
   listener. That puts the bump in one place that cannot depend on listener ordering. The listener approach also works,
   because listener effects start synchronously after the reducer.
6. **The scan's "column-0 declaration of shape X" is line-based.** A multi-line object literal such as
   `const store = {\n  entries: new Map(),\n}` escapes it. This is an accepted limit; name it in the guard's header comment.
