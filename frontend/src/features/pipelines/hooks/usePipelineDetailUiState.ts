import { useState } from "react";

import type { PipelineSummary } from "../types/pipelineStep";

/**
 * The page's local UI state (HEL-1704 split of `usePipelineDetailPage`): effect-free, so it may sit anywhere among the
 * effect-bearing hooks. `outputName` is re-seeded during render whenever a different pipeline becomes current (the React
 * derived-state pattern).
 */
export function usePipelineDetailUiState(currentPipeline: PipelineSummary | undefined | null) {
  const [outputName, setOutputName] = useState("");
  const [editingOutputName, setEditingOutputName] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Track which pipeline id the outputName was last initialized from
  const [outputNamePipelineId, setOutputNamePipelineId] = useState<string | null>(null);
  // Inline discard-confirm state (replaces window.confirm on dirty cancel).
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  // ── Derived-state initialization (React recommended pattern) ──
  // Sync outputName whenever a different pipeline becomes current.
  if (currentPipeline && currentPipeline.id !== outputNamePipelineId) {
    setOutputNamePipelineId(currentPipeline.id);
    setOutputName(currentPipeline.name);
  }

  return {
    outputName,
    setOutputName,
    editingOutputName,
    setEditingOutputName,
    shareOpen,
    setShareOpen,
    scheduleOpen,
    setScheduleOpen,
    outputNamePipelineId,
    isConfirmingCancel,
    setIsConfirmingCancel,
  };
}
