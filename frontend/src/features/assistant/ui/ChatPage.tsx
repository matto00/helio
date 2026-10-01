import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { fetchConversations, startNewConversation } from "../state/assistantConversationsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { ActiveConversationPanel } from "./ActiveConversationPanel";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";

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
  const [initialDraft] = useState(() => (location.state as { draft?: string } | null)?.draft);

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
  }, [dispatch, navigate, location.pathname, initialDraft, isFreeTier]);

  // Held back until the new-conversation flag is set, so the composer mounts already on the
  // null-conversation view and its reset-on-switch effect can never wipe the prefilled draft.
  const draftReady = !initialDraft || isFreeTier || startingNewConversation;

  return (
    <PageShell className="chat-page">
      {status === "loading" && <PageStatus status="loading" loadingLabel="Loading conversations" />}
      {status === "failed" && error && <PageStatus status="failed" message={error} />}
      {(status === "succeeded" || status === "idle") && draftReady && (
        <ActiveConversationPanel initialDraft={initialDraft} />
      )}
    </PageShell>
  );
}
