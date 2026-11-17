## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: bd77ef3a43bc3e67526378f7f23a8a47effa3495. Base resolved live: 7d9b2ea2d47f9ed0c57dddfdaf4fcfb4dd90317d
(`resolve-review-base.sh`, exit 0). I re-ran every load-bearing check myself; the executor and evaluator tables were
treated as claims.

### What I verified (with evidence)

- **Diff read in full** (theme.css, appearanceTokens test, DashboardShelf.tsx, both e2e specs, DESIGN.md, the archive
  one-line edit, the planning artifacts). Six `local()`-only faces, each with all four overrides. Stacks: web font,
  then the Arial-family face, then the DejaVu face, then the unchanged system entries. No `url()`, no new dependency.
- **Gates (fresh, worktree):** jest `appearanceTokens|DashboardShelf|HomePage` 4 suites / 54 tests passed, exit 0;
  `npm run typecheck` 0; `npm run lint` 0; `npm run format:check` 0. The evaluator pasted full-suite numbers. I did not
  re-run the full suite, because only one non-CSS source line changed.
- **AC, CI-like environment, rebuilt by me:** a `mcr.microsoft.com/playwright:v1.55.1-noble` container plus
  `fonts-dejavu` (fc-list: 22 DejaVu and 12 Liberation entries), driven through `PW_TEST_CONNECT_WS_ENDPOINT` against
  7110/10017. I ran the unmodified `hel1665-home-phone-stability.spec.ts` at 375x667, 620x900, 1024x900 and 1280x900,
  light and dark, both orders: **17 passed** (16 plus setup). `fontSwapSpread` was 0 in all 16 tests and
  `fontsAtFirstFrame` was `loading` in every one, so the fallback really rendered before the swap. The 4px assertion now
  runs under the AC's environment.
- **Red-first, plus a width sweep (my own probe, not the spec).** The probe logs in, blocks Google Fonts, holds
  `/api/home-summary` so the loading ghost stays mounted, and compares the ghost's height with the web-font ghost at
  every viewport width from 320 to 1300px. It ran in the same docker browser. Script persisted at
  `/home/matt/Development/helio/.concertino/runs/HEL-1678/evidence/openspec/changes/metric-matched-fallback-fonts/evidence/skeptic/vsweep.cjs.txt`.
  - Head stack: the ghost differs only at **605-613px**.
  - Base stack (fallback names stripped): the ghost differs at **320-330px and at every width from 605 to 1300px**.
  This independently confirms red on base and green on head. It also shows the residual band is exactly the disclosed
  one and 9px wide. It is not a sign of a wider problem the fixed VIEWPORTS list misses.
- **Large-font e2e (docker):** 4/4 passed. At a 24px default, the opening sentence measures 20 to 30px (375) and 24 to
  36px (1280). Overflow is 0 and `runsTopSpread` is 0. The red precondition is real.
- **Width contract (D6a revision).** I recomputed it from `evidence/boxmatch-ci.json` / `boxmatch-dv.json` at weight 400,
  on each face's intended platform font:

  | face | mean | min | max |
  |--|--|--|--|
  | Sans Arial | 1.0172 | 0.9856 | 1.0447 |
  | Sans DejaVu | 1.0112 | 0.9757 | 1.0646 |
  | Mono Courier | 1.0000 | 1.0000 | 1.0000 |
  | Mono DejaVu | 1.0000 | 1.0000 | 1.0000 |
  | Serif Times | 1.0174 | 0.9874 | 1.0462 |
  | Serif DejaVu | 0.9895 | 0.9256 | 1.0455 |

  Line-box height difference is 0 for every face. The claim "mean within 2%, no sample beyond 8%, worst 7.4%" is true on
  the data, and it is disclosed in the spec, design D6a, tasks 2.4b and measurements.md as a revision of the
  gate-approved per-size 2%. **Judgment: honest.** It is a loose contract: 8% per sample is generous, and n=6 per face.
  But the bound on what users see (the line-count sweep and the 0px swap) is measured directly, and that is the real
  evidence. The boxmatch numbers only explain it.
- **605-615px band (head 30px, base 22-24px at 610).** Both base and head wrap the ghost there, so this is not a new
  defect class. Head shifts by one 30px line where base shifted 24. In exchange, head closes 320-330 and 614-1300 on the
  CI-like fallback. Disclosed in the spec as a MAY, in the e2e comment and in measurements.md. **Judgment: an acceptable
  residual for this ticket**, which names 375-540/620/1024/1280 and none of these widths. It must be stated in the PR
  body (see notes).
- **Visual cohesion, running app, 1280x900, dark and light (C12).** Screenshots, persisted:
  - Web fonts loaded, dark: `.../evidence/skeptic/home-1280-dark-webfont.png`. Identical to the evaluator's description.
    Web fonts render, and the token-driven layout is unchanged.
  - Pre-swap fallback (head stack with the web faces removed, so the Liberation-matched faces render), dark and light:
    `.../evidence/skeptic/home-1280-dark-headfallback.png` and `.../home-1280-light-headfallback.png`. The sans and mono
    fallbacks look coherent in both themes. Mono widths match exactly (legend, axis labels and pipeline name sit where
    they do with the web font), weights and colours are unchanged, and nothing overflows or clips.
  - U+2192 arrow after load: `.../allN-link-light-webfont.png` (head) vs `.../allN-link-light-basestack.png` (base stack
    on the same page). Link widths are 43.7px vs 43.0px and the heights are equal (18px). Shelf heading height is 13px
    in both, and the runs card top is 393 in both. The arrow is in the size-adjusted Liberation Sans now and sits about
    a pixel lower and larger. That is not noticeable at reading distance and causes no layout change. Acceptable.
  - (`...` = `/home/matt/Development/helio/.concertino/runs/HEL-1678/evidence/openspec/changes/metric-matched-fallback-fonts`)
- **Extras:** the nested `aria-hidden` is removed (the outer span is still `aria-hidden`, the unit tests pass). The
  archive fix is 22-26 to 22-24. DESIGN.md §3 has its new sentence. Placeholder polish is deferred, per the design.
- **Worktree hygiene:** `git status` shows only the orchestrator's untracked `evaluation-2.md`. My e2e runs deleted
  their throwaway users (17 + 4, teardown log). I stopped my docker container.

### A residual the AC metric cannot see (not a regression)

The AC metric (`fontSwapSpread`) measures the swap only while Home is still loading, when the ghost is capped at `25em`.
The **settled** real sentence keeps `max-width: 40ch`, and `ch` follows the rendered font's `0` advance. I probed this
on the running app at 1280 (host, Liberation). With the head fallback stack the settled sentence's cap is 559.97px, so
it wraps to 2 lines and the runs card sits at 423. With the web font it is 1 line at 393. A user whose data arrives
before the web font therefore still sees a 30px reflow at desktop widths when the font swaps. Base does the same (cap
549px under system-ui, 2 lines, runs card at 426), so this is pre-existing and not introduced by this change. The
executor disclosed it (measurements.md, "fonts blocked and data already loaded"). It is outside the ticket's measured
AC.

### Verdict: CONFIRM

### Non-blocking notes

1. PR body must state: (a) the width-contract revision (per-size 2% replaced by mean 2% and 8% per sample, worst 7.4%);
   (b) the 605-613px band, head 30px vs base 22-24px at 610. My docker sweep shows head mismatches only at 605-613,
   while base mismatches at 320-330 and 605-1300.
2. File two follow-ups: the 605-613px band, and the settled-sentence `40ch` cap that still reflows 30px at desktop
   widths when data beats the web font (it is pre-existing on base, and an em-based cap or a digit-matched measure would
   close it). Placeholder polish was already marked as a follow-up.
3. The evaluator's note stands: measurements.md cites screenshots by absolute host path. They are portable only for this
   machine.
