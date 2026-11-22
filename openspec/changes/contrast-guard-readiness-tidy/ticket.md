# HEL-1806: Contrast guard tidy: 1440 pipeline check readiness wait, stale comment, widths by value (HEL-1649)

## Description

origin_kind: followup
origin_ticket: HEL-1649 (PR matto00/helio#1203, merged as 13180246a). The owner chose to file this.

### Do

1. **Readiness wait in the 1440 pipeline check.** The existing 1440 pipeline-detail check measures before the "Refresh sample" button is visible and enabled. HEL-1649 found that this, more than the missing widths, is why HEL-1628's invisible hover got past CI. HEL-1649 added the wait to the narrow checks only. Add it at 1440 too, and show by mutation that the check then fails on HEL-1628's pre-fix spine-card refresh hover.
2. **Stale comment.** `e2e/support/state-surface-contrast-guard.ts:55` still names the spec file from before the split.
3. **Widths by value.** The two narrow spec files (`state-surface-contrast-guard-narrow-1100-768.spec.ts` and `-390.spec.ts`) pick their widths by position in an array. Select them by width value, so reordering the array cannot silently change what each file covers.

## Acceptance criteria

- [ ] Item 1 is proven red by mutation and green on main.
- [ ] The guard covers the same set of checks before and after the change.

## Driver context (claims, verified at Planning — see premise-validation evidence)

- HEL-1805 (b1c72f7ed) seeded a connector in every /connectors cell, added a hover-only exemption for the connectors table scroll region, and made the guard centre each control before hovering. Re-read the guard on main; line numbers moved.
- AC interpretation from the driver: record per-cell sampled control counts before and after and compare.
- Owner rulings that bind: only exemptions are the glass bottom nav (HEL-1801) and the connectors scroll region (HEL-1805); narrow widths use a mouse pointer.
- e2e only; no app CSS change (the mutation is temporary).
- Sibling lanes in flight: HEL-1809 (frontend pipeline draft render perf), HEL-1803 (backend ClaudeClient split). Avoid their files.
