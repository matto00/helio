#!/bin/bash
# usage: javap.sh <classes-dir> <out>   -> raw dump + filtered dump
C=$1; O=$2
for c in PipelineRunService 'PipelineRunService$' CachedRunStatus 'CachedRunStatus$' TriggerSource 'TriggerSource$'; do echo "=== $c"; javap -public -cp "$C" "com.helio.services.pipelines.$c"; done > $O.raw 2>&1
grep -vE '\$anonfun\$|\$deserializeLambda\$|\$\$' $O.raw > $O.filtered
