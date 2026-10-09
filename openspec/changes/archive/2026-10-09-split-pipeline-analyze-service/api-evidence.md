# HEL-1385 API evidence (design D6b, C5)

Method: `javap -public` of PipelineAnalyzeService, PipelineAnalyzeService$, SchemaField, SchemaField$ and the nested PipelineStepInput, AnalyzedStep, NodeStepInput (class + companion), taken from the baseline build (before any edit) and the final build. Filtered: lines containing `$anonfun$`, `$deserializeLambda$`, `$$`, plus the `Compiled from "X.scala"` source-file attribute (SchemaField now says SchemaField.scala; not API). Script: scratchpad `javap.sh`.

Final diff (before vs after), exit code:
```
$ diff javap-before.filtered javap-after.filtered; echo exit=$?
exit=0
```

Red run: temporarily changed `stepConfigProblem`'s second parameter String -> CharSequence (callers still compile), rebuilt, re-ran javap, then reverted:
```
9c9
<   public static scala.Option<java.lang.String> stepConfigProblem(java.lang.String, java.lang.String);
---
>   public static scala.Option<java.lang.String> stepConfigProblem(java.lang.String, java.lang.CharSequence);
17c17
<   public scala.Option<java.lang.String> stepConfigProblem(java.lang.String, java.lang.String);
---
>   public scala.Option<java.lang.String> stepConfigProblem(java.lang.String, java.lang.CharSequence);
```
The forwarder keeps `inferOutputSchema` and `inferOutputSchema$default$4` (both present in the unchanged filtered output; an earlier red attempt that dropped the default failed to compile at the call site, which is also a guard).
