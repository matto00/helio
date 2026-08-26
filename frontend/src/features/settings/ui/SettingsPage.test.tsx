// HEL-525 (420-D) task 4.4 -- loading/error states, and that both child
// sections (PreferencesEditor, AgentMemoryList) render once their fetches
// succeed. Mirrors `PipelinesPage.test.tsx`'s fetch-on-mount test shape.
//
// F-047 (UI sweep) regression coverage: Preferences and Agent memory each
// gate on their own status independently -- one section's failure/loading
// must never blank a sibling section that has already succeeded.

import { fireEvent, screen, waitFor } from "@testing-library/react";

import * as settingsService from "../services/settingsService";
// HEL-702: `MfaSecuritySection` (mounted unconditionally by `SettingsPage`
// once its own fetches succeed) dispatches `fetchMfaStatus` on mount, which
// calls the real `authService.mfaStatusRequest` unless mocked here too --
// matching this file's existing house pattern of mocking every service call
// a mounted page/section makes, so no test attempts a real network request.
import * as authService from "../../auth/services/authService";
// HEL-727: `apiTokenService.listApiTokens` is called by the page's own
// `fetchApiTokens` on mount (F-047 own-fetch pattern, same as
// preferences/agent memory) -- mocked here for the same reason.
import * as apiTokenService from "../services/apiTokenService";
// HEL-488: `AuditHistorySection` (mounted unconditionally by `SettingsPage`)
// dispatches `fetchAuditEvents` on mount, same reason as the mocks above.
import * as auditEventService from "../../audit/services/auditEventService";
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

jest.mock("../services/apiTokenService", () => ({
  listApiTokens: jest.fn(),
  createApiToken: jest.fn(),
  revokeApiToken: jest.fn(),
}));

jest.mock("../../audit/services/auditEventService", () => ({
  fetchAuditEvents: jest.fn(),
}));

const getPreferencesMock = jest.mocked(settingsService.getPreferences);
const listAgentMemoryMock = jest.mocked(settingsService.listAgentMemory);
const mfaStatusRequestMock = jest.mocked(authService.mfaStatusRequest);
const listApiTokensMock = jest.mocked(apiTokenService.listApiTokens);
const fetchAuditEventsMock = jest.mocked(auditEventService.fetchAuditEvents);

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
  listApiTokensMock.mockReset();
  listApiTokensMock.mockResolvedValue([]);
  fetchAuditEventsMock.mockReset();
  fetchAuditEventsMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 200 });
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

  // HEL-728: accent moved here from the UserMenu popover -- verify the
  // Appearance section renders independently of the Preferences/Agent-memory
  // fetches (it reads accent from useTheme(), not from either fetch) and
  // that selecting a swatch applies immediately, the same behavior
  // AccentPicker.test.tsx already covers for the picker in isolation.
  it("renders an Appearance section with the accent picker, current color selected", () => {
    getPreferencesMock.mockReturnValueOnce(new Promise(() => {}));
    listAgentMemoryMock.mockReturnValueOnce(new Promise(() => {}));
    renderWithStore(<SettingsPage />);

    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Accent color presets" })).toBeInTheDocument();
    // ThemeProvider's default (dark theme, no stored preference) is Orange.
    expect(screen.getByRole("button", { name: "Orange" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking an accent swatch in Appearance applies immediately, without a Save preferences click", () => {
    getPreferencesMock.mockReturnValueOnce(new Promise(() => {}));
    listAgentMemoryMock.mockReturnValueOnce(new Promise(() => {}));
    renderWithStore(<SettingsPage />);

    const blueSwatch = screen.getByRole("button", { name: "Blue" });
    expect(blueSwatch).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(blueSwatch);

    // Immediate-apply: the swatch reflects the new selection and the CSS
    // token is written to :root right away -- no "Save preferences" button
    // exists for this section, and none is clicked here.
    expect(blueSwatch).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.style.getPropertyValue("--app-accent")).toBe("#3b82f6");
  });

  // HEL-745: moved from App.test.tsx's "toggles theme from the top-bar toggle
  // button" -- the theme toggle relocated from a standalone CommandBar icon
  // button to here, next to the accent picker, with the same immediate-apply
  // (no Save button) semantics the accent-swatch test above already covers.
  it("toggles theme from the Appearance section's theme button", async () => {
    getPreferencesMock.mockReturnValueOnce(new Promise(() => {}));
    listAgentMemoryMock.mockReturnValueOnce(new Promise(() => {}));
    renderWithStore(<SettingsPage />);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    // HEL-718: the removed CommandBar toggle carried a visible tooltip
    // alongside its accessible name; the relocated Settings button preserves
    // both.
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute(
      "title",
      "Switch to light theme",
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(window.localStorage.getItem("helio-theme")).toBe("light");
  });

  // HEL-727: `apiTokens` follows the F-047 own-fetch-on-mount pattern
  // (Preferences/Agent memory above), dispatched from the page's own
  // useEffect -- verify it actually fires and the section renders once it
  // resolves.
  it("renders a Personal access tokens section and fetches tokens on mount", async () => {
    getPreferencesMock.mockReturnValueOnce(new Promise(() => {}));
    listAgentMemoryMock.mockReturnValueOnce(new Promise(() => {}));
    listApiTokensMock.mockResolvedValueOnce([
      {
        id: "tok-1",
        name: "helio-mcp",
        createdAt: "2026-08-01T00:00:00Z",
        lastUsedAt: null,
        expiresAt: null,
      },
    ]);
    renderWithStore(<SettingsPage />);

    expect(screen.getByText("Personal access tokens")).toBeInTheDocument();
    await waitFor(() => expect(listApiTokensMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("helio-mcp")).toBeInTheDocument());
    expect(screen.queryByLabelText("Loading personal access tokens")).not.toBeInTheDocument();
  });

  it("shows an error for Personal access tokens without blanking the other sections", async () => {
    getPreferencesMock.mockResolvedValueOnce(testPreferences);
    listAgentMemoryMock.mockResolvedValueOnce([]);
    listApiTokensMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByText("Failed to load personal access tokens.")).toBeInTheDocument(),
    );
    // Preferences' own fetch succeeded -- it must still render.
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeInTheDocument();
  });
});
