## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD beb94adfe49759ebc8e180500130a032fdfac3b4. The planning artifacts are untracked in the change dir, and no tracked file is modified.

### What I verified (with evidence)

**Round-2 CR1 (the unit shimmer assertion collided with HEL-1584's `tl-nudge`): addressed.**
- D2 now scopes the assertion to four checks:
  - HomePage.css never mentions `ui-skeleton-shimmer`.
  - `tl-nudge` is the only `@keyframes`, and it is stated to be unrelated and left untouched.
  - No `background`/`background-image` declaration uses `linear-gradient`.
  - The bar rule body declares no `background`, `animation` or `@keyframes`.
- D4's Unit bullet repeats the same scope. Task 3.2 explicitly says not to touch `tl-nudge`.
- Ground truth, `grep -n "keyframes|gradient|ui-skeleton|shimmer|animation|mask" frontend/src/features/home/ui/HomePage.css` at base:
  - The only `@keyframes` is `tl-nudge` (line 481), and its `animation:` is at line 497.
  - There is zero `gradient` and zero `shimmer`.
  - `ui-skeleton` appears only as a class selector (line 189, `.home-card__name--skeleton .ui-skeleton`).
- So each file-level assertion passes on base and at head without deleting shipped motion. It cannot be "red for the wrong reason", so the C1 red evidence stays clean. The D2 mask's `linear-gradient` sits in `mask-image`, not a `background` declaration, so the scoped check does not trip on it.

**Round-1 CRs (re-checked against the current text):**
- CR1: the numeric targets (0.8em ±1px, gap >= 8px, `--app-radius-sm` corners) and the concrete mask are still in D2/C4.
- CR2: the thickness/gap/corner scan and mutation (c) are still in D4/4.1.
- CR3: the side-effect Skeleton.css import is still in D1/3.1.
- CR4: task 1.1 still names the Playwright 1.55 Chromium and the ci/dv images.

**Whole-plan soundness against the code:**
- `HomeOpeningLine.tsx` matches the design's description of current state: a ghost `<p aria-hidden>` holding `DEFAULT_SENTENCE` (a plain string from `sentenceText`), plus `<Skeleton variant="line" className="home-opening__skeleton-line" />`.
- Specificity holds:
  - `.ui-skeleton` sets `display: block` at specificity (0,1,0). The planned `.home-opening__ghost .home-opening__ghost-bar` (0,2,0) wins.
  - The rule does not set `background`/`animation`. Skeleton.css's reduced-motion rule `:root:not([data-motion]) .ui-skeleton` and its `:root[data-motion="off"] .ui-skeleton` rule therefore still apply unchanged.
  - `.ui-skeleton`'s other properties do not affect an inline box (`flex-shrink`, and the `--line` variant's width/height, which is not used here).
- Skeleton.css's header rule (no shimmer keyframes or shimmer background outside it) is respected: the mask is neither.
- `grep -rn "home-opening__ghost|home-opening__skeleton-line" e2e/` gives zero hits, so the removed class breaks no e2e. The unit tests that reference it (`HomePage.css.test.ts:33-36`) are listed for update in D4/2.2.
- Acceptance-criteria coverage:
  - AC1 (one bar per line at 431-604px, light and dark, matching look): covered by the D4 fragment/geometry/computed-style assertions and the 431/604 count == 2 pin.
  - AC2 (hel1665 0px series and the HEL-1737 320-1300 sweep stay green): covered by C2, task 4.2 and task 4.3.
- Each mutation names the assertion that catches it.
- The ESCALATION exits (task 1.1 feasibility, C2 sweep difference, C4 targets unmet) are explicit and never narrow the AC.
- Scope: the plan is frontend CSS and markup only, with no API or schema impact, so no contract delta is needed. Its mention of the desktop bar width (the sentence width replaces `min(520px, 80%)`) is explicit and justified (D3).
- No `TODO`/`TBD`/deferred blocking decisions remain. The spec delta is consistent with D2's targets and D3.

### Verdict: CONFIRM

### Non-blocking notes
- The file-level "no `linear-gradient` in a `background` declaration" check should match whole declarations, for example `/(?:^|[;{\s])background(?:-image)?\s*:[^;]*linear-gradient/m`. A loose `background[\s\S]*linear-gradient` regex could match across rules once the mask's `linear-gradient` lands after some unrelated `background:` declaration.
- Round 2's notes still apply. The pixel-scan threshold should be ~2/255 (flat fill vs `--app-bg` differs by about 7 per channel). If the corner stop is softened, the corner check must allow partial alpha. Never add padding to the span.
