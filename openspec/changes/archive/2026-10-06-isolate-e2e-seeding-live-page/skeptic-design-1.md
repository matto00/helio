## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- App.tsx:175 fetchDashboards on mount and :183 fetchPanels(selectedDashboardId): confirmed.
- recentVisitsListeners.ts: predicate on selectedDashboardId transition, records via recentHistoryStore (localStorage): confirmed.
- Population: 38 e2e files contain a form password login; 34 contain registerAndLogin: confirmed.
- Archived change openspec/changes/archive/2026-10-05-isolate-orphan-repair-e2e-seeding exists.
- PR 774 file list: the 9 e2e files named, plus ci.yml, playwright.config.ts, support/settleTransitions.ts. For the 7 overlap files the hunks are the header (describe.configure parallel) and, for hel1023/hel1028, removal of `const seededUsers`, replacement of `seededUsers.push(email)` with a console.log, and removal of afterAll. hel516/519/588/773/813 are header-only.
- Reload population (greps of reload()): hel1007, hel1065, hel1094 (3), hel519 (2), hel908-trunk, hel520-regression, hel813-regression, hel503 (6), hel908-tail (2), hel968, plus the two guards and hel1260.
- Mount read set: SidebarBody.tsx:62-68 (fetchSources/fetchPipelines/fetchConversations keyed on route section, not `/`), useResourceIndexing.ts:75-87 (palette open only), useOnboardingHost.ts:83-92 (fetchSources/fetchPipelines whenever the onboarding checklist is `visible`, which can include the `/` landing for a fresh user).

### Verdict: REFUTE

### Change Requests
1. design.md Context states as a premise that `/` does not fetch sources or pipelines on mount ("per hel503's own design note"). It is hedged as a claim, but it is wrong in general: useOnboardingHost.ts:83-92 fetches sources and pipelines on `/` whenever the onboarding checklist is visible (auto-activation for a user with no dashboards, exactly the post-registration state). D1's `exposed-unobservable` verdict is defined against that read set, so a test seeding only a source or pipeline in W is not provably unobservable. Revise: delete the premise; state in D1 that the read set is conditional (onboarding visibility, section route) and that `exposed-unobservable` requires the inventory to show, per test, that the conditional fetches are not triggered (for example dashboard already exists so checklist is not visible), citing file:line. Default to `affected` when it cannot be shown.
2. D5 and D7 contradict. D5 requires adding a `[HEL-1300 e2e] throwaway user` console.log in each touched spec's registration. In hel1023 and hel1028 that exact line (`seededUsers.push(email)`) is rewritten by #774 into a console.log, and main's afterAll already logs the users. D7 forbids touching the seededUsers lines. Revise: exempt hel1023, hel1028 (and any file where #774 already changes the registration lines) from the D5 log edit and record those emails from the existing afterAll/#774 log; state this in tasks 2.2.
3. D2a names only hel519 and hel503 as reload specs. 12+ files contain reload (list above), several where the reload may be the purpose (hel1094 SSE, hel908, hel968, hel1007, hel1065). Revise: task 1.2 must require, for every `affected` test whose W closes with a reload (or contains one before the seed is consumed), the quoted purpose and a D2a-vs-escalate decision; and state that hel1094 and the like default to escalation if the reload tests persistence of an already-loaded page. Add to tasks 1.2 a verify that no `affected` test lacking such a record exists.
4. (Minor, fold in) D6 isolation proof: specify how page-frame requests are separated from `request`/`page.request` seeding in the adapted parser, and that traces for 3.1 are taken on the modified specs (task text only says 'traces'). Also state that hel1260 (already isolated) is verified, not edited.

### Non-blocking notes
- D2/D2a/D2b reasoning, D3 helper shape (call-site isolation, not inside registerAndLogin) and D8 handling are sound; guards untouched per D7 is correct.
- 38-file population count matches the live tree.
