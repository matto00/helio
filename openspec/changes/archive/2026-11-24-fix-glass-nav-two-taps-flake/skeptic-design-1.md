## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/glass-nav-two-taps-flake/hel-1701`. Reviewed HEAD 665ceb96f415e875d2e955937b0b2af3f79dfa81 (no change commits yet; this is a planning-only review).
- Read ticket.md, proposal.md, design.md, tasks.md, .openspec.yaml (`skip_specs: true`), workflow-state.md, and the lane constraints.
- Test location claim: `e2e/support/hel1583-glass-nav.ts:549` is the test "a beta user reaches /chat in two taps...". Its body matches design.md's Context section: `openAt` (default path `/dashboards`, so the Dashboards tab starts out current), the tier set to beta, a reload, two clicks, `toHaveURL(/\/chat$/)`, then a one-shot `navGeometry` `page.evaluate` that reads each tab's `aria-current`. Confirmed.
- Same-test premise (AC6): `.concertino/runs/HEL-1701/evidence/premise-validation.md` records that `git show 14c08def8` line 554 is this test's declaration. Accepted as recorded. It does not bear on the design's soundness.
- Spec claim: `openspec/specs/mobile-bottom-nav/spec.md:22` says no tab is current "on routes that belong to none of them (for example `/chat`)". Confirmed, so `skip_specs: true` (no requirement text changes) is consistent.
- Nav mechanism (bears on H1/H2): `frontend/src/shared/chrome/BottomNav.tsx` derives `aria-current` from `useLocation().pathname` through `isDestinationActive`. It is mounted in `app/MobileShell.tsx:38`, in the same router tree as the routes. The overlay link is `<Link to="/chat" onClick={onClose}>` (`QuickLauncherOverlay.tsx:91`). The router is `BrowserRouter` on react-router-dom ^7.18.6, which wraps location updates in `startTransition` by default. The URL is pushed synchronously, and the React commit can trail it. So H1, the "URL ahead of an atomic commit" mechanism, is plausible. H2 is structurally unlikely, because the nav and the route read the same location. The probe in D1 decides between them, which is correct.
- AC coverage:
  - AC1 is covered by tasks 1.1, 2.1 and 2.2.
  - AC2 is covered by 1.2.
  - AC3 is covered by D3 and 3.1, with C1 forbidding waits, retries and the flake list.
  - AC4 is covered by 3.3 and D5.
  - AC5 is covered by 3.2 and D4.
  - AC6 is covered by the premise evidence.
  - AC7 is a delivery-phase check, which is appropriate.
  - No scope drift: D6 avoids the HEL-1651 and HEL-1852 files.
- D3 decision rule: sound. It keys the product-vs-test call to what a user can see (whether the /chat content coexists with a current tab). It forbids the bare `expect.poll` wrap, which would mask a product lag. It requires the test fix to gate on a real /chat condition. Under an atomic React commit, a visible /chat landmark implies the nav has re-rendered, so the fixed assertion keeps its full strength (C3).
- Placeholders or contradictions: none found. The bounded-effort escalation for a non-reproducing race is stated in Risks. D5's `N >= ceil(3/p)` addresses the low-red-rate statistics gap.

### Verdict: CONFIRM

### Non-blocking notes

1. H1's example mechanism, "a lazy `/chat` route chunk", is false at HEAD. `ChatPage` is imported eagerly (`app/AppRoutes.tsx:4`, route at :128), and ChatPage contains no `lazy`, `Suspense` or `use(`. The executor should not chase a chunk-load theory. The likelier form of H1 is a non-suspending concurrent transition render that yields under CPU load (React Router v7's default `startTransition`). In that case the URL is already `/chat` while the old tree is still committed. The probe should check this directly, for example by recording `history.state`/pathname against the first frame in which ChatPage's DOM appears.
2. design.md says "`NavLink`'s `aria-current`". The tab is actually a plain `Link` whose `aria-current` is computed from `useLocation()` (`BottomNav.tsx:63-68`). This does not change the plan, but `root-cause.md` should describe the real mechanism.
3. If D3 lands on a test fix, the "/chat landmark" must meet three conditions: ChatPage renders it in the same commit as the route switch; it is absent from `/dashboards` and from the open overlay (the overlay renders `ActiveConversationPanel`, which may share chat headings or roles); and it is matched by role or name, not a generic heading.
4. The mutation for a test-side fix reverts to a race that reddens at rate p. Commit the red mutation output from runs under the same throttled conditions that produced the original red, as D4 already says. A single warm run that passes is not a valid mutation result.
