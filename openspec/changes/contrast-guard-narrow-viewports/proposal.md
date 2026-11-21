## Why

The HEL-866 state-surface contrast guard measures hover and focus at 1440x900 only. Layouts that render only at
narrower widths (mobile pipeline spine, phone command bar and glass bottom nav, dashboard chip row, phone home) are
never measured, so an invisible hover there ships green (HEL-1628's spine-card and since-deleted phone-header refresh,
1.03 and 1.000 against the 1.10 floor, were found by hand).

## What Changes

- The guard gains narrow-viewport cells at 1100, 768 and 390 px wide, both themes, alongside the unchanged 1440 cells.
- Narrow cells use a hover-capable (fine) pointer, because HEL-1735 gates feature hover behind `(hover: hover)`;
  layouts are selected by width, which is how the phone shell and mobile pipeline are gated.
- Narrow cells keep the guard's whole-document partition check, so a narrow-only control that no view covers fails
  loudly instead of going unmeasured.
- Mutation evidence: HEL-1628's pre-fix spine-card hover, reintroduced, fails the guard at 768 and 390; the phone
  command-bar logo's hover flattened to its backdrop fails at 768 and 390; both pass on main.
- CI runtime impact measured locally and on the PR's CI run, stated in the PR.

## Capabilities

### New Capabilities

### Modified Capabilities
- `state-surface-contrast-guard`: adds a requirement that the guard measures the redesign's narrow layouts.

## Impact

- `e2e/support/state-surface-contrast-guard.ts` (second-dashboard seed option, bottom-nav hover exemption, scope comment, opt-in ratio dump), `e2e/support/state-surface-contrast-guard-narrow.ts` (the narrow cell registration) and two new part spec files split by width (`-narrow-1100-768`, `-narrow-390`).
- App CSS (owner rulings C1/C2): DESIGN.md §5 hovers, gated on `(hover: hover)`, for every control in the C2 inventory
  (see `hover-inventory.md`: `.dashboard-chip` inactive and active incl. the Data section links, `.app-command-bar__mobile-title`, `.tl-disc__head`); glass bottom-nav tab hover exempted (HEL-1801). No
  backend, no migration. `e2e/shard-weights.tsv` is not hand-edited (README: regenerated only from
  CI artifacts); the new file takes the median default until the next regeneration.

## Non-goals

- Touch-context (coarse pointer) hover: there is none by design since HEL-1735; no-sticky-hover after a tap is
  already guarded by `hel1675-shared-hover` and `hel1735-feature-hover`.
- Every route at every width: narrow cells cover the routes whose layout changes at those widths.
- Fixing any contrast defect the new cells find beyond a one-token fix; larger findings are escalated, never exempted.
