## Skeptic Report — design gate (round 5, skeptic-design-5.md)

I reviewed HEAD bd10d1767eb04e9467428155ed99c92554a01f11 plus the uncommitted design.md, spec.md and tasks.md revision
(the "D1 addendum (skeptic-design-4.md)").

Setup:
- Node v22.23.2, `nice -n 19`, one process at a time.
- The probes use the compiled `javaRegex*.js` in `skeptic3/js`. That is the cycle-1 translation, and it uses the same
  `u`-mode source as HEAD.
- Probes are in `/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic5/`:
  - `shapes.cjs` takes 1,000 rows of 333 characters. It compares one-byte `a...` cells, Cyrillic cells and uncharged
    lone-high cells, and reports the best of 5 timings.
  - `classes.cjs` varies the number of ranges in a counted negated class.
  - `ascii.cjs` builds negated classes from N alternating printable-ASCII code points.
- In every probe, all cell characters are inside the pattern's `U`. The run-based cost is therefore the whole-cell
  formula, `len + len*min(len,F) + m*len^2`, using the `F`/`m` that `compileJavaRegex` returns.
- `ms@4e6` is the predicted step time at the budget the addendum expects (about 3.9-4.3e6).

### What I verified (with evidence)

- **Round 4, CR1 is addressed in the text.**
  - The addendum adds the requested rows: `(.{8})x`, `(.{12})x`, `(.{16})x`, `(\S{16})x`, `(.{100})x` and `(.*)x`,
    each on Cyrillic, CJK, ASCII plus one em dash, and a two-byte-slice ASCII cell.
  - It names remedy (a): no per-cell two-byte charge, and the budget is taken from the max ratio over all rows.
  - tasks.md 3.5 matches the addendum.
- **Round 4, CR2 is addressed.**
  - The addendum adds the lone-high, lone-low, mixed `\uD800a`/`a\uD800` and `(.{12})x` lone-high rows.
  - It keeps the charge only if the uncharged lone rows exceed the new max, and requires the outcome to be recorded.
  - My probe shows the charge will most likely be kept. Uncharged lone-high is 5.18-5.93 ns/unit across `(.{16})$`,
    `(.{16})(.{16})x`, `.{16}x|.{16}y`, `[^x]{16}x` and `(.{16})x`. Cyrillic is 4.06-4.79 on the same shapes.
- **The other two-byte shapes I tried stay within the addendum's expected max** (Cyrillic, ns/unit):
  - `(.{16})$`: 4.08. The `$` lookaround tail costs nothing extra.
  - `(.{16})(.{16})x`: 4.39.
  - `.{16}x|.{16}y`: 4.79.
  - `(.*?)x`: 1.58.
  - `(.{1000})x`: 2.34.
  - `[^x]{16}x` and `[^aeiou]{16}x`: 4.06-4.56.
  - A realistic punctuation class `[^ ,;:.!?()<>/@#*+=%"]{16}x`: 4.56.
  - Lazy counted `{8,16}?` and quantified groups are declined by the tokenizer.
- **Remaining defect: a character class with many ranges is 2-3x slower per unit than any calibration row, and its
  representation is visible in the pattern, not the data.** V8 compiles a large class into a range search, and its
  per-character test is much slower than the test for `.` or a short class. The calibration list (including the
  addendum) contains only `.`, `\S`, `\D`, `\w`, `[^a]` and literal atoms, so the derived budget never sees this
  case. I reproduced each figure below on a second run within about 1.5%.

  `classes.cjs`: `([^<N code points above U+00FF>]{16})x`, ns/unit

  | N ranges | one-byte `a` | Cyrillic | `a`x331 + em dash | ms @ 4e6 (two-byte) |
  |---|---|---|---|---|
  | 1 | 1.41 | 4.07 | 4.06 | 16 |
  | 8 | 1.57 | 4.40 | 4.20 | 17 |
  | 32 | 1.40 | 8.40 | 8.59 | 34 |
  | 128 | 1.41 | 9.94 | 9.86 | 40 |
  | 384 | 1.40 | 11.73-11.89 | 10.54-10.62 | 42-48 |
  | 1500 | 1.41 | 12.81 | 12.50 | 50-51 |
  | 3000 | 1.41-1.58 | 13.61-13.66 | 13.10-13.15 | 52-55 |

  `ascii.cjs`: negated classes of plain printable ASCII, for example `([^!#%')+/13579;=?A]{16})x` at N=16. These slow
  down one-byte cells too:

  | N ranges | one-byte `a` | Cyrillic | ms @ 4e6 |
  |---|---|---|---|
  | 16 | 1.91 | 7.75 | 31 (two-byte) |
  | 24 | 3.01 | 8.41 | 34 |
  | 40 | 5.85 | 8.28 | 23 (one-byte) / 33 |
  | 90 | 6.89 | 9.17 | 28 / 37 |

  Other shapes:
  - `[^bdfhjlnprtvz02468BDFHJLNPRTVZ]{16}x` is a plausible "consonants and even digits" class. It measured 5.63 on
    one-byte and 8.40 on Cyrillic.
  - `([^<384 ranges>]*)x`, the quadratic `m=1` path, measured 6.36 on Cyrillic and 6.59 on uncharged lone-high.
  - A positive class with many ranges that includes Cyrillic, `[a<384 ranges>а-я]{16}x`, measured 9.61 on Cyrillic.

  So at the budget the addendum derives (about 4e6 from a max of about 5 ns/unit), an accepted step with one
  16-range class runs about 31 ms on any cell that holds one non-Latin-1 character. With a large class it runs 50-55 ms.
  The spec requires at most 20 ms, and 50-55 ms is past the 50 ms long-task threshold on the reference machine
  itself. On the 2-3x slower CI runner the design allows for, that is 100-165 ms, which breaks the e2e 100 ms bound.
- **Nothing else regressed.**
  - `clientEvaluable` stays config-only.
  - `git status` shows only the change dir modified.
  - The spec's "a per-character charge" wording no longer contradicts the lone-surrogate charge.

### Verdict: REFUTE

### Change Requests

1. **design.md D1 addendum and tasks.md 3.5: make the cost depend on class size.** Add calibration rows for counted
   and unbounded classes with many ranges: `([^<N ranges>]{16})x` and `([^<N ranges>]*)x` for N in {16, 32, 384, 3000}.
   Run each on one-byte, Cyrillic and ASCII-plus-em-dash cells. Repro:
   `/home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic5/classes.cjs` and `ascii.cjs`. Then name one
   remedy in D1:
   - (a) Fold these rows into the max. That gives about 13.7 ns/unit and a budget of about 1.4e6.
   - (b) Recommended. The range count is pattern-only and deterministic, so the observability argument that ruled out a
     two-byte charge does not apply. In `regexWorkModel`, charge each atom's per-character work by a calibrated
     class-width factor, a step function of the atom set's range count (for example 1 at 8 ranges or fewer, k at more).
     Apply the factor both to the per-start `W` and to the quadratic `m`. Show from the new rows that the charged
     ratio stays at or under the max ratio of the other rows. Add a Jest decline test for a many-range class frame that
     goes red when the factor is forced to 1.
   - (c) Decline classes above a range count as `unsafeRegex`. This option is allowed only if
     `git diff main -- shared-test-fixtures` stays empty and no corpus vector changes its `clientDeclines`. Show that
     with a grep of the corpus patterns.

   Whichever remedy is chosen, the design must state the range count (after set merging) that the factor or the
   decline keys on, and how it is read from the `Ranges` set.

### Non-blocking notes

- tasks.md still lists 3.5 before 3.4. This is cosmetic.
- The PR-body threshold note will need re-measuring once more after this change.
