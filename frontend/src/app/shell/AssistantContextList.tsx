import { Lock, MessagesSquare, Pencil, Pin, PinOff } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  fetchConversations,
  renameConversation,
  setSelectedConversationId,
  startNewConversation,
  TierRequestAccessCopy,
  togglePinned,
} from "../../features/assistant/state/assistantConversationsSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { SidebarItemList, type SidebarItem } from "../../shared/chrome/SidebarItemList";
import { ICON_SIZE } from "../../shared/ui/iconSize";
import "./AssistantContextList.css";

/** The Assistant section's context list: its existing conversation list, moved here as is (HEL-1574). A free-tier
 *  user sees the locked notice instead, and no fetch is made for them (HEL-703 design.md D9). */
export function AssistantContextList() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const conversations = useAppSelector((state) => state.assistantConversations);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const isFreeTier = currentUser?.tier === "free";

  useEffect(() => {
    if (!isFreeTier && conversations.status === "idle") void dispatch(fetchConversations());
  }, [dispatch, isFreeTier, conversations.status]);

  if (isFreeTier) {
    // F-056: a compact notice, deliberately not the main pane's hero card. F-017: the link reaches the self-serve
    // "Request Beta access" flow in Settings. `TierRequestAccessCopy` is shared so the two surfaces never drift.
    return (
      <section className="assistant-context-list__locked" aria-label="assistant">
        <p className="assistant-context-list__locked-heading">
          <Lock aria-hidden className="assistant-context-list__locked-icon" size={ICON_SIZE.sm} />
          {TierRequestAccessCopy.title}
        </p>
        <p className="assistant-context-list__locked-description">
          {TierRequestAccessCopy.description}
        </p>
        <button
          type="button"
          className="assistant-context-list__locked-link"
          onClick={() => navigate("/settings")}
        >
          Request access in Settings
        </button>
      </section>
    );
  }

  // Server-ordered (`pinned DESC, updatedAt DESC`, HEL-663), rendered exactly as returned.
  const conversationItems: SidebarItem[] = conversations.items.map((conversation) => ({
    id: conversation.id,
    name: conversation.title,
  }));
  const pinnedIds = new Set(
    conversations.items.filter((conversation) => conversation.pinned).map((c) => c.id),
  );
  const effectiveConversationId =
    conversations.selectedConversationId ?? conversations.items[0]?.id ?? null;

  return (
    <SidebarItemList
      heading="Assistant"
      hideHeading
      items={conversationItems}
      initialLoad={
        (conversations.status === "idle" || conversations.status === "loading") &&
        conversationItems.length === 0
      }
      error={conversations.error}
      onSelect={(item) => dispatch(setSelectedConversationId(item.id))}
      activeId={effectiveConversationId}
      emptyText="No conversations yet"
      emptyIcon={<MessagesSquare />}
      emptyDescription="Start a conversation to see it here."
      onAdd={() => dispatch(startNewConversation())}
      addLabel="New chat"
      // No `onDelete`: HEL-663's API has no delete endpoint (design.md D3).
      renderBadge={(item) =>
        pinnedIds.has(item.id) ? (
          <Pin
            className="dashboard-list__pin-badge"
            size={ICON_SIZE.sm}
            aria-label="Pinned"
            data-testid="pin-badge"
          />
        ) : null
      }
      renderRowAction={(item, helpers) => {
        const pinned = pinnedIds.has(item.id);
        return (
          <>
            <button
              type="button"
              className="dashboard-list__row-action-btn"
              aria-label={`Rename ${item.name}`}
              title={`Rename ${item.name}`}
              onClick={helpers.startRename}
            >
              <Pencil size={ICON_SIZE.sm} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="dashboard-list__row-action-btn"
              aria-label={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
              title={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
              onClick={() => dispatch(togglePinned({ id: item.id, pinned: !pinned }))}
            >
              {pinned ? (
                <PinOff size={ICON_SIZE.sm} aria-hidden="true" />
              ) : (
                <Pin size={ICON_SIZE.sm} aria-hidden="true" />
              )}
            </button>
          </>
        );
      }}
      // HEL-693 design.md D5: `unwrap()` re-throws the thunk's `rejectValue` so the row shows it inline.
      onRename={async (item, title) => {
        await dispatch(renameConversation({ id: item.id, title })).unwrap();
      }}
    />
  );
}
