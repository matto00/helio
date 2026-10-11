#!/bin/bash
# D6c grep guards. usage: BASE=<sha> grep-guards.sh   (run with the worktree as cwd)
D=backend/src/main/scala/com/helio/services/patchsets; K=$D/PatchSetApplyResolvers.scala
NEW="$D/PatchSetPanelResolvers.scala $D/PatchSetDataSourceResolvers.scala $D/PatchSetPipelineResolvers.scala $D/PatchSetPipelineStepResolvers.scala $D/PatchSetOutputResolvers.scala"
code() { grep -nvE '^\s*(\*|//|/\*)' "$@"; }
echo "## D6c grep guards (HEAD $(git rev-parse --short HEAD) + working tree; BASE=$BASE)"
echo "-- new files: Forbidden( producers / access-helper calls (expect none)"
code $NEW | grep -E 'ServiceError\.Forbidden\(|\b(requireOwnerOnly|requireAccess|authorizeResourceWithSharing|authorizeResource)\('; echo "(end)"
echo "-- kept file producer code lines (expect 4):"
code $K | grep 'ServiceError.Forbidden(' | grep -v 'Forbidden(_)' | tee /dev/stderr 2>&1 >/dev/null | wc -l
code $K | grep 'ServiceError.Forbidden(' | grep -v 'Forbidden(_)'
echo "-- kept file requireAccess( code lines (expect 2):"
code $K | grep -E '\brequireAccess\(' | grep -vE ':\s*(private )?def |\sdef ' | wc -l
echo "-- kept file dispatch case (\"kind\",\"op\") lines (expect 18):"
code $K | grep -cE 'case \("\w+", "\w+"\)'
echo "-- BASE dispatch lines (expect 18):"
git show $BASE:$K | grep -vE '^\s*(\*|//|/\*)' | grep -cE 'case \("\w+", "\w+"\)'
echo "-- inline FQN scan outside import/package lines in the six files (expect none):"
code $K $NEW | grep -E '(com\.helio\.|spray\.json\.|java\.|scala\.|org\.)' | grep -vE ':\s*(import|package) '; echo "(end)"
echo "-- BASE inline FQN in non-comment, non-import lines for comparison:"
git show $BASE:$K | grep -vE '^\s*(\*|//|/\*)' | grep -E '(com\.helio\.|spray\.json\.|java\.|scala\.|org\.)' | grep -vE '^\s*(import|package) '; echo "(end)"
echo "-- file sizes:"; wc -l $K $NEW
