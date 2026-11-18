import { Link } from "react-router-dom";

import "./ask.css";

/** The free-tier (and `403 TIER_FORBIDDEN`) state of an ask surface: it replaces the question field and no request is sent. */
export function AskUpsell() {
  return (
    <p className="ask-upsell">
      Asking about your data is on the beta plan.{" "}
      <Link
        className="ask-upsell__link"
        to="/settings#beta-access"
        target="_blank"
        rel="noreferrer"
      >
        Request Beta access<span className="sr-only"> (opens in a new tab)</span>
      </Link>
    </p>
  );
}
