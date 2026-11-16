## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD fd7064f7d700e49a2f7dfc1f6a244aab02048fd2 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/wait-out-panel-skeleton/HEL-1633`.
- Round-1 CR1 (one-shot reads): ADDRESSED. design.md D4 and standing constraint C1 require `count()`, one `evaluateAll`,
  and plain `expect(value)` after the helper, with no `toHaveCount`/`expect.poll`.
- Round-1 CR3 (`.panel-grid-card` premise): ADDRESSED. design.md Context and D3 now say desktop stubs are
  `.react-grid-item > .panel-grid-card`. D2 now says a filter on a skeleton-shared class is not OK-filtered. proposal.md
  Non-goals says "desktop and phone".
- Round-1 CR2 (deterministic vacuous window): ADDRESSED for mutant A only. With `goto(..., { waitUntil: "commit" })`,
  the helper starts before the SPA bundle has run. Mutant A (`Loading panels` count 0 only) passes on Playwright's
  first, immediate check. The one-shot `.react-grid-item` count is then 0, not N. That is red every time.
- **Mutant B is NOT deterministically red (new finding, see CR1).** Ground truth:
  - Playwright 1.55.1, `node_modules/playwright-core/lib/server/frames.js:1144-1152`: `expect` makes one immediate check,
    then retries at `[100, 250, 500, 1000]` ms. After the last step it keeps retrying every 1000 ms.
  - The guard delays the panels route by about 1.5 s. Before that request is even sent, app boot happens after the
    `commit`-time start. By the time the live grid mounts, the helper's step-1 poll is in its 1000 ms phase.
    (Cumulative check times: 0, 100, 350, 850, 1850, 2850 ms and so on.)
  - The fading stub layer lasts `--motion-duration-standard` = 280 ms (`frontend/src/theme/theme.css:92`;
    `Crossfade.css` `.crossfade__skeleton` transition). `Crossfade.tsx` then unmounts it on `transitionend`.
  - So mutant B (live-layer count only) first sees N live items at a random point 0-1000 ms after the swap. The
    stubs are still in the DOM for the one-shot read only if that point falls in the first ~280 ms. That gives red
    in roughly 30% of runs, and the chance of red on 5/5 is about 0.2%. D4's claim, "red because the fading
    stubs are still in the DOM at the one-shot read", rests on poll timing, not on the design.
  - C2 would catch this during execution and force a redesign mid-cycle. Catching it here is the purpose of this
    gate.
- hel1575-reload-after-edit.spec.ts:47 bare `.react-grid-item` `toHaveCount(1)` after `page.reload()`: still a valid FIX
  target (unchanged from round 1).
- AC coverage unchanged and complete: AC1 -> 1.8/D5, AC2 -> 1.4-1.6/D2-D3. No scope drift.

### Verdict: REFUTE

### Change Requests

1. **Make mutant B deterministic in D4 and task 1.7.** The stub fade (280 ms) must outlast Playwright's longest
   retry interval (1000 ms) by a clear margin. Only then is the stub layer guaranteed to be present at the one-shot
   read whenever step 2 is missing. Suggested approach (test-only, no product change):
   - In the guard spec only, inject a style (`page.addInitScript` or `addStyleTag` before navigation) that sets
     `.crossfade__skeleton { transition-duration: 3000ms }`. Scope it to that layer rather than overriding
     `--motion-duration-standard` globally.
   - Then mutant B sees the live items at most about 1000 ms after the swap, while the stubs remain for 3000 ms.
     That is red every time.
   - The real helper's step 2 must allow a timeout above the stretched fade. Pass an explicit timeout (for example
     10 s) on the guard spec's call, or make it a helper parameter.
   - State in D4 why the stretch exists: the property under guard is "the helper waits out the fade however long
     it is". At the real 280 ms, a missing step 2 is visible only by poll-timing luck.
   - Any equivalent deterministic mechanism is acceptable if D4 names it and explains why it does not depend on
     poll timing.

### Non-blocking notes

- Starting at `waitUntil: "commit"` means the helper's step 1 covers the whole app boot plus the 1.5 s route delay,
  under `nice -n 19` and concurrent lanes. The default 5 s expect timeout may be tight. Give step 1 an explicit
  generous timeout (for example 15 s, as hel1575 already uses).
- The round-1 notes still apply: a desktop-only doc comment on the helper, and careful classification of the
  hel1584 motion specs.
