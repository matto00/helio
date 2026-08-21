import { Plus } from "lucide-react";

import { setAddSourceModalOpen } from "../state/sourcesSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { EmptyStateCta } from "../../../shared/ui/EmptyState";

export interface CreateActionResult {
  cta: EmptyStateCta;
  error: string | null;
  isPending: boolean;
}

/** HEL-548 D5/D5b — the "Add source" create-action seam (the HEL-554
 *  consumable-CTA requirement). A pure flag flip: `AddSourceModal` owns its
 *  own submission, so this action can neither fail nor go in flight —
 *  `error`/`isPending` are true statements about it, not placeholders.
 *
 *  Reach (D4b/D5b): `AddSourceModal` is mounted only by `SourcesPage`, not
 *  at the shell — this action is usable only from there today. */
export function useAddSourceAction(): CreateActionResult {
  const dispatch = useAppDispatch();

  return {
    cta: {
      label: "Add source",
      icon: <Plus />,
      onClick: () => dispatch(setAddSourceModalOpen(true)),
    },
    error: null,
    isPending: false,
  };
}
