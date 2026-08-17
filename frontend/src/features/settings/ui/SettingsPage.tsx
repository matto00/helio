// Settings page (`/settings`, HEL-525 / 420-D task 3.1) — the app's first
// settings surface. Fetch-on-mount for both preferences and agent memory.
//
// F-047 (UI sweep): each section gates on its OWN loading/error state rather
// than a page-wide combined one. Beta access depends on neither fetch (it
// reads `state.auth.currentUser`) and always renders regardless of the other
// two sections' status. Previously a single failing fetch blanked the entire
// page, including sections with no dependency on it at all.

import { useEffect } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchAgentMemory, fetchPreferences } from "../state/settingsSlice";
import { AgentMemoryList } from "./AgentMemoryList";
import { BetaAccessSection } from "./BetaAccessSection";
import { PreferencesEditor } from "./PreferencesEditor";
import "./SettingsPage.css";

export function SettingsPage() {
  const dispatch = useAppDispatch();
  const preferences = useAppSelector((state) => state.settings.preferences);
  const agentMemory = useAppSelector((state) => state.settings.agentMemory);

  useEffect(() => {
    void dispatch(fetchPreferences());
    void dispatch(fetchAgentMemory());
  }, [dispatch]);

  const preferencesLoading = preferences.status === "idle" || preferences.status === "loading";
  const agentMemoryLoading = agentMemory.status === "idle" || agentMemory.status === "loading";

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>

      <div className="settings-page__sections">
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

        <section className="settings-page__section">
          <h2 className="settings-page__section-heading">Beta access</h2>
          <BetaAccessSection />
        </section>
      </div>
    </div>
  );
}
