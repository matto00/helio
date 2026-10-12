// AddRootModal.test.tsx — HEL-968 task 8.4 (design.md D4, HEL-620 regression
// guard). Both guards are exercised: the confirm control is disabled while
// no source is selected, AND selecting a source then submitting calls
// `onAdd` with exactly that id -- never with an empty/unset one.

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithStore } from "../../../test/renderWithStore";
import { AddRootModal } from "./AddRootModal";
import { fetchSources as fetchSourcesRequest } from "../../sources/services/dataSourceService";
import type { DataSource } from "../../sources/types/dataSource";
import {
  expectDistinctNonEmptyLabelIds,
  expectLabelTargetsControl,
  labelsWithText,
} from "../../../test/labelAssociation";

jest.mock("../../sources/services/dataSourceService", () => ({
  fetchSources: jest.fn(),
}));

const fetchSourcesMock = jest.mocked(fetchSourcesRequest);

const testDataSources: DataSource[] = [
  {
    id: "src-1",
    name: "Orders",
    type: "rest_api",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    inferredSchema: [],
    config: { url: "https://example.com/api" },
  },
];

function renderModal(onAdd = jest.fn(), onClose = jest.fn()) {
  return {
    onAdd,
    onClose,
    ...renderWithStore(<AddRootModal onAdd={onAdd} onClose={onClose} />, {
      sources: { items: testDataSources, status: "succeeded" },
    }),
  };
}

describe("AddRootModal", () => {
  beforeEach(() => {
    fetchSourcesMock.mockReset();
    fetchSourcesMock.mockResolvedValue(testDataSources);
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  it("disables 'Add source' while no source is selected", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Add source" })).toBeDisabled();
  });

  // HEL-620 regression guard — assert on the SERVICE SPY (`onAdd`), not the
  // button's disabled attribute: a disabled control is the affordance, not
  // the invariant.
  it("never calls onAdd while no source is selected, even if the disabled control is clicked", () => {
    const { onAdd } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("calls onAdd with the selected source's id once one is picked", () => {
    const { onAdd } = renderModal();
    fireEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    fireEvent.click(screen.getByRole("option", { name: /^Orders/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(onAdd).toHaveBeenCalledWith("src-1");
  });

  // HEL-1464 — the visible label must target its combobox (its literal `htmlFor="add-root-source"`
  // pointed at no element), and nothing may dangle when the picker is not rendered.
  describe("label association (HEL-1464)", () => {
    it("the Data source label targets the data source combobox", () => {
      renderModal();
      expectLabelTargetsControl("Data source", "combobox", "Data source");
    });

    it("two mounted modals never share the label target id", () => {
      renderModal();
      renderModal();
      expectDistinctNonEmptyLabelIds("Data source");
    });

    it("D3a: the Data source label has no `for` when no sources exist (picker not rendered)", async () => {
      fetchSourcesMock.mockResolvedValue([]);
      renderWithStore(<AddRootModal onAdd={jest.fn()} onClose={jest.fn()} />, {
        sources: { items: [], status: "succeeded" },
      });
      await waitFor(() =>
        expect(screen.queryByRole("combobox", { name: "Data source" })).not.toBeInTheDocument(),
      );
      const [label] = labelsWithText("Data source");
      expect(label.hasAttribute("for")).toBe(false);
    });
  });
});
