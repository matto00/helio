import "./Spinner.css";

interface SpinnerProps {
  /** Diameter/border-width preset. Matches the sizes already in use across the app's hand-rolled
   *  border-spinners: `sm` (14px, MessageComposer's inline "Sending…" indicator), `md` (16px,
   *  RefinementChatDrawer's progress row), `lg` (20px, ActiveConversationPanel's loading state),
   *  `xl` (24px, PanelContent's panel-load spinner), `2xl` (32px, auth.css's full-page boot/
   *  callback spinner). Defaults to `md`. */
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  className?: string;
}

/** Shared border-spinner primitive (DESIGN.md §7 — "the established spinner pattern"). Extracted
 *  from several near-identical hand-rolled recipes that differed only in size and keyframe name
 *  (ActiveConversationPanel.css, MessageComposer.css, RefinementChatDrawer.css — F-190;
 *  PanelContent.css's `.panel-content__spinner` and auth.css's `.auth-loading__spinner`
 *  subsequently migrated too — F-190 crossPackageRequests).
 *  Always `aria-hidden` — the loading state's accessible label/text lives on a sibling element
 *  (e.g. a `role="status"` wrapper), never on the spinner itself. */
export function Spinner({ size = "md", className }: SpinnerProps) {
  const classes = ["ui-spinner", `ui-spinner--${size}`, className ?? null]
    .filter(Boolean)
    .join(" ");
  return <span className={classes} aria-hidden="true" />;
}
