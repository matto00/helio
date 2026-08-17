// HEL-525 (420-D) task 4.4 -- loading/error states, and that both child
// sections (PreferencesEditor, AgentMemoryList) render once their fetches
// succeed. Mirrors `PipelinesPage.test.tsx`'s fetch-on-mount test shape.
//
// F-047 (UI sweep) regression coverage: Preferences and Agent memory each
// gate on their own status independently -- one section's failure/loading
// must never blank a sibling section that has already succeeded.

import { screen, waitFor } from "@testing-library/react";

import * as settingsService from "../services/settingsService";
// HEL-702: `MfaSecuritySection` (mounted unconditionally by `SettingsPage`
// once its own fetches succeed) dispatches `fetchMfaStatus` on mount, which
// calls the real `authService.mfaStatusRequest` unless mocked here too --
// matching this file's existing house pattern of mocking every service call
// a mounted page/section makes, so no test attempts a real network request.
import * as authService from "../../auth/services/authService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { AgentPreferences } from "../types/preferences";
import { SettingsPage } from "./SettingsPage";

jest.mock("../services/settingsService", () => ({
  getPreferences: jest.fn(),
  putPreferences: jest.fn(),
  listAgentMemory: jest.fn(),
  deleteAgentMemoryEntry: jest.fn(),
  clearAgentMemory: jest.fn(),
}));

jest.mock("../../auth/services/authService", () => ({
  mfaStatusRequest: jest.fn(),
}));

const getPreferencesMock = jest.mocked(settingsService.getPreferences);
const listAgentMemoryMock = jest.mocked(settingsService.listAgentMemory);
const mfaStatusRequestMock = jest.mocked(authService.mfaStatusRequest);

const testPreferences: AgentPreferences = {
  defaultSeriesColors: ["#ff0000"],
  defaultPanelStyle: null,
  namingConventions: null,
  extras: {},
};

beforeEach(() => {
  getPreferencesMock.mockReset();
  listAgentMemoryMock.mockReset();
  mfaStatusRequestMock.mockReset();
  mfaStatusRequestMock.mockResolvedValue({
    enabled: false,
    verifiedAt: null,
    backupCodesRemaining: 0,
  });
});

describe("SettingsPage", () => {
  it("shows a per-section loading indicator while fetches are in flight", () => {
    getPreferencesMock.mockReturnValueOnce(new Promise(() => {}));
    listAgentMemoryMock.mockReturnValueOnce(new Promise(() => {}));
    renderWithStore(<SettingsPage />);

    expect(screen.getByLabelText("Loading preferences")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading agent memory")).toBeInTheDocument();
  });

  it("shows an error for Preferences without blanking the other sections", async () => {
    getPreferencesMock.mockRejectedValueOnce(new Error("network error"));
    listAgentMemoryMock.mockResolvedValueOnce([
      {
        id: "mem-1",
        kind: "fact",
        content: "Prefers dark mode.",
        createdAt: "2026-08-01T00:00:00Z",
        lastUsedAt: null,
      },
    ]);
    renderWithStore(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load preferences.");
    // Agent memory's own fetch succeeded -- it must still render.
    expect(screen.getByText("Prefers dark mode.")).toBeInTheDocument();
    // Beta access depends on neither fetch -- it must still render too.
    expect(screen.getByText("Beta access")).toBeInTheDocument();
  });

  it("shows an error for Agent memory without blanking the other sections", async () => {
    getPreferencesMock.mockResolvedValueOnce(testPreferences);
    listAgentMemoryMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load agent memory.");
    // Preferences' own fetch succeeded -- it must still render.
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeInTheDocument();
  });

  it("renders both the preferences editor and the agent memory list once both fetches succeed", async () => {
    getPreferencesMock.mockResolvedValueOnce(testPreferences);
    listAgentMemoryMock.mockResolvedValueOnce([
      {
        id: "mem-1",
        kind: "fact",
        content: "Prefers dark mode.",
        createdAt: "2026-08-01T00:00:00Z",
        lastUsedAt: null,
      },
    ]);
    renderWithStore(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save preferences" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Prefers dark mode.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading preferences")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Loading agent memory")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
