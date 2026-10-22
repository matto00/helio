# Task 3.1 mutation proof (one mutation per guard, each run against `javaRegex.test.ts`, then reverted)

Each row: file edited -> failing tests (all other tests pass). Source restored byte-identical after each run.

| Guard | Mutation (javaRegexCost.ts unless noted) | Result |
| --- | --- | --- |
| wide = more than 16 extents | `WIDE_EXTENTS` 16 -> 15 | 1 failed: "treats a quantifier as wide above 16 extents" |
| wide = more than 16 extents | `WIDE_EXTENTS` 16 -> 17 | 1 failed: same test |
| whole-pattern cost cap | `MAX_COST` 64 -> 65 | 1 failed: "caps the whole-pattern cost at 64" |
| whole-pattern cost cap | `MAX_COST` 64 -> 63 | 2 failed: cost cap; branch-end unfenced |
| tail cap after unfenced wide | `MAX_TAIL_COST` 4 -> 5 | 1 failed: "caps the tail ... at 4" |
| tail cap after unfenced wide | `MAX_TAIL_COST` 4 -> 3 | 2 failed: tail cap; "$ as 2" |
| `$` weighs 2 | `DOLLAR_WEIGHT` 2 -> 1 | 2 failed: "weighs $ as 2 in the tail"; spec case `\d?\d?(\d+)$` |
| fenced narrow choice has multiplicity 1 | drop `!isFenced(seq, i)` from `seqPaths` | 3 failed: "fences a narrow choice with multiplicity 1", branch-end, IPv4 accepts |
| end of branch/pattern is unfenced | `isFenced` treats a missing next item as a fence | 2 failed: cost cap (65 case), "last item of an alternation branch as unfenced" |
| no wide quantifiers with alternation (Rule W) | `hasAlternation(alts) ||` -> `false ||` | 1 failed: "declines two wide quantifiers whenever the pattern has an alternation" |
| every wide but the last must be fenced (Rule W) | drop the `slice(0, -1).some(!fenced)` test | 2 failed: fence test; class-set test |
| disjoint sets (javaRegexSets.ts) | `disjointSets` returns true on overlap | 8 failed |
| negated class complement (javaRegex.ts) | `set: negated ? complementSet(union) : union` -> `set: union` | 1 failed: class-set test |
| a no-choice pattern is not cost-capped | drop `paths > 1 &&` | 1 failed: "does not bound the length of a pattern with no choice point" |
