import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { faComments } from "@fortawesome/free-solid-svg-icons";

import "./ActiveConversationPanel.css";
import { selectConversation, TierRequestAccessCopy } from "../state/assistantConversationsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Spinner } from "../../../shared/ui/Spinner";
import { extractProposal } from "../proposalExtraction";
import { MessageComposer } from "./MessageComposer";
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
 * and implements DESIGN.md §7's 3 required UI states.
 *
 * `MessageComposer` (HEL-665, reopened composer ticket, design.md D5) renders as the LAST child of
 * a single, stable content tree that covers "no conversation yet", "conversation detail loading",
 * and "conversation loaded" alike (F-021) — so a first-time user with zero conversations can start
 * one by typing directly, AND the composer's own local sending/error state survives the moment
 * `effectiveId` flips from `null` to a freshly-created conversation's id, before that id's own GET
 * resolves. The old structure used a separate early `return` per state, which unmounted and
 * remounted a fresh `MessageComposer` right at that boundary — silently discarding "sending…"
 * feedback for the rest of a real multi-second Claude round trip (F-021's repro). The sidebar's
 * "New chat" button reaches the `effectiveId === null` content via `startingNewConversation` even
 * when `items` is non-empty. The free-tier request-access state and a genuine conversation-detail
 * load *failure* are unrelated to that race (a stale/broken GET for an already-selected
 * conversation, not a fresh send) and keep their own separate early returns, composer-less exactly
 * as before. */
export function ActiveConversationPanel() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const {
    items,
    selectedConversationId,
    startingNewConversation,
    activeConversation,
    lastTurnOutcome,
  } = useAppSelector((state) => state.assistantConversations);

  // HEL-703 design.md D9 — proactive half of the tier gate: a `free`-tier user never fetches or
  // renders a conversation at all, short-circuiting to a dedicated, CTA-less request-access state
  // before any of the existing branches below. The reactive half (a `TIER_FORBIDDEN`/
  // `CHAT_LIMIT_REACHED` response arriving mid-session) is `MessageComposer`'s own local handling.
  const isFreeTier = currentUser?.tier === "free";

  const effectiveId = startingNewConversation
    ? null
    : (selectedConversationId ?? items[0]?.id ?? null);

  useEffect(() => {
    if (!isFreeTier && effectiveId !== null) {
      void dispatch(selectConversation(effectiveId));
    }
  }, [dispatch, effectiveId, isFreeTier]);

  // F-020/F-055 design.md — scrolls the composer (and whatever's immediately above it — the
  // latest transcript turn once one exists) back into view of the nearest scrollable ancestor
  // (the page's own `.app-content`; this component introduces no scroll region of its own)
  // whenever the effective conversation changes or grows a new turn. On a long conversation the
  // composer used to land several screens below the fold with no cue it existed. Declared
  // unconditionally, ahead of every early return below, because hooks can't be conditional — the
  // ref is simply unattached (`null`) on renders that don't reach the JSX where it's used.
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const transcriptLength = activeConversation.data?.transcript.length ?? 0;
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor || typeof anchor.scrollIntoView !== "function") return;
    anchor.scrollIntoView({ block: "end" });
  }, [effectiveId, transcriptLength]);

  if (isFreeTier) {
    return (
      <div className="active-conversation-panel active-conversation-panel--empty">
        <EmptyState
          variant="main"
          icon={faComments}
          title={TierRequestAccessCopy.title}
          description={TierRequestAccessCopy.description}
          cta={{ label: "Request access in Settings", onClick: () => navigate("/settings") }}
        />
      </div>
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

  // Covers "no conversation selected yet" and "the fetched detail hasn't caught up with the
  // currently-effective selection yet" (e.g. right after a second selection replaces a first, or
  // right after MessageComposer creates a brand-new conversation) — the panel never shows a stale
  // mix, and (F-021) never unmounts the composer to show it.
  const isLoadingSelected =
    effectiveId !== null &&
    (activeConversation.status !== "succeeded" || activeConversation.data?.id !== effectiveId);

  let panelContent: ReactNode;
  if (effectiveId === null) {
    panelContent = (
      <EmptyState
        variant="main"
        icon={faComments}
        title={items.length > 0 ? "New conversation" : "No conversations yet"}
        description="Start a conversation to see it here."
      />
    );
  } else if (isLoadingSelected) {
    panelContent = (
      <div className="active-conversation-panel__state-row" aria-label="Loading conversation">
        <Spinner size="lg" />
        <span className="active-conversation-panel__state-label">Loading conversation…</span>
      </div>
    );
  } else {
    // Narrowed non-null by `isLoadingSelected === false` above (status "succeeded" and
    // data.id === effectiveId, which is itself non-null in this branch).
    const data = activeConversation.data!;
    const transcript = data.transcript;
    const toolResultsById = buildToolResultsById(transcript);
    const proposalExtraction = extractProposal(transcript);

    // HEL-667 design.md D5 — `lastTurnOutcome` describes the MOST RECENTLY completed turn (the
    // one this very converse call just produced), never a historical one (cleared on
    // reload/reselect — see the slice's own doc comment). `lastBlockKey` pins that treatment to
    // the transcript's actual last content block, so it never leaks onto an earlier turn that
    // happens to share a role.
    const lastTurnIndex = transcript.length - 1;
    const lastTurn = transcript[lastTurnIndex];
    const lastBlockIndex = lastTurn ? lastTurn.content.length - 1 : -1;
    const lastBlockKey = lastTurn ? `${lastTurnIndex}-${lastBlockIndex}` : null;
    // A hop-cap-exhausted turn's last content block is the dangling tool_use itself (see
    // `ClaudeClient.sendWithTools`'s own doc comment) -- there is no trailing text block to
    // decorate in that case, so a standalone fallback bubble below is what actually carries the
    // "couldn't finish in time" message to the user (AC: "surface a clear message... not a
    // silent failure").
    const lastTurnHasTrailingText = lastTurn?.content[lastBlockIndex]?.blockType === "text";
    const showHopBudgetFallback =
      Boolean(lastTurnOutcome?.hopBudgetExhausted) && !lastTurnHasTrailingText;

    panelContent = (
      <>
        <h2 className="active-conversation-panel__title">{data.title}</h2>
        <p
          className="active-conversation-panel__meta"
          data-testid="active-conversation-message-count"
        >
          {transcript.length} messages
        </p>
        {/* F-101 — `role="log"`/`aria-live="polite"` so a screen-reader user is told about a new
            reply as it arrives, instead of the transcript being silently invisible to them until
            they explicitly re-scan the region. */}
        <div
          className="active-conversation-panel__transcript"
          aria-label="Conversation"
          role="log"
          aria-live="polite"
        >
          {transcript.map((turn, turnIndex) =>
            turn.content.map((block, blockIndex) => {
              const key = `${turnIndex}-${blockIndex}`;
              if (block.blockType === "text") {
                const isMostRecentTurn = key === lastBlockKey;
                return (
                  <MessageTurn
                    key={key}
                    role={turn.role}
                    text={block.text}
                    hopBudgetExhausted={
                      isMostRecentTurn && Boolean(lastTurnOutcome?.hopBudgetExhausted)
                    }
                    searchedWithNoResults={
                      isMostRecentTurn && Boolean(lastTurnOutcome?.searchedWithNoResults)
                    }
                  />
                );
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
              // `tool_result` blocks render via their paired `tool_use` row above, never
              // standalone.
              return null;
            }),
          )}
          {showHopBudgetFallback && (
            <MessageTurn
              role="assistant"
              text="I couldn't find enough in 3 lookups — can you narrow this down?"
              hopBudgetExhausted
            />
          )}
        </div>
        {proposalExtraction && <ProposalHandoff extraction={proposalExtraction} />}
      </>
    );
  }

  const rootClass =
    effectiveId === null
      ? "active-conversation-panel active-conversation-panel--empty"
      : "active-conversation-panel";

  return (
    <div className={rootClass}>
      {panelContent}
      <MessageComposer conversationId={effectiveId} />
      <div ref={scrollAnchorRef} aria-hidden="true" />
    </div>
  );
}
