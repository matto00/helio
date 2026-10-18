// MobileRunsTab -- HEL-1582 (design.md D8): the Runs tab, the run history list inline (the same list the desktop Run
// history modal shows). It loads on first activation through `ensureRunHistoryLoaded`, which never opens the modal.

import { useEffect } from "react";

import { RunHistoryList } from "../RunHistoryModal";
import type { PipelinePageState } from "../spine/PipelineSpineLayout";

export function MobileRunsTab({ page }: { page: PipelinePageState }) {
  const { ensureRunHistoryLoaded } = page;
  useEffect(() => {
    ensureRunHistoryLoaded();
  }, [ensureRunHistoryLoaded]);
  return (
    <RunHistoryList runs={page.runs} view={page.runHistoryView} onRetry={page.retryRunHistory} />
  );
}
