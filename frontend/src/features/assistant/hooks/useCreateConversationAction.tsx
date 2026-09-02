import { Plus } from "lucide-react";

import { startNewConversation } from "../state/assistantConversationsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { EmptyStateCta } from "../../../shared/ui/EmptyState";

export interface CreateActionResult {
  cta: EmptyStateCta;
  error: string | null;
  isPending: boolean;
}

/** HEL-789's surviving half — the shared "New chat" create-action seam,
 *  factored out of `SidebarBody.tsx`'s inline `dispatch(startNewConversation())`
 *  so `usePickerSelection`'s mobile nav sheet can offer the SAME action for
 *  Assistant that desktop already has (closing the one destination that
 *  previously had no mobile create-action parity). `startNewConversation` is
 *  a plain synchronous reducer action (not a thunk) — it cannot fail and has
 *  no in-flight state, so unlike its three async siblings this action can
 *  neither error nor go pending. */
export function useCreateConversationAction(): CreateActionResult {
  const dispatch = useAppDispatch();

  return {
    cta: {
      label: "New chat",
      icon: <Plus />,
      onClick: () => dispatch(startNewConversation()),
    },
    error: null,
    isPending: false,
  };
}
