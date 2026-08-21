import { Plus } from "lucide-react";
import { useState } from "react";

import { createDashboard } from "../state/dashboardsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { EmptyStateCta } from "../../../shared/ui/EmptyState";

export interface CreateActionResult {
  cta: EmptyStateCta;
  error: string | null;
  isPending: boolean;
}

/** HEL-548 D5/D6 — the "New dashboard" create-action seam, moved here from
 *  `PanelList.tsx`'s `handleCreateDashboard` (F-003's quick-create: a bare
 *  "Untitled dashboard", renameable afterward). Unlike the three flag-flip
 *  hooks, this action performs its own request and so genuinely owns
 *  in-flight/error state — `EmptyStateCta` alone has no slot for the
 *  rejection, and after HEL-770's toast removal (D6a) a hook that swallowed
 *  it would leave a failed create reporting nothing at all.
 *
 *  `err` from `.unwrap()` IS the thunk's `rejectValue` — a plain `string`,
 *  not an `Error` — because `createDashboard`'s own `catch` (D6) now calls
 *  `extractErrorMessage`, so no re-extraction happens here.
 *
 *  This is `PanelList`'s own immediate quick-create, a *different* flow from
 *  `DashboardList`'s named-create form (`isCreateMode` + a name field) —
 *  the two are deliberately not collapsed into one hook (D5, task 4.3). */
export function useCreateDashboardAction(): CreateActionResult {
  const dispatch = useAppDispatch();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setIsPending(true);
    setError(null);
    try {
      await dispatch(createDashboard({ name: "Untitled dashboard" })).unwrap();
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to create dashboard.");
    } finally {
      setIsPending(false);
    }
  }

  return {
    cta: {
      // Behavior-preserving (task 4.6): the pre-existing PanelList handler
      // never disabled the button while pending, only swapped its label —
      // unchanged here.
      label: isPending ? "Creating..." : "New dashboard",
      icon: <Plus />,
      onClick: () => void handleCreate(),
    },
    error,
    isPending,
  };
}
