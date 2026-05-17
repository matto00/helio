import { forwardRef, type TextareaHTMLAttributes } from "react";

import "./inputs.css";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, mono, ...rest },
  ref,
) {
  const classes = ["ui-textarea", mono ? "ui-input--mono" : null, className ?? null]
    .filter(Boolean)
    .join(" ");
  return <textarea ref={ref} className={classes} {...rest} />;
});
