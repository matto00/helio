// Settings page (`/settings`, HEL-525 / 420-D task 3.1) — the app's first
// settings surface. Fetch-on-mount for both preferences and agent memory;
// loading/error states follow `MetricsPage.tsx`'s shape, gated on both
// fetches together so `PreferencesEditor`/`AgentMemoryList` only ever mount
// once their backing data actually exists.

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

  const isLoading =
    preferences.status === "idle" ||
    preferences.status === "loading" ||
    agentMemory.status === "idle" ||
    agentMemory.status === "loading";
  const errors = [preferences.error, agentMemory.error].filter(
    (message): message is string => message !== null,
  );

  return (
    <div className="settings-page">
      <h1 className="settings-page__title">Settings</h1>

      {isLoading && (
        <p className="settings-page__loading" aria-label="Loading settings">
          Loading settings…
        </p>
      )}

      {!isLoading && errors.length > 0 && (
        <p className="settings-page__error" role="alert">
          {errors.join(" ")}
        </p>
      )}

      {!isLoading && errors.length === 0 && preferences.data !== null && (
        <div className="settings-page__sections">
          <section className="settings-page__section">
            <h2 className="settings-page__section-heading">Preferences</h2>
            <PreferencesEditor preferences={preferences.data} />
          </section>

          <section className="settings-page__section">
            <h2 className="settings-page__section-heading">Agent memory</h2>
            <AgentMemoryList entries={agentMemory.items} />
          </section>

          <section className="settings-page__section">
            <h2 className="settings-page__section-heading">Beta access</h2>
            <BetaAccessSection />
          </section>
        </div>
      )}
    </div>
  );
}
