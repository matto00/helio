import { useState, type FormEvent } from "react";

import "./MessageComposer.css";
import { Textarea } from "../../../shared/ui/Textarea";
import { InlineError } from "../../../shared/chrome/InlineError";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { createConversation } from "../services/assistantConversationsService";
import { converse, setSelectedConversationId } from "../state/assistantConversationsSlice";

interface MessageComposerProps {
  /** The conversation to send to, or `null` when none is currently selected (e.g. a first-time
   *  user with zero conversations, design.md D5) -- in that case the send handler creates one
   *  first, rather than being blocked behind a separate, unreachable "create conversation" step. */
  conversationId: string | null;
}

/** Real message composer (HEL-665, reopened composer ticket, design.md D5/D6) -- a text input +
 *  send action wired to `AssistantService.converse` via the `converse` thunk. Rendered inside
 *  `ActiveConversationPanel`, so both `/chat` and the quick-launcher overlay inherit it
 *  automatically -- no changes needed to either entry point. No streaming (design.md D6, buffered
 *  request/response only, matching `converse`'s own signature) -- shows a sending indicator for the
 *  duration of the request instead, reusing the established spinner pattern (DESIGN.md §7).
 *
 *  `conversationId === null` drives the "no conversation selected" send path (design.md D5,
 *  design-gate round-1 fix): `createConversation()` (no `firstMessage`) to get a real id -> an
 *  explicit `setSelectedConversationId(newId)` dispatch (REQUIRED -- without it
 *  `ActiveConversationPanel`'s own `effectiveId = selectedConversationId ?? items[0]?.id ?? null`
 *  derivation never picks up the freshly created conversation, so the panel would stay stuck on the
 *  empty-state branch forever even after a "successful" send) -> `converse(newId, message)` against
 *  it -- the exact same converse call an existing conversation's send uses, never a second,
 *  divergent "first message" mechanism. */
export function MessageComposer({ conversationId }: MessageComposerProps) {
  const dispatch = useAppDispatch();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length === 0 || sending) return;

    setSending(true);
    setError(null);
    try {
      let targetId = conversationId;
      if (targetId === null) {
        const created = await createConversation({});
        targetId = created.id;
        dispatch(setSelectedConversationId(targetId));
      }
      await dispatch(converse({ id: targetId, message: trimmed })).unwrap();
      // Only cleared on success -- a failed send preserves the typed input so the user can retry
      // without retyping (tasks.md 6.9).
      setMessage("");
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="message-composer" onSubmit={handleSubmit}>
      <Textarea
        className="message-composer__input"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Type a message…"
        aria-label="Message"
        rows={2}
        disabled={sending}
      />
      <div className="message-composer__actions">
        {sending && (
          <span className="message-composer__sending" role="status">
            <span className="message-composer__spinner" aria-hidden="true" />
            Sending…
          </span>
        )}
        <button
          type="submit"
          className="message-composer__submit"
          disabled={sending || message.trim().length === 0}
        >
          Send
        </button>
      </div>
      <InlineError error={error} />
    </form>
  );
}
