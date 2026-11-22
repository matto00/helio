# Coverage comparison (HEL-1806)

Before: `01-baseline-all-five.txt` (unmodified tree 787a283e9). After: `05-green-all-five.txt` (final tree). Both: all five
`state-surface-contrast-guard-*.spec.ts` files, full, 2 workers, 40 passed.

- Set of tests: the passed-test titles of the two runs (file:line stripped, sorted) are identical, 40 titles
  (`diff` empty). `--list` per narrow part, before vs after, is also identical (`06-width-by-value-checks.txt`).
- Per-cell sampled counts: every `[HEL-866 guard] view "<view>" (<theme>): N visible interactive element(s), sampled M`
  line (sorted) is identical between the two runs; `diff` empty over all lines. In particular `/pipelines/:id` at
  1440 is 19 visible / 19 sampled in both themes before and after.
- The only difference is the added assertion and its log line `[HEL-1806 guard] ... probed at 1440px (<theme>) in view
  "/pipelines/:id" (doc id 22)` in both themes: the refresh button was already among the 19 sampled in the baseline run
  (the race did not bite there), so its count did not change; the change makes that guaranteed instead of timing-dependent.
- The refresh button is sampled at 768 and 390 too (`[HEL-1649 guard]` lines, unchanged).
