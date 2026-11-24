## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD b2da43a3d02ba1b84eb8296b9bd9ed742623a353. The planning artifacts are untracked in the change dir. My probes
are in `/home/matt/Development/helio/.concertino/scratch/HEL-1836/skeptic-design-3/`:
- p3.cjs / p3.txt: model params, an equivalence fuzz, and the D4 (a)/(d) frames;
- p4.cjs / p4.txt: which astral-class patterns the allowlist accepts.

Both run against main's transpiled modules in `scratch/HEL-1836/cal-main`, with `nice -n 19`.

### What I verified (with evidence)

1. **Code ground truth matches the design's description.** I read `regexInputCost.ts` L34-206:
   - `perPositionWork` uses `codePointAt` + `inRanges`.
   - The unanchored stage 1 is `LONE_SURROGATE.test ? 2L : L`.
   - `hasNoLoneSurrogate` captures `isWellFormed` at module load (L130-133).
   - Anchored stages are at L193-199.

   `chars` comes only from `unionSets` → `normalize` (javaRegexCost.ts L207, javaRegexSets.ts L10-19), so it is sorted,
   merged and disjoint. No test builds a `RegexWork` literal by hand (grep `chars:` finds only javaRegexCost.ts). That
   makes D1's table identical to `inRanges` on every BMP value.
2. **Model parameters (p3.txt).**
   - `(x)`, `([^a]+)`, `(.+)`, `(\S+)`, `(\d+)`: A=1 W=1 m=0 f=1, unanchored.
   - `([^acegikm]+)` and `([^жикморт]+)`: 8 ranges, f=1, so they are the widest f=1 class as D5 claims
     (`classFactor` L138-144: f=1 for r ≤ 8).
3. **D1 is charge-identical.** I fuzzed a table + `charCodeAt` scan written to D1's text against shipped `cellWork`:
   - 200,000 seeded cells over 10 patterns: 0 differences.
   - Seeds included each range's lo-1/lo/hi/hi+1, U+FFFF/U+10000, lone highs and lows, and reversed pairs.
   - Patterns included the class straddling U+FFFF `([￰-\u{10010}]+)` (literal characters), the astral class
     `([😀-🙏]+)` and the negated astral `([^😀]+)`.

   In the same run, D3's `boundAt(unitLength)` was ≥ `cellWork` on every cell (true upper bound).
4. **D2 is decision-identical.** `boundAt` is non-decreasing in L for non-negative coefficients, and stage 1's L is at
   least `text.length`. D2 is now explicitly unanchored-only, and the anchored order is untouched.
5. **D4 (a) is red on main and green under D1+D2 (p3.txt).** Counts of `codePointAt` calls:

   | frame | exact | length-only | main | D1+D2 |
   |---|---|---|---|---|
   | (x) cyr + trailing `\ud800` (group H) | 4,000,000 | 7,998,000 | 3,999,000 | 0 |
   | surrogate-free cyr | 4,000,000 | 8,000,000 | 4,000,000 | 0 |

   Decisions are equal on both frames.
6. **D4 (d) holds.** On the (d) frame (cyr at 2.0e6) the length-only sum is exactly 4,000,000, so stage 1 admits the
   frame and it is never scanned. The `2 x text.length` mutation gives 8e6 and forces a scan, so (d) catches that
   mutation as designed.
7. **Earlier change requests are resolved in substance, not just reworded.**

   Round 2:
   - CR1: the r=8 f=1 class and its two-byte twin are in group J (one-byte control, 1k/20k rows, with and without a lone
     surrogate). The loosest-set rationale is rewritten around r=8.
   - CR2: about 46 ms is cited, and the exact value is deferred to calibration.md.
   - CR3: D2 is scoped to unanchored patterns.
   - CR4: (b) now has a seam installed before module load (`isolateModules` / dynamic require), plus a liveness check
     that stage 1 counts one call per cell. The "delete D2, keep D3" mutation is listed and caught by (b). I confirmed
     the round-2 diagnosis myself: `isWellFormed` is captured at L130.
   - The note on deterministic endpoint seeding is adopted in (c).

   Round 1:
   - CR1-CR5 are present: non-member bodies, a second lever plus D6, timing the shipped decision plus exec, main's
     unrecorded rows, and task 3.5 for AC4.
8. **AC coverage.**
   - AC1 → D4 (a) and tasks 1.1/1.2.
   - AC2 → D5/D6 and tasks 3.1/3.2. This includes the restated scope's added surrogate-free `(x)` shape, and the D-control
     is reported, not chased.
   - AC3 → D7 and task 3.3.
   - AC4 → task 3.5.

   The ticket's rule "If a row cannot get under 20 ms, escalate with the numbers" is carried by D6. No TBDs or
   placeholders. Scope stays frontend-only: no budget, constant or parity-corpus change.
9. **Feasibility.** probe-lever.txt puts the decision at 6.7-6.8 ms and totals at 17.0-19.1 ms. Round 2's r=8 row was
   19.4-19.9 ms. That is marginal, but D6 handles it honestly: rerun once, tighten the loop charge-identically, else
   escalate. Nothing gets loosened.

### Verdict: CONFIRM

### Non-blocking notes

- **Task 1.1 says "see red on main" for all of (a)-(d).** Only (a) and (b) can be red on main:
  - (c) compares against a reference copy of main's code, so it is trivially green on main;
  - (d) is green on main (p3.txt: 0 scans).

  The executor should label (c) and (d) as guards, shown failable by their listed mutations, not as red-first tests.
- **D4 (c) needs literal-character patterns for the astral and straddling classes.** The allowlist rejects `\x{...}`
  and `￰`-style escapes in a class (p4.txt), but accepts literal-character classes such as `([😀-🙏]+)` and
  `([<U+FFF0>-<U+10010>]+)`.
- If D3 is reverted on measurement (task 2.3), the (b) seam must switch to counting `RegExp.prototype.test`, and the D3
  mutation drops out. Record which applied.
