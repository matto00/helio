# Red evidence (C1) - HEL-1070

Command (from backend/, before any grammar implementation; only the two data vectors
`ExpressionEvaluator.SupportedOperators` / `BooleanLiterals` existed so the seam spec compiles):

    nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.engine.ExpressionBoolean* com.helio.domain.engine.ComputeConditionalCountSpec com.helio.domain.engine.ComputeExpressionFunctionsSeamSpec com.helio.domain.engine.ExpressionEvaluatorSpec"

Result: exit 1, `Tests: succeeded 129, failed 60`. Failing specs: ExpressionEvaluatorSpec (function-list size 15),
ExpressionBooleanParseSpec, ExpressionBooleanInferenceSpec, ExpressionBooleanEvalSpec, ComputeConditionalCountSpec,
ComputeExpressionFunctionsSeamSpec. Failed tests (verbatim sbt lines):

    - should equal ExpressionEvaluator.SupportedFunctions in both directions *** FAILED ***
    - should name only operators and literals the strict parser actually accepts *** FAILED ***
    - should accept every comparison operator *** FAILED ***
    - should accept and / or / not / true / false, case-insensitively *** FAILED ***
    - should treat a keyword written directly before '(' as the operator / literal, not a function *** FAILED ***
    - should accept comparisons and boolean expressions as function arguments and in groups *** FAILED ***
    - should reject a chained comparison *** FAILED ***
    - should reject == and <> with a hint at the right operator *** FAILED ***
    - should require exactly three arguments for if *** FAILED ***
    - should list if among the supported functions in the unknown-function message *** FAILED ***
    - should report a reserved word used as a value as a reserved-word error, never the dollar-prefix error *** FAILED ***
    - should never retry the legacy grammar for a reserved-word error *** FAILED ***
    - should now read an all-true/false bare-word expression as the literal *** FAILED ***
    - should now type-error (per-row) on arithmetic over a bare boolean literal *** FAILED ***
    - should now fail to parse a reserved word misused as a value first *** FAILED ***
    - should compare numbers numerically *** FAILED ***
    - should compare text exactly, by UTF-16 code unit *** FAILED ***
    - should compare a timestamp as its text, not as an instant *** FAILED ***
    - should support = and != on booleans *** FAILED ***
    - should type-error on an ordering comparison of booleans *** FAILED ***
    - should type-error (not false) when kinds differ *** FAILED ***
    - should yield null when an operand is null *** FAILED ***
    - should give the full and/or/not truth tables *** FAILED ***
    - should follow SQL logic when a comparison is null *** FAILED ***
    - should type-error on a non-boolean operand *** FAILED ***
    - should short-circuit and / or so an erroring right operand is never evaluated *** FAILED ***
    - should yield the literals as JSON booleans *** FAILED ***
    - should pick a branch by the condition (conditional count column) *** FAILED ***
    - should return the selected value unchanged, including null *** FAILED ***
    - should evaluate only the chosen branch *** FAILED ***
    - should type-error on a non-boolean, non-null condition *** FAILED ***
    - should nest for multiple branches *** FAILED ***
    - should evaluate as a JSON boolean when referenced alone, and through coalesce / if *** FAILED ***
    - should be usable as a condition and with and / or / not / = / != *** FAILED ***
    - should write a JSON boolean into the row through ComputeStep.apply *** FAILED ***
    - should bind and tighter than or *** FAILED ***
    - should apply not to a whole comparison *** FAILED ***
    - should bind not tighter than and / or *** FAILED ***
    - should bind arithmetic tighter than comparison *** FAILED ***
    - should repeat not *** FAILED ***
    - should bind unary minus tighter than comparison *** FAILED ***
    - should let parentheses override *** FAILED ***
    - should count the rows where status = Done, alongside the plain total, per group *** FAILED ***
    - should analyze the if column as float so the sum aggregation is accepted *** FAILED ***
    - should agree for every new construct *** FAILED ***
    - should agree through ComputeStep.apply and the analyze output type *** FAILED ***
    - should report a boolean column referenced alone as boolean (it evaluated as the text 'true' before) *** FAILED ***
    - should reject a number compared with text, with a cast hint *** FAILED ***
    - should point a numeric-vs-timestamp comparison at seconds_between *** FAILED ***
    - should reject boolean compared with number or text *** FAILED ***
    - should reject an ordering comparison of booleans *** FAILED ***
    - should reject a comparison with a binary-ref operand *** FAILED ***
    - should reject a non-boolean operand of and / or / not *** FAILED ***
    - should reject if branches of mixed kinds *** FAILED ***
    - should reject coalesce mixing boolean with non-boolean *** FAILED ***
    - should reject a boolean sub-expression used as a number, suggesting if(cond, 1, 0) *** FAILED ***
    - should still allow + on a boolean sub-expression (it concatenates) *** FAILED ***
    - should surface an inference error as the step's validationError while the step still saves and projects *** FAILED ***
    - should project boolean / float / string output types for the new constructs *** FAILED ***
    - should list every supported function in the unknown-function message *** FAILED ***
    *** 60 TESTS FAILED ***
    [info] Tests: succeeded 129, failed 60, canceled 0, ignored 0, pending 0
    [info] *** 60 TESTS FAILED ***
