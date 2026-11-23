import { useEffect, useMemo } from "react";

import type { DataSource } from "../../sources/types/dataSource";
import type { User } from "../../auth/types/user";
import type { PipelineRoot, PipelineSummary } from "../types/pipelineStep";

/** Whether `currentUser` owns `currentPipeline` (HEL-1794: also read before the draft hook, to resolve the caller's role first). */
export function isPipelineOwner(
  currentPipeline: PipelineSummary | null,
  currentUser: User | null,
): boolean {
  return (
    currentPipeline?.ownerId != null &&
    currentUser?.id != null &&
    currentUser.id === currentPipeline.ownerId
  );
}

/**
 * The dirty flag + beforeunload guard, page name, per-root source lookup and ownership flag
 * extracted from `usePipelineDetailPage` (HEL-1501). Moved verbatim.
 */
export function usePipelineDirtyAndOwner({
  id,
  outputNamePipelineId,
  outputName,
  currentPipeline,
  currentUser,
  roots,
  sources,
}: {
  id: string | undefined;
  outputNamePipelineId: string | null;
  outputName: string;
  currentPipeline: PipelineSummary | null;
  currentUser: User | null;
  roots: PipelineRoot[];
  sources: DataSource[];
}) {
  const isDirty = outputNamePipelineId !== null && outputName !== (currentPipeline?.name ?? "");

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const pipelineName = currentPipeline?.name ?? id ?? "Pipeline";
  // HEL-1022 — "which source(s) is this pipeline bound to" used to name only
  // `roots[0]` (D2's old display convention); the header now shows one chip
  // per root, so "is this source editable by the current user" is a PER-ROOT
  // question, not a single global boolean. Keyed by root id (not source id)
  // since two roots can't share a `dataSourceId` but the lookup site always
  // has the root, not the source, at hand.
  const sourceByRootId = useMemo(() => {
    const map: Record<string, DataSource | undefined> = {};
    for (const root of roots) {
      map[root.id] = sources.find((s) => s.id === root.dataSourceId);
    }
    return map;
  }, [roots, sources]);
  const isOwner = isPipelineOwner(currentPipeline, currentUser);

  return {
    isDirty,
    pipelineName,
    sourceByRootId,
    isOwner,
  };
}
