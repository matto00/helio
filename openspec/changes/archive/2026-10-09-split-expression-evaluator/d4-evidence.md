# D4 message pairs - HEL-1404

Probe: `move-check/Probe.java`, run with plain `java` against the sbt-built classes (+ scala-library 2.13.15, spray-json 1.3.6 jars) - outside `backend/src/test`. BEFORE = the baseline build (run before any source edit); AFTER = the split build. Each line is `ExpressionEvaluator.evaluate` / `parseProblem` on an empty row.

```
--- BEFORE (baseline classes) ---
1 / 0 => Left(DivisionByZero(BinOp(/,NumLit(1.0),NumLit(0.0))))
1 / 0 => parseProblem None
$a / 0 => Left(UnknownField(a,Set()))
$a / 0 => parseProblem None
1 + ) => Left(ParseError(Unexpected token in expression: RParen))
1 + ) => parseProblem Some(Unexpected token in expression: RParen)
x + $y => Left(ParseError(Unexpected token in expression: Ref(y)))
x + $y => parseProblem Some(Unexpected token in expression: Ref(y))
x + foo(1) => Left(ParseError(Unexpected token in expression: FnName(foo)))
x + foo(1) => parseProblem Some(Unexpected token in expression: FnName(foo))
x + , => Left(ParseError(Unexpected token in expression: Comma))
x + , => parseProblem Some(Unexpected token in expression: Comma)
--- AFTER (split classes) ---
1 / 0 => Left(DivisionByZero(BinOp(/,NumLit(1.0),NumLit(0.0))))
1 / 0 => parseProblem None
$a / 0 => Left(UnknownField(a,Set()))
$a / 0 => parseProblem None
1 + ) => Left(ParseError(Unexpected token in expression: RParen))
1 + ) => parseProblem Some(Unexpected token in expression: RParen)
x + $y => Left(ParseError(Unexpected token in expression: Ref(y)))
x + $y => parseProblem Some(Unexpected token in expression: Ref(y))
x + foo(1) => Left(ParseError(Unexpected token in expression: FnName(foo)))
x + foo(1) => parseProblem Some(Unexpected token in expression: FnName(foo))
x + , => Left(ParseError(Unexpected token in expression: Comma))
x + , => parseProblem Some(Unexpected token in expression: Comma)
```

`diff` of BEFORE vs AFTER (the two javac-warning source-echo lines excluded from BEFORE): identical.

- DivisionByZero text embeds `BinOp(/,NumLit(1.0),NumLit(0.0))`: identical (case-class toString uses the simple class name, not the enclosing object).
- `Unexpected token in expression: <token>`: identical for `RParen`, `Ref(y)`, `FnName(foo)`, `Comma`. The design's example `Ident(x)` is not reachable through the public API (the strict parser answers a bare identifier with the `$`-prefix error and the legacy parser accepts it), so `Ident` is exercised through the other token classes that do reach that message instead; the `Ref`/`FnName` cases cover nested-case-class toString for the moved `Token` ADT.
