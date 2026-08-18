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

// HEL-718: the remove-row buttons migrated from a hand-rolled
// `.preferences-editor__icon-btn` onto the shared `IconButton` primitive —
// verifies the accessible name/tooltip pairing and click behavior survived
// the migration.
describe("PreferencesEditor — remove-row IconButtons", () => {
  it("renders the series-color remove button with a matching aria-label and title, and removes the row on click", () => {
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    const removeBtn = screen.getByRole("button", { name: "Remove series color 1" });
    expect(removeBtn).toHaveAttribute("title", "Remove series color 1");

    fireEvent.click(removeBtn);

    expect(screen.queryByLabelText("Series color 2 hex value")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Series color 1 hex value")).toHaveValue("#00ff00");
  });

  it("renders the naming-convention remove button with a matching aria-label and title, and removes the row on click", () => {
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    const removeBtn = screen.getByRole("button", {
      name: "Remove naming convention dashboardTitleCase",
    });
    expect(removeBtn).toHaveAttribute("title", "Remove naming convention dashboardTitleCase");

    fireEvent.click(removeBtn);

    expect(screen.queryByDisplayValue("dashboardTitleCase")).not.toBeInTheDocument();
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

  // F-150 (UI sweep): a successful save previously gave no positive feedback
  // beyond the button label reverting -- indistinguishable from the pre-save
  // idle state.
  it("shows an inline 'Preferences saved' confirmation after a successful save, and clears it on the next edit", async () => {
    putPreferencesMock.mockResolvedValueOnce(populatedPreferences);
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    expect(screen.queryByText("Preferences saved.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(screen.getByText("Preferences saved.")).toBeInTheDocument());

    // Editing again must retract the (now-stale) confirmation.
    fireEvent.change(screen.getByLabelText("Series color 1 hex value"), {
      target: { value: "#123456" },
    });
    expect(screen.queryByText("Preferences saved.")).not.toBeInTheDocument();
  });

  it("does not show the saved confirmation when a save fails", async () => {
    putPreferencesMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() =>
      expect(screen.getByText("Failed to save preferences.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Preferences saved.")).not.toBeInTheDocument();
  });
});

// F-152 (UI sweep): two Naming-convention rows sharing a trimmed key silently
// collapsed to whichever came last on save (`Object.fromEntries`), discarding
// the earlier row's value with no warning.
describe("PreferencesEditor — duplicate naming-convention keys", () => {
  it("warns live and blocks Save while two rows share the same trimmed key", () => {
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    fireEvent.click(screen.getByRole("button", { name: "Add naming convention" }));
    const keyFields = screen.getAllByLabelText("Naming convention key");
    // populatedPreferences already has one string row ("dashboardTitleCase");
    // rename the newly-added row to collide with it.
    fireEvent.change(keyFields[keyFields.length - 1], {
      target: { value: "dashboardTitleCase" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Duplicate key: dashboardTitleCase");
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled();
  });

  it("never calls putPreferences while a duplicate key is present, and re-enables Save once resolved", async () => {
    putPreferencesMock.mockResolvedValueOnce(populatedPreferences);
    renderWithStore(<PreferencesEditor preferences={populatedPreferences} />);

    fireEvent.click(screen.getByRole("button", { name: "Add naming convention" }));
    const keyFields = screen.getAllByLabelText("Naming convention key");
    fireEvent.change(keyFields[keyFields.length - 1], {
      target: { value: "dashboardTitleCase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(putPreferencesMock).not.toHaveBeenCalled();

    // Rename the new row's key so it's unique again.
    fireEvent.change(screen.getAllByLabelText("Naming convention key")[keyFields.length - 1], {
      target: { value: "uniqueKey" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save preferences" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(putPreferencesMock).toHaveBeenCalledTimes(1));
  });
});
