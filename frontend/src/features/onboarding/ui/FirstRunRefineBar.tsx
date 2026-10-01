import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

import "./FirstRunRefineBar.css";
import { useAppSelector } from "../../../hooks/reduxHooks";
import type { FirstRunBuildResult } from "../services/firstRunService";
import { buildRefineDraft, canRefineWithAssistant } from "../state/firstRunDraft";

/** "Refine with the assistant" on a dashboard just built by the first run. Beta and owner tiers
 *  only: for a free user the control is not rendered at all (never shown-then-403). The HEL-1205
 *  tier gate stays the enforcement; this only avoids offering a door that would be refused. */
export function FirstRunRefineBar({ result }: { result: FirstRunBuildResult }) {
  const tier = useAppSelector((state) => state.auth.currentUser?.tier);
  const navigate = useNavigate();
  if (!canRefineWithAssistant(tier)) return null;

  return (
    <div className="first-run-refine" role="region" aria-label="Refine this dashboard">
      <p className="first-run-refine__text">
        Built from <strong>{result.sourceName}</strong>. Want it tweaked?
      </p>
      <button
        type="button"
        className="first-run-refine__button"
        onClick={() => navigate("/chat", { state: { draft: buildRefineDraft(result) } })}
      >
        <Sparkles aria-hidden="true" size={14} />
        Refine with the assistant
      </button>
    </div>
  );
}
