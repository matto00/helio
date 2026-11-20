import { registerSessionReset } from "../../../shared/session/sessionReset";

// design.md D4/D6 -- sessionStorage (tab-scoped), keyed per dashboardId: a refinement conversation is only ever valid
// against the dashboard it was grounded in, so a stored id must never be reused across a dashboard switch.
export const REFINEMENT_CONVERSATION_ID_PREFIX = "helio.refinement.conversationId.";

/** HEL-1634: removes every stored refinement conversation id (sign-out: the next user in this tab must never try to
 *  rehydrate the previous user's conversation). Imported by the store so the hook is registered before any sign-out. */
export function clearRefinementConversationIds(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key !== null && key.startsWith(REFINEMENT_CONVERSATION_ID_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

registerSessionReset("refinementConversationIds", {
  covers: [],
  reset: clearRefinementConversationIds,
});
