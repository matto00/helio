// HEL-1388 -- Kind is fixed once an Output exists (`UpdateOutputRequest` has no `kind`), so the
// edit-mode Kind select is disabled with a visible, AT-exposed reason; create mode is unchanged.

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Output } from "../../types/output";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

const REASON =
  "An Output's kind can't be changed after it's created. Create a new Output for a different kind.";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  http.get.mockImplementation((url: string) => {
    if (url.endsWith("/panels")) return Promise.resolve({ data: [] });
    if (url.includes("/capabilities")) {
      return Promise.resolve({ data: { columns: [], capabilities: {} } });
    }
    return Promise.resolve({
      data: {
        rows: [],
        rowCount: 0,
        stepRowCounts: {},
        sourceRowCount: 0,
        blocked: false,
        sourceTruncated: false,
        truncatedReads: [],
      },
    });
  });
});

const STORED: Output = {
  id: "o-1",
  pipelineId: "p-1",
  nodeStepId: "step-1",
  ownerId: "u-1",
  name: "Out",
  kind: "chart",
  config: {},
  schema: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderSheet(output: Output | null) {
  const store = configureStore({ reducer: { outputs: outputsReducer } });
  render(
    <MemoryRouter>
      <Provider store={store}>
        <OutputEditorSheet
          open
          onClose={jest.fn()}
          pipelineId="p-1"
          output={output}
          createTargetStepId="step-1"
          steps={[]}
        />
      </Provider>
    </MemoryRouter>,
  );
}

describe("OutputEditorSheet -- Kind is locked in edit mode (HEL-1388)", () => {
  it("renders Kind disabled with the stored label and the reason as its accessible description", async () => {
    renderSheet(STORED);
    const kind = await screen.findByRole("combobox", { name: "Output kind" });
    expect(kind).toBeDisabled();
    expect(kind).toHaveTextContent("Chart");
    expect(screen.getByText(REASON)).toBeVisible();
    expect(kind).toHaveAccessibleDescription(REASON);
  });

  // `@testing-library/user-event` is not a dependency (see PanelCard.test.tsx), so there is no
  // `userEvent.tab()` walk: instead assert native `disabled` (what removes a control from the
  // browser tab order) and that jsdom refuses focus() on it -- a disabled button cannot take focus.
  it("opens no listbox on click/keyboard and cannot take focus", async () => {
    renderSheet(STORED);
    const kind = await screen.findByRole("combobox", { name: "Output kind" });
    expect(kind).toBeDisabled();
    act(() => kind.focus());
    expect(kind).not.toHaveFocus();
    fireEvent.click(kind);
    fireEvent.keyDown(kind, { key: "Enter" });
    fireEvent.keyDown(kind, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("OutputEditorSheet -- Kind stays switchable in create mode (HEL-1388)", () => {
  it("is enabled, has no reason, and selecting Table swaps the option group", async () => {
    renderSheet(null);
    const kind = await screen.findByRole("combobox", { name: "Output kind" });
    expect(kind).toBeEnabled();
    expect(kind).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();

    fireEvent.click(kind);
    const listbox = await screen.findByRole("listbox");
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("option", { name: "Table" }));
    });
    expect(kind).toHaveTextContent("Table");
    expect(screen.queryByText("Chart type")).not.toBeInTheDocument();
  });
});
