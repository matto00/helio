# javap -public evidence (HEL-1463, D6b / C5)

`move-check/javap.sh <classes-dir> <out>` dumps `javap -public` for `com.helio.services.pipelines.PipelineService` and
`PipelineService$` and filters it by dropping ONLY lines matching `\$anonfun\$|\$deserializeLambda\$|\$\$`.

- BEFORE: classes compiled at BASE 1b765f59d (run evidence dir `base-classes/`, re-dumped and identical to the first dump):
  raw 495 lines, filtered 56, dropped 439.
- AFTER: classes compiled from the change: raw 98 lines, filtered 56, dropped 42.
- `diff javap-base.filtered javap-after.filtered`: EMPTY (exit 0). Both filtered files are in `move-check/`
  (`javap-base.filtered`, `javap-after.filtered`); they cover the constructor, `$lessinit$greater$default$N`,
  `listSummaries$default$2`, every public method (the five `private[services]` ones included) and every companion member.

## Red run (`move-check/javap-red-run.txt`)

`removeRoot`'s entry delegation temporarily given a trailing defaulted parameter `redProbe: Int = 0`; `main` compiled
(rc=0); the filtered diff was NON-empty:

```
<   public ...removeRoot(java.lang.String, java.lang.String, com.helio.domain.model.AuthenticatedUser);
>   public ...removeRoot(java.lang.String, java.lang.String, com.helio.domain.model.AuthenticatedUser, int);
>   public int removeRoot$default$4();
```

Reverted; recompiled; filtered diff empty again.
