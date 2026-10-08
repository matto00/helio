# API evidence (HEL-1371, design D6b / C5)

`javap -public` of PipelineRunService, PipelineRunService$, CachedRunStatus, CachedRunStatus$, TriggerSource, TriggerSource$, from the sbt 2 output dir (`backend/target/out/jvm/scala-2.13.15/helio-backend/classes`), built at the base (4db9730fd, before any edit) and after the split. Script: `move-check/javap.sh`. Filter: drop lines containing `$anonfun$`, `$deserializeLambda$` or `$$`.

| | raw lines | `$anonfun$` lines | `$$` lines | filtered lines |
|---|---|---|---|---|
| base | 388 | 262 | 9 | 120 |
| after | 185 | 64 | 4 | 120 |

## Filtered diff, base vs after
```
diff exit=0 (empty = identical)
```

The filtered output still contains the constructor, every `$lessinit$greater$default$N`, `submit$default$N`, every public method and the companion/`CachedRunStatus`/`TriggerSource` members.

## Expected `$$` members (name-mangled public accessors that left or arrived with the moved bodies)
```
--- base
public final scala.concurrent.ExecutionContext com$helio$services$pipelines$PipelineRunService$$ec;
public org.slf4j.Logger com$helio$services$pipelines$PipelineRunService$$log();
public void com$helio$services$pipelines$PipelineRunService$$logExecutionFailure(java.lang.String, java.lang.Throwable);
public com.helio.services.ServiceError com$helio$services$pipelines$PipelineRunService$$executionFailureError(java.lang.Throwable);
public scala.concurrent.Future<scala.runtime.BoxedUnit> com$helio$services$pipelines$PipelineRunService$$onWriteBackFailure(java.lang.String, java.lang.String, java.lang.String, com.helio.domain.model.AuthenticatedUser, scala.collection.immutable.Vector<com.helio.domain.model.AssertionResult>, java.lang.String);
public boolean com$helio$services$pipelines$PipelineRunService$$isBinaryRefShape(scala.collection.immutable.Map<java.lang.String, java.lang.Object>);
public static final scala.util.Try $anonfun$$lessinit$greater$default$13$1(java.lang.String);
public static final boolean $anonfun$$lessinit$greater$default$14$1(java.lang.String, java.net.InetAddress);
public static final java.lang.Object $anonfun$$lessinit$greater$default$14$1$adapted(java.lang.String, java.net.InetAddress);
--- after
public com.helio.services.pipelines.PipelineRunSupport com$helio$services$pipelines$PipelineRunService$$support();
public static final scala.util.Try $anonfun$$lessinit$greater$default$13$1(java.lang.String);
public static final boolean $anonfun$$lessinit$greater$default$14$1(java.lang.String, java.net.InetAddress);
public static final java.lang.Object $anonfun$$lessinit$greater$default$14$1$adapted(java.lang.String, java.net.InetAddress);
```

## Red run (filtered comparison is failable)
A trailing defaulted parameter `redProbe: Boolean = false` was temporarily added to `submit` (main still compiled: `[success]`), then rebuilt, dumped and diffed, then reverted:
```
23c23
<   public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.api.protocols.pipelines.RunResultResponse>> submit(java.lang.String, boolean, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option<java.lang.String>);
---
>   public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.api.protocols.pipelines.RunResultResponse>> submit(java.lang.String, boolean, com.helio.domain.model.AuthenticatedUser, java.lang.String, scala.Option<java.lang.String>, boolean);
25a26
>   public boolean submit$default$6();
diff exit=1
```
