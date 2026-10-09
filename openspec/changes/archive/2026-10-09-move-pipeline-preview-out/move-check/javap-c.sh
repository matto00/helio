#!/bin/bash
# usage: javap-c.sh <classes-dir> <out-dir> : full disassembly (-c -p -l) of every class of PipelineRunPreview and PipelineRunTerminalWrites (incl. anonymous/lambda classes)
C=$1; O=$2; mkdir -p $O
for f in $(cd $C/com/helio/services/pipelines && ls | grep -E '^(PipelineRunPreview|PipelineRunTerminalWrites)(\$.*)?\.class$' | sort); do
  n=${f%.class}; javap -c -p -l -cp "$C" "com.helio.services.pipelines.$n" > "$O/$n.txt" 2>&1
done
ls $O | wc -l
