#!/bin/bash
# usage: javap.sh <classes-dir> <out-prefix>  -> <out>.raw (javap -public) and <out>.filtered (D6b filter) for PipelineService and PipelineService$
C=$1; O=$2
for c in PipelineService 'PipelineService$'; do echo "=== $c"; javap -public -cp "$C" "com.helio.services.pipelines.$c"; done > "$O.raw" 2>&1
grep -vE '\$anonfun\$|\$deserializeLambda\$|\$\$' "$O.raw" > "$O.filtered"
echo "raw lines: $(wc -l < "$O.raw"); filtered lines: $(wc -l < "$O.filtered"); dropped: $(( $(wc -l < "$O.raw") - $(wc -l < "$O.filtered") ))"
