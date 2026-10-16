import { createElement, useMemo } from "react";
import { MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useCommandQuery } from "./hooks";
import { ASK_SECTION } from "./model/builtInActions";
import type { CommandAction } from "./model/types";

/** HEL-1575 D10: while the palette's query has non-whitespace text, one `Ask the assistant: "<text>"` action,
 *  always last (the `Ask` section sorts after every other). It hands the trimmed text to `/chat`, which sends
 *  it once as the first message of a new conversation (`ChatPage` + `startConversationWithMessage`).
 *  Computed at the call site from the live query, like the resource-search results, because the shared
 *  registry has no query access. */
export function useAskAssistantAction(enabled: boolean): CommandAction[] {
  const query = useCommandQuery();
  const navigate = useNavigate();
  const text = query.trim();

  return useMemo(() => {
    if (!enabled || text === "") return [];
    return [
      {
        id: "ask.assistant",
        title: `Ask the assistant: "${text}"`,
        section: ASK_SECTION,
        icon: createElement(MessageCircle),
        matchesQuery: true,
        run: () => navigate("/chat", { state: { draft: text, autoSend: true } }),
      },
    ];
  }, [enabled, text, navigate]);
}
