#!/usr/bin/env python3
"""D6d mutations: usage W=<worktree> mutate.py apply|revert|list [ids]. One behaviour mutation per new object (exact-line, asserted)."""
import sys, os
W = os.environ["W"]
P = W + "/backend/src/main/scala/com/helio/services/patchsets/"
MUT = [  # id, file, 1-based line, old substring, new substring
 ("M1", "PatchSetApplyResolvers.scala", 189, 'case Right(_)                     => Right(())', 'case Right(_)                     => Left(ServiceError.Conflict("mutated"))'),  # PatchSetResolverSupport.authorizeEditorOnDashboard (editor/owner pass -> reject)
 ("M2", "PatchSetPanelResolvers.scala", 45, 'Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))),', 'None,'),  # resolvePanelUpdate priorState dropped
 ("M3", "PatchSetDataSourceResolvers.scala", 56, 'Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(existing))),', 'None,'),  # resolveDataSourceDelete priorState dropped
 ("M4", "PatchSetPipelineResolvers.scala", 56, 'Some(pipelineSummaryResponseFormat.write(pipelineSummaryResponse(summary))),', 'None,'),  # resolvePipelineUpdate priorState dropped
 ("M5", "PatchSetPipelineStepResolvers.scala", 65, 'ServiceError.NotFound(s"edit $index: data source not found: $id")', 'ServiceError.Conflict(s"edit $index: data source not found: $id")'),  # validateEmbeddedStepReferences foreign second source
 ("M6", "PatchSetOutputResolvers.scala", 28, 'if output.ownerId != user.id => Left(ServiceError.NotFound("Output not found"))', 'if output.ownerId != user.id => Right(output)'),  # findOwnedOutput owner check
]
mode = sys.argv[1]; only = set(sys.argv[2:])
for mid, fn, ln, old, new in MUT:
    if only and mid not in only: continue
    if mode == "list": print(mid, fn, ln, old, "->", new); continue
    p = P + fn; lines = open(p).read().split("\n")
    a, b = (old, new) if mode == "apply" else (new, old)
    assert a in lines[ln - 1], (mid, "pattern absent", lines[ln - 1])
    lines[ln - 1] = lines[ln - 1].replace(a, b, 1); open(p, "w").write("\n".join(lines)); print(mode, mid, fn, ln)
