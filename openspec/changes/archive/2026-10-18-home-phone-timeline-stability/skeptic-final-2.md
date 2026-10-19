## Skeptic Report — final gate (round 2, skeptic-final-2.md)

- **Reviewed:** HEAD `837363bfa3c5372b2b7ccc1fddc6c82db6e3edbd`.
- **Base:** `6477341111d4b4ec6d0368e5a1f46e473325f226`, resolved live with `resolve-review-base.sh` (exit 0).
- **Spawn-cwd guard:** printed `READY`.
- **Evidence directory:** `/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/scratch/HEL-1665/skeptic-final-2/`. Every evidence ref below is in this directory.

### What I verified (with evidence)

#### 1. The 40ch discrepancy is explained by the Chromium version

The previous review and the executor measured different widths for `40ch` because they used different Chromium
builds. Neither measurement was wrong. Both of my measurements below are fresh.

| | Chromium 151 (Playwright MCP browser) | Chromium 140.0.7339.186 (repo e2e, Playwright 1.55.1) |
| --- | --- | --- |
| What I measured | The real `.home-opening__sentence` at 1280x900 on the dev account, after `fonts.ready` | A fresh `<div>` styled `width:40ch` in `"Schibsted Grotesk"` at 24px, on `/login`, after `document.fonts.load` |
| `40ch` | **586.875px** (computed max-width; the 40ch probe div matched) | **600px** |
| `25em` | 600px | 600px |
| Rendered "0" advance | 15.158px | 15.9px |
| Default sentence natural width | 581.27px | 580.05px |

- The 151 result reproduces the previous review's 586.875px exactly.
- The 140 result reproduces the executor's 600px. That build is what the e2e suite runs, which is why its
  long-sentence test logs `ch40: 600px`.
- `ch` resolves differently between the two Chromium builds against the same Google-served font. The rendered "0"
  advance does not even match `ch` in either build.
- Conclusion: `40ch` depends on the environment, and `25em` is 600px in both builds.
- Evidence: `ch-measurements.json`. The script is `scratchpad/chprobe/probe.cjs`.

#### 2. Settled desktop Home is identical to base, for every sentence

- The real sentence's rule is byte-identical to base. The `.home-opening__sentence { … }` rule body has the same
  sha1 on 647734111 and on HEAD (`a7947933…`).
- The only `-` lines in the branch's `HomePage.css` diff are in the touch block (`max-width: 768px` or
  `pointer: coarse`). That block does not apply at 1280 with a fine pointer.
- The other changes do not affect the settled state:
  - the link slot renders only when there are no dashboards;
  - the legend renders the same as base whenever `pipelines.length > 0`;
  - the ghost renders only while loading.
- So the settled layout cannot differ from base, in any browser, for any sentence. This holds even where `40ch`
  is 586.875px.
- This closes skeptic-final-1 CR1 (the 19/625 sentences that wrapped differently): with `40ch` back, they wrap
  exactly as on base.

#### 3. The ghost and the real default sentence never disagree on line count

- I swept container widths from 280 to 1300px in 1px steps, at 24px and at 20px (the ≤430 size), in Chromium 151.
  This is the build where the ghost's cap (600px) and the real sentence's cap (586.875px) differ.
- I compared the real sentence's height with the ghost's height at each width:
  - **default type style:** 0 mismatches;
  - **"Serif headings":** real cap 619.7px, ghost cap 600px, 0 mismatches;
  - **"Mono":** real cap 576px, ghost cap 600px, 0 mismatches. Both are two lines at desktop.
- Why it holds: the default sentence (about 581px) is narrower than both caps whenever the cap is what limits the
  width. Below that, the container decides for both.
- So the ghost does not mis-predict the default sentence anywhere in the environments I could measure, and the
  restored load shift does not come back. In Chromium 140 the two caps are both 600px, so they match trivially.
- Evidence: `ch-measurements.json`.

#### 4. e2e on HEAD: 65/65 passed

- **Run:** `hel1665` + `hel1642` + `hel1583-home-375` + `hel1578-home-page`, with 2 workers, `nice -n 19`,
  `--trace retain-on-failure`, under the e2e flock. Result: **65 passed, 2.6 min**.
- **Shift tests:** 28 width × theme × order cases, at 375 (×2 heights), 430, 480, 540, 620, 1024 and 1280:
  - `runsTopSpread` = 0 and `contentTopSpread` = 0 in every case;
  - settled line counts are 2 at ≤540 and 1 at ≥620;
  - `fontSwapSpread` is 3 to 4px, under the asserted bound of 4.5px.
- **Long-sentence C1 test:** passes in both themes (`settledMax` = `ch40` = 600px, 2 lines).
- **Touch test:** `All N` is 44.5 × 48.5 and `+N more` is 44.5 × 54.5; the shelf head is 18px tall.
- **Cleanup:** teardown deleted 65 users, and `users like 'hel1665h-%'` = 0.
- Evidence: `green-head.txt`.

#### 5. Other gates

- Home jest: 15 suites, 99 tests passed.
- `eslint src/features/home --max-warnings 0`: clean.
- Prettier check on the changed sources and e2e files: clean.

#### 6. AC1 red-first evidence still holds

- skeptic-final-1 ran the shift tests on base and recorded them red: the runs card top spread was 61px at 375/430,
  71px at 480/540 and 11px at 1280 (`../skeptic-final/red-head-spec-on-base.txt`).
- That spec's shift tests are unchanged in 837363bfa. The commit only adds the viewports 620 and 1024, plus a
  settled C1 guard that is meant to pass on base.
- The cycle-4 mutation (`cycle4/mutation-real-sentence-24em.txt`) shows the long-sentence test turns red when the
  real sentence's cap changes (576px vs 600px).

#### 7. AC2 is documented and parked

- C2 parks item 2. `item2-owner-handoff.md` gives four options and before/after numbers at 375×667.
- I measured live at 375×667 on the dev account:
  - runs card top 480.8;
  - nav top 599;
  - shelf head 18px.
- These match the hand-off's after-item-1 numbers (base was 506.8). The hand-off's residuals now describe the
  40ch/25em split correctly.

#### 8. Visual review against DESIGN.md (settled; dev account, Chromium 151)

- **Screenshots:** `head-375x667-dark.png`, `head-375x667-light.png`, `head-430x932-light.png`,
  `head-480x900-dark.png` and `head-1280-settled-current.png` (light).
- **Theme parity** is good.
- **The "All N →" link** sits on the eyebrow's baseline line.
- **Cards and spacing** are on the same rhythm as their siblings.
- **Console:** no errors.
- **Loading state:** I took the frames from the evaluator (`eval2-loading-*`) because the ghost geometry is
  unchanged since then. They are coherent: the legend shows, the skeleton cards are the loaded size, and one bar sits
  over the two-line ghost at phone widths.
- **Tokens:** the new CSS uses tokens and existing units. `max-width: 25em` is a unit change on a hidden element, not
  a new raw px value.

#### Gate-defect check

No claim here rests on mtime ordering. Everything rests on computed-style measurements, sha1 comparisons and test
output.

### Verdict: CONFIRM

### Non-blocking notes

- **The e2e test does not catch every reversion of the real sentence's cap.** In the repo's Chromium 140,
  `40ch` = `25em` = 600px. So if the real sentence went back to `25em`, the e2e's `settledMax === ch40` assertion
  would still pass, and its `lines === 2` assertion passes at both 576px and 600px. The jest CSS guard
  (`HomePage.css.test.ts`: the real sentence is `40ch`, the ghost is `25em`) is what pins this. design.md's claim that
  the test is "environment-independent" is true only in that it never compares against a fixed number.
- **The executor's design note says `40ch` resolves to 600px.** That is true only in Chromium 140. In Chromium 151
  it is 586.875px. The cap is pre-existing base behaviour that this branch no longer changes, but the PR body could
  say that `ch` depends on the Chromium build.
- **The 431–604px placeholder is still one bar centred in a two-line block.** This is polish, carried over from
  round 1.
