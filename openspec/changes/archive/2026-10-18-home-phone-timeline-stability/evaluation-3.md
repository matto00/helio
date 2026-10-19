## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD fec0a6562ce42bfa445ce473c7669fd33f76ffc2 (diff 7d9bd8bc1..HEAD and the full branch against base
6477341111). Evidence is in `/home/matt/Development/helio/.concertino/scratch/HEL-1665/`:
- `eval3-fontswap-{held,natural}.json`: cold contexts, default and Serif-headings variants, 375–1280.
- `eval3-fontswap-band-held.json`: 605–635px at 1–2px steps.
- `eval3-e2e-run.txt` and `eval3-e2e-repeat.txt`: e2e output.

### Cycle-2 change requests

1. **The `25em` cap is fixed and verified.**
   - `HomePage.css:28` changed from `max-width: 40ch` to `max-width: 25em`, with a comment explaining why. A CSS
     guard test pins `25em` and checks that no `ch` value returns.
   - The cold-context method from cycle 2 (empty cache, real Google Fonts) on HEAD gives a runs-card top spread in
     the held order of 4/4/4/4/3px at 640/700/768/1024/1280. The natural order gives the same. In cycle 2 these widths
     measured 34/34/–/34/33.
   - The settled tops are unchanged at every width (393 at 1280, which is the C1 pin).
2. **The swap bound is asserted.**
   - `fontSwapSpread <= 4.5` sits in every shift test (`hel1665…spec.ts:146`). In this run all 24 values were 3–4px.
   - Red on 7d9bd8bc1: my own cycle-2 run of that commit's spec logged `fontSwapSpread: 33` for all four 1280 cases,
     so this assertion would have failed there.
3. **Spec, design and hand-off are corrected.** They now name the `ch` cause and the `25em` fix and state a bound of
   4px or less. One inaccuracy is left (see the residual below).

### Residual (non-blocking): a 605–615px band, plus a check on Serif headings

- **605–615px band.** The default style still has an 11px-wide band, 605–615px, where the fallback font wraps the
  default sentence one line early. There the cold-load swap is **34px**, in both the held and natural orders.
  - At 616px and up it is 4px (`eval3-fontswap-band-held.json`).
  - The band sits right at the 1-line/2-line switch for the loaded sentence. No `max-width` fixes it, because the
    container width is what forces the wrap. A `size-adjust` fallback is the only fix.
  - No common device width falls in this band.
  - The spec's "at most 4px … at every width" is therefore slightly overstated.
- **Serif headings.** I approximated Serif headings by forcing `--font-heading` to the serif face. At 540px that showed
  a 30px cold-load swap: Georgia is 1 line and the loaded font is 2. Settled tops at every width match the default
  style, which supports the executor's claim that the settled wrap is unchanged. My injection may not follow how the
  app actually loads that style's font, so this is a lead, not a finding.
- I don't hold back PASS for either: both are cold-load-only font-metric effects in narrow cases. The orchestrator
  should still correct the wording before merge (see suggestions).

### Phase 1: Spec Review — PASS

- **AC1:** with fonts loaded, the timeline moves 0px at every scenario viewport, both themes and both orders. The 16
  shift tests have 24 cases, and with `--repeat-each=2` all 50 tests passed. Cold-load swap is ≤4px outside the
  605–615 band.
- **AC2:** documented-and-parked per C2. The hand-off is present and current.
- **AC3:**
  - fails-first evidence exists for the original shift (cycle 1), for 480/540 (cycle 2), and for the swap bound (my
    cycle-2 measurement);
  - mutations M1–M5 were recorded in cycle 1.
- **C1:** the 1280 pinned-boxes test passes in light and dark, and my probe shows the same 393 top.
- **C2:** honored.
- **Tasks:** 3.7 is still open, which is right because it is the PR/merge disposition.

### Phase 2: Code Review — PASS

- **Gates I re-ran:**
  - `npm run lint` (exit 0), `format:check` and `typecheck` (exit 0) pass; `check:e2e-types` exits 0.
  - Jest with 2 workers: root 524/524, frontend 9058/9058.
  - The frontend build passes.
- **e2e:**
  - `hel1665` + `hel1642` + `hel1583-home-375` + `hel1578-home-page`: 55/55, exit 0.
  - Shift tests with `--repeat-each=2`: 50/50, exit 0. With cycle 2's 75/75 that makes 125 consecutive green runs
    of the shift tests.
- The cycle-3 change is one CSS declaration with a comment, one guard test and one e2e assertion. It is minimal and
  uses no new tokens. The `em` unit replaces an existing `ch` unit, so this is not a new raw-px value under the
  DESIGN.md mechanical rules.

### Phase 3: UI Review — PASS

- With fonts warm, the loading and settled states are coherent and match to the pixel at 375x667, 375x812, 430x932,
  480, 540, 604, 605, 1024 and 1280, in light and dark (cycle-2 probe; cycle 3 changes no geometry at these widths
  when the web font is loaded).
- No console errors. No horizontal scroll.
- The hidden link slot and the ghost sentence are both `aria-hidden` and `visibility: hidden`. Neither can take
  focus, and the screen-reader tree while loading shows only the status regions.
- Test data: the e2e global teardown deleted every recorded user, and `users like 'hel1665h-%'` = 0. I created no
  data.

### Overall: PASS

### Non-blocking Suggestions

- Before merge, change one sentence in each of three places.
  - `specs/home-page/spec.md:24-25` and `item2-owner-handoff.md`'s web-font residual: "at most 4px … at every width"
    should become "at most 4px, except about 605–615px, where the fallback font wraps the default sentence a line
    early (34px measured) until a `size-adjust` fallback lands".
  - design.md's cycle-3 addendum: add the same band.
- Hand-off: list the Serif-headings cold-load observation (540px, ~30px, from an injected approximation) for the owner
  to confirm under the real type-style path.
- 431–604px loading state: one bar centred in a two-line block. This is a judgment call for the skeptic.
