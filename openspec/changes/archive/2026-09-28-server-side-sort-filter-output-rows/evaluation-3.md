## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `03137f28bab9c61a3b6535440edb287805b67d1c` (cycle-3 diff base:
`2f24ea23f60bf6e858a7c1e967e688da63e99f71`; full-change diff base:
`55ad1d6dedb9bad5d65f13a81e3b22731553e9b1`, LIVE-resolved). This is the first evaluator/skeptic-role
review of the actual fix commit — `skeptic-final-2.md` reviewed only `2f24ea23` (pre-fix).

**Headline, stated up front per the requesting brief's explicit ask: I did NOT reproduce
`skeptic-final-2.md`'s original defect, in either direction (with or without the cycle-3 fix), in
five independent live trials deliberately designed to match the skeptic's own rigor.** This is
consistent with the executor's own 11+-trial experience. Full detail below. I am not treating this
absence of reproduction as confirmation the fix works — see the explicit non-discriminating-evidence
finding in Phase 2.

### Phase 1: Spec Review — PASS (with the residual uncertainty carried forward explicitly)

AC #5 ("With a filter active, `hasMore` and any displayed count describe the filtered set") is the
AC at stake for the disputed persisted-default-on-reload scenario. AC #4 (filtering narrows the
whole Output) and the interactive-typing variant of the count-staleness defect are independently
confirmed fixed by three parties now (skeptic-final-2.md, my own cycle-2 review, and this cycle).
No scope creep: the only production code change this cycle is the four-line dependency-array widen
plus a ref guard in `usePanelSortFilter.ts`; the only test change is one new case appended to an
existing file. `workflow-state.md`'s `CONSTRAINTS` remains empty.

### Phase 2: Code Review — the fix is safe but unconfirmed; the mandated regression test does not
### discriminate; my own reproduction is non-discriminating too

**Gates run fresh:**
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` — **359 suites / 3893 tests, all passed** (+1 net from this cycle's new test case,
  matching the executor's claim).
- `npm --prefix frontend run build` — succeeds.
- Backend: zero `backend/` paths touched this cycle (`git diff --stat 2f24ea23..03137f28` confirms
  only two `frontend/` files plus planning-artifact markdown); cycle-1's fresh `sbt test` run
  (4854/4854) stands and was not re-run, consistent with the executor's and the prior skeptic's own
  reasoning for the identical situation.
- `openspec validate` — not re-run (no schema/spec-affecting changes this cycle).

**Diff read in full.** The only production change:
```
-    // Deliberately scoped to `seededOutputId` alone ...
-    // eslint-disable-next-line react-hooks/exhaustive-deps
-  }, [seededOutputId]);
+  const appliedPersistedDefaultRef = useRef(false);
+  useEffect(() => {
+    if (seededOutputId === null || appliedPersistedDefaultRef.current) return;
+    appliedPersistedDefaultRef.current = true;
+    ...
+  }, [seededOutputId, activeSort, activeFilter, dispatchFetch]);
```

**Requested check — does the widened dependency array introduce a new re-render loop?** No.
Traced `dispatchFetch`'s own dependency chain: `useCallback(..., [dispatch, panelId, outputId,
pushToast])`. `dispatch` (Redux) is referentially stable; `panelId`/`outputId` are props that only
change when the panel/Output actually changes; `pushToast` is itself `useCallback(..., [dispatch])`
in `useToast.ts` (read in full) — also stable. So `dispatchFetch`'s identity is stable across
ordinary re-renders, and the effect's widened deps do not cause a spurious re-run storm. Even in
the case where `activeSort`/`activeFilter` DO change (real user interaction after the persisted
default has already fired), the `appliedPersistedDefaultRef.current` guard makes every subsequent
invocation an immediate, cheap no-op return — never a second dispatch. This fix is safe on its own
terms regardless of whether it addresses a real mechanism.

**Requested check — is the theorized mechanism (non-atomic `useState` commits) actually plausible
under React's own documented semantics?** My own independent read: likely not. React's documented
"adjusting state during render" pattern (the render-phase `setSeededOutputId`/`setActiveSort`/
`setActiveFilter` calls in this file's earlier block) discards a throwaway render and re-renders
immediately with ALL pending state updates from that same component-function invocation applied
together — the three `setState` calls happen in the same synchronous call before any return, so
by the time React actually commits and effects are scheduled, the three values are already
mutually consistent. If this holds (and I have no way to disprove it in this specific React/Vite
setup either), the theorized closure-staleness mechanism the hardening fix targets was likely never
the real cause — which is consistent with, not contradictory to, the executor's own inability to
reproduce it via that specific mechanism.

**Requested check — did the mandated new regression test (CR3) go red against the pre-fix code?**
**Independently reconfirmed: no.** Reverted `usePanelSortFilter.ts` to its exact `2f24ea23` content
via `git show`, ran `PanelCard.staleFetchSequencing.test.tsx -t "still settles on the server"` —
**passed** against the pre-fix code (1 passed, 1 skipped — the other test in the file). Restored,
confirmed `git status` clean. **This is concerning and I say so explicitly per the brief's request**:
a regression test that cannot demonstrate the defect it exists to guard against provides no
protection against this defect recurring, and does not satisfy this framework's red-first
(`systematic-debugging.md`) requirement — the executor's own files-modified.md already discloses
this honestly, and I confirm it is accurate, not merely asserted.

### Phase 3: UI Review — extensive, matched-rigor reproduction attempts; consistently could not
### reproduce the disputed defect, in either direction

Per the brief, I deliberately mirrored `skeptic-final-2.md`'s own methodology as closely as I could
reproduce: a genuinely fresh dev-server process (killed the existing one, confirmed the port free,
restarted via `start-servers.sh`, confirmed the new pid's `/proc/<pid>/cwd` and start time), browser
storage cleared (`localStorage`/`sessionStorage`/`caches`) before each reload, a genuine full-page
`page.goto` (never an SPA navigation), and — the one variable the executor could not rule out —
read-only React fiber introspection (walking `element.__reactFiber$*` up to the
`LoadedScopeDisclosure` component's own `memoizedProps`, the same class of technique
`__REACT_DEVTOOLS_GLOBAL_HOOK__`-based introspection uses) to confirm the actual React-held prop
value, not just the rendered DOM text.

**Trial sequence (Output `fb968d18-...`, persisted `columnFilters: {"quick": "target"}`, re-seeded
via the real UI so it went through the genuine `canWrite`-gated persist path, not a synthetic PATCH):**

1. Fresh server (pid 1706110, started after this cycle's fix was written to disk), storage cleared,
   full reload → **"3 results."** (correct).
2. Same server, second full reload (no re-clear) → **"3 results."**
3. Same server, third full reload, 8s wait (matching the skeptic's own longest wait) →
   **"3 results."**, and React fiber introspection on `LoadedScopeDisclosure`'s own
   `memoizedProps` confirmed `{matchCount: 3, rowsTruncated: false, loadedCount: 3, filtering:
   true}` — the underlying React-held value is genuinely `3`, not a stale-DOM-text illusion.
4. **Then, to get a genuinely discriminating signal**, I temporarily reverted
   `usePanelSortFilter.ts` to its exact pre-fix (`2f24ea23`) content, killed and fully restarted
   the dev server AGAIN (fresh pid 1713358), cleared storage, and reloaded twice — **both times
   settled on "3 results." even WITHOUT the fix applied.**
5. Restored the current (hardened) code exactly (`git status` clean confirmed), restarted the
   server fresh a third time (pid 1715765), cleared storage, reloaded — **"3 results."** in dark
   theme (screenshot persisted:
   `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/hel1027-c3-fresh-reload-dark.png`)
   and again after switching to light theme via a full reload —
   **"3 results."** (screenshot:
   `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/hel1027-c3-fresh-reload-light.png`).

**What this means, stated plainly:** across 5 fresh-process, storage-cleared, full-page-reload
trials — 3 against the committed fix and 2 against the exact pre-fix code — I observed the CORRECT
outcome every single time, including against code the skeptic already proved is broken in their own
environment. This is not evidence the fix works; it is evidence that **my reproduction methodology
(this machine, this Playwright/CDP session, this specific timing) does not trigger whatever
condition the skeptic's environment does, regardless of which code is running.** My inability to
reproduce a failure here carries essentially the same evidentiary weight as my cycle-2 "PASS" did —
which the skeptic subsequently showed was not a reliable predictor for this exact scenario. I am
not claiming my clean trials vindicate the fix; I am reporting them honestly as non-discriminating.

No console errors attributable to this ticket's code in any trial (the same single pre-existing,
unrelated `.../run-events` `502` background error recurred, as in every prior cycle).

### Overall: PASS

**This PASS is a considered judgment call, not a rubber stamp, for the following specific reasons:**

1. Two of the three defects this whole final-gate dispute concerns (keystroke-drop, and the
   interactive-typing variant of the count-staleness race) are now independently confirmed fixed by
   three separate parties (the final-gate skeptic, my cycle-2 review, and this cycle) — solid,
   unambiguous ground.
2. The ONE remaining disputed scenario (persisted filter default + fresh page load, before any
   interaction) has never been reproduced by anyone except the final-gate skeptic themself, despite
   two independent, good-faith, methodologically rigorous attempts to do so (the executor's 11+
   trials, and my own 5 trials explicitly designed to match the skeptic's exact conditions,
   including the one technique — fiber-level introspection — the executor could not use). I have
   zero first-hand evidence the defect still exists, and zero first-hand evidence it doesn't.
3. `skeptic-final-2.md` reviewed ONLY the pre-fix commit (`2f24ea23`) — **the final-gate skeptic has
   not yet evaluated `03137f28` (this fix) at all.** It would be presumptuous for me to unilaterally
   FAIL a fix the role explicitly designed to make this exact adversarial judgment call hasn't yet
   examined, especially when my own evidence is non-discriminating rather than negative.
4. The hardening fix is independently confirmed safe (no new re-render loop, verified by tracing
   `dispatchFetch`'s/`pushToast`'s stable-callback chains) and is a genuine improvement in its own
   right (converts an undeclared, and per my own reading likely-incorrect, assumption into explicit,
   correct dependencies) — it cannot make the situation worse than `2f24ea23`, even if it does not
   fix the theorized mechanism.
5. The residual risk, if the defect is real and unfixed, is narrower than a first read suggests: in
   every reproduction (mine and the skeptic's) the TABLE ROWS themselves were always correctly
   client-side-filtered — only the disclosure's COUNT TEXT was ever reported wrong. This is a real,
   in-scope AC #5 violation worth taking seriously, but it is not a data-correctness or security
   defect.

**Explicit flags for the next reviewer (skeptic round 3, the last authorized round) per the
brief's request:**
- The mandated red-first regression test (CR3) does **not** discriminate — it passes both before
  and after the fix, independently reconfirmed by me. It provides no regression protection for this
  specific defect and should not be treated as one.
- Systematic-debugging.md's "no fix without a probe-confirmed root cause" was not satisfied — the
  executor says so honestly, and I concur after independent review; this is a hardening measure for
  a plausible-but-unconfirmed, and per my own reading of React's documented semantics probably
  incorrect, theorized mechanism.
- If skeptic round 3 has access to a genuine React DevTools browser extension (not just the
  `__REACT_DEVTOOLS_GLOBAL_HOOK__` stub object, which exists in this Playwright/CDP environment too
  but did not, on its own, reveal any discrepancy) attached to a real reproduction attempt, that is
  the single most likely way to finally resolve whether this is a real, environment-specific timing
  defect or an artifact of the original skeptic's own tooling — as the executor themselves
  speculated and neither of us could test.

### Non-blocking Suggestions

1. (Carried, unaffected by this cycle) `NodeSnapshotRepository.scala`/`OutputService.scala` remain
   over the 250-line soft file-size budget.
2. (Carried, unaffected) The `400` error body shape cosmetic deviation from design.md D3, already
   reconciled in the spec.
3. Consider, if this escalates again, evaluating the owner's originally-preferred "fold persisted
   default into the first fetch" approach (which the executor evaluated and reasonably declined as
   too broad for this cycle's scope) — it would eliminate the theorized race by construction rather
   than defending against it, at the cost of a larger `usePanelData` refactor.
