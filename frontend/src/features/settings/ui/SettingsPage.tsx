// Settings page (`/settings`, HEL-525 / 420-D task 3.1) — the app's first
// settings surface. Fetch-on-mount for both preferences and agent memory.
//
// F-047 (UI sweep): each section gates on its OWN loading/error state rather
// than a page-wide combined one. Beta access depends on neither fetch (it
// reads `state.auth.currentUser`) and always renders regardless of the other
// two sections' status. Previously a single failing fetch blanked the entire
// page, including sections with no dependency on it at all.

import { useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSun, faMoon } from "@fortawesome/free-solid-svg-icons";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { AccentPicker } from "../../../shared/chrome/AccentPicker";
import { useTheme } from "../../../theme/ThemeProvider";
import { fetchAgentMemory, fetchApiTokens, fetchPreferences } from "../state/settingsSlice";
import { AgentMemoryList } from "./AgentMemoryList";
import { ApiTokensSection } from "./ApiTokensSection";
import { BetaAccessSection } from "./BetaAccessSection";
import { MfaSecuritySection } from "./MfaSecuritySection";
import { PreferencesEditor } from "./PreferencesEditor";
import "./SettingsPage.css";

export function SettingsPage() {
  const dispatch = useAppDispatch();
  const preferences = useAppSelector((state) => state.settings.preferences);
  const agentMemory = useAppSelector((state) => state.settings.agentMemory);
  const apiTokens = useAppSelector((state) => state.settings.apiTokens);
  const { accentColor, setAccentColor, theme, toggleTheme } = useTheme();

  useEffect(() => {
    void dispatch(fetchPreferences());
    void dispatch(fetchAgentMemory());
    void dispatch(fetchApiTokens());
  }, [dispatch]);

  const preferencesLoading = preferences.status === "idle" || preferences.status === "loading";
  const agentMemoryLoading = agentMemory.status === "idle" || agentMemory.status === "loading";
  const apiTokensLoading = apiTokens.status === "idle" || apiTokens.status === "loading";

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>

      <div className="settings-page__sections">
        {/* HEL-728: accent moves here from the UserMenu popover -- a persisted,
            infrequently-changed preference belongs alongside Preferences, not
            behind a quick top-bar affordance. Immediate-apply (no Save button)
            is preserved unchanged via the same useTheme() setAccentColor the
            command bar already uses. HEL-745: the light/dark theme toggle
            moves here too, from a standalone CommandBar icon button -- same
            immediate-apply, no-Save-button semantics via the same useTheme()
            call, just relocated. Label/aria-label/title copy matches the
            pre-F-082 UserMenu dropdown row this replaces. */}
        <section className="settings-page__section">
          <h2 className="settings-page__section-heading">Appearance</h2>
          <AccentPicker accentColor={accentColor} setAccentColor={setAccentColor} />
          <button
            type="button"
            className="settings-page__theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </section>

        <section className="settings-page__section">
          <h2 className="settings-page__section-heading">Preferences</h2>
          {preferencesLoading && (
            <p className="settings-page__loading" aria-label="Loading preferences">
              Loading preferences…
            </p>
          )}
          {!preferencesLoading && preferences.error && (
            <p className="settings-page__error" role="alert">
              {preferences.error}
            </p>
          )}
          {!preferencesLoading && !preferences.error && preferences.data !== null && (
            <PreferencesEditor preferences={preferences.data} />
          )}
        </section>

        <section className="settings-page__section">
          <h2 className="settings-page__section-heading">Agent memory</h2>
          {agentMemoryLoading && (
            <p className="settings-page__loading" aria-label="Loading agent memory">
              Loading agent memory…
            </p>
          )}
          {!agentMemoryLoading && agentMemory.error && (
            <p className="settings-page__error" role="alert">
              {agentMemory.error}
            </p>
          )}
          {!agentMemoryLoading && !agentMemory.error && (
            <AgentMemoryList entries={agentMemory.items} />
          )}
        </section>

        {/* HEL-702 design.md D7: `MfaSecuritySection` owns its own
            fetch/loading/error state independently of the F-047 per-section
            gates above -- no reason to block rendering Security on the
            unrelated preferences/agent-memory fetches. */}
        <section className="settings-page__section">
          <h2 className="settings-page__section-heading">Security</h2>
          <MfaSecuritySection />
        </section>

        {/* HEL-727: `apiTokens` follows the F-047 own-loading/error-gate
            pattern (Preferences/Agent memory above), fetched from this
            page's own useEffect -- unlike `MfaSecuritySection`, which owns
            its fetch internally. */}
        <section className="settings-page__section">
          <h2 className="settings-page__section-heading">Personal access tokens</h2>
          {apiTokensLoading && (
            <p className="settings-page__loading" aria-label="Loading personal access tokens">
              Loading personal access tokens…
            </p>
          )}
          {!apiTokensLoading && apiTokens.error && (
            <p className="settings-page__error" role="alert">
              {apiTokens.error}
            </p>
          )}
          {!apiTokensLoading && !apiTokens.error && <ApiTokensSection tokens={apiTokens.items} />}
        </section>

        <section className="settings-page__section">
          <h2 className="settings-page__section-heading">Beta access</h2>
          <BetaAccessSection />
        </section>
      </div>
    </div>
  );
}
