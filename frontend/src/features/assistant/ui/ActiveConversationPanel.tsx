import { useEffect } from "react";
import { faComments } from "@fortawesome/free-solid-svg-icons";

import "./ActiveConversationPanel.css";
import { selectConversation } from "../state/assistantConversationsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { extractProposal } from "../proposalExtraction";
import { MessageTurn } from "./MessageTurn";
import { ProposalHandoff } from "./ProposalHandoff";
import { ToolCallIndicator } from "./ToolCallIndicator";
import type { ClaudeToolMessageDto, ClaudeToolResultBlockDto } from "../types";

/** Every `tool_result` block across the whole transcript, keyed by `toolUseId` — a `tool_use`
 *  block's paired result can land in a LATER turn (the backend's tool loop appends a separate
 *  synthetic `role: "user"` turn carrying only `tool_result` blocks), never the same turn. */
function buildToolResultsById(
  transcript: ClaudeToolMessageDto[],
): Map<string, ClaudeToolResultBlockDto> {
  const map = new Map<string, ClaudeToolResultBlockDto>();
  for (const turn of transcript) {
    for (const block of turn.content) {
      if (block.blockType === "tool_result") {
        map.set(block.toolUseId, block);
      }
    }
  }
  return map;
}

/** Real message-turn rendering (design.md D1-D5, HEL-665) — replaces the HEL-664 placeholder's
 * title + message count with role-based bubbles (`MessageTurn`, one per `text` content block, in
 * transcript order) and per-tool-call progress rows (`ToolCallIndicator`, one per `tool_use`
 * block, its paired `tool_result` resolved via `buildToolResultsById` since the two blocks live in
 * different transcript turns). A completed `propose_*` call renders a `ProposalHandoff` card below
 * the transcript. Rendered by both `/chat` (`ChatPage.tsx`) and the quick-launcher
 * (`QuickLauncherOverlay.tsx`) — the same component reading the same Redux slice is what makes the
 * two entry points "one coherent visual system" (design.md D5). Derives the selected conversation
 * with fallback to the first item, mirroring `SourcesPage.tsx`/`TypeRegistryBrowser.tsx`'s pattern,
 * and implements DESIGN.md §7's 3 required UI states. */
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

  const transcript = activeConversation.data.transcript;
  const toolResultsById = buildToolResultsById(transcript);
  const proposalExtraction = extractProposal(transcript);

  return (
    <div className="active-conversation-panel">
      <h2 className="active-conversation-panel__title">{activeConversation.data.title}</h2>
      <p
        className="active-conversation-panel__meta"
        data-testid="active-conversation-message-count"
      >
        {transcript.length} messages
      </p>
      <div className="active-conversation-panel__transcript" aria-label="Conversation">
        {transcript.map((turn, turnIndex) =>
          turn.content.map((block, blockIndex) => {
            const key = `${turnIndex}-${blockIndex}`;
            if (block.blockType === "text") {
              return <MessageTurn key={key} role={turn.role} text={block.text} />;
            }
            if (block.blockType === "tool_use") {
              return (
                <ToolCallIndicator
                  key={key}
                  toolUse={block}
                  result={toolResultsById.get(block.id) ?? null}
                />
              );
            }
            // `tool_result` blocks render via their paired `tool_use` row above, never standalone.
            return null;
          }),
        )}
      </div>
      {proposalExtraction && <ProposalHandoff extraction={proposalExtraction} />}
    </div>
  );
}
