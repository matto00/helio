import "./MessageTurn.css";

interface MessageTurnProps {
  /** `ClaudeToolMessageDto.role` — anything other than `"user"` renders with the assistant
   *  treatment (mirrors `AuthoringChatDrawer`'s own `role === "user" ? "You" : "Assistant"` label
   *  logic; the backend only ever emits `"user"`/`"assistant"`). */
  role: string;
  text: string;
}

/** One text content block rendered as a role-differentiated bubble (design.md D1) — a real gap the
 *  old `AuthoringChatDrawer` never had (its `.authoring-drawer__turn` uses one flat card style for
 *  both roles). `ActiveConversationPanel` renders one `MessageTurn` per `text` content block (in
 *  transcript order); a turn's `tool_use` blocks render as sibling `ToolCallIndicator` rows instead
 *  of nesting inside this bubble, keeping each component's own DESIGN.md recipe (bubble vs. pill)
 *  visually distinct. */
export function MessageTurn({ role, text }: MessageTurnProps) {
  const roleClass = role === "user" ? "message-turn--user" : "message-turn--assistant";

  return (
    <div className={`message-turn ${roleClass}`}>
      <span className="message-turn__role eyebrow">{role === "user" ? "You" : "Assistant"}</span>
      <p className="message-turn__text">{text}</p>
    </div>
  );
}
