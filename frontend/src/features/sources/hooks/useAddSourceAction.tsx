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
 *  Reach (HEL-516): `AddSourceModal` is now also mounted at the app shell (`App.tsx`), route-
 *  skipped on `/sources` (which mounts its own instance) — so this action works from any route.
 *
 *  evaluation-1.md CR2 — this seam is intentionally UNCHANGED for the nested-modal-collision
 *  concern (design.md Decision 7): `CreatePipelineModal`/`AddRootModal` each render their own
 *  `AddSourceModal` from local state, and the palette is the one NEW entry point that makes
 *  running "Add source" while a nested instance is already open newly reachable. That collision
 *  guard lives at the palette call site (`CreateCommandActions.tsx`), not here, so every OTHER
 *  consumer of this seam (`SourcesPage`'s own button, the sources empty state) keeps its exact
 *  pre-existing, unaltered behavior. */
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
