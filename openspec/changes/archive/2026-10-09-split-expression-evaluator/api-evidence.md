# API evidence (design D6b) - HEL-1404

`javap -public` of the baseline build (unmodified worktree at 0f95ec49, the same build the baseline `testFull` ran on) versus the split build, both from the worktree's own sbt-2 output dir `backend/target/out/jvm/scala-2.13.15/helio-backend/classes/`. Classes dumped: `ExpressionEvaluator`, `ExpressionEvaluator$`, `ExpressionEvaluator$CompiledExpression`, `EvaluationError`, `EvaluationError$`, and `EvaluationError$X` / `EvaluationError$X$` for X in DivisionByZero, UnknownField, ParseError, TypeError (13 classes). Scripts: `move-check/dump_javap.sh`, `move-check/norm_javap.py`.

**Note on AC3's "synthetic-filtered".** This check is stricter than filtering synthetics: nothing is dropped by a blanket "is synthetic" rule. Each deviation is normalised or removed only under the D6b fixed-order steps, with every touched line listed below and every removal checked against the moved-member list (`tokenize, parse, parseLegacy, inferTypeOf, evalExpr, applyFn, applyOp, valToJs, checkArity, DollarPrefixRequiredMsg`). Step (iii) lines are identified by member name plus descriptor, not by the `$N` suffix (which step (i) already replaced by `N`).

## Predicted delta 1 - `Compiled from` lines
Unchanged for all 13 classes (all stay in `ExpressionEvaluator.scala`): the raw diffs below contain no `Compiled from` line. 11 of the 13 classes have a raw diff of 0 lines (all `EvaluationError*` and the `ExpressionEvaluator` mirror class).

## Fixed-order normalisation (full tool output)
```
$ python3 -I move-check/norm_javap.py <baseline dumps> <split dumps>   (only the two classes with a non-empty raw diff shown; the other 11 print raw diff = 0, normalised diff = 0)
### ExpressionEvaluator$.txt: raw diff = 40 lines
   RAW -  public java.lang.String com$helio$domain$engine$ExpressionEvaluator$$DollarPrefixRequiredMsg();
   RAW -  public scala.util.Either<java.lang.String, scala.runtime.BoxedUnit> com$helio$domain$engine$ExpressionEvaluator$$checkArity(java.lang.String, int);
   RAW -  public scala.util.Either<com.helio.domain.engine.EvaluationError, com.helio.domain.engine.ExpressionEvaluator$Val> com$helio$domain$engine$ExpressionEvaluator$$evalExpr(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map<java.lang.String, spray.json.JsValue>);
   RAW -  public spray.json.JsValue com$helio$domain$engine$ExpressionEvaluator$$valToJs(com.helio.domain.engine.ExpressionEvaluator$Val);
   RAW -  public static final boolean $anonfun$tokenize$1(com.helio.domain.engine.ExpressionEvaluator$Token);
   RAW -  public static final scala.util.Either $anonfun$parse$1(scala.collection.immutable.Vector);
   RAW -  public static final scala.util.Either $anonfun$parseLegacy$1(scala.collection.immutable.Vector);
   RAW -  public static final scala.util.Either $anonfun$validate$1(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionEvaluator$Expr);
   RAW -  public static final scala.util.Either $anonfun$validateTolerant$1(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionEvaluator$Expr);
   RAW -  public static final scala.util.Either $anonfun$checkRefs$1(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit);
   RAW -  public static final scala.util.Either $anonfun$checkRefs$3(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit);
   RAW -  public static final scala.util.Either $anonfun$checkRefs$2(scala.collection.immutable.Set, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   RAW -  public static final scala.util.Either $anonfun$inferType$1(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$Expr);
   RAW -  public static final java.lang.String $anonfun$inferTypeOf$1(java.lang.String, scala.collection.immutable.Map);
   RAW -  public static final java.lang.String $anonfun$inferTypeOf$3(char, java.lang.String, java.lang.String);
   RAW -  public static final scala.util.Either $anonfun$inferTypeOf$2(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, char, java.lang.String);
   RAW -  public static final scala.collection.immutable.Vector $anonfun$inferTypeOf$6(scala.collection.immutable.Vector, java.lang.String);
   RAW -  public static final scala.util.Either $anonfun$inferTypeOf$5(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, scala.collection.immutable.Vector);
   RAW -  public static final scala.util.Either $anonfun$inferTypeOf$4(scala.collection.immutable.Map, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   RAW -  public static final scala.util.Either $anonfun$inferTypeOf$7(java.lang.String, scala.collection.immutable.Vector);
   RAW +  public static final scala.util.Either $anonfun$validate$1(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionParser$Expr);
   RAW +  public static final scala.util.Either $anonfun$validateTolerant$1(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionParser$Expr);
   RAW +  public static final scala.util.Either $anonfun$checkRefs$1(com.helio.domain.engine.ExpressionParser$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit);
   RAW +  public static final scala.util.Either $anonfun$checkRefs$3(com.helio.domain.engine.ExpressionParser$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit);
   RAW +  public static final scala.util.Either $anonfun$checkRefs$2(scala.collection.immutable.Set, scala.util.Either, com.helio.domain.engine.ExpressionParser$Expr);
   RAW +  public static final scala.util.Either $anonfun$inferType$1(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionParser$Expr);
   RAW -  public static final com.helio.domain.engine.ExpressionEvaluator$Val $anonfun$evalExpr$3(com.helio.domain.engine.ExpressionEvaluator$Val);
   RAW -  public static final scala.util.Either $anonfun$evalExpr$2(char, com.helio.domain.engine.ExpressionEvaluator$Val, com.helio.domain.engine.ExpressionEvaluator$Expr, com.helio.domain.engine.ExpressionEvaluator$Val);
   RAW -  public static final scala.util.Either $anonfun$evalExpr$1(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, char, com.helio.domain.engine.ExpressionEvaluator$Expr, com.helio.domain.engine.ExpressionEvaluator$Val);
   RAW -  public static final scala.util.Either $anonfun$evalExpr$4(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$Expr);
   RAW -  public static final scala.util.Right $anonfun$evalExpr$5();
   RAW -  public static final scala.collection.immutable.Vector $anonfun$evalExpr$8(scala.collection.immutable.Vector, com.helio.domain.engine.ExpressionEvaluator$Val);
   RAW -  public static final scala.util.Either $anonfun$evalExpr$7(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, scala.collection.immutable.Vector);
   RAW -  public static final scala.util.Either $anonfun$evalExpr$6(scala.collection.immutable.Map, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   RAW -  public static final scala.util.Either $anonfun$evalExpr$9(java.lang.String, scala.collection.immutable.Vector);
   RAW -  public static final java.lang.String $anonfun$applyFn$1(com.helio.domain.engine.ExpressionEvaluator$Val);
   RAW -  public static final double $anonfun$applyFn$2(double);
   RAW -  public static final double $anonfun$applyFn$3(double);
   RAW -  public static final double $anonfun$applyFn$4(double);
   RAW -  public static final java.lang.Object $anonfun$tokenize$1$adapted(com.helio.domain.engine.ExpressionEvaluator$Token);
   (i) BEFORE public static final boolean $anonfun$tokenize$1(com.helio.domain.engine.ExpressionEvaluator$Token); => public static final boolean $anonfun$tokenize$N(com.helio.domain.engine.ExpressionEvaluator$Token);
   (i) BEFORE public static final scala.util.Either $anonfun$parse$1(scala.collection.immutable.Vector); => public static final scala.util.Either $anonfun$parse$N(scala.collection.immutable.Vector);
   (i) BEFORE public static final scala.util.Either $anonfun$parseLegacy$1(scala.collection.immutable.Vector); => public static final scala.util.Either $anonfun$parseLegacy$N(scala.collection.immutable.Vector);
   (i) BEFORE public static final scala.util.Either $anonfun$validate$1(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionEvaluator$Expr); => public static final scala.util.Either $anonfun$validate$N(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (i) BEFORE public static final scala.util.Either $anonfun$validateTolerant$1(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionEvaluator$Expr); => public static final scala.util.Either $anonfun$validateTolerant$N(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (i) BEFORE public static final scala.util.Either $anonfun$checkRefs$1(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit); => public static final scala.util.Either $anonfun$checkRefs$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit);
   (i) BEFORE public static final scala.util.Either $anonfun$checkRefs$3(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit); => public static final scala.util.Either $anonfun$checkRefs$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit);
   (i) BEFORE public static final scala.util.Either $anonfun$checkRefs$2(scala.collection.immutable.Set, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr); => public static final scala.util.Either $anonfun$checkRefs$N(scala.collection.immutable.Set, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (i) BEFORE public static final scala.util.Either $anonfun$inferType$1(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$Expr); => public static final scala.util.Either $anonfun$inferType$N(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (i) BEFORE public static final java.lang.String $anonfun$inferTypeOf$1(java.lang.String, scala.collection.immutable.Map); => public static final java.lang.String $anonfun$inferTypeOf$N(java.lang.String, scala.collection.immutable.Map);
   (i) BEFORE public static final java.lang.String $anonfun$inferTypeOf$3(char, java.lang.String, java.lang.String); => public static final java.lang.String $anonfun$inferTypeOf$N(char, java.lang.String, java.lang.String);
   (i) BEFORE public static final scala.util.Either $anonfun$inferTypeOf$2(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, char, java.lang.String); => public static final scala.util.Either $anonfun$inferTypeOf$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, char, java.lang.String);
   (i) BEFORE public static final scala.collection.immutable.Vector $anonfun$inferTypeOf$6(scala.collection.immutable.Vector, java.lang.String); => public static final scala.collection.immutable.Vector $anonfun$inferTypeOf$N(scala.collection.immutable.Vector, java.lang.String);
   (i) BEFORE public static final scala.util.Either $anonfun$inferTypeOf$5(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, scala.collection.immutable.Vector); => public static final scala.util.Either $anonfun$inferTypeOf$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, scala.collection.immutable.Vector);
   (i) BEFORE public static final scala.util.Either $anonfun$inferTypeOf$4(scala.collection.immutable.Map, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr); => public static final scala.util.Either $anonfun$inferTypeOf$N(scala.collection.immutable.Map, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (i) BEFORE public static final scala.util.Either $anonfun$inferTypeOf$7(java.lang.String, scala.collection.immutable.Vector); => public static final scala.util.Either $anonfun$inferTypeOf$N(java.lang.String, scala.collection.immutable.Vector);
   (i) BEFORE public static final scala.util.Either $anonfun$evaluate$1(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$CompiledExpression); => public static final scala.util.Either $anonfun$evaluate$N(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$CompiledExpression);
   (i) BEFORE public static final com.helio.domain.engine.ExpressionEvaluator$Val $anonfun$evalExpr$3(com.helio.domain.engine.ExpressionEvaluator$Val); => public static final com.helio.domain.engine.ExpressionEvaluator$Val $anonfun$evalExpr$N(com.helio.domain.engine.ExpressionEvaluator$Val);
   (i) BEFORE public static final scala.util.Either $anonfun$evalExpr$2(char, com.helio.domain.engine.ExpressionEvaluator$Val, com.helio.domain.engine.ExpressionEvaluator$Expr, com.helio.domain.engine.ExpressionEvaluator$Val); => public static final scala.util.Either $anonfun$evalExpr$N(char, com.helio.domain.engine.ExpressionEvaluator$Val, com.helio.domain.engine.ExpressionEvaluator$Expr, com.helio.domain.engine.ExpressionEvaluator$Val);
   (i) BEFORE public static final scala.util.Either $anonfun$evalExpr$1(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, char, com.helio.domain.engine.ExpressionEvaluator$Expr, com.helio.domain.engine.ExpressionEvaluator$Val); => public static final scala.util.Either $anonfun$evalExpr$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, char, com.helio.domain.engine.ExpressionEvaluator$Expr, com.helio.domain.engine.ExpressionEvaluator$Val);
   (i) BEFORE public static final scala.util.Either $anonfun$evalExpr$4(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$Expr); => public static final scala.util.Either $anonfun$evalExpr$N(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (i) BEFORE public static final scala.util.Right $anonfun$evalExpr$5(); => public static final scala.util.Right $anonfun$evalExpr$N();
   (i) BEFORE public static final scala.collection.immutable.Vector $anonfun$evalExpr$8(scala.collection.immutable.Vector, com.helio.domain.engine.ExpressionEvaluator$Val); => public static final scala.collection.immutable.Vector $anonfun$evalExpr$N(scala.collection.immutable.Vector, com.helio.domain.engine.ExpressionEvaluator$Val);
   (i) BEFORE public static final scala.util.Either $anonfun$evalExpr$7(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, scala.collection.immutable.Vector); => public static final scala.util.Either $anonfun$evalExpr$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, scala.collection.immutable.Vector);
   (i) BEFORE public static final scala.util.Either $anonfun$evalExpr$6(scala.collection.immutable.Map, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr); => public static final scala.util.Either $anonfun$evalExpr$N(scala.collection.immutable.Map, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (i) BEFORE public static final scala.util.Either $anonfun$evalExpr$9(java.lang.String, scala.collection.immutable.Vector); => public static final scala.util.Either $anonfun$evalExpr$N(java.lang.String, scala.collection.immutable.Vector);
   (i) BEFORE public static final java.lang.String $anonfun$applyFn$1(com.helio.domain.engine.ExpressionEvaluator$Val); => public static final java.lang.String $anonfun$applyFn$N(com.helio.domain.engine.ExpressionEvaluator$Val);
   (i) BEFORE public static final double $anonfun$applyFn$2(double); => public static final double $anonfun$applyFn$N(double);
   (i) BEFORE public static final double $anonfun$applyFn$3(double); => public static final double $anonfun$applyFn$N(double);
   (i) BEFORE public static final double $anonfun$applyFn$4(double); => public static final double $anonfun$applyFn$N(double);
   (i) BEFORE public static final java.lang.Object $anonfun$tokenize$1$adapted(com.helio.domain.engine.ExpressionEvaluator$Token); => public static final java.lang.Object $anonfun$tokenize$N$adapted(com.helio.domain.engine.ExpressionEvaluator$Token);
   (ii) removed BEFORE (moved member 'DollarPrefixRequiredMsg'): public java.lang.String com$helio$domain$engine$ExpressionEvaluator$$DollarPrefixRequiredMsg();
   (ii) removed BEFORE (moved member 'checkArity'): public scala.util.Either<java.lang.String, scala.runtime.BoxedUnit> com$helio$domain$engine$ExpressionEvaluator$$checkArity(java.lang.String, int);
   (ii) removed BEFORE (moved member 'evalExpr'): public scala.util.Either<com.helio.domain.engine.EvaluationError, com.helio.domain.engine.ExpressionEvaluator$Val> com$helio$domain$engine$ExpressionEvaluator$$evalExpr(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map<java.lang.String, spray.json.JsValue>);
   (ii) removed BEFORE (moved member 'valToJs'): public spray.json.JsValue com$helio$domain$engine$ExpressionEvaluator$$valToJs(com.helio.domain.engine.ExpressionEvaluator$Val);
   (ii) removed BEFORE (moved member 'tokenize'): public static final boolean $anonfun$tokenize$N(com.helio.domain.engine.ExpressionEvaluator$Token);
   (ii) removed BEFORE (moved member 'parse'): public static final scala.util.Either $anonfun$parse$N(scala.collection.immutable.Vector);
   (ii) removed BEFORE (moved member 'parseLegacy'): public static final scala.util.Either $anonfun$parseLegacy$N(scala.collection.immutable.Vector);
   (ii) removed BEFORE (moved member 'inferTypeOf'): public static final java.lang.String $anonfun$inferTypeOf$N(java.lang.String, scala.collection.immutable.Map);
   (ii) removed BEFORE (moved member 'inferTypeOf'): public static final java.lang.String $anonfun$inferTypeOf$N(char, java.lang.String, java.lang.String);
   (ii) removed BEFORE (moved member 'inferTypeOf'): public static final scala.util.Either $anonfun$inferTypeOf$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, char, java.lang.String);
   (ii) removed BEFORE (moved member 'inferTypeOf'): public static final scala.collection.immutable.Vector $anonfun$inferTypeOf$N(scala.collection.immutable.Vector, java.lang.String);
   (ii) removed BEFORE (moved member 'inferTypeOf'): public static final scala.util.Either $anonfun$inferTypeOf$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, scala.collection.immutable.Vector);
   (ii) removed BEFORE (moved member 'inferTypeOf'): public static final scala.util.Either $anonfun$inferTypeOf$N(scala.collection.immutable.Map, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (ii) removed BEFORE (moved member 'inferTypeOf'): public static final scala.util.Either $anonfun$inferTypeOf$N(java.lang.String, scala.collection.immutable.Vector);
   (ii) removed BEFORE (moved member 'evalExpr'): public static final com.helio.domain.engine.ExpressionEvaluator$Val $anonfun$evalExpr$N(com.helio.domain.engine.ExpressionEvaluator$Val);
   (ii) removed BEFORE (moved member 'evalExpr'): public static final scala.util.Either $anonfun$evalExpr$N(char, com.helio.domain.engine.ExpressionEvaluator$Val, com.helio.domain.engine.ExpressionEvaluator$Expr, com.helio.domain.engine.ExpressionEvaluator$Val);
   (ii) removed BEFORE (moved member 'evalExpr'): public static final scala.util.Either $anonfun$evalExpr$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, char, com.helio.domain.engine.ExpressionEvaluator$Expr, com.helio.domain.engine.ExpressionEvaluator$Val);
   (ii) removed BEFORE (moved member 'evalExpr'): public static final scala.util.Either $anonfun$evalExpr$N(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (ii) removed BEFORE (moved member 'evalExpr'): public static final scala.util.Right $anonfun$evalExpr$N();
   (ii) removed BEFORE (moved member 'evalExpr'): public static final scala.collection.immutable.Vector $anonfun$evalExpr$N(scala.collection.immutable.Vector, com.helio.domain.engine.ExpressionEvaluator$Val);
   (ii) removed BEFORE (moved member 'evalExpr'): public static final scala.util.Either $anonfun$evalExpr$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Map, scala.collection.immutable.Vector);
   (ii) removed BEFORE (moved member 'evalExpr'): public static final scala.util.Either $anonfun$evalExpr$N(scala.collection.immutable.Map, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (ii) removed BEFORE (moved member 'evalExpr'): public static final scala.util.Either $anonfun$evalExpr$N(java.lang.String, scala.collection.immutable.Vector);
   (ii) removed BEFORE (moved member 'applyFn'): public static final java.lang.String $anonfun$applyFn$N(com.helio.domain.engine.ExpressionEvaluator$Val);
   (ii) removed BEFORE (moved member 'applyFn'): public static final double $anonfun$applyFn$N(double);
   (ii) removed BEFORE (moved member 'applyFn'): public static final double $anonfun$applyFn$N(double);
   (ii) removed BEFORE (moved member 'applyFn'): public static final double $anonfun$applyFn$N(double);
   (ii) removed BEFORE (moved member 'tokenize'): public static final java.lang.Object $anonfun$tokenize$N$adapted(com.helio.domain.engine.ExpressionEvaluator$Token);
   (iii) member=validate rewrite: public static final scala.util.Either $anonfun$validate$N(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (iii) member=validateTolerant rewrite: public static final scala.util.Either $anonfun$validateTolerant$N(scala.collection.immutable.Set, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (iii) member=checkRefs rewrite: public static final scala.util.Either $anonfun$checkRefs$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit);
   (iii) member=checkRefs rewrite: public static final scala.util.Either $anonfun$checkRefs$N(com.helio.domain.engine.ExpressionEvaluator$Expr, scala.collection.immutable.Set, scala.runtime.BoxedUnit);
   (iii) member=checkRefs rewrite: public static final scala.util.Either $anonfun$checkRefs$N(scala.collection.immutable.Set, scala.util.Either, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (iii) member=inferType rewrite: public static final scala.util.Either $anonfun$inferType$N(scala.collection.immutable.Map, com.helio.domain.engine.ExpressionEvaluator$Expr);
   (iii) lines touched in this file: 6
   (v) normalised diff lines: 0
### ExpressionEvaluator$CompiledExpression.txt: raw diff = 4 lines
   RAW -  public static final spray.json.JsValue $anonfun$eval$1(com.helio.domain.engine.ExpressionEvaluator$Val);
   RAW -  public com.helio.domain.engine.ExpressionEvaluator$CompiledExpression(com.helio.domain.engine.ExpressionEvaluator$Expr);
   RAW +  public static final spray.json.JsValue $anonfun$eval$1(com.helio.domain.engine.ExpressionInterpreter$Val);
   RAW +  public com.helio.domain.engine.ExpressionEvaluator$CompiledExpression(com.helio.domain.engine.ExpressionParser$Expr);
   (i) BEFORE public static final spray.json.JsValue $anonfun$eval$1(com.helio.domain.engine.ExpressionEvaluator$Val); => public static final spray.json.JsValue $anonfun$eval$N(com.helio.domain.engine.ExpressionEvaluator$Val);
   (iii) member=eval rewrite: public static final spray.json.JsValue $anonfun$eval$N(com.helio.domain.engine.ExpressionEvaluator$Val);
   (iii) lines touched in this file: 1
   (iv) ctor: public com.helio.domain.engine.ExpressionEvaluator$CompiledExpression(com.helio.domain.engine.ExpressionEvaluator$Expr); => public com.helio.domain.engine.ExpressionEvaluator$CompiledExpression(com.helio.domain.engine.ExpressionParser$Expr);
   (v) normalised diff lines: 0
### ExpressionEvaluator.txt: raw diff = 0 lines
TOTAL normalised diff lines: 0
exit=0
```

Classification of every raw-diff line:
- Delta 2 (renumber/disappear): no surviving lambda was renumbered in this build (the seven kept `$anonfun$` lines of `ExpressionEvaluator$` and `eval$1` keep their `$N`), so step (i) is a no-op for kept members; it only matters for the removed ones.
- Delta 2/3 removals (step ii), 28 lines in `ExpressionEvaluator$`, all for moved members: `$$DollarPrefixRequiredMsg`, `$$checkArity`, `$$evalExpr`, `$$valToJs` (delta 3, four expanded-name accessors; none appears in the split build) and `$anonfun$` lambdas of `tokenize` (+`$adapted`), `parse`, `parseLegacy`, `inferTypeOf` (x7), `evalExpr` (x9), `applyFn` (x4) (delta 2). No kept member lost a lambda (`validate`, `validateTolerant`, `checkRefs`, `inferType`, `evaluate`, `eval` remain). The step-(ii) script flags any `$$` line of a non-moved member; it printed none.
- Delta 5 (step iii): exactly 7 lines touched: `validate` (1), `validateTolerant` (1), `checkRefs` (3), `inferType` (1) in `ExpressionEvaluator$` (6, `ExpressionEvaluator$Expr` -> `ExpressionParser$Expr`) and `eval` in `ExpressionEvaluator$CompiledExpression` (1, `ExpressionEvaluator$Val` -> `ExpressionInterpreter$Val`). `evaluate$1` (takes `CompiledExpression`) is correctly untouched.
- Delta 4 (step iv): the single `CompiledExpression` constructor line, `ExpressionEvaluator$Expr` -> `ExpressionParser$Expr`.
- Step (v): normalised diff is empty for every class; `TOTAL normalised diff lines: 0`.

## Class-file set under `com/helio/domain/engine/` (names starting `ExpressionEvaluator$`)
```
$ comm on the sorted ls output
baseline: 42 files; split build still has these ExpressionEvaluator$ classes:
ExpressionEvaluator$.class
ExpressionEvaluator$CompiledExpression.class

REMOVED from ExpressionEvaluator$* (all are moved private nested types, or the one synthetic anon class of a moved member):
ExpressionEvaluator$$anonfun$com$helio$domain$engine$ExpressionEvaluator$$evalExpr$1.class
ExpressionEvaluator$BinOp$.class
ExpressionEvaluator$BinOp.class
ExpressionEvaluator$Call$.class
ExpressionEvaluator$Call.class
ExpressionEvaluator$Expr.class
ExpressionEvaluator$FieldRef$.class
ExpressionEvaluator$FieldRef.class
ExpressionEvaluator$LegacyParser.class
ExpressionEvaluator$NumLit$.class
ExpressionEvaluator$NumLit.class
ExpressionEvaluator$StrictParser.class
ExpressionEvaluator$StrLit$.class
ExpressionEvaluator$StrLit.class
ExpressionEvaluator$Token$.class
ExpressionEvaluator$Token$Comma$.class
ExpressionEvaluator$Token$EOF$.class
ExpressionEvaluator$Token$FnName$.class
ExpressionEvaluator$Token$FnName.class
ExpressionEvaluator$Token$Ident$.class
ExpressionEvaluator$Token$Ident.class
ExpressionEvaluator$Token$LParen$.class
ExpressionEvaluator$Token$Minus$.class
ExpressionEvaluator$Token$Num$.class
ExpressionEvaluator$Token$Num.class
ExpressionEvaluator$Token$Plus$.class
ExpressionEvaluator$Token$Ref$.class
ExpressionEvaluator$Token$Ref.class
ExpressionEvaluator$Token$RParen$.class
ExpressionEvaluator$Token$Slash$.class
ExpressionEvaluator$Token$Star$.class
ExpressionEvaluator$Token$Str$.class
ExpressionEvaluator$Token$Str.class
ExpressionEvaluator$Token.class
ExpressionEvaluator$Val.class
ExpressionEvaluator$VNull$.class
ExpressionEvaluator$VNum$.class
ExpressionEvaluator$VNum.class
ExpressionEvaluator$VStr$.class
ExpressionEvaluator$VStr.class

ADDED to ExpressionEvaluator$*: (none)

New classes (the four new objects and their nested types), including the reappeared evalExpr partial function:
ExpressionInterpreter$$anonfun$evalExpr$5.class
ExpressionInterpreter$.class
ExpressionInterpreter$Val.class
ExpressionInterpreter$VNull$.class
ExpressionInterpreter$VNum$.class
ExpressionInterpreter$VNum.class
ExpressionInterpreter$VStr$.class
ExpressionInterpreter$VStr.class
ExpressionInterpreter.class
ExpressionParser$BinOp$.class
ExpressionParser$BinOp.class
ExpressionParser$Call$.class
ExpressionParser$Call.class
ExpressionParser$.class
ExpressionParser$Expr.class
ExpressionParser$FieldRef$.class
ExpressionParser$FieldRef.class
ExpressionParser$LegacyParser.class
ExpressionParser$NumLit$.class
ExpressionParser$NumLit.class
ExpressionParser$StrictParser.class
ExpressionParser$StrLit$.class
ExpressionParser$StrLit.class
ExpressionParser.class
ExpressionTokenizer$.class
ExpressionTokenizer$Token$.class
ExpressionTokenizer$Token$Comma$.class
ExpressionTokenizer$Token$EOF$.class
ExpressionTokenizer$Token$FnName$.class
ExpressionTokenizer$Token$FnName.class
ExpressionTokenizer$Token$Ident$.class
ExpressionTokenizer$Token$Ident.class
ExpressionTokenizer$Token$LParen$.class
ExpressionTokenizer$Token$Minus$.class
ExpressionTokenizer$Token$Num$.class
ExpressionTokenizer$Token$Num.class
ExpressionTokenizer$Token$Plus$.class
ExpressionTokenizer$Token$Ref$.class
ExpressionTokenizer$Token$Ref.class
ExpressionTokenizer$Token$RParen$.class
ExpressionTokenizer$Token$Slash$.class
ExpressionTokenizer$Token$Star$.class
ExpressionTokenizer$Token$Str$.class
ExpressionTokenizer$Token$Str.class
ExpressionTokenizer$Token.class
ExpressionTokenizer.class
ExpressionTypeInference$.class
ExpressionTypeInference.class
```

The baseline's only anonymous class, `ExpressionEvaluator$$anonfun$com$helio$domain$engine$ExpressionEvaluator$$evalExpr$1`, reappears as `ExpressionInterpreter$$anonfun$evalExpr$5` (the partial function of `evalExpr`'s `collectFirst`). No non-private type was removed and none was added to `ExpressionEvaluator$*`; `ExpressionEvaluator$` and `ExpressionEvaluator$CompiledExpression` are the only survivors.

## Red run (non-vacuity)
Temporarily changed the kept public member `evaluate` to `def evaluate(expr: String, row: Map[String, JsValue] = Map.empty)`, rebuilt, dumped, normalised:
```
### ExpressionEvaluator$.txt ... (v) normalised diff lines: 1
       +  public scala.collection.immutable.Map<java.lang.String, spray.json.JsValue> evaluate$default$2();
### ExpressionEvaluator.txt  ... (v) normalised diff lines: 1
       +  public static scala.collection.immutable.Map<java.lang.String, spray.json.JsValue> evaluate$default$2();
TOTAL normalised diff lines: 2        (exit 1)
```
Reverted (restored byte-identical file), rebuilt: `diff -r` of the dumps against the pre-red split dumps was empty and `TOTAL normalised diff lines: 0` again.
