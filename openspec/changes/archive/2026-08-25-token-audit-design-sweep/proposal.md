## Why

`DESIGN.md` §3 marks its color/spacing/typography token rules `[mechanical]`
— greppable, zero-judgment rules — but no sweep has ever enforced them across
the whole `frontend/src` tree. Drift has accumulated: literal px spacing,
literal font-size/weight, and (rarely) ad-hoc hex colors sit alongside the
correct token usage in older CSS modules. HEL-439 audits and remediates that
drift, and adds a guard so it can't silently regress.

Three sibling tickets (HEL-652, HEL-677, HEL-680) previously spun off
instance-level findings of this exact gap. HEL-652 and HEL-677 are fully
subsumed by this ticket's spacing sweep and have been closed as duplicates.
HEL-680 needs a *new* token (out of this audit's scope) and stays open,
informed by this ticket's findings.

## What Changes

- Mechanically enumerate every `DESIGN.md` §3 mechanical-rule violation in
  `frontend/src/**/*.css` and `*.tsx`: literal color hex/rgb/rgba where an
  `--app-*` token applies, literal spacing (`margin`/`padding`/`gap` > 4px)
  where a `--space-*` token applies, literal `font-size` where a `--text-*`
  token applies, literal numeric `font-weight` where a `--weight-*` token
  applies, and ad-hoc `font-family` declarations.
- For each exact 1:1 match (a literal value **exactly** equal to an existing
  token's value — no tolerance, to avoid uncontrolled visual changes),
  substitute the token. Leave anything without a matching token value, or
  requiring a structural decision beyond a value swap, unfixed and
  enumerated with a reason. (Revised after design-gate skeptic round 1: a
  full classification found this fixable set is a **minority** of the >4px
  spacing population — ~84-108 fixable vs. ~120 off-scale with no token —
  not "the vast majority" as originally assumed.)
- Add guard test(s) (`*.css.test.ts`, following the `Modal.css.test.ts` /
  `inputs.css.test.ts` pattern) that scan the swept files for the same
  literal patterns and fail on any **new** disallowed hit or any regression
  of an already-fixed literal, pinned against an explicit baseline of the
  known off-scale residual (which will legitimately remain).
- No new tokens are added. The off-scale residual this audit enumerates
  (~120 spacing literals with no matching token, dominated by `6px`/`10px`/
  `14px`/`7px`/`5px`) is materially larger than HEL-680's stated remit ("the
  one already-known compact-chip case") — the PR description flags this for
  a human decision on broadening HEL-680 or filing a further follow-up.

## Impact

- Affected: CSS modules and TSX inline styles across `frontend/src/features/**`,
  `frontend/src/shared/**`, `frontend/src/app/**`. Pure styling substitution;
  no component logic, no new tokens, no `.husky/**` or gate-chain scripts
  touched.
- Risk: visual regression from an incorrect token substitution. Mitigated by
  substituting only exact-value matches (no tolerance) and spot-checking
  rendered output (light + dark) for every touched surface before
  considering a file done.
