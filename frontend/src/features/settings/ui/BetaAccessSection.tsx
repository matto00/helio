// Beta access section (HEL-704 tasks.md 6.3) — third Settings section, mounted below Preferences
// and Agent memory. Tier-aware (settings-beta-access-ui spec): a `free`-tier user sees a
// "Request Beta access" action plus a code-entry field with a redeem action; `beta`/`owner`
// instead see a confirmation and no controls. Follows `PreferencesEditor.tsx`'s established
// pattern — shared `TextField`, explicit action buttons, `InlineError` for status.

import { type FormEvent, useState } from "react";

import { InlineError } from "../../../shared/chrome/InlineError";
import { TextField } from "../../../shared/ui/index";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { redeemInviteCodeThunk, requestBetaAccessThunk } from "../state/settingsSlice";
import "./BetaAccessSection.css";

export function BetaAccessSection() {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const { requestStatus, requestError, redeemStatus, redeemError } = useAppSelector(
    (state) => state.settings.betaAccess,
  );
  const [code, setCode] = useState("");

  // No identity resolved yet (e.g. rehydration in flight) — nothing meaningful to render.
  if (!currentUser) return null;

  if (currentUser.tier !== "free") {
    return (
      <div className="beta-access-section">
        <p className="beta-access-section__confirmation">
          {currentUser.tier === "owner"
            ? "You have workspace-owner access."
            : "You have Beta access."}
        </p>
      </div>
    );
  }

  const isRequesting = requestStatus === "loading";
  const isRedeeming = redeemStatus === "loading";

  function handleRequest() {
    void dispatch(requestBetaAccessThunk());
  }

  async function handleRedeem(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || isRedeeming) return;
    try {
      await dispatch(redeemInviteCodeThunk(trimmed)).unwrap();
      // Only cleared on success — a rejected code leaves the input in place so the user can see
      // what they submitted (settings-beta-access-ui spec: "leave state unchanged").
      setCode("");
    } catch {
      // redeemError (from the slice) already carries the message this component renders below.
    }
  }

  return (
    <div className="beta-access-section">
      <div className="beta-access-section__request">
        <button
          type="button"
          className="beta-access-section__request-btn"
          onClick={handleRequest}
          disabled={isRequesting}
        >
          {isRequesting ? "Requesting…" : "Request Beta access"}
        </button>
        {requestStatus === "succeeded" && (
          <p className="beta-access-section__confirmation">
            Request sent — the owner has been notified.
          </p>
        )}
        <InlineError error={requestError} />
      </div>

      <form className="beta-access-section__redeem" onSubmit={handleRedeem}>
        <TextField
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter invite code"
          aria-label="Invite code"
          disabled={isRedeeming}
        />
        <button
          type="submit"
          className="beta-access-section__redeem-btn"
          disabled={isRedeeming || !code.trim()}
        >
          {isRedeeming ? "Redeeming…" : "Redeem code"}
        </button>
        <InlineError error={redeemError} />
      </form>
    </div>
  );
}
