import { patchShellPreferencesRequest } from "../../auth/services/authService";
import { applyAssistantModelPreference } from "../../auth/state/authSlice";
import { selectConversation } from "../../assistant/state/assistantConversationsSlice";
import { fetchAssistantModels } from "../../assistant/state/assistantModelsSlice";
import type { AppDispatch, RootState } from "../../../store/store";

/** HEL-1755 D10: saves the default assistant model (`null` = "Server default", clears it). The local value is applied
 *  first and restored if the PATCH fails (resolves `false` so the section can say so). After a successful save the
 *  model list (its `defaultModel` changed) and the open conversation (its `effectiveModel` may change) are refetched,
 *  so the composer never shows a stale model. */
export function saveAssistantModelPreference(next: string | null) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<boolean> => {
    const previous = getState().auth.currentUser?.preferences?.assistantModel ?? null;
    dispatch(applyAssistantModelPreference(next));
    try {
      await patchShellPreferencesRequest({ assistantModel: next });
    } catch {
      dispatch(applyAssistantModelPreference(previous));
      return false;
    }
    await dispatch(fetchAssistantModels());
    const activeId = getState().assistantConversations.activeConversation.data?.id;
    if (activeId !== undefined) await dispatch(selectConversation(activeId));
    return true;
  };
}
