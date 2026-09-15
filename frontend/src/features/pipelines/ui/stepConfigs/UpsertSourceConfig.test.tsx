// UpsertSourceConfig.test.tsx — HEL-1102 tasks 2.1/2.2. Covers design.md
// Decisions 2-5: no default target selection, the owner-enabled /
// non-owner-disabled existing-dataset option, and the append/replace mode's
// ConfirmInline gating.

import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { UpsertSourceConfig, type UpsertSourceConfigValue } from "./UpsertSourceConfig";
import type { DataSource } from "../../../sources/types/dataSource";

const DATASET_SOURCE: DataSource = {
  id: "ds-1",
  name: "Enriched users",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  inferredSchema: [],
  type: "dataset",
};

const CSV_SOURCE: DataSource = {
  id: "ds-2",
  name: "Raw CSV",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  inferredSchema: [],
  type: "csv",
  config: { path: "/tmp/x.csv" },
};

function renderConfig(
  config: UpsertSourceConfigValue,
  overrides: { isOwner?: boolean; saveError?: string | null; onChange?: jest.Mock } = {},
) {
  const onChange = overrides.onChange ?? jest.fn();
  renderWithStore(
    <UpsertSourceConfig
      config={config}
      isOwner={overrides.isOwner ?? true}
      saveError={overrides.saveError ?? null}
      onChange={onChange}
    />,
    { sources: { items: [DATASET_SOURCE, CSV_SOURCE] } },
  );
  return onChange;
}

describe("UpsertSourceConfig — target picker (design.md Decision 3)", () => {
  it("shows no pre-selected target when the step's config has no target yet", () => {
    renderConfig({ mode: "append" });
    expect(screen.getByLabelText("Use existing dataset")).not.toBeChecked();
    expect(screen.getByLabelText("Create new source")).not.toBeChecked();
    expect(screen.queryByLabelText("Existing dataset")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New source name")).not.toBeInTheDocument();
  });

  // evaluation-1.md CR1: this is the REAL shape a freshly-added step round-trips as once it
  // hits the real backend -- `UpsertSourceConfig.decode`'s tolerant-absent-target default is
  // `ExistingSource("")`, never a truly-absent `target` key, and live-reproducing this against
  // the running dev app showed "Use existing dataset" silently pre-checked with no dataset
  // actually selected below it (exactly the HEL-386/620 picker-empty-default defect).
  it("shows no pre-selected target for the backend's own round-trip sentinel (existingSource with empty dataSourceId)", () => {
    renderConfig({ mode: "append", target: { kind: "existingSource", dataSourceId: "" } });
    expect(screen.getByLabelText("Use existing dataset")).not.toBeChecked();
    expect(screen.getByLabelText("Create new source")).not.toBeChecked();
    expect(screen.queryByLabelText("Existing dataset")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New source name")).not.toBeInTheDocument();
  });

  it("the owner can select and pick an existing dataset (only dataset-kind sources listed)", () => {
    const onChange = renderConfig({ mode: "append" }, { isOwner: true });
    fireEvent.click(screen.getByLabelText("Use existing dataset"));

    const select = screen.getByRole("combobox", { name: "Existing dataset" });
    expect(select).toBeInTheDocument();
    // Only the dataset-kind source appears (isStaticSource filter) — the CSV source doesn't.
    fireEvent.click(select);
    expect(screen.getByRole("option", { name: "Enriched users" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Raw CSV" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "Enriched users" }));
    expect(onChange).toHaveBeenCalledWith({
      mode: "append",
      target: { kind: "existingSource", dataSourceId: "ds-1" },
    });
  });

  it("disables the existing-dataset option for a non-owner editor grantee, with an inline explanation", () => {
    renderConfig({ mode: "append" }, { isOwner: false });
    expect(screen.getByLabelText("Use existing dataset")).toBeDisabled();
    expect(screen.getByLabelText("Create new source")).not.toBeDisabled();
    expect(
      screen.getByText(/only the pipeline owner can target an existing dataset/i),
    ).toBeInTheDocument();
  });

  it("typing a new-source name emits the newSource target", () => {
    const onChange = renderConfig({ mode: "append" });
    fireEvent.click(screen.getByLabelText("Create new source"));
    fireEvent.change(screen.getByLabelText("New source name"), {
      target: { value: "enriched_users" },
    });
    expect(onChange).toHaveBeenCalledWith({
      mode: "append",
      target: { kind: "newSource", name: "enriched_users" },
    });
  });
});

describe("UpsertSourceConfig — multiple cards on one page (evaluation change request 1)", () => {
  // Two `UpsertSourceConfig` cards on the same pipeline detail page must not
  // share a browser-level radio group — otherwise selecting one card's radio
  // silently unchecks the other card's already-committed selection. This
  // must fail against a shared constant `name` (verified by mutation).
  it("keeps each card's selected radio checked independently of the other card's selection", () => {
    renderWithStore(
      <>
        <UpsertSourceConfig
          config={{ mode: "append", target: { kind: "newSource", name: "a" } }}
          isOwner
          saveError={null}
          onChange={jest.fn()}
        />
        <UpsertSourceConfig
          config={{ mode: "append", target: { kind: "existingSource", dataSourceId: "ds-1" } }}
          isOwner
          saveError={null}
          onChange={jest.fn()}
        />
      </>,
      { sources: { items: [DATASET_SOURCE, CSV_SOURCE] } },
    );

    const newSourceRadios = screen.getAllByLabelText("Create new source");
    const existingDatasetRadios = screen.getAllByLabelText("Use existing dataset");
    expect(newSourceRadios[0]).toBeChecked();
    expect(existingDatasetRadios[1]).toBeChecked();
  });
});

describe("UpsertSourceConfig — mode toggle (design.md Decision 5)", () => {
  it("a freshly seeded step shows append selected", () => {
    renderConfig({ mode: "append" });
    expect(screen.getByLabelText("Mode")).toHaveTextContent(/append/i);
  });

  it("selecting replace shows a confirmation before persisting, and the control still shows append", () => {
    const onChange = renderConfig({ mode: "append" });
    fireEvent.click(screen.getByLabelText("Mode"));
    fireEvent.click(screen.getByText(/replace — overwrite/i));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Mode")).toHaveTextContent(/append/i);
  });

  it("confirming the replace prompt commits mode:'replace'", () => {
    const onChange = renderConfig({ mode: "append" });
    fireEvent.click(screen.getByLabelText("Mode"));
    fireEvent.click(screen.getByText(/replace — overwrite/i));
    fireEvent.click(screen.getByText("Switch to replace"));

    expect(onChange).toHaveBeenCalledWith({ mode: "replace" });
  });

  it("canceling the replace prompt reverts to the last committed mode with no PATCH", () => {
    const onChange = renderConfig({ mode: "append" });
    fireEvent.click(screen.getByLabelText("Mode"));
    fireEvent.click(screen.getByText(/replace — overwrite/i));
    fireEvent.click(screen.getByText("Cancel"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/can't be undone/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Mode")).toHaveTextContent(/append/i);
  });

  it("loading an already-replace step shows replace selected with no confirmation prompt", () => {
    renderConfig({ mode: "replace" });
    expect(screen.getByLabelText("Mode")).toHaveTextContent(/replace/i);
    expect(screen.queryByText(/can't be undone/i)).not.toBeInTheDocument();
  });

  it("switching from replace to append commits immediately, with no confirmation", () => {
    const onChange = renderConfig({ mode: "replace" });
    fireEvent.click(screen.getByLabelText("Mode"));
    fireEvent.click(screen.getByText(/append — add rows/i));

    expect(onChange).toHaveBeenCalledWith({ mode: "append" });
    expect(screen.queryByText(/can't be undone/i)).not.toBeInTheDocument();
  });
});

describe("UpsertSourceConfig — save error (design.md Decision 6)", () => {
  it("renders the backend rejection message inline", () => {
    renderConfig(
      { mode: "append", target: { kind: "existingSource", dataSourceId: "ds-1" } },
      { saveError: "Data source not found: ds-1" },
    );
    expect(screen.getByText("Data source not found: ds-1")).toBeInTheDocument();
  });

  it("renders nothing extra when there is no save error", () => {
    renderConfig({ mode: "append" }, { saveError: null });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
