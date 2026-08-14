import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import { Textarea } from "../../../shared/ui/Textarea";
import { InlineError } from "../../../shared/chrome/InlineError";
import { useOverlay } from "../../../shared/chrome/OverlayProvider";
import { useRefinement } from "../hooks/useRefinement";
import { fetchAuthoringConversation } from "../services/authoringService";
import { summarizeRefinementPatchSet } from "../utils/refinementSummary";
import type { AuthoringDisplayTurn, AuthoringErrorKind } from "../types/authoring";
import type { PatchSet } from "../../patchSets/types/patchSet";
import "./RefinementChatDrawer.css";

interface RefinementChatDrawerProps {
  open: boolean;
  onClose: () => void;
  /** design.md D6 — REQUIRED: the drawer always targets the currently-open dashboard, never a
   *  user-typed id (`refinement-chat-surface` spec's "targets the currently-open dashboard"
   *  requirement). Callers (`App.tsx`) gate mounting on `selectedDashboardId !== null`. */
  dashboardId: string;
}

type Phase = "idle" | "loading" | "error";

// design.md D4/D6 — sessionStorage (tab-scoped, mirrors AuthoringChatDrawer's identical
// CONVERSATION_ID_STORAGE_KEY precedent), keyed per dashboardId: a refinement conversation is only
// ever valid against the dashboard it was grounded in, so a stored id must never be reused across a
// dashboard switch.
const CONVERSATION_ID_STORAGE_PREFIX = "helio.refinement.conversationId.";

/** Per-kind error copy — mirrors `AuthoringChatDrawer.errorCopyFor` (HEL-401 design.md D5), reusing
 *  the SAME `AuthoringErrorKind` values (design.md D5 — `RefinementRoutes` reuses `AuthoringErrorKind`
 *  unchanged, no new kind). `EmptyWorkspace` never applies here (`RefinementGrounding` has no
 *  empty-workspace short-circuit — a refinement like "rename this dashboard" needs no DataType at
 *  all), so it falls through to the raw-message default like any kind outside this switch. */
function errorCopyFor(kind: AuthoringErrorKind | null, rawMessage: string): string {
  switch (kind) {
    case "ModelFailure":
      return "The AI model had trouble responding. Please try again.";
    case "BudgetExceeded":
      return "This conversation has used its available token budget. Start a new conversation to continue.";
    default:
      return rawMessage;
  }
}

/** "Refine with AI" chat surface (HEL-411 design.md D6) — a drawer overlay, sibling to
 *  `AuthoringChatDrawer` (NOT a modification of it — different target semantics: an EXISTING
 *  dashboard vs. a brand-new one). Sends `POST /api/refinements` via `useRefinement` (buffered, no
 *  SSE). A completed turn appends to the visible thread and re-opens the input for a follow-up —
 *  this component never auto-navigates on a result and never calls the apply endpoint itself;
 *  nothing is written until the user explicitly activates "Review & apply", which hands the latest
 *  working patch set to the existing Patch Set Review route (`/patch-sets/review`,
 *  `location.state.patchSet`) unmodified. `conversationId` is persisted to `sessionStorage`,
 *  scoped per `dashboardId`, so the conversation survives a reload. */
export function RefinementChatDrawer({ open, onClose, dashboardId }: RefinementChatDrawerProps) {
  const navigate = useNavigate();
  const overlay = useOverlay();
  const wasActiveRef = useRef(false);
  // Tracks the dashboardId the effect below last ran for, so it can tell "the target dashboard
  // just changed" apart from "open toggled with the same dashboard" — merged into ONE effect
  // (rather than two separate [dashboardId]/[open] effects) specifically so a fresh mount doesn't
  // double-fire rehydrateFromStorage (both would independently see themselves as "new" on the
  // first render, firing twice — confirmed via a failing test asserting exactly one GET).
  const prevDashboardIdRef = useRef(dashboardId);
  const storageKey = `${CONVERSATION_ID_STORAGE_PREFIX}${dashboardId}`;

  const [message, setMessage] = useState("");
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<AuthoringDisplayTurn[]>([]);
  const [latestPatchSet, setLatestPatchSet] = useState<PatchSet | null>(null);

  const { result, error, errorKind } = useRefinement({
    target: { kind: "dashboard", id: dashboardId },
    message: submittedMessage ?? "",
    active: submittedMessage !== null,
    conversationId: conversationId ?? undefined,
  });

  // Gate on submittedMessage first, not just error: the hook only resets its error state at the
  // *start* of the next attempt (not when `active` flips false), so once the user has reset back to
  // idle (handleReset) the drawer must not keep reading the previous attempt's now-stale error.
  const phase: Phase = submittedMessage === null ? "idle" : error !== null ? "error" : "loading";

  function rehydrateFromStorage() {
    const storedId = window.sessionStorage.getItem(storageKey);
    if (!storedId) return;
    fetchAuthoringConversation(storedId)
      .then((view) => {
        if (view && view.latestPatchSet) {
          setConversationId(view.conversationId);
          setThread(view.displayTurns);
          setLatestPatchSet(view.latestPatchSet);
        } else {
          // A stale/foreign/other-flow conversation id degrades to a fresh conversation, exactly
          // like a clean 404 — never an inline error for what is a recoverable case.
          window.sessionStorage.removeItem(storageKey);
        }
      })
      .catch(() => {
        window.sessionStorage.removeItem(storageKey);
      });
  }

  // Registers with the shared single-active-overlay + global Escape handler (matches
  // AuthoringChatDrawer's identical precedent) and triggers a reload-hydration attempt on every
  // open. ALSO handles the dashboardId-changed case (design.md D6): a conversationId is only ever
  // valid against the dashboard it was grounded in, so switching the target dashboard resets local
  // state before rehydrating under the NEW dashboard's own storage key — never silently continues
  // the old dashboard's conversation against the new one. Both concerns live in ONE effect (not two
  // separately keyed on [open]/[dashboardId]) so a fresh mount rehydrates exactly once, not twice.
  useEffect(() => {
    const dashboardChanged = prevDashboardIdRef.current !== dashboardId;
    prevDashboardIdRef.current = dashboardId;

    if (dashboardChanged) {
      setMessage("");
      setSubmittedMessage(null);
      setConversationId(null);
      setThread([]);
      setLatestPatchSet(null);
    }

    if (open) {
      overlay.open();
      rehydrateFromStorage();
    } else {
      overlay.close();
      wasActiveRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dashboardId]);

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

  // Terminal success: append this turn to the visible thread and re-open the input for a follow-up
  // — NEVER auto-navigate/close. Navigation to Patch Set Review only happens from the explicit
  // "Review & apply" control below (refinement-chat-surface spec).
  useEffect(() => {
    if (result) {
      const turnMessage = submittedMessage ?? "";
      setThread((prev) => [
        ...prev,
        { role: "user", text: turnMessage },
        { role: "assistant", text: summarizeRefinementPatchSet(result.patchSet) },
      ]);
      setLatestPatchSet(result.patchSet);
      setConversationId(result.conversationId);
      window.sessionStorage.setItem(storageKey, result.conversationId);
      setMessage("");
      setSubmittedMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function handleClose() {
    setMessage("");
    setSubmittedMessage(null);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length === 0 || phase !== "idle") return;
    setSubmittedMessage(trimmed);
  }

  function handleReset() {
    setSubmittedMessage(null);
  }

  // The conversation's natural endpoint: clears the stored conversationId (a fresh "Refine with AI"
  // next time starts a new conversation) and hands the latest working patch set to the existing,
  // unmodified Patch Set Review flow. Also resets LOCAL thread/conversationId/latestPatchSet state —
  // without this, reopening this same mounted drawer instance would still show the just-reviewed
  // conversation's stale thread. `handleClose` (the "X"/backdrop path) deliberately does NOT do this
  // reset — resuming an in-progress draft on reopen there is intentional, mirrors AuthoringChatDrawer.
  function handleReviewAndApply() {
    if (!latestPatchSet) return;
    window.sessionStorage.removeItem(storageKey);
    navigate("/patch-sets/review", { state: { patchSet: latestPatchSet } });
    setThread([]);
    setLatestPatchSet(null);
    setConversationId(null);
    handleClose();
  }

  // BudgetExceeded's escape hatch — mirrors AuthoringChatDrawer.handleStartNewConversation:
  // retrying the SAME conversation would just hit the same budget wall again.
  function handleStartNewConversation() {
    window.sessionStorage.removeItem(storageKey);
    setThread([]);
    setLatestPatchSet(null);
    setConversationId(null);
    setMessage("");
    setSubmittedMessage(null);
  }

  if (!open) return null;

  const isFollowUp = thread.length > 0;

  return createPortal(
    <>
      <button
        type="button"
        className="refinement-drawer__backdrop"
        aria-label="Close"
        onClick={handleClose}
      />
      <aside
        className="refinement-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Refine this dashboard with AI"
      >
        <header className="refinement-drawer__header">
          <h2 className="refinement-drawer__title">Refine with AI</h2>
          <button
            type="button"
            className="refinement-drawer__close"
            aria-label="Close"
            onClick={handleClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>
        <p className="refinement-drawer__description">
          Describe a change to this dashboard. We&rsquo;ll draft a reviewable patch set — nothing
          changes until you accept it.
        </p>

        {isFollowUp && (
          <ul className="refinement-drawer__thread" aria-label="Conversation">
            {thread.map((turn, index) => (
              <li
                key={index}
                className={`refinement-drawer__turn refinement-drawer__turn--${turn.role}`}
              >
                <span className="refinement-drawer__turn-role">
                  {turn.role === "user" ? "You" : "Assistant"}
                </span>
                <span className="refinement-drawer__turn-text">{turn.text}</span>
              </li>
            ))}
          </ul>
        )}

        <form className="refinement-drawer__form" onSubmit={handleSubmit}>
          <Textarea
            className="refinement-drawer__input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              isFollowUp
                ? "e.g. Make that a bar chart, group by month"
                : "e.g. Add a table of top customers by revenue"
            }
            aria-label="Refinement message"
            rows={4}
            disabled={phase !== "idle"}
            autoFocus
          />
          {phase === "idle" && (
            <div className="refinement-drawer__actions">
              {latestPatchSet && (
                <button
                  type="button"
                  className="refinement-drawer__review"
                  onClick={handleReviewAndApply}
                >
                  Review &amp; apply
                </button>
              )}
              <button
                type="submit"
                className="refinement-drawer__submit"
                disabled={message.trim().length === 0}
              >
                {isFollowUp ? "Send" : "Propose changes"}
              </button>
            </div>
          )}
        </form>

        {phase === "loading" && (
          <div className="refinement-drawer__progress" role="status">
            <span className="refinement-drawer__spinner" aria-hidden="true" />
            <span>Composing your patch set…</span>
          </div>
        )}

        {phase === "error" && (
          <div className="refinement-drawer__error-block">
            <InlineError error={errorCopyFor(errorKind, error ?? "")} />
            {errorKind === "InvalidProposal" && (
              <p className="refinement-drawer__error-hint">
                Try refining your message with more specific detail.
              </p>
            )}
            {errorKind === "BudgetExceeded" ? (
              <button
                type="button"
                className="refinement-drawer__retry"
                onClick={handleStartNewConversation}
              >
                Start a new conversation
              </button>
            ) : (
              <button type="button" className="refinement-drawer__retry" onClick={handleReset}>
                Try again
              </button>
            )}
          </div>
        )}
      </aside>
    </>,
    document.body,
  );
}
