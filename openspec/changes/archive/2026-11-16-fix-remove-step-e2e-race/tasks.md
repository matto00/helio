## Standing Constraints

## 1. Probe

### Tests

- [x] 1.1 Reproduce the item-7 failure locally with `--repeat-each` and `--trace retain-on-failure` (Playwright workers 2); record the command, N, pass/fail counts and the failing trace path in the commit-adjacent evidence (or the documented no-local-red fallback from design.md Decision 1) (see evidence.md)
- [x] 1.2 From the failing trace, record which step/Output the cascade removed and which focused section was shown at the Remove-step click; confirm or refute "selection lag → test race" (design.md Decision 2; escalate on a product cause) (see evidence.md)

## 2. Fix

### Tests

- [x] 2.1 hel1685 item 7: wait for the focused `Step 3` section, scope the Remove-step click to it, and assert the Confirm-removals dialog names "Avg minutes"; verify by reading the diff (no new waitForTimeout, no widened timeout)
- [x] 2.2 hel1631-draft-mode.spec.ts:250-252: same scoped wait; verify the spec still passes
- [x] 2.3 Show the fix closes the race: re-run item 7 with the same `--repeat-each` N that went red (all green), plus the forced-race mutation going red without the wait and green with it (see evidence.md)
- [x] 2.4 Run `npx eslint`/`prettier --check` on both specs and the full hel1685 + hel1631 specs once; record results
