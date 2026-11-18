# HEL-1754: Flake sweep: root-cause four e2e flakes seen on 2026-11-17 (hel1578:111, hel1668-schema-panel-copy:172, hel1668-phone-sheet:184, hel813:93)

## Description

Four e2e tests failed on unrelated PRs on 2026-11-17. Each time, a single rerun of the failed job passed. Lanes now
rerun them on sight as "flake candidates", which costs a CI cycle and a driver decision each time.

| Spec:line | Seen on | Failure |
| -- | -- | -- |
| `hel1578-home-changed-dot.spec.ts:111` | run 44141488503 (dependabot helio-mcp PR), PR #1146 (HEL-1737) | After clicking the "Dot A" shelf card, the heading "Dot A edited elsewhere" is not visible within 5s (:138) |
| `hel1668-schema-panel-copy.spec.ts:172` | PR #1142 (HEL-1728) run 44074426286, PR #1146 | `menuOpacity` received `0.997824`, expected `"1"` (:210). Looks like an opacity transition read before it finished |
| `hel1668-phone-sheet.spec.ts:184` | PR #1139 (HEL-1675) | At 390x844, item 3: the Output schema panel did not appear after a tap |
| `hel813-mobile-touch-target-floor.spec.ts:93` | PR #1139 | At 430 mono, `page.goto("/login")` timed out |

`hel1583-glass-nav.spec.ts:554` and `hel1584:493` are already known flakes. Fold them in if the cause turns out to be
shared.

Today's earlier flake fixes were all **test races**: a read made before the app had settled (HEL-1623, HEL-1711,
HEL-1723, HEL-1731, HEL-1729). Check that pattern first.

## Acceptance criteria

- [ ] AC1. For each spec, the root cause is found from a probe or the CI trace artifact, while the artifacts are still
  downloadable. No retries, sleeps or longer timeouts.
- [ ] AC2. Each failure is first reproduced red, by forcing the timing, then passes 40/40 with `--repeat-each` at 2
  workers.
- [ ] AC3. If a failure is a real product defect, fix it with a test that fails first, or split it into its own ticket
  if it is large.
- [ ] AC4. A spec with no reproducible cause is documented with what was tried, and stays a named candidate.
