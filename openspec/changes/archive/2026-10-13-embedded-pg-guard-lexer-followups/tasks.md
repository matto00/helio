## Standing Constraints

## 1. Fact-finding

- [x] 1.1 Confirm both escape facts with scalac 2.13.15 (design D1); transcript `proof/scalac-escapes.txt`
- [x] 1.2 Record zonky 2.0.7 start-failure behaviour with sources citations; transcript `proof/zonky-start-failure.txt`
- [x] 1.3 Record the pre-change CASE inventory (test names + every Seq case label) of the guard/helper specs to `proof/test-inventory-before.txt`

## 2. Backend (test sources)

- [x] 2.1 Split the guard per D4 (lexer object, guard object, specs); every file <= 250 lines (`wc -l`)
- [x] 2.2 Add the two reject + matching accept cases (D2); run and capture RED with only the new reject cases missed
- [x] 2.3 Fix the lexer per D1; capture GREEN; capture per-fix revert mutations RED; restore (`proof/lexer-red-green.txt`)
- [x] 2.4 Relabel the three fail-closed GUARD cases and add balanced failable variants (D3); mutation RED + restore (`proof/guard-mutations.txt`)
- [x] 2.5 Helper fatal-path cleanup + `newDataDirectory` seam (D5); verify with the helper spec
- [x] 2.6 Add fatal-path (incl. instance closed) and pre-postmaster failed-start tests (D5); fatal test red on the old helper

## 3. Docs

- [x] 3.1 Correct archived D7 wording (D6); verify with grep that "without escapes" is gone
- [x] 3.2 Add the CONTRIBUTING.md note (D6)

## 4. Tests

- [x] 4.1 Run the testkit specs; record STATS (raw-fallback-files=0 offenders=0) and post-change test inventory
- [x] 4.2 Run `node scripts/check-scala-quality.mjs` and the test temp-dir hygiene check; both pass
