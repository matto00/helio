import { useEffect } from "react";

import "./ChatPage.css";
import { fetchConversations } from "../state/assistantConversationsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { ActiveConversationPanel } from "./ActiveConversationPanel";

/** `/chat`'s routed page. Mirrors `TypeRegistryPage.tsx`/`SourcesPage.tsx`'s
 * pattern: fetches the section's list on mount and renders the main-content
 * detail surface. The list itself renders in the desktop sidebar via
 * `SidebarBody.tsx`'s `chat` branch, not here (design.md D4). */
export function ChatPage() {
  const dispatch = useAppDispatch();
  const { status, error } = useAppSelector((state) => state.assistantConversations);

  useEffect(() => {
    void dispatch(fetchConversations());
  }, [dispatch]);

  return (
    <div className="chat-page">
      {status === "loading" && <p className="chat-page__loading">Loading conversations…</p>}
      {status === "failed" && error && (
        <p className="chat-page__error" role="alert">
          {error}
        </p>
      )}
      {(status === "succeeded" || status === "idle") && <ActiveConversationPanel />}
    </div>
  );
}
