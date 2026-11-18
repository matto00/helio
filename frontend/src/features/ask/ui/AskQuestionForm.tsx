import { useId, type FormEvent, type Ref } from "react";

import { FormField } from "../../../shared/ui/FormField";
import { Spinner } from "../../../shared/ui/Spinner";
import { Textarea } from "../../../shared/ui/Textarea";
import { ASK_MAX_QUESTION, isAskableQuestion } from "../hooks/useAsk";
import "./ask.css";

interface AskQuestionFormProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  /** Where focus lands on open (the dashboard drawer); the Output sheet leaves it unset. */
  fieldRef?: Ref<HTMLTextAreaElement>;
}

/** The labelled question field and its submit control. Enter submits, Shift+Enter inserts a newline; submit is disabled while
 *  pending or when the trimmed text is outside 1..2000 characters. The text is never cleared (every state keeps the question). */
export function AskQuestionForm({
  value,
  onChange,
  onSubmit,
  pending,
  fieldRef,
}: AskQuestionFormProps) {
  const fieldId = useId();
  const hintId = useId();
  const askable = isAskableQuestion(value);
  const tooLong = value.trim().length > ASK_MAX_QUESTION;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (askable && !pending) onSubmit();
  }

  return (
    <form className="ask-form" onSubmit={handleSubmit}>
      <FormField
        label="Your question"
        htmlFor={fieldId}
        hintId={hintId}
        hint={
          tooLong
            ? `Questions are at most ${ASK_MAX_QUESTION} characters.`
            : "Answers come only from this data. Enter to ask, Shift+Enter for a new line."
        }
      >
        <Textarea
          id={fieldId}
          ref={fieldRef}
          className="ask-form__field"
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          submitOnEnter
          aria-describedby={hintId}
          aria-invalid={tooLong || undefined}
        />
      </FormField>
      <div className="ask-form__actions">
        <button
          type="submit"
          className="ui-modal-btn ui-modal-btn--primary"
          disabled={!askable || pending}
        >
          {pending ? (
            <>
              <Spinner /> Asking…
            </>
          ) : (
            "Ask"
          )}
        </button>
      </div>
    </form>
  );
}
