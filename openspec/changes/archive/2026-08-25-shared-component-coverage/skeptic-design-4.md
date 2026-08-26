## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Narrow confirmation round, scoped to round 3's two Change Requests. Round 3 already
validated selector uniqueness, specificity math, and custom-property definedness; not re-audited.

### What I verified (with evidence)

1. **`display: inline-block` in all three CSS blocks** —
   `grep -n` on `design.md` returns `display: inline-block;` at lines **96, 126, 158**, i.e. once in each of
   `.ui-input.panel-grid-card__title-input`, `.ui-input.pipeline-detail-page__footer-output-input`, and
   `.ui-input.type-detail-panel__name-input`. No residual `display: block;` anywhere in the file.

2. **`line-height: inherit` in all three CSS blocks** —
   `line-height: inherit;` at lines **108, 136, 171** — one per block. No residual `line-height: normal;`
   in any CSS block.

3. **Explanatory paragraph accurate against ground truth** — `design.md:185-193` states the `inline-block`
   rationale (matches a native `<input>`'s own default display, avoids an unintended full-line-box change)
   and the `inherit` rationale, citing `frontend/src/theme/theme.css:271-277`. I read that range directly:

   ```
   271
   272  body,
   273  button,
   274  input,
   275  textarea,
   276  select {
   277    font: inherit;
   278  }
   ```

   The citation is exact (the rule spans precisely 271-277 as cited), the selector list does include `input`,
   and `font: inherit` does reset the `line-height` component — so the paragraph's claim that these inputs'
   pre-migration line-height was inherited from an ancestor rather than the UA-default `normal` is correct,
   and `line-height: inherit` is the faithful reproduction. `body` sets `line-height: 1.5` (theme.css:265),
   which concretely confirms a literal `normal` would have been a real visual change, not a cosmetic nit.

### Verdict: CONFIRM

Both round-3 Change Requests are applied correctly and completely — both properties, all three blocks — and
the supporting prose is accurate against the cited source.

### Non-blocking notes
- `design.md:24` (the property-diff table row for `display`/`gap`/`line-height`) still describes the current
  local styling as "browser default `inline-block`, normal line-height". The `inline-block` half is right,
  but "normal line-height" is the exact claim round 3 refuted, so that cell now mildly contradicts the
  paragraph at 190-193. Purely descriptive context — it drives no CSS in the plan and no implementation
  decision — but worth a one-word fix to "inherited line-height" whenever the file is next touched.
