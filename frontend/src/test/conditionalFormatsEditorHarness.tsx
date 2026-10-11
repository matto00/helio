// HEL-1307: shared harness that mounts the REAL Output editor sheet (edit mode) for the conditionalFormats
// editor tests and the seam test. Test-only.
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../services/httpClient";
import { outputsReducer } from "../features/pipelines/state/outputsSlice";
import { OutputEditorSheet } from "../features/pipelines/ui/outputEditor/OutputEditorSheet";
import type { Output } from "../features/pipelines/types/output";

jest.mock("../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
export const http = jest.mocked(httpClient);

export const COLUMNS = ["id", "status", "pass_rate", "duration_s", "amount"];
export const PREVIEW_ROWS = [{ id: "1", status: "failed", pass_rate: "0.5", amount: 42 }];

export function setupEditorMocks(): void {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  const result = {
    columns: COLUMNS.map((name) => ({ name, dataType: "string", nullable: false })),
    capabilities: {},
    rows: PREVIEW_ROWS,
    rowCount: PREVIEW_ROWS.length,
    stepRowCounts: {},
    sourceRowCount: PREVIEW_ROWS.length,
    blocked: false,
    sourceTruncated: false,
    truncatedReads: [],
  };
  http.get.mockImplementation((url: string) =>
    url.endsWith("/panels") ? Promise.resolve({ data: [] }) : Promise.resolve({ data: result }),
  );
  http.post.mockResolvedValue({ data: { outputs: [{ outputId: "o-1", preview: result }] } });
  http.patch.mockResolvedValue({
    data: { id: "o-1", pipelineId: "p-1", kind: "metric", name: "n", config: {}, schema: [] },
  });
}

export function outputOf(kind: string, config: Record<string, unknown>): Output {
  return {
    id: "o-1",
    pipelineId: "p-1",
    nodeStepId: "step-1",
    ownerId: "u-1",
    name: "CI",
    kind,
    config,
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

export function renderSheet(output: Output) {
  render(
    <MemoryRouter>
      <Provider store={configureStore({ reducer: { outputs: outputsReducer } })}>
        <OutputEditorSheet open onClose={jest.fn()} pipelineId="p-1" output={output} steps={[]} />
      </Provider>
    </MemoryRouter>,
  );
}

/** The PATCH body's `config` (empty when the sheet sent none). */
export async function save(): Promise<Record<string, unknown>> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  await waitFor(() => expect(http.patch).toHaveBeenCalled());
  return (http.patch.mock.calls[0][1] as { config?: Record<string, unknown> }).config ?? {};
}

export async function choose(comboboxName: string, optionLabel: string): Promise<void> {
  fireEvent.click(await screen.findByRole("combobox", { name: comboboxName }));
  const listbox = await screen.findByRole("listbox");
  await act(async () => {
    fireEvent.click(within(listbox).getByRole("option", { name: optionLabel }));
  });
}

export async function type(label: string, value: string): Promise<void> {
  const input = await screen.findByLabelText(label);
  fireEvent.change(input, { target: { value } });
}

const OP_LABEL: Record<string, string> = {
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  eq: "equals",
  neq: "does not equal",
};
const TONE_LABEL: Record<string, string> = {
  success: "Good",
  warning: "Warning",
  error: "Critical",
};

/** Drives the editor UI to add one rule from its wire shape (rule number `n`, 1-based). */
export async function addRuleThroughUi(n: number, rule: Record<string, unknown>): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
  await choose(`Rule ${n} condition`, OP_LABEL[rule.op as string]);
  await type(`Rule ${n} ${rule.op === "between" ? "from" : "value"}`, String(rule.value));
  if (rule.value2 !== undefined) await type(`Rule ${n} to`, String(rule.value2));
  await choose(`Rule ${n} colour`, TONE_LABEL[rule.tone as string]);
  if (rule.label !== undefined) await type(`Rule ${n} label`, String(rule.label));
  if (rule.column !== undefined) await choose(`Rule ${n} column`, String(rule.column));
  if (rule.target === "row") await choose(`Rule ${n} applies to`, "Whole row");
}
