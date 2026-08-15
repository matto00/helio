import "./MessageTurn.css";

interface MessageTurnProps {
  /** `ClaudeToolMessageDto.role` — anything other than `"user"` renders with the assistant
   *  treatment (mirrors `AuthoringChatDrawer`'s own `role === "user" ? "You" : "Assistant"` label
   *  logic; the backend only ever emits `"user"`/`"assistant"`). */
  role: string;
  text: string;
  /** HEL-667 design.md D5 — true only for the MOST RECENTLY completed assistant turn, when the
   *  converse response's `hopBudgetExhausted` field is `true`: renders a distinct "couldn't finish
   *  in time" treatment. Driven by this explicit boolean alone, never inferred from `text` content.
   *  Defaults `false` so every pre-existing/historical turn is unaffected. */
  hopBudgetExhausted?: boolean;
  /** HEL-667 design.md D5 — true only for the most recently completed assistant turn, when the
   *  converse response's `searchedWithNoResults` field is `true`: renders a distinct "asking a
   *  follow-up" treatment. Same explicit-boolean-only discipline as `hopBudgetExhausted`. */
  searchedWithNoResults?: boolean;
}

/** One text content block rendered as a role-differentiated bubble (design.md D1) — a real gap the
 *  old `AuthoringChatDrawer` never had (its `.authoring-drawer__turn` uses one flat card style for
 *  both roles). `ActiveConversationPanel` renders one `MessageTurn` per `text` content block (in
 *  transcript order); a turn's `tool_use` blocks render as sibling `ToolCallIndicator` rows instead
 *  of nesting inside this bubble, keeping each component's own DESIGN.md recipe (bubble vs. pill)
 *  visually distinct.
 *
 *  `hopBudgetExhausted`/`searchedWithNoResults` (HEL-667 design.md D5) decorate the SAME bubble
 *  rather than adding a separate element — `ActiveConversationPanel` is responsible for only ever
 *  passing `true` for the turn these signals actually describe (the one the just-completed
 *  converse call produced), including synthesizing a standalone `hopBudgetExhausted` bubble when
 *  the hop-cap-exhausted turn has no trailing text block of its own to decorate. */
export function MessageTurn({
  role,
  text,
  hopBudgetExhausted = false,
  searchedWithNoResults = false,
}: MessageTurnProps) {
  const roleClass = role === "user" ? "message-turn--user" : "message-turn--assistant";
  const outcomeClass = hopBudgetExhausted
    ? " message-turn--hop-budget-exhausted"
    : searchedWithNoResults
      ? " message-turn--searched-no-results"
      : "";

  return (
    <div className={`message-turn ${roleClass}${outcomeClass}`}>
      <span className="message-turn__role eyebrow">{role === "user" ? "You" : "Assistant"}</span>
      {hopBudgetExhausted && (
        <span className="message-turn__outcome-note">{"Couldn't finish in time"}</span>
      )}
      {searchedWithNoResults && (
        <span className="message-turn__outcome-note">Asking a follow-up</span>
      )}
      <p className="message-turn__text">{text}</p>
    </div>
  );
}
