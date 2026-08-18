import { useEffect, useRef, useState, type FormEvent } from "react";

import "./MessageComposer.css";
import { Textarea } from "../../../shared/ui/Textarea";
import { Spinner } from "../../../shared/ui/Spinner";
import { InlineError } from "../../../shared/chrome/InlineError";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { createConversation } from "../services/assistantConversationsService";
import {
  conversationCreated,
  converse,
  setSelectedConversationId,
} from "../state/assistantConversationsSlice";

// HEL-703 design.md D9 — distinct, actionable copy for the two tier-gate error codes; every other
// converse failure (network/model/generic) keeps showing its own server-provided message, unchanged.
const LimitReachedMessage =
  "Daily chat limit reached. Your conversation history is still here — the limit resets at the start of the next UTC day.";
const TierForbiddenMessage =
  "Chat access has changed for your account. Refresh the page to see your current access.";

/** Resolves the message `MessageComposer`'s local error state renders. `err` is either a plain
 *  string (an older/other thunk's rejectValue, or a thrown primitive), a `ConverseErrorPayload`
 *  object (`converse`'s own widened rejectValue, thrown as-is by RTK's `.unwrap()`), a real `Error`/
 *  `AxiosError` (e.g. `createConversation`'s own failure path, not a thunk at all), or anything
 *  else. Only a plain, non-`Error` object carrying a `message` field is treated as the structured
 *  payload — a real `Error` instance never is, so `createConversation` failures keep their
 *  pre-existing generic fallback untouched. */
function composerErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object" && !(err instanceof Error) && "message" in err) {
    const payload = err as { code?: string; message: string };
    if (payload.code === "CHAT_LIMIT_REACHED") return LimitReachedMessage;
    if (payload.code === "TIER_FORBIDDEN") return TierForbiddenMessage;
    if (typeof payload.message === "string" && payload.message) return payload.message;
  }
  return "Failed to send message.";
}

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
 *  divergent "first message" mechanism.
 *
 *  `pendingSend` (HEL-698 design.md D6) tracks `{key, text}` for the one logical message currently
 *  being sent/retried -- the retry unit IS this composer's own preserved input, no other component
 *  retries. On submit: reuse `pendingSend.key` iff the preserved text still matches the trimmed
 *  input exactly (a same-text retry after a failure); otherwise mint a fresh `crypto.randomUUID()`
 *  (a previous send succeeded -- `pendingSend` was cleared -- or the text was edited). Cleared only
 *  on success, so a failed send's key survives into its retry.
 *
 *  Reset-on-switch (HEL-711 design.md D1/D2): the component is never remounted across an ordinary
 *  conversation switch (HEL-695's F-021 fix keeps it the stable last child of
 *  `ActiveConversationPanel`'s content tree), so without an explicit reset a draft typed in
 *  conversation A would still be sitting in the composer after switching to B. A
 *  `useEffect([conversationId])` clears `message`/`error`/`pendingSend` whenever `conversationId`
 *  changes to a value the component did not itself just create -- EXCEPT for the one self-created
 *  transition: when the null-conversation send path above creates a conversation and dispatches
 *  `setSelectedConversationId(targetId)` mid-`handleSubmit`, `conversationId` flips from `null` to
 *  `targetId` as a side effect of the in-flight send, not a user-initiated switch, and resetting on
 *  that transition would wipe the send's own `pendingSend`/`message` state out from under it
 *  (regressing HEL-695's continuous-sending-indication fix). `selfCreatedIdRef` marks that one-shot
 *  exception; `prevConversationIdRef` lets the effect distinguish a genuine id change from a
 *  same-id re-render. */
export function MessageComposer({ conversationId }: MessageComposerProps) {
  const dispatch = useAppDispatch();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState<{ key: string; text: string } | null>(null);
  // HEL-711 design.md D2 -- the last `conversationId` seen, so the reset effect below can tell a
  // genuine change from a same-id re-render.
  const prevConversationIdRef = useRef(conversationId);
  // HEL-711 design.md D2 -- one-shot marker for the self-created-conversation transition (set just
  // before `setSelectedConversationId` is dispatched in the null-conversation branch below); the
  // reset effect consumes (nulls out) it instead of clearing state when `conversationId` matches.
  const selfCreatedIdRef = useRef<string | null>(null);

  // HEL-711 -- clears the draft/error/pending-send state on an ordinary conversation switch, but
  // skips the reset for the one transition the composer caused itself (see doc comment above).
  useEffect(() => {
    if (conversationId !== prevConversationIdRef.current) {
      if (conversationId !== null && conversationId === selfCreatedIdRef.current) {
        selfCreatedIdRef.current = null;
      } else {
        setMessage("");
        setError(null);
        setPendingSend(null);
      }
      prevConversationIdRef.current = conversationId;
    }
  }, [conversationId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length === 0 || sending) return;

    const idempotencyKey =
      pendingSend !== null && pendingSend.text === trimmed ? pendingSend.key : crypto.randomUUID();
    setPendingSend({ key: idempotencyKey, text: trimmed });

    setSending(true);
    setError(null);
    try {
      let targetId = conversationId;
      if (targetId === null) {
        const created = await createConversation({});
        targetId = created.id;
        // Sidebar's `items` list is otherwise only populated by `fetchConversations` on mount --
        // without this, a conversation started from the empty-state/new-chat composer never shows
        // up in the sidebar until the next full page load.
        dispatch(conversationCreated(created));
        // HEL-711 design.md D2 -- set immediately before the dispatch below flips `conversationId`
        // from `null` to `targetId`, so the reset effect recognizes this as the composer's own
        // self-created transition and skips clearing this in-flight send's state.
        selfCreatedIdRef.current = targetId;
        dispatch(setSelectedConversationId(targetId));
      }
      await dispatch(converse({ id: targetId, message: trimmed, idempotencyKey })).unwrap();
      // Only cleared on success -- a failed send preserves the typed input so the user can retry
      // without retyping (tasks.md 6.9), and preserves pendingSend so the retry reuses the same key.
      setMessage("");
      setPendingSend(null);
    } catch (err) {
      setError(composerErrorMessage(err));
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
        submitOnEnter
      />
      <div className="message-composer__actions">
        {sending && (
          <span className="message-composer__sending" role="status">
            <Spinner size="sm" />
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
