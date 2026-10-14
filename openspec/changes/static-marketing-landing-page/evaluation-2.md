## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `340c9e799e114be6862cb3c38873cc5416f87fd2` (base `2c1ab0326fe6c171152bc59ff2918f433558296f`, resolved live). The cycle-2 delta is `1496762da..340c9e799`: `landing.css`, `landing.ts`, `reel.ts`, `build.ts`, `index.html`, `e2e/hel1562-landing-page.spec.ts`, and the committed `evaluation-1.md`.

### Phase 1: Spec Review — PASS

Issues: none.

- The delta stays in scope: it addresses only cycle 1's two change requests and one non-blocking suggestion (removing the mouse-only step click).
- No acceptance criterion or constraint regresses.
  - C4 still holds: Fraunces remains on h1/h2 through the `:where()` reset, measured.
  - C7 still holds: the hints are untouched.
- Cycle 1's Phase 1 findings stand unchanged.

### Phase 2: Code Review — PASS

Gates, fresh runs in WORKTREE_PATH at 340c9e799:

- `npm run lint`: exit 0.
- `format:check`: exit 0.
- `frontend typecheck`: exit 0.
- `npm test`: 595 suites, 7130 tests, all passing; plus 51 suites / 469 tests passing.
- `npm --prefix frontend run build`: exit 0.
- `check-landing-build` and its selftest: OK. `check-tokens`, `check:e2e-types` and openspec hygiene: OK.
- e2e: `hel1562-landing-page.spec.ts` (23 tests, including the 2 new ones) and `hel813-mobile-touch-target-floor.spec.ts` passed together, 37/37.

Verifying cycle 1's change requests:

1. **Spacing (CR1): fixed.**
   - `:where(.landing) h1/h2/h3/p` drops the resets to zero specificity.
   - Computed at 1440 and 375, light and dark: `.closing-sub` is 20px top / 32px bottom and `.caption2` is 12px top, matching `--space-5`/`--space-7`/`--space-3`.
   - No other margin changed: `.center p` stays 24px, `.cols p` 8px, and `.center h2` 0.
2. **Touch floor (CR2): fixed.**
   - `tapTarget.css` is imported in `landing.ts`, and `tap-expand-44` is on the pills (`reel.ts`) and on the nav `.btn-sm` (`index.html`).
   - At 375, both the pill and the button have a painted height of 32px with an `::after` of 44px. The pill row gap is 12px under the phone/coarse gate and 8px at desktop.
   - My own `elementFromPoint` bisection at 375 measured all six pills at 44–44.5px (three rows, 44px apart, so the expanders tile without overlapping).
   - A real tap 5px below the painted "Revenue" pill selects it.
   - At 1440 there is no expander (painted hit height 32.75px), which is correct for a fine pointer.
3. **Step click: removed.** The click handler and `cursor: pointer` are gone (computed `cursor: auto`). `wide`, `reduce` and `stepSegment` are still used by `onScroll`, and lint is clean.

The executor's mutation claims: I verified them independently instead of accepting them. Each mutation was applied in a scratch detached worktree at 340c9e799, served by its own frontend-only dev server on :6995 through `start-servers.sh` with the backend disabled. The executor's worktree was never modified. I ran the two new tests with `--retries=0`:

| Run | Result |
| --- | --- |
| Baseline | 2 passed |
| M1: `:where(.landing) p` reverted to `.landing p` | margin test red (Received 0) |
| M2: pills lose `tap-expand-44` | hit test red (33 < 43.75) |
| M3: nav button loses `tap-expand-44` | hit test red (32.5) |
| M4: gated pill gap back to `--space-2` | hit test red (40, overlap stolen by the next row) |
| M5: `tapTarget.css` import dropped | hit test red (32.75) |

Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1562/evidence/eval-evidence/hel1562-eval2-mutations.txt`. The scratch server was stopped with `stop-servers.sh <scratch> 6995 0`, so the shared :9901 was never targeted, and the scratch worktree was removed. :6994 and :9901 both still return 200.

Issues: none.

### Phase 3: UI Review — PASS

Live dev server :6994 / backend :9901, headless Playwright, at 375×812 (touch) and 1440×900, light and dark:

- No horizontal scroll across the full page in any of the four configurations (max overflow 0).
- No JS exceptions.
  - The only console entry is the browser's network log of the intended 401 from the signed-out "Request beta access" call.
  - The UI handles that 401 as designed: "Create a free account first. Start free." with a `/register` link.
- The hotspot opens via keyboard (Enter), shows the correct hint ("Overlay the previous run and mark a 200 ms SLO."), and Escape closes it.
- Screenshots confirm the restored spacing and that nothing else broke:
  - the closing sub-line is spaced from the tagline and the CTAs;
  - the build caption sits clear of its frame;
  - the 375 hero is intact with a 12px pill gap;
  - the build section at 1440 is unchanged.

### Overall: PASS

### Non-blocking Suggestions

- These cycle-1 suggestions are still open and optional:
  - Without JS, the reel stays roughly seven screens tall.
  - The shared CSS chunk is named `csrfHeader-*.css`.
