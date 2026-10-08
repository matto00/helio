#!/usr/bin/env bash
S=/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad
SV=backend/src/main/scala/com/helio/services/pipelines; PE=backend/src/main/scala/com/helio/infrastructure/persistence/pipelines
$S/mutate.sh filtersql $PE/NodeSnapshotFilterSql.scala 'sql" >= "' 'sql" > "' '*OutputRoutesSpec'
$S/mutate.sh rowreads $SV/OutputRowReads.scala 'lastSuccess.exists(t => !t.isBefore(output.createdAt))' 'lastSuccess.exists(t => t.isBefore(output.createdAt))' '*OutputRoutesSpec'
$S/mutate.sh rootres $SV/OutputRootResolution.scala 'if (roots.size > 1)' 'if (roots.size > 2)' '*OutputRoutesSpec'
$S/mutate.sh cfgval $SV/OutputConfigValidation.scala 'JsObject(existing.fields ++ patch.fields)' 'JsObject(patch.fields ++ existing.fields)' '*OutputRoutesSpec'
echo all > $S/muts.done
