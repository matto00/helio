import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import { Textarea } from "../../../shared/ui/Textarea";
import { InlineError } from "../../../shared/chrome/InlineError";
import { useOverlay } from "../../../shared/chrome/OverlayProvider";
import { useDashboardAuthoringStream } from "../hooks/useDashboardAuthoringStream";
import "./AuthoringChatDrawer.css";

interface AuthoringChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

type Phase = "idle" | "streaming" | "error";

/** "Author with AI" chat surface (HEL-395) — a drawer overlay (design.md D1),
 *  not a new route. Takes a single natural-language goal, streams
 *  `POST /api/authoring/dashboard?stream=true` via
 *  `useDashboardAuthoringStream`, and on a terminal `authoring-result` hands
 *  the proposal to the existing Proposal Review route completely unmodified
 *  (design.md D4) — this component never calls `applyProposal` or any apply
 *  endpoint itself; nothing is written until the user accepts there. */
export function AuthoringChatDrawer({ open, onClose }: AuthoringChatDrawerProps) {
  const navigate = useNavigate();
  const overlay = useOverlay();
  const wasActiveRef = useRef(false);

  const [goal, setGoal] = useState("");
  const [submittedGoal, setSubmittedGoal] = useState<string | null>(null);

  const { statusLabel, result, error, connectionError } = useDashboardAuthoringStream({
    goal: submittedGoal ?? "",
    active: submittedGoal !== null,
  });

  const inlineError = error ?? connectionError;
  // Gate on submittedGoal first, not just inlineError: the hook only resets
  // its error/connectionError state at the *start* of the next connection
  // attempt (not when `active` flips false), so once the user has reset back
  // to idle (handleReset) the drawer must not keep reading the previous
  // attempt's now-stale error.
  const phase: Phase =
    submittedGoal === null ? "idle" : inlineError !== null ? "error" : "streaming";

  // Register with the shared single-active-overlay + global Escape handler
  // (matches MobileNavSheet's use of the same primitive).
  useEffect(() => {
    if (open) {
      overlay.open();
    } else {
      overlay.close();
      wasActiveRef.current = false;
    }
    // overlay.open/close are stable (useCallback); only re-run on `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (overlay.isActive) {
      wasActiveRef.current = true;
      return;
    }
    if (open && wasActiveRef.current) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay.isActive]);

  // Terminal success: hand off to the existing Proposal Review UI (D4) and
  // close the drawer — no apply call happens here, ever.
  useEffect(() => {
    if (result) {
      navigate("/proposals/review", { state: { proposal: result.proposal } });
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function handleClose() {
    setGoal("");
    setSubmittedGoal(null);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = goal.trim();
    if (trimmed.length === 0 || phase !== "idle") return;
    setSubmittedGoal(trimmed);
  }

  function handleCancel() {
    setSubmittedGoal(null);
  }

  function handleReset() {
    setSubmittedGoal(null);
  }

  if (!open) return null;

  const statusText = statusLabel ? `${capitalize(statusLabel)}…` : "Composing your dashboard…";

  return createPortal(
    <>
      <button
        type="button"
        className="authoring-drawer__backdrop"
        aria-label="Close"
        onClick={handleClose}
      />
      <aside
        className="authoring-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Author a dashboard with AI"
      >
        <header className="authoring-drawer__header">
          <h2 className="authoring-drawer__title">Author with AI</h2>
          <button
            type="button"
            className="authoring-drawer__close"
            aria-label="Close"
            onClick={handleClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>
        <p className="authoring-drawer__description">
          Describe the dashboard you want. We&rsquo;ll draft a proposal for you to review before
          anything is created.
        </p>

        <form className="authoring-drawer__form" onSubmit={handleSubmit}>
          <Textarea
            className="authoring-drawer__input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Show weekly revenue by region with a top-10 customers table"
            aria-label="Dashboard goal"
            rows={4}
            disabled={phase !== "idle"}
            autoFocus
          />
          {phase === "idle" && (
            <div className="authoring-drawer__actions">
              <button
                type="submit"
                className="authoring-drawer__submit"
                disabled={goal.trim().length === 0}
              >
                Generate proposal
              </button>
            </div>
          )}
          {phase === "streaming" && (
            <div className="authoring-drawer__actions">
              <button type="button" className="authoring-drawer__cancel" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          )}
        </form>

        {phase === "streaming" && (
          <div className="authoring-drawer__progress" role="status">
            <span className="authoring-drawer__spinner" aria-hidden="true" />
            <span>{statusText}</span>
          </div>
        )}

        {phase === "error" && (
          <div className="authoring-drawer__error-block">
            <InlineError error={inlineError} />
            <button type="button" className="authoring-drawer__retry" onClick={handleReset}>
              Try again
            </button>
          </div>
        )}
      </aside>
    </>,
    document.body,
  );
}

function capitalize(label: string): string {
  return label.length === 0 ? label : label[0].toUpperCase() + label.slice(1);
}
