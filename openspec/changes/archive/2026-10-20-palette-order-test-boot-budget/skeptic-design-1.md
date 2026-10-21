## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD edfd329c82f448874972cc3ea29bce8363905ad9 (planning artifacts uncommitted in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/palette-order-test-budget/HEL-1689`.
- **Per-iteration timing breakdown.** I parsed the CI trace myself (`.concertino/scratch/HEL-1689/art/t/test.trace` and `1-trace.trace`, run 39540076554 shard 4).
  Iteration wall times were 7.5 / 6.1 / 5.7 / 5.6 s, and iteration 5 was killed 4.8 s in.
  - `/login` goto took 2.6 / 2.2 / 1.6 / 1.4 / 1.2 s.
  - `/dashboards` goto took 2.2 / 1.4 / 1.5 / 1.8 / 1.3 s.
  - The "Add dashboard" wait took 0.5 / 0.4 / 0.7 / 0.4 / 0.3 s.
  - Register took about 0.4 s and the palette about 0.5 s.
  - The 5th `Expect "poll toBeGreaterThan"` began about 29.3 s after the Before Hooks, then `Test timeout of 30000ms exceeded`.

  This matches design.md Context and the premise summary.
- **The palette opened on the first press in every iteration.** In each of iterations 1-4 there is exactly one `keyboardPress Control+k`, followed by `queryCount .command-palette[open]` returning `{'value': 1}`, then the group labels `Navigation, General, ...`. Iteration 5 also issued a single press and its `queryCount` returned 1, but only after the test timeout had fired. Both triage hypotheses (a race with readiness, a missed keybinding) are refuted, so this is a budget overrun.
- **The reload alternative would share storage.** This holds by construction: `page.reload()` keeps the same context and tab, so localStorage, sessionStorage and IndexedDB carry over. It is also concretely relevant: `frontend/src/features/commandPalette/model/recentHistoryStore.ts` and `dashboardSeenStore.ts` use web storage, and the palette reads them. The same check confirms D3: the existing loop only calls `clearCookies()`, so origin storage already leaked between boots, and a new context per boot is strictly more independent.
- **Cookie transfer.** The `request` fixture and the page share `use.baseURL` (`http://localhost:${DEV_PORT}`, playwright.config.ts), so the cookie domain should match. design.md Risks already requires the executor to check this.
- **Constraints.** No timeout, retry or poll change is planned (C1, consistent with the ticket's "no retries and no bigger timeouts"). The red-first, then 40/40 under throttle requirement is covered by tasks 1.1 and 3.1, and a mutation check by 2.2. The scope is one test.
- **Placeholders and contradictions:** none found. Every task has a "Verify:" signal.

### Verdict: CONFIRM

### Non-blocking notes

- The cost estimate in D1 is optimistic. Each new context starts with a cold HTTP cache, so every `/dashboards` load costs about what the cold first `/login` load did (2.6 s on CI), not the warm 1.4-2.3 s. Expect about 3.5-4.5 s per iteration on CI, roughly 18-22 s per test. That is still inside 30 s, but the margin is not "wide". Task 3.1's max-duration report at 4x is the right measurement. Please state the max duration against the 30 s budget explicitly.
- design.md says the `use` block in playwright.config.ts "sets only `baseURL` and `trace`". It also sets `launchOptions`, which is browser-level and so does not affect `newContext`. The conclusion holds; the sentence is inaccurate.
- AC "CI is green on main" can only be met after merge, and no task covers it. The orchestrator or delivery step should confirm it after merge.
