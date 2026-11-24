import { queuePreferencesPatch } from "../../auth/services/preferencesSaveQueue";
import { applyAssistantModelPreference } from "../../auth/state/authSlice";
import { selectConversation } from "../../assistant/state/assistantConversationsSlice";
import { fetchAssistantModels } from "../../assistant/state/assistantModelsSlice";
import type { AppDispatch, RootState } from "../../../store/store";
import { registerSessionReset } from "../../../shared/session/sessionReset";
import { getSessionEpoch } from "../../../shared/session/sessionEpoch";

// HEL-1829 D6: saves are serialised and coalesced, so a failed save is no longer "the value before this call". The
// last value the SERVER confirmed (taken only from a saved outcome's sent body) is what a failure restores, and only
// the newest save may restore it: an older failure would otherwise overwrite a newer choice still in flight.
let latestSequence = 0;
let outstanding = 0;
let confirmed: string | null = null;

registerSessionReset("saveAssistantModelPreference", {
  covers: [
    "features/settings/state/saveAssistantModelPreference.ts#latestSequence",
    "features/settings/state/saveAssistantModelPreference.ts#outstanding",
    "features/settings/state/saveAssistantModelPreference.ts#confirmed",
  ],
  reset: () => {
    latestSequence = 0;
    outstanding = 0;
    confirmed = null;
  },
});

/** HEL-1755 D10: saves the default assistant model (`null` = "Server default", clears it). The local value is applied
 *  first and restored if the PATCH fails (resolves `false` so the section can say so). After a successful save the
 *  model list (its `defaultModel` changed) and the open conversation (its `effectiveModel` may change) are refetched,
 *  so the composer never shows a stale model. */
export function saveAssistantModelPreference(next: string | null) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<boolean> => {
    if (outstanding === 0) {
      confirmed = getState().auth.currentUser?.preferences?.assistantModel ?? null;
    }
    outstanding += 1;
    latestSequence += 1;
    const sequence = latestSequence;
    const startEpoch = getSessionEpoch();
    dispatch(applyAssistantModelPreference(next));
    const outcome = await queuePreferencesPatch({ assistantModel: next });
    // HEL-1634: after a sign-out the reset already cleared this state; never write the previous session's value
    // into the next user's preferences.
    if (startEpoch !== getSessionEpoch()) return outcome.status === "saved";
    outstanding -= 1;
    if (outcome.status === "saved") {
      if (outcome.sent !== null && "assistantModel" in outcome.sent) {
        confirmed = outcome.sent.assistantModel ?? null;
      }
    } else {
      if (sequence === latestSequence) dispatch(applyAssistantModelPreference(confirmed));
      return false;
    }
    await dispatch(fetchAssistantModels());
    const activeId = getState().assistantConversations.activeConversation.data?.id;
    if (activeId !== undefined) await dispatch(selectConversation(activeId));
    return true;
  };
}
