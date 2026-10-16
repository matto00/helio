import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { fetchConversations, startNewConversation } from "../state/assistantConversationsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { startConversationWithMessage } from "../state/startConversationWithMessage";
import { ActiveConversationPanel } from "./ActiveConversationPanel";
import { composerErrorMessage } from "./MessageComposer";
import { InlineError } from "../../../shared/chrome/InlineError";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";

interface Handoff {
  key: string;
  draft: string | undefined;
  autoSend: boolean;
}

function readHandoff(locationState: unknown, key: string): Handoff {
  const state = locationState as { draft?: string; autoSend?: boolean } | null;
  return { key, draft: state?.draft, autoSend: state?.autoSend === true };
}

/** `/chat`'s routed page. Mirrors `TypeRegistryPage.tsx`/`SourcesPage.tsx`'s
 * pattern: fetches the section's list on mount and renders the main-content
 * detail surface. The list itself renders in the desktop sidebar via
 * `SidebarBody.tsx`'s `chat` branch, not here (design.md D4). */
export function ChatPage() {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const { status, error, startingNewConversation } = useAppSelector(
    (state) => state.assistantConversations,
  );
  // HEL-1209 — "Refine with the assistant" navigates here with `state.draft`. Captured once (a
  // later navigation to `/chat` without state must not clear a draft the user is editing) and
  // consumed by starting a fresh conversation, so the refine request does not append to whatever
  // conversation happened to be open.
  const location = useLocation();
  const navigate = useNavigate();
  const [handoff, setHandoff] = useState(() => readHandoff(location.state, location.key));
  // HEL-1575 C3: the hand-off is per NAVIGATION (keyed on `location.key`), not per mount -- "Ask the
  // assistant" run while already on `/chat` navigates to the same route, which does not remount this page.
  const incoming = readHandoff(location.state, location.key);
  if (incoming.draft && incoming.key !== handoff.key) setHandoff(incoming);
  // HEL-1575 D10: the palette's "Ask the assistant" hand-off sends its text itself, as the first message of a
  // new conversation, so the composer is not seeded with it (it would sit there after the send).
  const autoSend = handoff.autoSend && !!handoff.draft;
  const initialDraft = autoSend ? undefined : handoff.draft;
  const autoSendMessage = autoSend ? handoff.draft : undefined;
  const autoSendStartedFor = useRef<string | null>(null);
  const [autoSendError, setAutoSendError] = useState<string | null>(null);

  // HEL-703 design.md D9 — a `free`-tier user never even attempts the list fetch (which would
  // otherwise 403), so `ActiveConversationPanel`'s own request-access state never races a 403 into
  // this page's `status === "failed"` branch below.
  const isFreeTier = currentUser?.tier === "free";

  // F-104 — every remount of `ChatPage` (e.g. navigating away and back)
  // re-issued `fetchConversations()` even though the list was already
  // loaded and unchanged. `fetchConversations` itself has no dedupe
  // `condition` (unlike `fetchPanels`/`fetchPipelines`), so the guard lives
  // here at the call site instead: skip while a fetch is already in flight
  // or has already succeeded, but still allow a retry from `failed`.
  useEffect(() => {
    if (!isFreeTier && status !== "loading" && status !== "succeeded") {
      void dispatch(fetchConversations());
    }
  }, [dispatch, isFreeTier, status]);

  useEffect(() => {
    if (!initialDraft) return;
    if (!isFreeTier) dispatch(startNewConversation());
    // History state survives a reload; clear it so the draft is a one-time hand-off.
    navigate(location.pathname, { replace: true, state: null });
  }, [dispatch, navigate, location.pathname, initialDraft, handoff.key, isFreeTier]);

  // The send fires once per hand-off (per navigation key): the ref outlives React StrictMode's simulated unmount/remount, and the
  // idempotency key is minted inside this one call. A free-tier user lands on the request-access state and
  // nothing is sent (D10).
  useEffect(() => {
    if (autoSendMessage === undefined || autoSendStartedFor.current === handoff.key) return;
    autoSendStartedFor.current = handoff.key;
    navigate(location.pathname, { replace: true, state: null });
    if (isFreeTier) return;
    dispatch(startNewConversation());
    dispatch(
      startConversationWithMessage({
        message: autoSendMessage.trim(),
        idempotencyKey: crypto.randomUUID(),
      }),
    ).catch((err: unknown) => setAutoSendError(composerErrorMessage(err)));
  }, [autoSendMessage, handoff.key, dispatch, isFreeTier, location.pathname, navigate]);

  // Held back until the new-conversation flag is set, so the composer mounts already on the
  // null-conversation view and its reset-on-switch effect can never wipe the prefilled draft.
  const draftReady = !initialDraft || isFreeTier || startingNewConversation;

  return (
    <PageShell className="chat-page">
      {status === "loading" && <PageStatus status="loading" loadingLabel="Loading conversations" />}
      {status === "failed" && error && <PageStatus status="failed" message={error} />}
      <InlineError error={autoSendError} />
      {(status === "succeeded" || status === "idle") && draftReady && (
        <ActiveConversationPanel initialDraft={initialDraft} />
      )}
    </PageShell>
  );
}
