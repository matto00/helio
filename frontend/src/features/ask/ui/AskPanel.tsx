import { useState, type Ref } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { InlineError } from "../../../shared/chrome/InlineError";
import { askErrorMessage, askErrorRetryable } from "../askErrorCopy";
import { useAsk } from "../hooks/useAsk";
import type { AskScope } from "../types/ask";
import { AskAnswerCard } from "./AskAnswerCard";
import { AskQuestionForm } from "./AskQuestionForm";
import { AskUpsell } from "./AskUpsell";
import "./ask.css";

interface AskPanelProps {
  scope: AskScope;
  /** A pipeline draft exists: Pin is disabled with a reason (Output sheet only). */
  draftActive?: boolean;
  fieldRef?: Ref<HTMLTextAreaElement>;
}

/** The shared body of both ask surfaces: the question form (or the free-tier upsell), the one live region, the answer card and
 *  the error state. Its state is local and ephemeral; the question is kept in every state. */
export function AskPanel({ scope, draftActive = false, fieldRef }: AskPanelProps) {
  const tier = useAppSelector((state) => state.auth?.currentUser?.tier);
  const [question, setQuestion] = useState("");
  // The pin announcement belongs to the answer it was made for: a new answer or ask no longer matches, so it clears with no effect.
  const [pinNote, setPinNote] = useState<{ answerKey: string; text: string } | null>(null);
  const { state, ask, retry } = useAsk(scope);

  const answerKey =
    state.status === "answered" ? `${state.question}:${state.response.answer}` : null;
  const upsell =
    tier === "free" || (state.status === "error" && state.error.kind === "tierForbidden");
  const announcement =
    (pinNote !== null && pinNote.answerKey === answerKey ? pinNote.text : null) ??
    (state.status === "pending" ? "Asking…" : state.status === "answered" ? "Answer ready." : "");

  return (
    <div className="ask-panel">
      {upsell ? (
        <AskUpsell />
      ) : (
        <AskQuestionForm
          value={question}
          onChange={setQuestion}
          onSubmit={() => void ask(question)}
          pending={state.status === "pending"}
          fieldRef={fieldRef}
        />
      )}
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {!upsell && state.status === "answered" && (
        <AskAnswerCard
          // A new answer resets the pin state.
          key={`${state.question}:${state.response.answer}`}
          scope={scope}
          response={state.response}
          draftActive={draftActive}
          onAnnounce={(text) => setPinNote({ answerKey: answerKey ?? "", text })}
        />
      )}
      {!upsell && state.status === "error" && (
        <InlineError
          variant="banner"
          error={askErrorMessage(state.error)}
          onRetry={askErrorRetryable(state.error) ? retry : undefined}
        />
      )}
    </div>
  );
}
