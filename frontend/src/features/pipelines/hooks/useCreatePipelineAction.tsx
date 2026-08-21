import { Plus } from "lucide-react";

import { setCreatePipelineModalOpen } from "../state/pipelinesSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { EmptyStateCta } from "../../../shared/ui/EmptyState";

export interface CreateActionResult {
  cta: EmptyStateCta;
  error: string | null;
  isPending: boolean;
}

/** HEL-548 D4/D5/D5b — the "New pipeline" create-action seam. A pure flag
 *  flip: `CreatePipelineModal` owns its own submission, so this action can
 *  neither fail nor go in flight.
 *
 *  Reach (D4b/D5b): `CreatePipelineModal` is mounted at the application
 *  shell (`App.tsx`, comment F-045) for every route except `/pipelines`
 *  (where `PipelinesPage` mounts its own page-local instance instead), so
 *  this action opens in place from **any** route — no navigation, ever. */
export function useCreatePipelineAction(): CreateActionResult {
  const dispatch = useAppDispatch();

  return {
    cta: {
      label: "New pipeline",
      icon: <Plus />,
      onClick: () => dispatch(setCreatePipelineModalOpen(true)),
    },
    error: null,
    isPending: false,
  };
}
