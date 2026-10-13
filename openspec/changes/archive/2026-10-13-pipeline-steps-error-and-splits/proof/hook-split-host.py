#!/usr/bin/env python3
"""HEL-1501 commit 3: rewrite usePipelineDetailPage.ts from SPLIT_BASE by replacing each moved
cluster's line range with its call site. Everything outside the ranges is carried byte-for-byte."""
import subprocess
BASE = "f63ab8365"
H = "frontend/src/features/pipelines/hooks/"
base = subprocess.check_output(["git", "show", f"{BASE}:{H}usePipelineDetailPage.ts"], text=True).split("\n")
def destructure(names, call): return "  const {\n" + "".join(f"    {n},\n" for n in names) + "  } = " + call + ";\n"
repl = {
 (49, 91): destructure(["sources","sourcesStatus","runStatus","runError","runIsDry","runResult","runStepRowCounts","runSourceRowCount","runSourceTruncated","runTruncationNotice","updateStatus","updateError","reduxSteps","singletonIsOwn","currentPipeline","currentPipelineStatus","currentPipelineError","currentPipelineErrorKind"], "usePipelineOwnPipeline({ id })"),
 (93, 119): destructure(["analyzeResult","analyzeStatus","analyzeStatusRef","pipelineSchedule"], "usePipelineAnalyzeState({ id })"),
 (123, 220): destructure(["steps","setSteps","stepsRef","pendingDraftMetaRef","pendingDraftIds","setPendingDraftIds","draftFallbackMetaRef","allOutputsRef","stepsInitialized","setStepsInitialized","setStepsFetch","stepsFetchedThisMount","stepsLoading","seedToken","setSeedToken","consumedSeedTokenRef","dropdownOpenAt","setDropdownOpenAt","sseActive","setSseActive","sseActiveRef","pendingAnalyzeRef","lastAnalyzedFingerprintRef","pendingSinceRef","deferWatchdogHandleRef","stepsFingerprintRef"], "usePipelineEditorState()"),
 (287, 310): "  const stepsFingerprint = usePipelineStepsFingerprint({ steps, pendingDraftIds, stepsFingerprintRef });\n",
 (346, 355): "  usePipelineClearRunOnLeave({ dispatch, id });\n",
 (371, 400): destructure(["isDirty","pipelineName","sourceByRootId","isOwner"], "usePipelineDirtyAndOwner({ id, outputNamePipelineId, outputName, currentPipeline, currentUser, roots, sources })"),
}
out, i = [], 1
starts = {a: (a, b) for (a, b) in repl}
while i <= len(base) - 1 or i == len(base) and base[-1] != "":
    if i in starts:
        a, b = starts[i]; out.append(repl[(a, b)].rstrip("\n")); i = b + 1; continue
    if i > len(base): break
    out.append(base[i - 1]); i += 1
open(H + "usePipelineDetailPage.ts", "w").write("\n".join(out).rstrip("\n") + "\n")
