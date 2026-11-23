import { useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { savePipelineSchedule } from "../state/pipelinesSlice";
import type { PipelineSchedule } from "../types/pipelineSchedule";

type UsePipelineSourceScheduleActionsArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  navigate: NavigateFunction;
  pipelineSchedule: PipelineSchedule | null;
  /** HEL-1794: false for a viewer or an unknown role: the schedule toggle returns at once. */
  canEdit: boolean;
};

/**
 * The header's source-chip and schedule-bar actions extracted from `usePipelineDetailPage`
 * (HEL-1478 D3, C8).
 */
export function usePipelineSourceScheduleActions({
  id,
  dispatch,
  navigate,
  pipelineSchedule,
  canEdit,
}: UsePipelineSourceScheduleActionsArgs) {
  // HEL-1022 — takes the target source's id explicitly rather than closing
  // over a single "the bound source" (there can be several now); the caller
  // (`PipelineDetailHeader`) resolves which root's source this is per chip.
  const handleEditSource = useCallback(
    (sourceId: string) => {
      // Deep-links straight to the source now that `/sources/:id` exists; this
      // previously set a Redux selection and landed on `/sources`, relying on
      // that page to resolve it.
      void navigate(`/sources/${sourceId}`);
    },
    [navigate],
  );

  // Toggles `enabled` from the bar without opening the dialog — persists the
  // same kind/expression/timezone (spec: "Disabling from the bar").
  const handleToggleScheduleEnabled = useCallback(
    (nextEnabled: boolean) => {
      if (!id || !pipelineSchedule || !canEdit) return;
      void dispatch(
        savePipelineSchedule({
          pipelineId: id,
          request: {
            kind: pipelineSchedule.kind,
            expression: pipelineSchedule.expression,
            enabled: nextEnabled,
            timezone: pipelineSchedule.timezone,
          },
        }),
      );
    },
    [dispatch, id, pipelineSchedule, canEdit],
  );
  return { handleEditSource, handleToggleScheduleEnabled };
}
