// HEL-1784: a user who is not the FORM's owner (a dashboard editor, or the dashboard owner on an editor's form) cannot
// read the dataset's own schema, rows or aggregate. Their form loads the bound fields from the panel's own
// `form-schema` route, shows a counter's tally from their own clicks only, and never requests `/api/data-sources/*`.

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { readFileSync } from "fs";
import { resolve } from "path";

import { FormPanelView } from "./FormPanelView";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchFieldAggregate as fetchFieldAggregateRequest,
} from "../../../sources/services/dataSourceService";
import {
  fetchFormSchema as fetchFormSchemaRequest,
  submitFormPanel as submitFormPanelRequest,
} from "../../services/panelService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { testUser } from "../../../../test/tabsTestStore";
import type { FormPanelConfig } from "../../types/panel";
import type { DatasetSchemaResponse } from "../../../sources/types/dataSource";

jest.mock("../../../sources/services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
  fetchFieldAggregate: jest.fn(),
}));

jest.mock("../../services/panelService", () => ({
  fetchFormSchema: jest.fn(),
  submitFormPanel: jest.fn(),
  parseFieldErrors: jest.requireActual("../../services/panelService").parseFieldErrors,
}));

const fetchDatasetSchemaMock = jest.mocked(fetchDatasetSchemaRequest);
const fetchFieldAggregateMock = jest.mocked(fetchFieldAggregateRequest);
const fetchFormSchemaMock = jest.mocked(fetchFormSchemaRequest);
const submitFormPanelMock = jest.mocked(submitFormPanelRequest);

// The exact body the real route returns for a counter form, asserted byte-equal by FormSchemaRouteSpec.
const counterFormSchema = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../../../shared-test-fixtures/panels/form-schema-counter.json"),
    "utf8",
  ),
) as DatasetSchemaResponse;

const counterConfig: FormPanelConfig = {
  dataSourceId: "ds-2",
  fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
  submit: { writeMode: "append", resetOnSuccess: false },
};

const stackedConfig: FormPanelConfig = {
  dataSourceId: "ds-3",
  fields: [
    { sourceField: "note", control: "text", label: "Note" },
    { sourceField: "delta", control: "counter", label: "Delta" },
  ],
  submit: { writeMode: "append" },
};

const stackedSchema: DatasetSchemaResponse = {
  fields: [
    { name: "note", type: "string", required: false },
    { name: "delta", type: "integer", required: true },
  ],
};

const rowResponse = {
  rows: [{ id: "r1", updatedAt: "now" }],
  updatedAt: "now",
  deniedPipelines: [],
};

function definiteRejection(): AxiosError {
  return new AxiosError("Request failed", "400", undefined, undefined, {
    status: 400,
    statusText: "",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
    data: { message: "This form no longer matches its dataset. Ask its owner to update it." },
  });
}

const signedIn = { auth: { currentUser: testUser(undefined, "signed-in") } };

function renderNonOwner(config: FormPanelConfig, title = "Widgets", formOwnerId?: string) {
  return renderWithStore(
    <FormPanelView title={title} panelId="panel-9" config={config} formOwnerId={formOwnerId} />,
    signedIn,
  );
}

describe("FormPanelView for a user who is not the form's owner", () => {
  beforeEach(() => {
    fetchDatasetSchemaMock.mockReset();
    fetchFieldAggregateMock.mockReset();
    fetchFormSchemaMock.mockReset();
    submitFormPanelMock.mockReset();
  });

  it("loads the schema from the panel's form-schema route, never the dataset's own", async () => {
    fetchFormSchemaMock.mockResolvedValueOnce(stackedSchema);
    renderNonOwner(stackedConfig, "Stacked");
    await screen.findByRole("form", { name: "Stacked" });
    expect(fetchFormSchemaMock).toHaveBeenCalledWith("panel-9");
    expect(fetchDatasetSchemaMock).not.toHaveBeenCalled();
  });

  it("enables a compact counter fed the real route's body, and + submits its step", async () => {
    fetchFormSchemaMock.mockResolvedValueOnce(counterFormSchema);
    submitFormPanelMock.mockResolvedValue(rowResponse);
    renderNonOwner(counterConfig);
    const control = await screen.findByRole("spinbutton", { name: "Widgets" });
    expect(control).toHaveAttribute("aria-valuenow", "0");
    const plus = screen.getByRole("button", { name: /increase widgets/i });
    expect(plus).toBeEnabled();

    fireEvent.click(plus);

    await waitFor(() =>
      expect(submitFormPanelMock).toHaveBeenCalledWith("panel-9", { delta: 5 }, {}),
    );
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));
  });

  it("keeps a local tally of its own clicks and makes no /api/data-sources request", async () => {
    fetchFormSchemaMock.mockResolvedValueOnce(counterFormSchema);
    submitFormPanelMock.mockResolvedValue(rowResponse);
    renderNonOwner(counterConfig);
    const control = await screen.findByRole("spinbutton", { name: "Widgets" });

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));
    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "10"));
    fireEvent.click(screen.getByRole("button", { name: /decrease widgets/i }));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));

    expect(fetchFieldAggregateMock).not.toHaveBeenCalled();
    expect(fetchDatasetSchemaMock).not.toHaveBeenCalled();
  });

  it("rolls back that click's delta on a definite rejection", async () => {
    fetchFormSchemaMock.mockResolvedValueOnce(counterFormSchema);
    submitFormPanelMock.mockRejectedValueOnce(definiteRejection());
    renderNonOwner(counterConfig);
    const control = await screen.findByRole("spinbutton", { name: "Widgets" });

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() =>
      expect(document.querySelector(".form-panel-view__alert")).toHaveTextContent(
        /no longer matches its dataset/i,
      ),
    );
    expect(control).toHaveAttribute("aria-valuenow", "0");
    expect(fetchFieldAggregateMock).not.toHaveBeenCalled();
  });

  it("keeps the tally and announces it could not be confirmed on an indeterminate failure", async () => {
    fetchFormSchemaMock.mockResolvedValueOnce(counterFormSchema);
    submitFormPanelMock.mockRejectedValueOnce(new Error("Network Error"));
    renderNonOwner(counterConfig);
    const control = await screen.findByRole("spinbutton", { name: "Widgets" });

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() =>
      expect(document.querySelector(".form-panel-view__alert")).toHaveTextContent(
        /couldn't confirm the current value/i,
      ),
    );
    expect(control).toHaveAttribute("aria-valuenow", "5");
    expect(fetchFieldAggregateMock).not.toHaveBeenCalled();
  });

  it("submits a stacked counter + text form, whose schema omits occurred_at and value", async () => {
    fetchFormSchemaMock.mockResolvedValueOnce(stackedSchema);
    submitFormPanelMock.mockResolvedValue(rowResponse);
    renderNonOwner(stackedConfig, "Stacked");
    const form = await screen.findByRole("form", { name: "Stacked" });
    expect(form.querySelector("[aria-invalid='true']")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /increase delta/i }));
    fireEvent.click(screen.getByRole("button", { name: /increase delta/i }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(submitFormPanelMock).toHaveBeenCalledWith("panel-9", { note: "hi", delta: 2 }, {}),
    );
  });
});

describe("FormPanelView for the form's owner", () => {
  beforeEach(() => {
    fetchDatasetSchemaMock.mockReset();
    fetchFieldAggregateMock.mockReset();
    fetchFormSchemaMock.mockReset();
    submitFormPanelMock.mockReset();
  });

  it("still reads the dataset's own schema and reconciles a counter against its aggregate", async () => {
    fetchDatasetSchemaMock.mockResolvedValueOnce({
      fields: [
        { name: "delta", type: "integer", required: false },
        { name: "occurred_at", type: "timestamp", required: false },
        { name: "value", type: "integer", required: false },
      ],
    });
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 42 });
    submitFormPanelMock.mockResolvedValue(rowResponse);
    renderWithStore(
      <FormPanelView
        title="Widgets"
        panelId="panel-9"
        config={counterConfig}
        formOwnerId="signed-in"
      />,
      signedIn,
    );
    const control = await screen.findByRole("spinbutton", { name: "Widgets" });

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "42"));
    expect(fetchFormSchemaMock).not.toHaveBeenCalled();
    expect(fetchFieldAggregateMock).toHaveBeenCalledWith("ds-2", "delta");
  });
});
