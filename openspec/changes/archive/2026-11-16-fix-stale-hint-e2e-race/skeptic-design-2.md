## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 0c699d2633e5dedbc14cb3bddaca6147dd6b6025. There are no change commits yet; only the artifacts in the change dir were reviewed.

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/fix-stale-hint-e2e-race/HEL-1623`.
- Test under fix: `e2e/hel1562-landing-page.spec.ts:81-87`. It matches design.md Context word for word.
- Race mechanism:
  - `frontend/src/features/auth/state/signedInHint.ts:28-37` synchronously removes `helio.signedIn` on any transition to `unauthenticated`.
  - `frontend/index.html:43-47` has an inline head script that reads the key and calls `location.replace("/home")`.
  - Nothing orders the old `/login` document's clear against the test's `setItem` or the next document's read. The hypothesis is plausible. AC2's forced repro is still required to prove it, and that requirement is planned (D3.1).
- D1 premise:
  - `/` loads only the inline head script and `/src/landing/landing.ts` (`index.html:77`).
  - `grep -rn "localStorage|signedIn" frontend/src/landing --include=*.ts` (non-test) returns no hits.
  - So nothing on `/` can clear the hint. Task 2.1 still requires the executor to re-verify this against the served scripts.
- Round-1 CR1 is resolved. D3.2 now uses a release-controlled hold rather than a whole-test hold, and states that the `/home` document's own `/api/auth/me` must return 401. The load-bearing assertion is now an explicit count: zero `/api/auth/me` requests between the seed `goto` and the second `goto("/")`. That count proves AC1 directly. Task 3.1 mirrors it.
- Round-1 CR2 is resolved. D3.3 defines "held" as (a) hung until the test ends and (b) delayed 5 s, then continued. It probes every navigation wait, not only the seed load. It names the in-bounds fix (`domcontentloaded`/`commit`), never a larger timeout. Ground truth: `frontend/app.html` also loads the font stylesheet with `media="print"` and an onload swap, so whether `load` is delayed is a real open question. Probing it is the right call. Task 3.2 mirrors it.
- The round-1 advisory CI-trace corroboration is now D3.4 / task 3.2b, with an escalation path if the page sat on `/home` at timeout (a broken bounce, which this fix would not cure). Good.
- D4 sweep: the only other test that touches the hint (`:55-79`) seeds it through a real `registerAndLogin`, not from a booted unauthenticated page. That is not the same race, so D4 should conclude "no fix". This is consistent with the plan.
- AC coverage:

  | AC | Covered by |
  | --- | --- |
  | AC1 | D1, task 2.1/2.2, D3.2 count |
  | AC2 | task 1.1 + 3.1 |
  | AC3 | task 3.2 |
  | AC4 | task 3.3 |
  | AC5 | CI |
  | AC6 | C1 |
  | AC7 | D5 / task 3.5 |

- No placeholders or TBDs. Proposal, design and tasks are mutually consistent. Scope stays on one spec file plus throwaway probes.

### Verdict: CONFIRM

### Non-blocking notes
- D2's justification ("`/login` can be reached before the `/home` app's clear is observable") is speculative. The design already makes the executor check the real order, and it keeps `expect.poll` at the default timeout. That is acceptable under C2. If the probe shows the clear always lands before the redirect, the executor may say so in `proofs.md`. Keeping the poll is still harmless.
- "No Helio app code" (proposal/D1) is stricter wording than reality: `landing.ts` is Helio code, just not the app bundle. The D3.2 auth/me count is the actual proof, so this is wording only.
