#!/bin/bash
# usage: javap.sh <classes-dir> <out-prefix>  -> <out>.raw (javap -public) and <out>.filtered (D6b filter) for PatchSetApplyResolvers and PatchSetApplyResolvers$
C=$1; O=$2
for c in PatchSetApplyResolvers 'PatchSetApplyResolvers$'; do echo "=== $c"; javap -public -cp "$C" "com.helio.services.patchsets.$c"; done > "$O.raw" 2>&1
grep -vE '\$anonfun\$|\$deserializeLambda\$|\$\$' "$O.raw" > "$O.filtered"
echo "raw lines: $(wc -l < "$O.raw"); filtered lines: $(wc -l < "$O.filtered"); dropped: $(( $(wc -l < "$O.raw") - $(wc -l < "$O.filtered") ))"
