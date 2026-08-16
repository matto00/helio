// HEL-525 (420-D) task 4.2. The non-string `namingConventions` value test is
// the regression test for the round-1 skeptic finding (design.md Decision 2):
// a key whose fetched value isn't a JSON string must survive a save
// unchanged -- never dropped, never coerced to a string.

import { fireEvent, screen, waitFor } from "@testing-library/react";

import * as settingsService from "../services/settingsService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { AgentPreferences } from "../types/preferences";
import { PreferencesEditor } from "./PreferencesEditor";

jest.mock("../services/settingsService", () => ({
  putPreferences: jest.fn(),
}));

const putPreferencesMock = jest.mocked(settingsService.putPreferences);

const populatedPreferences: AgentPreferences = {
  defaultSeriesColors: ["#ff0000", "#00ff00"],
  defaultPanelStyle: {
    background: "#111111",
    color: "#eeeeee",
    transparency: 40,
    customLegacyKey: "keep-me",
  },
  namingConventions: {
    dashboardTitleCase: "kebab",
    titleCase: true,
  },
  extras: { favoriteChart: "bar" },
};

const emptyPreferences: AgentPreferences = {
  defaultSeriesColors: null,
  defaultPanelStyle: null,
  namingConventions: null,
  extras: {},
};

beforeEach(() => {
  putPreferencesMock.mockReset();
});

describe("PreferencesEditor — populated render", () => {
  it("displays stored defaultSeriesColors, defaultPanelStyle, and namingConventions", () => {
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    expect(screen.getByLabelText("Series color 1 hex value")).toHaveValue("#ff0000");
    expect(screen.getByLabelText("Series color 2 hex value")).toHaveValue("#00ff00");
    expect(screen.getByLabelText("Default panel background color")).toHaveValue("#111111");
    expect(screen.getByLabelText("Default panel text color")).toHaveValue("#eeeeee");
    expect(screen.getByLabelText("Default panel transparency")).toHaveValue("40");
    expect(screen.getByDisplayValue("dashboardTitleCase")).toBeInTheDocument();
    expect(screen.getByDisplayValue("kebab")).toBeInTheDocument();
    // Non-string valued key is never rendered as an editable row.
    expect(screen.queryByDisplayValue("titleCase")).not.toBeInTheDocument();
  });
});

describe("PreferencesEditor — empty render", () => {
  it("renders empty/default field values, not an error, when nothing is stored", () => {
    renderWithStore(<PreferencesEditor preferences={emptyPreferences} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Default panel background color")).toHaveValue("#1c1c1c");
    expect(screen.getByLabelText("Default panel text color")).toHaveValue("#ffffff");
    expect(screen.getByLabelText("Default panel transparency")).toHaveValue("0");
    expect(screen.getByText("No naming conventions set.")).toBeInTheDocument();
  });
});

describe("PreferencesEditor — edit + save", () => {
  it("persists an edited defaultSeriesColors swatch on save", async () => {
    putPreferencesMock.mockResolvedValueOnce(populatedPreferences);
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    fireEvent.change(screen.getByLabelText("Series color 1 hex value"), {
      target: { value: "#123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(putPreferencesMock).toHaveBeenCalledTimes(1));
    expect(putPreferencesMock.mock.calls[0][0].defaultSeriesColors).toEqual(["#123456", "#00ff00"]);
  });

  it("preserves extras and unedited defaultPanelStyle keys on save", async () => {
    putPreferencesMock.mockResolvedValueOnce(populatedPreferences);
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(putPreferencesMock).toHaveBeenCalledTimes(1));
    const request = putPreferencesMock.mock.calls[0][0];
    expect(request.extras).toEqual({ favoriteChart: "bar" });
    expect(request.defaultPanelStyle).toEqual(
      expect.objectContaining({ customLegacyKey: "keep-me" }),
    );
  });

  it("preserves a non-string namingConventions value unchanged across an edit-and-save cycle", async () => {
    putPreferencesMock.mockResolvedValueOnce(populatedPreferences);
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    // Edit an unrelated, string-valued field to exercise a real "edit" before saving.
    fireEvent.change(screen.getByLabelText("Default panel background color"), {
      target: { value: "#654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(putPreferencesMock).toHaveBeenCalledTimes(1));
    const request = putPreferencesMock.mock.calls[0][0];
    // Neither dropped nor coerced to a string.
    expect(request.namingConventions).toEqual(expect.objectContaining({ titleCase: true }));
  });

  it("shows an error and keeps in-progress edits when save fails", async () => {
    putPreferencesMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    fireEvent.change(screen.getByLabelText("Series color 1 hex value"), {
      target: { value: "#123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() =>
      expect(screen.getByText("Failed to save preferences.")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Series color 1 hex value")).toHaveValue("#123456");
  });
});
