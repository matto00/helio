# HEL-1187 API evidence (design D5b(b), constraint C2)

Classes checked (`javap -public`, both builds): every class file matching `OutputService*`, `OutputConfigValidation*` and `NodeSnapshotRepository*` (so `OutputService`, `OutputService$`, `NodeSnapshotRepository`, `NodeSnapshotRepository$`, all nested companion types `SortCast/SortDirection/SortSpec/OpSpec/FilterSpec` incl. their `$` module classes, `OutputConfigValidation`, `OutputConfigValidation$`, and the compiler anonymous-function classes).

Provenance: BEFORE = sbt build of an unmodified copy of the base sources (`24f6de4cf`, identical to the worktree at start: `git status` clean); AFTER = sbt build of HEAD `0010efb84` in this worktree. Raw listings: `move-check/javap-base.txt` (581 lines), `move-check/javap-after.txt` (535 lines); generator `move-check/javap-all.sh`; classifier `move-check/classify.py`.

## 1. RAW unfiltered diff (`diff javap-base.txt javap-after.txt`)

```diff
10,11d9
<   public java.lang.String com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$escapeLikeTerm(java.lang.String);
<   public java.lang.String com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$likeEscapeChar();
26,34d23
<   public static final slick.jdbc.SQLActionBuilder $anonfun$quickTermFragment$1(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, java.lang.String, java.lang.String);
<   public static final slick.jdbc.SQLActionBuilder $anonfun$quickTermFragment$2(slick.jdbc.SQLActionBuilder, slick.jdbc.SQLActionBuilder);
<   public static final slick.jdbc.SQLActionBuilder $anonfun$opFragment$1(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$SortCast, java.lang.String);
<   public static final slick.jdbc.SQLActionBuilder $anonfun$opFragment$2(slick.jdbc.SQLActionBuilder, slick.jdbc.SQLActionBuilder);
<   public static final boolean $anonfun$filterWhereFragment$2(java.lang.String);
<   public static final slick.jdbc.SQLActionBuilder $anonfun$filterWhereFragment$3(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$FilterSpec, java.lang.String);
<   public static final slick.jdbc.SQLActionBuilder $anonfun$filterWhereFragment$4(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$OpSpec);
<   public static final slick.jdbc.SQLActionBuilder $anonfun$filterWhereFragment$5(slick.jdbc.SQLActionBuilder, slick.jdbc.SQLActionBuilder);
<   public static final scala.Option $anonfun$filterWhereFragment$1(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$FilterSpec);
46d34
<   public static final java.lang.Object $anonfun$filterWhereFragment$2$adapted(java.lang.String);
54,61d41
< == com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$$anonfun$1
< public final class com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$$anonfun$1 extends scala.runtime.AbstractPartialFunction<scala.Tuple2<java.lang.String, java.lang.String>, slick.jdbc.SQLActionBuilder> implements java.io.Serializable {
<   public final <A1 extends scala.Tuple2<java.lang.String, java.lang.String>, B1> B1 applyOrElse(A1, scala.Function1<A1, B1>);
<   public final boolean isDefinedAt(scala.Tuple2<java.lang.String, java.lang.String>);
<   public boolean isDefinedAt(java.lang.Object);
<   public java.lang.Object applyOrElse(java.lang.Object, scala.Function1);
<   public com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$$anonfun$1(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository);
< }
356a337,340
>   public static spray.json.JsObject mergeConfig(spray.json.JsObject, spray.json.JsObject);
>   public static com.helio.services.pipelines.OutputConfigWritePolicy validateConfig$default$4();
>   public static scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit> validateConfig(com.helio.domain.model.OutputKind, spray.json.JsObject, spray.json.JsObject, com.helio.services.pipelines.OutputConfigWritePolicy);
>   public static scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit> validateFieldMapping(com.helio.domain.model.OutputKind, spray.json.JsObject);
368a353,356
>   public scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit> validateFieldMapping(com.helio.domain.model.OutputKind, spray.json.JsObject);
>   public scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit> validateConfig(com.helio.domain.model.OutputKind, spray.json.JsObject, spray.json.JsObject, com.helio.services.pipelines.OutputConfigWritePolicy);
>   public com.helio.services.pipelines.OutputConfigWritePolicy validateConfig$default$4();
>   public spray.json.JsObject mergeConfig(spray.json.JsObject, spray.json.JsObject);
396a385,392
>   public static final boolean $anonfun$validateFieldMapping$1(com.helio.domain.model.OutputKind, com.helio.domain.panels.OutputBindingSpec);
>   public static final scala.runtime.Nothing$ $anonfun$validateFieldMapping$2(com.helio.domain.model.OutputKind);
>   public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$1(java.lang.String);
>   public static final scala.util.Either $anonfun$validateConfig$2(com.helio.domain.model.OutputKind, spray.json.JsObject, scala.runtime.BoxedUnit);
>   public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$4(java.lang.String);
>   public static final scala.util.Either $anonfun$validateConfig$3(spray.json.JsObject, scala.runtime.BoxedUnit);
>   public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$6(java.lang.String);
>   public static final scala.util.Either $anonfun$validateConfig$5(spray.json.JsObject, scala.runtime.BoxedUnit);
403a400
>   public static final java.lang.Object $anonfun$validateFieldMapping$1$adapted(com.helio.domain.model.OutputKind, com.helio.domain.panels.OutputBindingSpec);
421a419,434
> == com.helio.services.pipelines.OutputConfigValidation$$anonfun$3
> public final class com.helio.services.pipelines.OutputConfigValidation$$anonfun$3 extends scala.runtime.AbstractPartialFunction<spray.json.JsValue, spray.json.JsObject> implements java.io.Serializable {
>   public final <A1 extends spray.json.JsValue, B1> B1 applyOrElse(A1, scala.Function1<A1, B1>);
>   public final boolean isDefinedAt(spray.json.JsValue);
>   public boolean isDefinedAt(java.lang.Object);
>   public java.lang.Object applyOrElse(java.lang.Object, scala.Function1);
>   public com.helio.services.pipelines.OutputConfigValidation$$anonfun$3();
> }
> == com.helio.services.pipelines.OutputConfigValidation$$anonfun$4
> public final class com.helio.services.pipelines.OutputConfigValidation$$anonfun$4 extends scala.runtime.AbstractPartialFunction<scala.Tuple2<java.lang.String, spray.json.JsValue>, scala.Tuple2<java.lang.String, java.lang.String>> implements java.io.Serializable {
>   public final <A1 extends scala.Tuple2<java.lang.String, spray.json.JsValue>, B1> B1 applyOrElse(A1, scala.Function1<A1, B1>);
>   public final boolean isDefinedAt(scala.Tuple2<java.lang.String, spray.json.JsValue>);
>   public boolean isDefinedAt(java.lang.Object);
>   public java.lang.Object applyOrElse(java.lang.Object, scala.Function1);
>   public com.helio.services.pipelines.OutputConfigValidation$$anonfun$4();
> }
473,475d485
<   public static final scala.util.Either $anonfun$requireUnambiguousRootWhenNeither$1(scala.collection.immutable.Vector);
<   public static final boolean $anonfun$resolveExplicitRootId$2(java.lang.String, com.helio.domain.model.PipelineRoot);
<   public static final scala.util.Either $anonfun$resolveExplicitRootId$1(java.lang.String, java.lang.String, scala.collection.immutable.Vector);
499,518d508
<   public static final java.lang.String $anonfun$rows$3(java.lang.String);
<   public static final java.lang.String $anonfun$rows$4(java.lang.String);
<   public static final spray.json.JsValue $anonfun$rows$8(spray.json.JsValue);
<   public static final scala.util.Right $anonfun$rows$7(com.helio.domain.model.PagedResult, boolean, scala.Option);
<   public static final scala.concurrent.Future $anonfun$rows$6(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, scala.Option, com.helio.domain.model.Page, com.helio.domain.model.PagedResult, boolean);
<   public static final scala.concurrent.Future $anonfun$rows$5(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, scala.Option, com.helio.domain.model.Page, com.helio.domain.model.PagedResult);
<   public static final scala.concurrent.Future $anonfun$rows$2(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, com.helio.domain.model.Page, scala.Option, scala.util.Either);
<   public static final scala.concurrent.Future $anonfun$rows$1(com.helio.services.pipelines.OutputService, com.helio.domain.model.Page, scala.Option, scala.Option, scala.Option);
<   public static final scala.util.Right $anonfun$filterCapabilities$2(com.helio.services.pipelines.OutputFilterCapability$FilterCapabilityContract);
<   public static final scala.concurrent.Future $anonfun$filterCapabilities$1(com.helio.services.pipelines.OutputService, scala.Option);
<   public static final java.lang.String $anonfun$distinctValues$3(java.lang.String);
<   public static final java.lang.String $anonfun$distinctValues$4(java.lang.String);
<   public static final scala.util.Right $anonfun$distinctValues$5(scala.collection.immutable.Vector);
<   public static final scala.concurrent.Future $anonfun$distinctValues$2(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, java.lang.String, scala.util.Either);
<   public static final scala.concurrent.Future $anonfun$distinctValues$1(com.helio.services.pipelines.OutputService, java.lang.String, scala.Option);
<   public static final java.lang.String $anonfun$materializedFor$1(java.lang.String);
<   public static final java.lang.String $anonfun$materializedFor$2(java.lang.String);
<   public static final boolean $anonfun$materializedFor$5(com.helio.domain.model.Output, java.time.Instant);
<   public static final boolean $anonfun$materializedFor$4(com.helio.domain.model.Output, scala.Option);
<   public static final scala.concurrent.Future $anonfun$materializedFor$3(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, boolean);
520,522d509
<   public static final java.lang.String $anonfun$materializedFor$1$adapted(java.lang.Object);
<   public static final java.lang.String $anonfun$materializedFor$2$adapted(java.lang.Object);
<   public static final scala.concurrent.Future $anonfun$materializedFor$3$adapted(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, java.lang.Object);
526d512
<   public static final java.lang.Object $anonfun$resolveExplicitRootId$2$adapted(java.lang.String, com.helio.domain.model.PipelineRoot);
531,537d516
<   public static final scala.concurrent.Future $anonfun$rows$6$adapted(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, scala.Option, com.helio.domain.model.Page, com.helio.domain.model.PagedResult, java.lang.Object);
<   public static final java.lang.String $anonfun$rows$3$adapted(java.lang.Object);
<   public static final java.lang.String $anonfun$rows$4$adapted(java.lang.Object);
<   public static final java.lang.String $anonfun$distinctValues$3$adapted(java.lang.Object);
<   public static final java.lang.String $anonfun$distinctValues$4$adapted(java.lang.Object);
<   public static final java.lang.Object $anonfun$materializedFor$5$adapted(com.helio.domain.model.Output, java.time.Instant);
<   public static final java.lang.Object $anonfun$materializedFor$4$adapted(com.helio.domain.model.Output, scala.Option);
555,563d533
<   public static final boolean $anonfun$validateFieldMapping$1(com.helio.domain.model.OutputKind, com.helio.domain.panels.OutputBindingSpec);
<   public static final scala.runtime.Nothing$ $anonfun$validateFieldMapping$2(com.helio.domain.model.OutputKind);
<   public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$1(java.lang.String);
<   public static final scala.util.Either $anonfun$validateConfig$2(com.helio.domain.model.OutputKind, spray.json.JsObject, scala.runtime.BoxedUnit);
<   public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$4(java.lang.String);
<   public static final scala.util.Either $anonfun$validateConfig$3(spray.json.JsObject, scala.runtime.BoxedUnit);
<   public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$6(java.lang.String);
<   public static final scala.util.Either $anonfun$validateConfig$5(spray.json.JsObject, scala.runtime.BoxedUnit);
<   public static final java.lang.Object $anonfun$validateFieldMapping$1$adapted(com.helio.domain.model.OutputKind, com.helio.domain.panels.OutputBindingSpec);
565,580d534
< }
< == com.helio.services.pipelines.OutputService$$anonfun$1
< public final class com.helio.services.pipelines.OutputService$$anonfun$1 extends scala.runtime.AbstractPartialFunction<spray.json.JsValue, spray.json.JsObject> implements java.io.Serializable {
<   public final <A1 extends spray.json.JsValue, B1> B1 applyOrElse(A1, scala.Function1<A1, B1>);
<   public final boolean isDefinedAt(spray.json.JsValue);
<   public boolean isDefinedAt(java.lang.Object);
<   public java.lang.Object applyOrElse(java.lang.Object, scala.Function1);
<   public com.helio.services.pipelines.OutputService$$anonfun$1();
< }
< == com.helio.services.pipelines.OutputService$$anonfun$2
< public final class com.helio.services.pipelines.OutputService$$anonfun$2 extends scala.runtime.AbstractPartialFunction<scala.Tuple2<java.lang.String, spray.json.JsValue>, scala.Tuple2<java.lang.String, java.lang.String>> implements java.io.Serializable {
<   public final <A1 extends scala.Tuple2<java.lang.String, spray.json.JsValue>, B1> B1 applyOrElse(A1, scala.Function1<A1, B1>);
<   public final boolean isDefinedAt(scala.Tuple2<java.lang.String, spray.json.JsValue>);
<   public boolean isDefinedAt(java.lang.Object);
<   public java.lang.Object applyOrElse(java.lang.Object, scala.Function1);
<   public com.helio.services.pipelines.OutputService$$anonfun$2();
```

## 2. Classification of every differing line (classifier output; a per-class set difference, nothing is blanket-filtered)

Rules, applied mechanically by `classify.py`:
- Compiler synthetics (`$anonfun$..`, `$adapted`, `$deserializeLambda$`) may be added/removed.
- `OutputConfigValidation` / `OutputConfigValidation$` may only ADD: the three moved public methods, `validateConfig$default$4()`, and the static forwarders the mirror class emits for those four (plus `$anonfun$` synthetics). Every pre-existing member must be unchanged.
- The only permitted `$$` MEMBER change is the REMOVAL of the two pre-approved `NodeSnapshotRepository` names: `com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$escapeLikeTerm(String)` and `...$$likeEscapeChar()`. Any ADDED `$$` member name fails.
- **Disclosed classifier addition (needed because the move is byte-identical):** scalac names a `collect { case ... }` partial-function body's class `<Owner>$$anonfun$N`. Moving `validateFieldMapping`'s two `collect` closures into `OutputConfigValidation` therefore REMOVES `OutputService$$anonfun$1/2` and ADDS `OutputConfigValidation$$anonfun$3/4` (identical bodies/signatures: `AbstractPartialFunction<JsValue,JsObject>` and `<Tuple2<String,JsValue>,Tuple2<String,String>>`); likewise `filterWhereFragment`'s `collect` closure class `NodeSnapshotRepository$$anonfun$1` (the sole reader of the two pre-approved private accessors) leaves the repository. The classifier accepts an added/removed `$$anonfun$N` CLASS only for exactly these owners; every other `$$` class or member still fails. Reviewer: please check this addition against D5b(b)'s "an ADDED `$$` name on any checked class fails" wording -- the added names are anonymous-function classes of the receiving object, not leaked privates.

```
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public java.lang.String com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$escapeLikeTerm(java.lang.String); | PRE-APPROVED $$ removal (privates made public only for the collect closure; moved to NodeSnapshotFilterSql)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public java.lang.String com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$likeEscapeChar(); | PRE-APPROVED $$ removal (privates made public only for the collect closure; moved to NodeSnapshotFilterSql)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final boolean $anonfun$filterWhereFragment$2(java.lang.String); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final java.lang.Object $anonfun$filterWhereFragment$2$adapted(java.lang.String); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final scala.Option $anonfun$filterWhereFragment$1(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$FilterSpec); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final slick.jdbc.SQLActionBuilder $anonfun$filterWhereFragment$3(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$FilterSpec, java.lang.String); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final slick.jdbc.SQLActionBuilder $anonfun$filterWhereFragment$4(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$OpSpec); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final slick.jdbc.SQLActionBuilder $anonfun$filterWhereFragment$5(slick.jdbc.SQLActionBuilder, slick.jdbc.SQLActionBuilder); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final slick.jdbc.SQLActionBuilder $anonfun$opFragment$1(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$SortCast, java.lang.String); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final slick.jdbc.SQLActionBuilder $anonfun$opFragment$2(slick.jdbc.SQLActionBuilder, slick.jdbc.SQLActionBuilder); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final slick.jdbc.SQLActionBuilder $anonfun$quickTermFragment$1(com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository, java.lang.String, java.lang.String); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public static final slick.jdbc.SQLActionBuilder $anonfun$quickTermFragment$2(slick.jdbc.SQLActionBuilder, slick.jdbc.SQLActionBuilder); | compiler synthetic (removed)
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository$$anonfun$1 | CLASS REMOVED | compiler PartialFunction class whose body moved: OK
com.helio.services.pipelines.OutputConfigValidation | + public static com.helio.services.pipelines.OutputConfigWritePolicy validateConfig$default$4(); | pre-approved OutputConfigValidation addition (moved method / default / static forwarder)
com.helio.services.pipelines.OutputConfigValidation | + public static scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit> validateConfig(com.helio.domain.model.OutputKind, spray.json.JsObject, spray.json.JsObject, com.helio.services.pipelines.OutputConfigWritePolicy); | pre-approved OutputConfigValidation addition (moved method / default / static forwarder)
com.helio.services.pipelines.OutputConfigValidation | + public static scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit> validateFieldMapping(com.helio.domain.model.OutputKind, spray.json.JsObject); | pre-approved OutputConfigValidation addition (moved method / default / static forwarder)
com.helio.services.pipelines.OutputConfigValidation | + public static spray.json.JsObject mergeConfig(spray.json.JsObject, spray.json.JsObject); | pre-approved OutputConfigValidation addition (moved method / default / static forwarder)
com.helio.services.pipelines.OutputConfigValidation$ | + public com.helio.services.pipelines.OutputConfigWritePolicy validateConfig$default$4(); | pre-approved OutputConfigValidation addition (moved method / default / static forwarder)
com.helio.services.pipelines.OutputConfigValidation$ | + public scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit> validateConfig(com.helio.domain.model.OutputKind, spray.json.JsObject, spray.json.JsObject, com.helio.services.pipelines.OutputConfigWritePolicy); | pre-approved OutputConfigValidation addition (moved method / default / static forwarder)
com.helio.services.pipelines.OutputConfigValidation$ | + public scala.util.Either<com.helio.services.ServiceError, scala.runtime.BoxedUnit> validateFieldMapping(com.helio.domain.model.OutputKind, spray.json.JsObject); | pre-approved OutputConfigValidation addition (moved method / default / static forwarder)
com.helio.services.pipelines.OutputConfigValidation$ | + public spray.json.JsObject mergeConfig(spray.json.JsObject, spray.json.JsObject); | pre-approved OutputConfigValidation addition (moved method / default / static forwarder)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final boolean $anonfun$validateFieldMapping$1(com.helio.domain.model.OutputKind, com.helio.domain.panels.OutputBindingSpec); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$1(java.lang.String); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$4(java.lang.String); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$6(java.lang.String); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final java.lang.Object $anonfun$validateFieldMapping$1$adapted(com.helio.domain.model.OutputKind, com.helio.domain.panels.OutputBindingSpec); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final scala.runtime.Nothing$ $anonfun$validateFieldMapping$2(com.helio.domain.model.OutputKind); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final scala.util.Either $anonfun$validateConfig$2(com.helio.domain.model.OutputKind, spray.json.JsObject, scala.runtime.BoxedUnit); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final scala.util.Either $anonfun$validateConfig$3(spray.json.JsObject, scala.runtime.BoxedUnit); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$ | + public static final scala.util.Either $anonfun$validateConfig$5(spray.json.JsObject, scala.runtime.BoxedUnit); | compiler synthetic (added)
com.helio.services.pipelines.OutputConfigValidation$$anonfun$3 | CLASS ADDED | compiler PartialFunction class carrying a moved `collect { case .. }` body: OK (name-only change from OutputService$$anonfun$N)
com.helio.services.pipelines.OutputConfigValidation$$anonfun$4 | CLASS ADDED | compiler PartialFunction class carrying a moved `collect { case .. }` body: OK (name-only change from OutputService$$anonfun$N)
com.helio.services.pipelines.OutputService | - public static final boolean $anonfun$materializedFor$4(com.helio.domain.model.Output, scala.Option); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final boolean $anonfun$materializedFor$5(com.helio.domain.model.Output, java.time.Instant); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final boolean $anonfun$resolveExplicitRootId$2(java.lang.String, com.helio.domain.model.PipelineRoot); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.Object $anonfun$materializedFor$4$adapted(com.helio.domain.model.Output, scala.Option); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.Object $anonfun$materializedFor$5$adapted(com.helio.domain.model.Output, java.time.Instant); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.Object $anonfun$resolveExplicitRootId$2$adapted(java.lang.String, com.helio.domain.model.PipelineRoot); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$distinctValues$3$adapted(java.lang.Object); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$distinctValues$3(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$distinctValues$4$adapted(java.lang.Object); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$distinctValues$4(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$materializedFor$1$adapted(java.lang.Object); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$materializedFor$1(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$materializedFor$2$adapted(java.lang.Object); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$materializedFor$2(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$rows$3$adapted(java.lang.Object); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$rows$3(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$rows$4$adapted(java.lang.Object); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final java.lang.String $anonfun$rows$4(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$distinctValues$1(com.helio.services.pipelines.OutputService, java.lang.String, scala.Option); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$distinctValues$2(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, java.lang.String, scala.util.Either); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$filterCapabilities$1(com.helio.services.pipelines.OutputService, scala.Option); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$materializedFor$3$adapted(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, java.lang.Object); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$materializedFor$3(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, boolean); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$rows$1(com.helio.services.pipelines.OutputService, com.helio.domain.model.Page, scala.Option, scala.Option, scala.Option); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$rows$2(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, com.helio.domain.model.Page, scala.Option, scala.util.Either); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$rows$5(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, scala.Option, com.helio.domain.model.Page, com.helio.domain.model.PagedResult); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$rows$6$adapted(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, scala.Option, com.helio.domain.model.Page, com.helio.domain.model.PagedResult, java.lang.Object); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.concurrent.Future $anonfun$rows$6(com.helio.services.pipelines.OutputService, com.helio.domain.model.Output, scala.Option, com.helio.domain.model.Page, com.helio.domain.model.PagedResult, boolean); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.util.Either $anonfun$requireUnambiguousRootWhenNeither$1(scala.collection.immutable.Vector); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.util.Either $anonfun$resolveExplicitRootId$1(java.lang.String, java.lang.String, scala.collection.immutable.Vector); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.util.Right $anonfun$distinctValues$5(scala.collection.immutable.Vector); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.util.Right $anonfun$filterCapabilities$2(com.helio.services.pipelines.OutputFilterCapability$FilterCapabilityContract); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final scala.util.Right $anonfun$rows$7(com.helio.domain.model.PagedResult, boolean, scala.Option); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService | - public static final spray.json.JsValue $anonfun$rows$8(spray.json.JsValue); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final boolean $anonfun$validateFieldMapping$1(com.helio.domain.model.OutputKind, com.helio.domain.panels.OutputBindingSpec); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$1(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$4(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final com.helio.services.ServiceError$BadRequest $anonfun$validateConfig$6(java.lang.String); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final java.lang.Object $anonfun$validateFieldMapping$1$adapted(com.helio.domain.model.OutputKind, com.helio.domain.panels.OutputBindingSpec); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final scala.runtime.Nothing$ $anonfun$validateFieldMapping$2(com.helio.domain.model.OutputKind); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final scala.util.Either $anonfun$validateConfig$2(com.helio.domain.model.OutputKind, spray.json.JsObject, scala.runtime.BoxedUnit); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final scala.util.Either $anonfun$validateConfig$3(spray.json.JsObject, scala.runtime.BoxedUnit); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$ | - public static final scala.util.Either $anonfun$validateConfig$5(spray.json.JsObject, scala.runtime.BoxedUnit); | compiler synthetic (removed)
com.helio.services.pipelines.OutputService$$anonfun$1 | CLASS REMOVED | compiler PartialFunction class whose body moved: OK
com.helio.services.pipelines.OutputService$$anonfun$2 | CLASS REMOVED | compiler PartialFunction class whose body moved: OK
INVARIANT | OutputService carries validateConfig$default$4() | OK
INVARIANT | OutputService$ carries validateConfig$default$4() | OK
INVARIANT | OutputService has no member containing 'rowReads' or 'rootResolution' | OK
INVARIANT | no `$$` MEMBER (method/field) name added on any checked class | OK

RESULT: PASS
```

## 3. `git grep` proof that nothing references the two removed accessors

```
$ git grep -n -e escapeLikeTerm -e likeEscapeChar 24f6de4cf -- backend frontend helio-mcp e2e schemas scripts | grep -v "NodeSnapshotRepository.scala"
(exit 1 ; no output = no other reference)
$ git grep -n -e escapeLikeTerm -e likeEscapeChar ca3f5619 -- backend frontend helio-mcp e2e schemas scripts | grep -v "NodeSnapshotRepository.scala"
(exit 1 ; no output = no other reference)
$ git grep -n -e escapeLikeTerm -e likeEscapeChar HEAD -- backend | grep -v "NodeSnapshotFilterSql.scala"
(exit 1 ; no output = only the new home references them)
```

## 4. Red runs of the classifier (both temporary, reverted)

### Red (i): add a defaulted parameter to a public method (`NodeSnapshotRepository.countRows(..., extra: Int = 0)`), rebuild, javap, classify
```
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | + public int countRows$default$4(); | FAIL
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | + public scala.concurrent.Future<java.lang.Object> countRows(java.lang.String, scala.Option<java.lang.String>, scala.Option<java.lang.String>, int); | FAIL
com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository | - public scala.concurrent.Future<java.lang.Object> countRows(java.lang.String, scala.Option<java.lang.String>, scala.Option<java.lang.String>); | FAIL
RESULT: FAIL [('unclassified added', 'com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository', '  public int countRows$default$4();'), ('unclassified added', 'com.helio.infrastructure.persistence.pipelines.NodeSnapshotRepository', '  public scala.concurrent.Future<java.lang.Object> countRows(java.lang.String, scal
```

### Red (ii): make `rowReads` `private[pipelines]` instead of `private`, rebuild, javap, classify
```
com.helio.services.pipelines.OutputService | + public com.helio.services.pipelines.OutputRowReads rowReads(); | FAIL
INVARIANT | OutputService has no member containing 'rowReads' or 'rootResolution' | FAIL
RESULT: FAIL [('unclassified added', 'com.helio.services.pipelines.OutputService', '  public com.helio.services.pipelines.OutputRowReads rowReads();'), ('invariant', "OutputService has no member containing 'rowReads' or 'rootResolution'")]
```

Both reverted (source verified byte-identical via `move-check/check_moves.py` PASS at commit time and the final full suite run being on the committed tree).

## 5. Companion forwarders keep their defaults
`OutputService` and `OutputService$` both still list `validateConfig$default$4()` (classifier INVARIANT lines above), and `OutputService.scala` has no member containing `rowReads`/`rootResolution` (both wiring vals are strictly `private`; no `$$` accessor appeared).

## 6. Open PR #847 (HEL-1371, ca3f5619)
`git merge-tree --write-tree HEAD ca3f5619` -> tree `984c3b148f98cbe245442803a7d1e5235b389493`, exit 0, no conflicts (`move-check/trialmerge.out`). Beyond the textual merge, the merged tree was exported with `git archive` and `sbt Test/compile` ran green on it (PR #847's `NodeSnapshotRepository.listRows/overwriteRows/overwriteRowsWith` callers compile against the split).
