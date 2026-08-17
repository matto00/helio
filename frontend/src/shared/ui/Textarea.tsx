import { forwardRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";

import "./inputs.css";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  /** F-063 — opt-in: plain Enter submits the nearest `<form>` (via `requestSubmit()`, so the
   *  form's own `onSubmit` handler runs unchanged), Shift+Enter still inserts a newline. Every
   *  other `Textarea` (multi-line free text: descriptions, source configs, etc.) leaves this unset
   *  and keeps its existing "Enter always inserts a newline" behavior — this is exclusively for
   *  chat-style composers where Enter-to-send is the expected convention. Ignored while an IME
   *  composition is in progress, so a Japanese/Chinese/Korean input's Enter-to-confirm keystroke
   *  never submits the form prematurely. */
  submitOnEnter?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, mono, submitOnEnter, onKeyDown, ...rest },
  ref,
) {
  const classes = ["ui-textarea", mono ? "ui-input--mono" : null, className ?? null]
    .filter(Boolean)
    .join(" ");

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (
      submitOnEnter &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return <textarea ref={ref} className={classes} onKeyDown={handleKeyDown} {...rest} />;
});
