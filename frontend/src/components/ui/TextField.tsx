import { forwardRef, type InputHTMLAttributes } from "react";

import "./inputs.css";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  type?: "text" | "number" | "search" | "email" | "url" | "tel";
  /** When true, applies a monospace stack — used for expressions and field names. */
  mono?: boolean;
}

/** App-styled text input. Replaces raw <input> in feature components so the
 * visual language stays consistent (transparent surface, accent-tinted border,
 * focus ring) without each call site re-declaring styles. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { className, type = "text", mono, ...rest },
  ref,
) {
  const classes = ["ui-input", mono ? "ui-input--mono" : null, className ?? null]
    .filter(Boolean)
    .join(" ");
  return <input ref={ref} type={type} className={classes} {...rest} />;
});
