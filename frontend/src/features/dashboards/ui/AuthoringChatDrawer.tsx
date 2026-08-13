import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import { Textarea } from "../../../shared/ui/Textarea";
import { InlineError } from "../../../shared/chrome/InlineError";
import { useOverlay } from "../../../shared/chrome/OverlayProvider";
import { useDashboardAuthoringStream } from "../hooks/useDashboardAuthoringStream";
import { fetchAuthoringConversation } from "../services/authoringService";
import { summarizeAuthoringProposal } from "../utils/authoringSummary";
import type { AuthoringDisplayTurn } from "../types/authoring";
import type { DashboardProposal } from "../types/proposal";
import "./AuthoringChatDrawer.css";

interface AuthoringChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

type Phase = "idle" | "streaming" | "error";

// HEL-397 design.md D7 — sessionStorage (tab-scoped), not localStorage: "survive a reload" is
// satisfied without a stale conversation id lingering indefinitely across unrelated future tabs.
const CONVERSATION_ID_STORAGE_KEY = "helio.authoring.conversationId";

/** "Author with AI" chat surface (HEL-395, extended to multi-turn by HEL-397) — a drawer overlay
 *  (design.md D1), not a new route. Streams `POST /api/authoring/dashboard?stream=true` via
 *  `useDashboardAuthoringStream`. A completed turn appends to the visible thread and re-opens the
 *  input for a follow-up (HEL-397 design.md D6) — this component never auto-navigates on a result
 *  and never calls `applyProposal` or any apply endpoint itself; nothing is written until the user
 *  explicitly activates "Review & apply", which hands the latest working proposal to the existing
 *  Proposal Review route unmodified. `conversationId` is persisted to `sessionStorage` so the
 *  conversation survives a reload (design.md D7). */
export function AuthoringChatDrawer({ open, onClose }: AuthoringChatDrawerProps) {
  const navigate = useNavigate();
  const overlay = useOverlay();
  const wasActiveRef = useRef(false);

  const [goal, setGoal] = useState("");
  const [submittedGoal, setSubmittedGoal] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<AuthoringDisplayTurn[]>([]);
  const [latestProposal, setLatestProposal] = useState<DashboardProposal | null>(null);

  const { statusLabel, result, error, connectionError } = useDashboardAuthoringStream({
    goal: submittedGoal ?? "",
    active: submittedGoal !== null,
    conversationId: conversationId ?? undefined,
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
  // (matches MobileNavSheet's use of the same primitive). Also triggers a
  // reload-hydration attempt (design.md D7) on every open.
  useEffect(() => {
    if (open) {
      overlay.open();
      rehydrateFromStorage();
    } else {
      overlay.close();
      wasActiveRef.current = false;
    }
    // overlay.open/close are stable (useCallback); rehydrateFromStorage reads
    // sessionStorage fresh every call. Only re-run on `open`.
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

  function rehydrateFromStorage() {
    const storedId = window.sessionStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
    if (!storedId) return;
    fetchAuthoringConversation(storedId)
      .then((view) => {
        if (view) {
          setConversationId(view.conversationId);
          setThread(view.displayTurns);
          setLatestProposal(view.latestProposal ?? null);
        } else {
          window.sessionStorage.removeItem(CONVERSATION_ID_STORAGE_KEY);
        }
      })
      .catch(() => {
        // A stale/unreachable conversation id degrades to a fresh conversation, exactly like a
        // clean 404 (design.md D7) — never an inline error for what is a recoverable case.
        window.sessionStorage.removeItem(CONVERSATION_ID_STORAGE_KEY);
      });
  }

  // Terminal success (HEL-397 design.md D6): append this turn to the visible thread and re-open
  // the input for a follow-up — NEVER auto-navigate/close. Navigation to Proposal Review only
  // happens from the explicit "Review & apply" control below.
  useEffect(() => {
    if (result) {
      const turnGoal = submittedGoal ?? "";
      setThread((prev) => [
        ...prev,
        { role: "user", text: turnGoal },
        { role: "assistant", text: summarizeAuthoringProposal(result.proposal) },
      ]);
      setLatestProposal(result.proposal);
      setConversationId(result.conversationId);
      window.sessionStorage.setItem(CONVERSATION_ID_STORAGE_KEY, result.conversationId);
      setGoal("");
      setSubmittedGoal(null);
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

  // The conversation's natural endpoint (design.md D7): clears the stored conversationId (a fresh
  // "Author with AI" next time starts a new conversation) and hands the latest working proposal to
  // the existing, unmodified Proposal Review flow. Also resets the LOCAL thread/conversationId/
  // latestProposal state (skeptic-final-1.md change request 1) — without this, reopening this same
  // mounted drawer instance (no full page reload, e.g. after rejecting in Proposal Review and
  // returning to `/`) would still show the just-reviewed conversation's stale thread, and an
  // unrelated follow-up goal would be silently appended to that already-applied conversation
  // instead of starting fresh. `handleClose` (the "X"/backdrop path) deliberately does NOT do this
  // reset — resuming an in-progress draft on reopen there is intentional, not a bug.
  function handleReviewAndApply() {
    if (!latestProposal) return;
    window.sessionStorage.removeItem(CONVERSATION_ID_STORAGE_KEY);
    navigate("/proposals/review", { state: { proposal: latestProposal } });
    setThread([]);
    setLatestProposal(null);
    setConversationId(null);
    handleClose();
  }

  if (!open) return null;

  const statusText = statusLabel ? `${capitalize(statusLabel)}…` : "Composing your dashboard…";
  const isFollowUp = thread.length > 0;

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

        {isFollowUp && (
          <ul className="authoring-drawer__thread" aria-label="Conversation">
            {thread.map((turn, index) => (
              <li
                key={index}
                className={`authoring-drawer__turn authoring-drawer__turn--${turn.role}`}
              >
                <span className="authoring-drawer__turn-role">
                  {turn.role === "user" ? "You" : "Assistant"}
                </span>
                <span className="authoring-drawer__turn-text">{turn.text}</span>
              </li>
            ))}
          </ul>
        )}

        <form className="authoring-drawer__form" onSubmit={handleSubmit}>
          <Textarea
            className="authoring-drawer__input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={
              isFollowUp
                ? "e.g. Make the second panel a bar chart"
                : "e.g. Show weekly revenue by region with a top-10 customers table"
            }
            aria-label="Dashboard goal"
            rows={4}
            disabled={phase !== "idle"}
            autoFocus
          />
          {phase === "idle" && (
            <div className="authoring-drawer__actions">
              {latestProposal && (
                <button
                  type="button"
                  className="authoring-drawer__review"
                  onClick={handleReviewAndApply}
                >
                  Review &amp; apply
                </button>
              )}
              <button
                type="submit"
                className="authoring-drawer__submit"
                disabled={goal.trim().length === 0}
              >
                {isFollowUp ? "Send" : "Generate proposal"}
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
