#!/usr/bin/env python3
"""HEL-1501 commit 3: carve the verbatim clusters K1-K6 out of SPLIT_BASE usePipelineDetailPage.ts
into new hook files. Bodies are sliced mechanically from `git show f63ab8365:...`; only the file
headers (imports, params type, function signature) and `return {...}` footers are authored.
The host edit (call sites + deleted regions) is applied separately by hook-split-host.py."""
import subprocess
BASE = "f63ab8365"
H = "frontend/src/features/pipelines/hooks/"
base = subprocess.check_output(["git", "show", f"{BASE}:{H}usePipelineDetailPage.ts"], text=True).split("\n")
def r(a, b): return "\n".join(base[a - 1:b]) + "\n"

def emit(name, header, sig, body, ret):
    with open(f"{H}{name}.ts", "w") as f:
        if len(ret) == 1 and name == "usePipelineStepsFingerprint":
            tail = "\n  return stepsFingerprint;\n}\n"
        elif not ret:
            tail = "}\n"
        else:
            tail = "\n  return {\n" + "".join(f"    {k},\n" for k in ret) + "  };\n}\n"
        f.write(header + "\n" + sig + body + tail)

emit("usePipelineOwnPipeline",
'''import { useState } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";

/**
 * The sources + pipelines slice selectors and the page-id ownership derivation extracted from
 * `usePipelineDetailPage` (HEL-1501): the singleton `currentPipeline*` state exposed only for the
 * page's own id. Moved verbatim and called at the same position in the host's hook order.
 */''',
"export function usePipelineOwnPipeline({ id }: { id: string | undefined }) {\n",
r(49, 91),
["sources","sourcesStatus","runStatus","runError","runIsDry","runResult","runStepRowCounts","runSourceRowCount","runSourceTruncated","runTruncationNotice","updateStatus","updateError","reduxSteps","singletonIsOwn","currentPipeline","currentPipelineStatus","currentPipelineError","currentPipelineErrorKind"])

emit("usePipelineAnalyzeState",
'''import { useLayoutEffect, useRef } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";

/**
 * The per-pipeline analyze result / status (+ the status mirrored into a ref) and schedule
 * selectors extracted from `usePipelineDetailPage` (HEL-1501). Moved verbatim.
 */''',
"export function usePipelineAnalyzeState({ id }: { id: string | undefined }) {\n",
r(93, 119),
["analyzeResult","analyzeStatus","analyzeStatusRef","pipelineSchedule"])

emit("usePipelineEditorState",
'''import { useLayoutEffect, useRef, useState } from "react";

import type { Output } from "../types/output";
import type { Step } from "../types/step";
import type { PendingDraftMeta } from "./usePipelineStepCreation";

/**
 * The editor's local state and ref cluster extracted from `usePipelineDetailPage` (HEL-1501): the
 * `steps` list + its ref, the pending/in-flight draft bookkeeping, the steps-fetch phase, the
 * seed token, the SSE-active flag + ref and the analyze-guard refs. Moved verbatim, in order,
 * so the host's hook sequence is unchanged.
 */''',
"export function usePipelineEditorState() {\n",
r(123, 220),
["steps","setSteps","stepsRef","pendingDraftMetaRef","pendingDraftIds","setPendingDraftIds","draftFallbackMetaRef","allOutputsRef","stepsInitialized","setStepsInitialized","setStepsFetch","stepsFetchedThisMount","stepsLoading","seedToken","setSeedToken","consumedSeedTokenRef","dropdownOpenAt","setDropdownOpenAt","sseActive","setSseActive","sseActiveRef","pendingAnalyzeRef","lastAnalyzedFingerprintRef","pendingSinceRef","deferWatchdogHandleRef","stepsFingerprintRef"])

emit("usePipelineStepsFingerprint",
'''import { useLayoutEffect } from "react";
import type { MutableRefObject } from "react";

import type { Step } from "../types/step";

/**
 * The steps-shape fingerprint (and the ref mirroring it) extracted from `usePipelineDetailPage`
 * (HEL-1501). Moved verbatim.
 */''',
"export function usePipelineStepsFingerprint({\n  steps,\n  pendingDraftIds,\n  stepsFingerprintRef,\n}: {\n  steps: Step[];\n  pendingDraftIds: ReadonlySet<string>;\n  stepsFingerprintRef: MutableRefObject<string>;\n}) {\n",
r(287, 310),
["stepsFingerprint"])

emit("usePipelineClearRunOnLeave",
'''import { useEffect } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { clearRunState } from "../state/pipelinesSlice";
// HEL-878 (task 2.4): dispatched alongside `clearRunState` at every reset call
// site so the run-scoped Output preview cache never drifts out of sync with
// the run-scoped pipeline state -- see `outputsSlice.ts`'s doc comment on the
// reducer itself for the full unification rationale.
import { resetRunScopedState } from "../state/outputsSlice";

/**
 * The run-state reset on pipeline change / unmount extracted from `usePipelineDetailPage`
 * (HEL-1501). Moved verbatim.
 */''',
"export function usePipelineClearRunOnLeave({\n  dispatch,\n  id,\n}: {\n  dispatch: ReturnType<typeof useAppDispatch>;\n  id: string | undefined;\n}) {\n",
r(346, 355),
[])

emit("usePipelineDirtyAndOwner",
'''import { useEffect, useMemo } from "react";

import type { DataSource } from "../../sources/types/dataSource";
import type { User } from "../../auth/types/user";
import type { PipelineRoot, PipelineSummary } from "../types/pipelineStep";

/**
 * The dirty flag + beforeunload guard, page name, per-root source lookup and ownership flag
 * extracted from `usePipelineDetailPage` (HEL-1501). Moved verbatim.
 */''',
"export function usePipelineDirtyAndOwner({\n  id,\n  outputNamePipelineId,\n  outputName,\n  currentPipeline,\n  currentUser,\n  roots,\n  sources,\n}: {\n  id: string | undefined;\n  outputNamePipelineId: string | null;\n  outputName: string;\n  currentPipeline: PipelineSummary | null;\n  currentUser: User | null;\n  roots: PipelineRoot[];\n  sources: DataSource[];\n}) {\n",
r(371, 400),
["isDirty","pipelineName","sourceByRootId","isOwner"])
