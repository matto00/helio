# HEL-1836: Client draft regex: apply the exact-length rule to the unanchored stage-2 bound (last 21-25 ms calibration rows)

## Description

Filed from HEL-1823 (PR #1245, merged as a938420dc). HEL-1823 made the anchored stage-2 bound in `regexInputCost.ts`
count each cell's exact length (UTF-16 length plus one per unpaired surrogate) instead of doubling the whole cell. Two
rows over 20 ms were said to remain on paths HEL-1823 did not touch: the unanchored `(x)` rows in group H (25.2 ms) and
the group-D `(.{16})x` control row (21.4 ms). Both are under the owner's 50 ms limit (HEL-1697 ruling C2).

Original "Do": apply the same exact-length rule to the unanchored stage-2 bound, keeping it a true upper bound; re-run
the calibration (`calibrate-anchored.mjs`, groups A-I); keep `REGEX_WORK_BUDGET` at 4.00e6 and the parity corpus
unchanged; no decision may change and no pattern may cost more.

## Premise refuted, scope restated (owner answer 2026-11-24: proceed-with-restated-scope)

Premise validation (`.concertino/runs/HEL-1836/evidence/premise-validation.md`) refuted the original premise on main:
`(x)` compiles to A=1 W=1 m=0 f=1, so its unanchored bound is `2L` against an exact charge of `L` for a cell with no `x`.
The looseness comes from treating the whole cell as one matching run, not from surrogates: on the worst frame the
exact-length bound is 8.0e6 (> 4.0e6), so the exact per-character scan still runs and that scan is the 21-27 ms. The same
frame with NO unpaired surrogate takes 25.6-28.2 ms of decision and is in no calibration group. The group-D
`(.{16})x` control is an exec-only timing (no decision, no surrogates) re-measured at 19.0 ms: report it, do not chase it.

Restated scope: target the unanchored decision scan, or a tighter unanchored bound for W=1/m=0 patterns (any bound must
stay a TRUE upper bound of `cellWork`, with the reason shown); add the surrogate-free cyr `(x)` shape to calibration.
`REGEX_WORK_BUDGET` 4.00e6, the parity corpus and every decision unchanged; no pattern may cost more. If a row cannot get
under 20 ms, escalate with the numbers.

## Acceptance criteria

- [ ] A test that fails first on the worst unanchored `(x)` row (red run committed before implementation; mutations recorded).
- [ ] Calibration (groups A-I plus the added surrogate-free `(x)` shapes) shows no row over 20 ms (group-D `(.{16})x` exec-only control reported, not chased) and zero decision differences; no cost differs.
- [ ] The prod-build e2e long-task check passes (`npm run e2e:prod-build`).
- [ ] The PR body carries a scope note: the original premise was refuted (cite premise-validation.md).
