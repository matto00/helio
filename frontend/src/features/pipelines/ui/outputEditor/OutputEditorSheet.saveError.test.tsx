// HEL-1313 -- a rejected save (e.g. an unknown config key or a malformed aggregation, HTTP 400)
// shows the server's message, not a fixed "Failed to save output.".

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const OUTPUT: Output = {
  id: "o-1",
  pipelineId: "p-1",
  nodeStepId: "step-1",
  ownerId: "u-1",
  name: "Revenue",
  kind: "metric",
  config: { fieldMapping: {}, aggregation: { value: "amount", agg: "sum" } },
  schema: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  http.get.mockImplementation((url: string) =>
    url.endsWith("/panels")
      ? Promise.resolve({ data: [] })
      : Promise.resolve({
          data: {
            columns: [{ name: "amount", dataType: "number", nullable: false }],
            capabilities: {},
            rows: [],
            rowCount: 0,
            stepRowCounts: {},
            sourceRowCount: 0,
            blocked: false,
            sourceTruncated: false,
            truncatedReads: [],
          },
        }),
  );
});

function renderSheet() {
  const store = configureStore({ reducer: { outputs: outputsReducer } });
  render(
    <MemoryRouter>
      <Provider store={store}>
        <OutputEditorSheet
          open
          onClose={jest.fn()}
          pipelineId="p-1"
          output={OUTPUT}
          createTargetStepId="step-1"
          steps={[]}
        />
      </Provider>
    </MemoryRouter>,
  );
}

async function clickSave() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^(Save|Create)/ }));
  });
}

describe("OutputEditorSheet -- rejected save (HEL-1313)", () => {
  it("shows the server's message naming the rejected key", async () => {
    http.patch.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: "Unknown config key for a metric Output: `lable`" },
      },
    });
    renderSheet();
    await clickSave();
    await waitFor(() =>
      expect(
        screen.getByText("Unknown config key for a metric Output: `lable`"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Failed to save output.")).not.toBeInTheDocument();
  });

  it("falls back to the thunk's generic message when the failure carries no server message", async () => {
    http.patch.mockRejectedValue(new Error("network down"));
    renderSheet();
    await clickSave();
    await waitFor(() => expect(screen.getByText("Failed to update output.")).toBeInTheDocument());
  });
});
