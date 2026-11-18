import type { AppDispatch } from "../../../store/store";
import { createConversation } from "../services/assistantConversationsService";
import {
  conversationCreated,
  converse,
  setSelectedConversationId,
} from "./assistantConversationsSlice";

export interface StartConversationArgs {
  message: string;
  idempotencyKey: string;
  /** HEL-1755 D10: the model picked before the conversation existed; sent as `model` on the first converse (the
   *  server persists it on the new conversation). Absent = the user's default / the server default applies. */
  model?: string | null;
  /** Called with the new id immediately before it is selected, so a caller that resets on a selection
   *  change (`MessageComposer`'s reset-on-switch effect) can recognise the transition as its own. */
  onCreated?: (conversationId: string) => void;
}

/** The one "first message of a new conversation" send path (HEL-1575 D10), shared by `MessageComposer`'s
 *  no-conversation submit and the palette's `/chat` auto-send hand-off: create the conversation, add it to the
 *  sidebar list, select it, then `converse` with the caller's idempotency key. Resolves to the new
 *  conversation id; failures propagate unchanged (a `createConversation` error as thrown, a `converse`
 *  rejection as its payload object), so each caller keeps its own error copy. */
export function startConversationWithMessage({
  message,
  idempotencyKey,
  model,
  onCreated,
}: StartConversationArgs) {
  return async (dispatch: AppDispatch): Promise<string> => {
    const created = await createConversation({});
    const id = created.id;
    // Sidebar `items` are otherwise populated only by `fetchConversations` on mount.
    dispatch(conversationCreated(created));
    onCreated?.(id);
    dispatch(setSelectedConversationId(id));
    await dispatch(converse({ id, message, idempotencyKey, model: model ?? undefined })).unwrap();
    return id;
  };
}
