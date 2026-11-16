## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD fd7064f7d700e49a2f7dfc1f6a244aab02048fd2 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/wait-out-panel-skeleton/HEL-1633`.
- Round-2 CR1 (mutant B deterministic): ADDRESSED in design.md D4 and C3. The guard spec stretches only
  `.crossfade__skeleton` to 3000 ms. D4 explains why: the guarded property is "the helper waits out the fade however
  long it is". At 280 ms a missing step 2 is visible only by luck. The guard calls the helper with a 15 s timeout,
  which is above the stretched fade.
- Ground truth for the stretch mechanism, `frontend/src/shared/ui/Crossfade.tsx`:
  - The skeleton layer unmounts only on `transitionend` or `transitioncancel` (target === layer), or when one rAF
    after `leaving` finds `getAnimations()` empty.
  - There is no fixed-duration fallback timer. So a 3000 ms transition really keeps the stub layer mounted for
    about 3 s.
  - The rAF check sees the running 3 s opacity transition, so it does not end early.
- `Crossfade.css`: `.crossfade__skeleton { transition: opacity var(--motion-duration-standard) ... }` and
  `--motion-duration-standard: 280ms` (`theme.css:92`).
  - Under `data-motion="off"` or OS reduce, the token becomes `0.01ms` (`theme.css:211-238`).
  - An explicit `transition-duration` override replaces the duration no matter which token value applies.
  - Playwright config sets no `reducedMotion` (`playwright.config.ts:183+`).
- Mutant A (step 2 only): with `goto(..., { waitUntil: "commit" })`, `Loading panels` count 0 passes on the first,
  immediate check. The one-shot `.react-grid-item` count is then 0, not N. It is red every time.
- Mutant B (step 1 only): the live layer reaches N at most about 1000 ms (the largest poll step) after the swap. The
  stub layer stays for 3000 ms, so the one-shot total count is N plus the stub count. Desktop width, seeded
  layout, so the stub count is above 0. It is red every time, provided the stretch actually applies (see note 1).
- C1, C2 and C3 all appear in tasks.md Standing Constraints and in workflow-state.md CONSTRAINTS. Task 1.7 cites all
  three.
- The round-1 and round-2 non-blocking notes are folded in:
  - D1 has the desktop-only doc comment and a 15 s default timeout.
  - D5 records `uptime` and `free -g` before and after.
  - D2's OK-not-a-load verdict covers the fade-observing specs. Those still need a line reference.
- Sweep inputs are live:
  - `grep -rn "react-grid-item" e2e | wc -l` = 74.
  - `e2e/hel1575-reload-after-edit.spec.ts:47` is a bare `toHaveCount(1)` right after `page.reload()`. That is a
    valid FIX target.
  - `e2e/support/` exists and holds peer helpers (e.g. `settingsReady.ts`, `settleTransitions.ts`).
- AC coverage is complete: AC1 maps to 1.8/D5, and AC2 maps to 1.4-1.6/D2-D3. No placeholders, no TBDs. Proposal,
  design and tasks do not contradict each other. Test-only, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

1. **Make the stretch win the cascade, then prove it applied.** This is strongly recommended. It would otherwise
   cost a C2 redesign mid-execution.
   - The rule D4 names, `.crossfade__skeleton { transition-duration: 3000ms }`, has the same specificity (0,1,0)
     as `Crossfade.css`'s `.crossfade__skeleton { transition: ... }`. So source order decides which one wins.
   - In the Vite dev server, `Crossfade.css` is injected as a `<style>` when its module runs. `Crossfade` is
     imported by `SuspenseFallback.tsx` as well as `PanelList.tsx`, so this happens early.
   - An `addInitScript` style that is inserted before that `<style>` loses the tie. If it loses, the stretch is a
     silent no-op and mutant B returns to the ~30% red rate that round 2 measured.
   - C2 would catch this, but only after a mutant run.
   - Fix: raise specificity, e.g. `:root .crossfade .crossfade__skeleton`, or use `!important` on
     `transition-duration`.
   - Then add one positive precondition read in the guard while the skeleton is up, e.g.
     `getComputedStyle(layer).transitionDuration === "3s"`. This makes the stretch self-verifying rather than
     inferred from mutant results.
2. If the guard dashboard's saved layout can produce zero tier-1 stubs, mutant B's "N + stubs" difference vanishes.
   Seed a real layout (as `hel1575-reload-after-edit` does through the UI, or via the API) so the desktop skeleton
   renders stubs. Then assert once, before the helper finishes, that the stub layer had a `.react-grid-item`.
3. Classify the fade-observing hel1584 motion specs in `sweep.md` with a line reference, and do not convert them to
   the helper.
