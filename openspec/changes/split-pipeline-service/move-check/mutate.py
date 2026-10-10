#!/usr/bin/env python3
"""D6d mutations: usage mutate.py apply|revert|list. One behaviour mutation per collaborator file (exact-line, asserted)."""
import sys, os
W = os.environ.get("W", "/home/matt/Development/helio/.claude/worktrees/task/split-pipeline-service/hel-1463")
P = W + "/backend/src/main/scala/com/helio/services/pipelines/"
MUT = [  # id, file, 1-based line, old substring, new substring
 ("M1", "PipelineServiceSupport.scala", None, "      tag                  = s.tag,", "      tag                  = None,"),
 ("M2", "PipelineCreateWrites.scala", 109, 'ServiceError.NotFound(s"Data source not found:', 'ServiceError.Conflict(s"Data source not found:'),
 ("M3", "PipelineCreateTransaction.scala", 144, 'ServiceError.NotFound(s"Data source not found: $dataSourceId")', 'ServiceError.BadRequest(s"Data source not found: $dataSourceId")'),
 ("M4", "PipelineRootWrites.scala", 113, 'ServiceError.NotFound(s"Pipeline not found:', 'ServiceError.Conflict(s"Pipeline not found:'),
 ("M5", "PipelineAnalyzeReads.scala", 169, 'ServiceError.NotFound(s"Pipeline not found:', 'ServiceError.Conflict(s"Pipeline not found:'),
 ("M6", "PipelineNodeReads.scala", 148, 'ServiceError.NotFound(s"Pipeline not found:', 'ServiceError.Conflict(s"Pipeline not found:'),
 ("M7", "PipelineProposalAnalyze.scala", 273, "ServiceError.BadRequest(err)", "ServiceError.Conflict(err)"),
 ("M8", "PipelineStepCreate.scala", 126, 'ServiceError.NotFound(s"Pipeline not found:', 'ServiceError.Conflict(s"Pipeline not found:'),
 ("M9", "PipelineStepWrites.scala", 39, 'ServiceError.NotFound(s"Pipeline step not found:', 'ServiceError.Conflict(s"Pipeline step not found:'),
]
mode = sys.argv[1]; only = set(sys.argv[2:])
for mid, fn, ln, old, new in MUT:
    if only and mid not in only: continue
    if mode == "list": print(mid, fn, ln, old, "->", new); continue
    p = P + fn; lines = open(p).read().split("\n")
    a, b = (old, new) if mode == "apply" else (new, old)
    idx = [i for i, l in enumerate(lines) if a in l] if ln is None else [ln - 1]
    assert len(idx) == 1, (mid, idx)
    assert a in lines[idx[0]], (mid, "pattern absent", lines[idx[0]])
    lines[idx[0]] = lines[idx[0]].replace(a, b, 1); open(p, "w").write("\n".join(lines)); print(mode, mid, fn, idx[0] + 1)
