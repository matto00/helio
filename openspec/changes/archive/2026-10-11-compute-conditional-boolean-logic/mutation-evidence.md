# Mutation evidence (C5) - HEL-1070

Each mutation was applied to the implementation, `sbt "testOnly com.helio.domain.engine.ExpressionBoolean*"` was run
(from backend/, nice -n 19), the named test was observed red, and the mutation was reverted (restored from a byte copy;
never committed). Baseline without mutation: all green. Verbatim failing lines below.

Expected named test per task 4.3 -> observed:

- M1 swap or/and levels (ExpressionParser parseOr/parseAnd keywords exchanged) -> expected "bind and tighter than or" (Eval)
- M2 parse `not` tighter than comparison -> expected "apply not to a whole comparison" (Eval)
- M3 make comparison associative (left-fold chain) -> expected "reject a chained comparison" (Parse)
- M4 drop `and` short-circuit (remove `Some(false)` arm in And) -> expected "short-circuit and / or ..." (Eval)
- M5 drop `or` short-circuit -> expected "short-circuit and / or ..." (Eval)
- M6 evaluate both `if` branches -> expected "evaluate only the chosen branch" (Eval)
- M7 null `if` condition takes then (`c != Some(false)`) -> expected "pick a branch by the condition" (Eval)
- M8 `null and false` returns null (drop `(_, Some(false))` arm of and3) -> expected "give the full and/or/not truth tables" (Eval)

Raw output:

```
## M1 swap or/and precedence levels
exit 1
  - should bind and tighter than or *** FAILED ***
  Tests: succeeded 65, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## M2 parse not below (tighter than) comparison
exit 1
  - should apply not to a whole comparison *** FAILED ***
  - should repeat not *** FAILED ***
  - should accept and / or / not / true / false, case-insensitively *** FAILED ***
  Tests: succeeded 63, failed 3, canceled 0, ignored 0, pending 0
## M3 make comparison associative
exit 1
  - should reject a chained comparison *** FAILED ***
  Tests: succeeded 65, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## M4 drop and short-circuit
exit 1
  - should short-circuit and / or so an erroring right operand is never evaluated *** FAILED ***
  Tests: succeeded 65, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## M5 drop or short-circuit
exit 1
  - should type-error on a non-boolean operand *** FAILED ***
  - should short-circuit and / or so an erroring right operand is never evaluated *** FAILED ***
  Tests: succeeded 64, failed 2, canceled 0, ignored 0, pending 0
## M6 evaluate both if branches
exit 1
  - should evaluate only the chosen branch *** FAILED ***
  Tests: succeeded 65, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## M7 null if-condition takes then
exit 1
  - should pick a branch by the condition (conditional count column) *** FAILED ***
  Tests: succeeded 65, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## M8 null and false returns null
exit 1
  - should give the full and/or/not truth tables *** FAILED ***
  - should follow SQL logic when a comparison is null *** FAILED ***
  - should let parentheses override *** FAILED ***
  - should agree for every new construct *** FAILED ***
  - should agree through ComputeStep.apply and the analyze output type *** FAILED ***
  Tests: succeeded 61, failed 5, canceled 0, ignored 0, pending 0
```

## Cycle 2 (final-gate skeptic CR1): M11 / M12

Equality-boundary assertions added to ExpressionBooleanEvalSpec. Each mutation applied to ExpressionInterpreter.compare, the named test observed red (with the guard line), then reverted.

```
## M11 numeric <= -> < exit 1
  - should compare numbers numerically *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 65, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## M12 text <=/>= -> strict exit 1
  - should compare text exactly, by UTF-16 code unit *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 65, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
```

## Cycle 3 (final-gate skeptic 2): comparison operator sweep, seven mutations + baseline

Added "sweep every operator over numbers and text" and "sweep = and != over booleans" to ExpressionBooleanEvalSpec (expected values from the sign of the ordering, below/equal/above per operator and kind). Each mutation applied to ExpressionInterpreter.compare, run with `sbt testOnly com.helio.domain.engine.ExpressionBoolean*` (nice -n 19), named test red, reverted. Baseline run is the unmutated source.

```
## BASELINE (no mutation) exit 0
  [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
  Tests: succeeded 68, failed 0, canceled 0, ignored 0, pending 0
## NNE numeric != -> false exit 1
  - should sweep every operator over numbers and text: below, equal and above the bound *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 67, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## M14 numeric != -> a > b exit 1
  - should sweep every operator over numbers and text: below, equal and above the bound *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 67, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## NLT numeric < -> <= exit 1
  - should sweep every operator over numbers and text: below, equal and above the bound *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 67, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## TLT text < -> <= exit 1
  - should sweep every operator over numbers and text: below, equal and above the bound *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 67, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## TGT text > -> >= exit 1
  - should sweep every operator over numbers and text: below, equal and above the bound *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 67, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## TNE text != -> true exit 1
  - should sweep every operator over numbers and text: below, equal and above the bound *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 67, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
## BNE boolean != -> true exit 1
  - should sweep = and != over booleans: every pairing *** FAILED ***
  [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
  Tests: succeeded 67, failed 1, canceled 0, ignored 0, pending 0
  *** 1 TEST FAILED ***
```
