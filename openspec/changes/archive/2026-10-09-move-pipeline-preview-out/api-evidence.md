# API evidence -- HEL-1393 (C5)

Method: `move-check/javap.sh <classes> <out>`: `javap -public` of `PipelineRunService`, `PipelineRunService$`, `CachedRunStatus(+$)`, `TriggerSource(+$)`,
synthetics (`$anonfun$`, `$deserializeLambda$`, `$$`) filtered. Baseline = classes compiled from the unmodified ecaa1a53 worktree.

## Commit (a)
```
$ diff javap-base.filtered javap-a.filtered ; echo exit=$?
exit=0
```
Filtered lines: 122. Raw (unfiltered) differs only in synthetics: the `$anonfun$previewOutputs/previewAtNode*` lambdas and the `...$$support` accessor left PipelineRunService (they now live in PipelineRunPreview).

## Red run (non-empty required): add a defaulted param `extra: Int = 0` to `previewStep`, compile, diff, revert
```
29c29,30
<   public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.api.protocols.pipelines.RunResultResponse>> previewStep(java.lang.String, java.lang.String, com.helio.domain.model.AuthenticatedUser);
---
>   public scala.concurrent.Future<scala.util.Either<com.helio.services.ServiceError, com.helio.api.protocols.pipelines.RunResultResponse>> previewStep(java.lang.String, java.lang.String, com.helio.domain.model.AuthenticatedUser, int);
>   public int previewStep$default$4();
```

## Final (HEAD, after all four commits and the full testFull run)
```
$ diff javap-base.filtered javap-final.filtered ; echo exit=$?
exit=0
```
