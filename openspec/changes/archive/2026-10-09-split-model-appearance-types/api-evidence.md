# API evidence (D6b)

Class dir used for javap (sbt 2 output dir, this worktree): `backend/target/out/jvm/scala-2.13.15/helio-backend/classes` (NOT backend/target/scala-2.13/classes). Before = base build with model.scala untouched (after baseline testFull); after = post-move build, re-dumped after the final testFull and byte-identical to the first after-dump. Dump script: `move-check/javap-dump.sh` (`javap -public`, 16 classes, no filtering).

## Compiled-from lines (positive per-D1 mapping)
Before: all 16 dumps say `model.scala`. After:
```
ChartAppearance$Patch$: Compiled from "ChartAppearance.scala"
ChartAppearance$Patch: Compiled from "ChartAppearance.scala"
ChartAppearance$: Compiled from "ChartAppearance.scala"
ChartAppearance: Compiled from "ChartAppearance.scala"
ChartAxisLabel$: Compiled from "ChartAppearance.scala"
ChartAxisLabels$: Compiled from "ChartAppearance.scala"
ChartAxisLabels: Compiled from "ChartAppearance.scala"
ChartAxisLabel: Compiled from "ChartAppearance.scala"
ChartLegend$: Compiled from "ChartAppearance.scala"
ChartLegend: Compiled from "ChartAppearance.scala"
ChartTooltip$: Compiled from "ChartAppearance.scala"
ChartTooltip: Compiled from "ChartAppearance.scala"
PanelAppearance$Patch$: Compiled from "PanelAppearance.scala"
PanelAppearance$Patch: Compiled from "PanelAppearance.scala"
PanelAppearance$: Compiled from "PanelAppearance.scala"
PanelAppearance: Compiled from "PanelAppearance.scala"
```

## DEVIATION from D6b ("everything else byte-identical")
The raw diff (move-check/javap-raw.diff) has, besides the 16 `Compiled from` lines, a renumbering of public synthetic `$anonfun$applyPatch$N` lambda methods in `PanelAppearance$` ONLY: 13 lines (`$anonfun$applyPatch$15..26` became `$1..12`, plus the `$22$adapted` -> `$8$adapted` bridge), an N to N-14 shift. scalac numbers lambdas with a per-compilation-unit counter; `ChartAppearance$` already held lambdas 1..14 in model.scala at base, so `PanelAppearance`'s started at 15 and restarts at 1 in its own file. `ChartAppearance$` and `ChartAppearance$Patch$` show no `$anonfun$` change (only the `Compiled from` line). D6b assumed stability; it does not hold for the object that moved second. Not a signature change: after normalizing only the numeric suffix of `$anonfun$<name>$N` and dropping the `Compiled from` line, ALL 16 dumps are identical, in original line order (no sorting needed):
```
for each dump: diff <(sed -E "/^Compiled from/d; s/(\$anonfun\$[A-Za-z]+\$)[0-9]+/\1N/g" before) <(same after)  ->  empty for all 16
```
The anonfun methods are synthetic, unreachable by name from Scala source; no caller references them.

## Class-file name set under com/helio/domain/model/
`diff javap-before/_classnames.txt javap-after/_classnames.txt` -> identical (315 names).

## Red run (main compiles): trailing defaulted param on `PanelAppearance.applyPatchJson`
```
7c7,8
<   public scala.util.Either<java.lang.String, com.helio.domain.model.PanelAppearance> applyPatchJson(spray.json.JsValue, com.helio.domain.model.PanelAppearance);
---
>   public scala.util.Either<java.lang.String, com.helio.domain.model.PanelAppearance> applyPatchJson(spray.json.JsValue, com.helio.domain.model.PanelAppearance, boolean);
>   public boolean applyPatchJson$default$3();
```
Reverted afterwards; subsequent full testFull and final re-dump are from the unmutated tree.
