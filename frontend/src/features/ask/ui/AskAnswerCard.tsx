import { useEffect, useId } from "react";
import { Link } from "react-router-dom";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { InlineError } from "../../../shared/chrome/InlineError";
import { CitationChip } from "../../panels/insight/CitationChip";
import { InsightMarkdown } from "../../panels/insight/InsightMarkdown";
import type { InsightCitation } from "../../panels/insight/insightService";
import { useAskPin } from "../hooks/useAskPin";
import type { AskCitation, AskResponse, AskScope } from "../types/ask";
import "./ask.css";

export const PIN_DRAFT_REASON = "Save or discard your draft to pin.";

/** The one adapter from an ask citation to HEL-1744's chip input. */
function toInsightCitation(c: AskCitation): InsightCitation {
  return { ...c };
}

interface AskAnswerCardProps {
  scope: AskScope;
  response: AskResponse;
  /** A pipeline draft exists (Output sheet): pinning would change the saved Outputs under it, so Pin is disabled with a reason. */
  draftActive?: boolean;
  /** Called with the text a screen reader should hear (the surface owns the one live region). */
  onAnnounce: (text: string) => void;
}

/** A 200 answer: sanitised markdown whose `[cN]` markers are HEL-1744's citation chips (a marker the response does not cite stays
 *  plain text), the cited Outputs by name, and the pin action iff the server returned a pin. Shows no model, token or cost. */
export function AskAnswerCard({
  scope,
  response,
  draftActive = false,
  onAnnounce,
}: AskAnswerCardProps) {
  const { state, pin } = useAskPin(scope, response.pin);
  const reasonId = useId();
  const pipelineName = useAppSelector(
    (s) => s.pipelines?.items?.find((p) => p.id === response.pin?.pipelineId)?.name,
  );
  const byId = new Map(response.citations.map((c, i) => [c.id, { citation: c, ordinal: i + 1 }]));
  const insightPanelId = `ask:${scope.kind}:${scope.id}`;

  function renderCitation(id: string) {
    const entry = byId.get(id);
    if (entry === undefined) return null;
    return (
      <CitationChip
        citation={toInsightCitation(entry.citation)}
        ordinal={entry.ordinal}
        insightPanelId={insightPanelId}
        source={{ variant: "authenticated" }}
      />
    );
  }

  const pinned = state.status === "pinned";
  useEffect(() => {
    if (pinned) onAnnounce("Pinned as an insight.");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce once per pin, not per parent render
  }, [pinned]);

  const pinnedText =
    state.status === "pinned"
      ? state.placed
        ? "Pinned as an insight and placed on this dashboard."
        : scope.kind === "output"
          ? "Pinned as an insight in this pipeline."
          : null
      : null;

  return (
    <section className="ask-answer" aria-label="Answer">
      <InsightMarkdown
        markdown={response.answer}
        citations={response.citations.map((c) => c.id)}
        renderCitation={renderCitation}
      />
      {response.citedOutputs.length > 0 && (
        <p className="ask-answer__sources">
          Based on {response.citedOutputs.map((o) => o.name).join(", ")}
        </p>
      )}
      {response.pin !== null && state.status !== "pinned" && (
        <div className="ask-answer__pin">
          <button
            type="button"
            className="ui-modal-btn ui-modal-btn--secondary"
            disabled={state.status === "pending" || draftActive}
            aria-describedby={draftActive ? reasonId : undefined}
            onClick={() => void pin()}
          >
            {state.status === "pending" ? "Pinning…" : "Pin as insight"}
          </button>
          {draftActive && (
            <p id={reasonId} className="ask-answer__pin-reason">
              {PIN_DRAFT_REASON}
            </p>
          )}
        </div>
      )}
      {state.status === "error" && (
        <InlineError
          variant="banner"
          error="Couldn't pin this answer."
          onRetry={() => void pin()}
        />
      )}
      {state.status === "pinned" && (
        <p className="ask-answer__pinned">
          <strong>Pinned.</strong>{" "}
          {pinnedText ?? (
            <>
              Saved to{" "}
              <Link
                className="ask-answer__link"
                to={`/pipelines/${response.pin?.pipelineId ?? ""}`}
              >
                {pipelineName ?? "the pipeline"}
              </Link>
              .
            </>
          )}
        </p>
      )}
    </section>
  );
}
