// HEL-525 (420-D) task 4.4 -- loading/error states, and that both child
// sections (PreferencesEditor, AgentMemoryList) render once their fetches
// succeed. Mirrors `PipelinesPage.test.tsx`'s fetch-on-mount test shape.

import { screen, waitFor } from "@testing-library/react";

import * as settingsService from "../services/settingsService";
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

const getPreferencesMock = jest.mocked(settingsService.getPreferences);
const listAgentMemoryMock = jest.mocked(settingsService.listAgentMemory);

const testPreferences: AgentPreferences = {
  defaultSeriesColors: ["#ff0000"],
  defaultPanelStyle: null,
  namingConventions: null,
  extras: {},
};

beforeEach(() => {
  getPreferencesMock.mockReset();
  listAgentMemoryMock.mockReset();
});

describe("SettingsPage", () => {
  it("shows a loading indicator while fetches are in flight", () => {
    getPreferencesMock.mockReturnValueOnce(new Promise(() => {}));
    listAgentMemoryMock.mockReturnValueOnce(new Promise(() => {}));
    renderWithStore(<SettingsPage />);

    expect(screen.getByLabelText("Loading settings")).toBeInTheDocument();
  });

  it("shows an error when the preferences fetch fails", async () => {
    getPreferencesMock.mockRejectedValueOnce(new Error("network error"));
    listAgentMemoryMock.mockResolvedValueOnce([]);
    renderWithStore(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load preferences.");
  });

  it("shows an error when the agent memory fetch fails", async () => {
    getPreferencesMock.mockResolvedValueOnce(testPreferences);
    listAgentMemoryMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load agent memory.");
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
    expect(screen.queryByLabelText("Loading settings")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
