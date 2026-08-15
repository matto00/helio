import { useEffect } from "react";
import { faComments } from "@fortawesome/free-solid-svg-icons";

import "./ActiveConversationPanel.css";
import { selectConversation } from "../state/assistantConversationsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { EmptyState } from "../../../shared/ui/EmptyState";

/** Deliberately minimal placeholder (design.md D6) — renders enough to verify
 * the right conversation loaded (title + transcript length), NOT the real
 * chat-bubble message-rendering UI (HEL-665's job). No message composer /
 * send affordance either. Derives the selected conversation with fallback to
 * the first item, mirroring `SourcesPage.tsx`/`TypeRegistryBrowser.tsx`'s
 * pattern, and implements DESIGN.md §7's 3 required UI states. */
export function ActiveConversationPanel() {
  const dispatch = useAppDispatch();
  const { items, selectedConversationId, activeConversation } = useAppSelector(
    (state) => state.assistantConversations,
  );

  const effectiveId = selectedConversationId ?? items[0]?.id ?? null;

  useEffect(() => {
    if (effectiveId !== null) {
      void dispatch(selectConversation(effectiveId));
    }
  }, [dispatch, effectiveId]);

  if (effectiveId === null) {
    return (
      <EmptyState
        variant="main"
        icon={faComments}
        title="No conversations yet"
        description="Start a conversation to see it here."
      />
    );
  }

  if (activeConversation.status === "failed") {
    return (
      <div
        className="active-conversation-panel active-conversation-panel--state active-conversation-panel--error"
        role="alert"
      >
        <span className="active-conversation-panel__state-label">
          {activeConversation.error ?? "Failed to load conversation."}
        </span>
      </div>
    );
  }

  // Covers "loading" and any render where the fetched detail hasn't caught up
  // with the currently-effective selection yet (e.g. right after a second
  // selection replaces a first) — the panel never shows a stale mix.
  if (activeConversation.status !== "succeeded" || activeConversation.data?.id !== effectiveId) {
    return (
      <div
        className="active-conversation-panel active-conversation-panel--state"
        aria-label="Loading conversation"
      >
        <span className="active-conversation-panel__spinner" aria-hidden="true" />
        <span className="active-conversation-panel__state-label">Loading conversation…</span>
      </div>
    );
  }

  return (
    <div className="active-conversation-panel">
      <h2 className="active-conversation-panel__title">{activeConversation.data.title}</h2>
      <p
        className="active-conversation-panel__meta"
        data-testid="active-conversation-message-count"
      >
        {activeConversation.data.transcript.length} messages
      </p>
    </div>
  );
}
