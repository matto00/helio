// HEL-1510 -- a scatter chart's "Point size field" / "Color by field" pickers list the clear option
// ("— None —") exactly once on the Output editor path, and opening them logs no duplicate-key warning.
// Both pickers are opened for real: the listbox is portalled and only renders while open, so a
// render-only test would never see the duplicate `key=""`.

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Output } from "../../types/output";
import type { Step } from "../../types/step";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

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
      return Promise.resolve({
        data: {
          columns: [
            { name: "amount", dataType: "number", nullable: false },
            { name: "category", dataType: "string", nullable: false },
          ],
          capabilities: {},
        },
      });
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

const STEPS = [{ id: "step-1", name: "Step one", op: "filter" }] as unknown as Step[];

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
          steps={STEPS}
        />
      </Provider>
    </MemoryRouter>,
  );
}

async function openOptions(comboName: string): Promise<string[]> {
  fireEvent.click(await screen.findByRole("combobox", { name: comboName }));
  const listbox = await screen.findByRole("listbox");
  return within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
}

describe("OutputEditorSheet scatter field pickers (HEL-1510)", () => {
  it.each([["Scatter point size field"], ["Scatter color by field"]])(
    "%s lists '— None —' once, then each column once, with no duplicate-key warning",
    async (name) => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      try {
        renderSheet(null);
        fireEvent.click(await screen.findByRole("combobox", { name: "Chart type" }));
        await act(async () => {
          fireEvent.click(
            within(await screen.findByRole("listbox")).getByRole("option", { name: "Scatter" }),
          );
        });
        const labels = await openOptions(name);
        expect(labels.filter((l) => l === "— None —")).toHaveLength(1);
        expect(labels[0]).toBe("— None —");
        expect(labels.filter((l) => l === "amount")).toHaveLength(1);
        expect(labels.filter((l) => l === "category")).toHaveLength(1);
        const dupKey = errorSpy.mock.calls.filter((c) =>
          /same key|unique "key"/i.test(String(c[0])),
        );
        expect(dupKey).toEqual([]);
      } finally {
        errorSpy.mockRestore();
      }
    },
  );
});
