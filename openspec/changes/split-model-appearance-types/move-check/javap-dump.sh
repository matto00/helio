#!/usr/bin/env bash
# usage: javap-dump.sh <classes-dir> <out-dir>  -- javap -public of the D6b classes, one file each, plus class-name list
set -euo pipefail
CD="$1"; OUT="$2"; mkdir -p "$OUT"
M=com.helio.domain.model
for c in ChartLegend ChartTooltip ChartAxisLabel ChartAxisLabels ChartAppearance PanelAppearance; do
  for n in "$c" "$c\$"; do javap -public -cp "$CD" "$M.$n" > "$OUT/$n.txt"; done
done
for n in 'ChartAppearance$Patch' 'ChartAppearance$Patch$' 'PanelAppearance$Patch' 'PanelAppearance$Patch$'; do
  javap -public -cp "$CD" "$M.$n" > "$OUT/$n.txt"
done
(cd "$CD/com/helio/domain/model" && ls | sort) > "$OUT/_classnames.txt"
