// HEL-1085/HEL-1087 — loading skeleton, InlineError + Retry (re-fetches), authored field order,
// and the submit path: success, client-side block, server field errors, transport failure,
// preserved input on rejection, and computed-ARIA-only assertions (C1).

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

import { FormPanelView } from "./FormPanelView";
import { fetchDatasetSchema as fetchDatasetSchemaRequest } from "../../../sources/services/dataSourceService";
import { submitFormPanel as submitFormPanelRequest } from "../../services/panelService";
import type { FormPanelConfig } from "../../types/panel";

jest.mock("../../../sources/services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
}));

jest.mock("../../services/panelService", () => ({
  submitFormPanel: jest.fn(),
  parseFieldErrors: jest.requireActual("../../services/panelService").parseFieldErrors,
}));

const fetchDatasetSchemaMock = jest.mocked(fetchDatasetSchemaRequest);
const submitFormPanelMock = jest.mocked(submitFormPanelRequest);

const config: FormPanelConfig = {
  dataSourceId: "ds-1",
  fields: [
    { sourceField: "note", control: "text", label: "Note", required: true },
    { sourceField: "quantity", control: "number", label: "Quantity" },
  ],
  submit: { writeMode: "append" },
};

const schemaFields = [
  { name: "note", type: "string" as const, required: false },
  { name: "quantity", type: "integer" as const, required: false },
];

function axiosErrorWith(status: number, data: unknown): AxiosError {
  return new AxiosError("Request failed", String(status), undefined, undefined, {
    status,
    statusText: "",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
    data,
  });
}

async function renderReady() {
  fetchDatasetSchemaMock.mockResolvedValueOnce({ fields: schemaFields });
  render(<FormPanelView title="My form" panelId="panel-1" config={config} />);
  return screen.findByRole("form", { name: "My form" });
}

describe("FormPanelView", () => {
  beforeEach(() => {
    fetchDatasetSchemaMock.mockReset();
    submitFormPanelMock.mockReset();
  });

  it("shows a loading state while the schema fetch is in flight", () => {
    fetchDatasetSchemaMock.mockReturnValue(new Promise(() => {}));
    render(<FormPanelView title="My form" panelId="panel-1" config={config} />);
    expect(screen.getByLabelText("Loading form fields")).toBeInTheDocument();
  });

  it("shows InlineError with a working Retry action on failure", async () => {
    fetchDatasetSchemaMock.mockRejectedValueOnce(new Error("boom"));
    render(<FormPanelView title="My form" panelId="panel-1" config={config} />);

    await screen.findByRole("alert");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();

    fetchDatasetSchemaMock.mockResolvedValueOnce({ fields: schemaFields });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await screen.findByRole("form", { name: "My form" });
    expect(fetchDatasetSchemaMock).toHaveBeenCalledTimes(2);
  });

  it("renders fields in authored order once the schema loads", async () => {
    const form = await renderReady();
    const controls = form.querySelectorAll("input, textarea, button[role='combobox']");
    expect(controls[0]).toHaveAccessibleName("Note");
    expect(controls[1]).toHaveAccessibleName("Quantity");
  });

  it("submits typed values to the mocked service", async () => {
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
    });
    await renderReady();

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hello" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(submitFormPanelMock).toHaveBeenCalledWith(
        "panel-1",
        { note: "hello", quantity: 3 },
        {},
      ),
    );
  });

  it("HEL-1086: submits an attached file alongside typed values via the multipart path", async () => {
    const fileConfig: FormPanelConfig = {
      dataSourceId: "ds-1",
      fields: [
        { sourceField: "note", control: "text", label: "Note" },
        { sourceField: "attachment", control: "file", label: "Attachment" },
      ],
      submit: { writeMode: "append" },
    };
    const fileSchemaFields = [
      { name: "note", type: "string" as const, required: false },
      { name: "attachment", type: "binary-ref" as const, required: false },
    ];
    fetchDatasetSchemaMock.mockResolvedValueOnce({ fields: fileSchemaFields });
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
    });
    render(<FormPanelView title="My form" panelId="panel-1" config={fileConfig} />);
    await screen.findByRole("form", { name: "My form" });

    const file = new File(["contents"], "report.pdf", { type: "application/pdf" });
    const fileInput = screen.getByLabelText("Attachment");
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(fileInput).toHaveAccessibleDescription("report.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(submitFormPanelMock).toHaveBeenCalledWith("panel-1", {}, { attachment: file }),
    );
  });

  it("blocks a client-side-invalid submit — no request, invalid control marked and focused", async () => {
    await renderReady();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submitFormPanelMock).not.toHaveBeenCalled();
    const noteField = screen.getByRole("textbox", { name: "Note" });
    await waitFor(() => expect(noteField).toHaveAttribute("aria-invalid", "true"));
    expect(noteField).toHaveAccessibleDescription(/required/i);
    await waitFor(() => expect(noteField).toHaveFocus());
  });

  // evaluation-1.md CR1 — a repeated IDENTICAL client-side failure must still mutate the alert
  // region's DOM text, or a screen reader announces nothing on the second attempt (the spec's
  // "Regions SHALL be emptied when the next attempt starts"). This must fail before the CR1 fix:
  // pre-fix, `setAlertText("")` and `setAlertText(summary)` land in the same React commit, so the
  // DOM text after two identical failures never differs from after one.
  it("mutates the alert region's DOM text on a SECOND identical client-blocked submit (CR1)", async () => {
    await renderReady();
    const submitButton = screen.getByRole("button", { name: "Submit" });
    const alert = document.querySelector(".form-panel-view__alert") as HTMLElement;

    fireEvent.click(submitButton);
    await waitFor(() => expect(alert.textContent).toMatch(/required/i));
    const observed: string[] = [];
    const observer = new MutationObserver(() => observed.push(alert.textContent ?? ""));
    observer.observe(alert, { childList: true, characterData: true, subtree: true });

    fireEvent.click(submitButton);
    await waitFor(() => expect(observed.length).toBeGreaterThan(0));
    observer.disconnect();
    expect(alert.textContent).toMatch(/required/i);
  });

  it("associates a 400 field error with its control, shows the alert, and preserves values", async () => {
    submitFormPanelMock.mockRejectedValueOnce(
      axiosErrorWith(400, {
        message: "bad",
        fieldErrors: [{ field: "quantity", reason: "expected integer, got string" }],
      }),
    );
    await renderReady();

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hello" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    const quantityField = await screen.findByRole("spinbutton", { name: "Quantity" });
    await waitFor(() => expect(quantityField).toHaveAttribute("aria-invalid", "true"));
    expect(quantityField).toHaveAccessibleDescription(/expected integer/i);
    await waitFor(() => expect(quantityField).toHaveFocus());

    const formAlert = document.querySelector(".form-panel-view__alert");
    expect(formAlert).toHaveTextContent(/quantity/i);
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("hello");
    expect(quantityField).toHaveValue(5);
  });

  it("a 400 naming only an unrendered field keeps focus on the submit button", async () => {
    submitFormPanelMock.mockRejectedValueOnce(
      axiosErrorWith(400, {
        message: "bad",
        fieldErrors: [{ field: "status", reason: "not part of this form" }],
      }),
    );
    await renderReady();

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hello" } });
    const submitButton = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(submitButton);

    await screen.findByText(/status/i);
    expect(screen.getByRole("textbox", { name: "Note" })).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await waitFor(() => expect(submitButton).toHaveFocus());
  });

  it("a network error announces, preserves values, and leaves focus on the submit button", async () => {
    submitFormPanelMock.mockRejectedValueOnce(new Error("Network Error"));
    await renderReady();

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hello" } });
    const submitButton = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(submitButton);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be completed/i),
    );
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("hello");
    await waitFor(() => expect(submitButton).toHaveFocus());
  });

  it("success shows status text, resets the form, and leaves focus on the submit button", async () => {
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
    });
    await renderReady();

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hello" } });
    const submitButton = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(submitButton);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/added/i));
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("");
    await waitFor(() => expect(submitButton).toHaveFocus());
  });

  it("resetOnSuccess: false keeps the submitted values after success", async () => {
    const noResetConfig: FormPanelConfig = {
      ...config,
      submit: { writeMode: "append", resetOnSuccess: false },
    };
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
    });
    fetchDatasetSchemaMock.mockResolvedValueOnce({ fields: schemaFields });
    render(<FormPanelView title="My form" panelId="panel-1" config={noResetConfig} />);
    await screen.findByRole("form", { name: "My form" });

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/added/i));
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("hello");
  });

  it("double activation while pending sends only one request", async () => {
    let resolveSubmit: (() => void) | undefined;
    submitFormPanelMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubmit = () => resolve({ rows: [], updatedAt: "now" });
      }),
    );
    await renderReady();

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hello" } });
    const submitButton = screen.getByRole("button", { name: "Submit" });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(submitFormPanelMock).toHaveBeenCalledTimes(1);
    resolveSubmit?.();
  });

  it("Enter in a single-line text field submits the form", async () => {
    submitFormPanelMock.mockResolvedValueOnce({ rows: [], updatedAt: "now" });
    await renderReady();

    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "hello" } });
    const form = screen.getByRole("form", { name: "My form" });
    fireEvent.submit(form);

    await waitFor(() => expect(submitFormPanelMock).toHaveBeenCalledTimes(1));
  });
});

// HEL-1088 design.md Decision 1/2/3 — the compact single-counter-field layout: every `+`/`-`
// submits immediately as a delta, the local value is an optimistic tally that accumulates across
// clicks and reverts on rejection, and a rejected/failed increment must write nothing.
describe("FormPanelView — compact single-counter-field layout", () => {
  const counterConfig: FormPanelConfig = {
    dataSourceId: "ds-2",
    fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
    submit: { writeMode: "append", resetOnSuccess: false },
  };
  const counterSchemaFields = [
    { name: "delta", type: "integer" as const, required: false },
    { name: "occurred_at", type: "timestamp" as const, required: false },
    { name: "value", type: "integer" as const, required: false },
  ];

  beforeEach(() => {
    fetchDatasetSchemaMock.mockReset();
    submitFormPanelMock.mockReset();
  });

  async function renderCompact() {
    fetchDatasetSchemaMock.mockResolvedValueOnce({ fields: counterSchemaFields });
    render(<FormPanelView title="Widgets" panelId="panel-2" config={counterConfig} />);
    return screen.findByRole("spinbutton", { name: "Widgets" });
  }

  it("2.1/2.3: a single counter field renders the compact layout, not the standard Submit-button form", async () => {
    await renderCompact();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  });

  it("2.3: zero fields, one non-counter field, and 2+ fields (incl. a counter) all keep the standard layout", async () => {
    const zeroFieldConfig: FormPanelConfig = {
      dataSourceId: "ds-3",
      fields: [],
      submit: { writeMode: "append" },
    };
    fetchDatasetSchemaMock.mockResolvedValueOnce({ fields: [] });
    render(<FormPanelView title="Empty" panelId="panel-3" config={zeroFieldConfig} />);
    await screen.findByRole("form", { name: "Empty" });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    cleanup();

    const oneNonCounterConfig: FormPanelConfig = {
      dataSourceId: "ds-4",
      fields: [{ sourceField: "note", control: "text", label: "Note" }],
      submit: { writeMode: "append" },
    };
    fetchDatasetSchemaMock.mockResolvedValueOnce({
      fields: [{ name: "note", type: "string" as const, required: false }],
    });
    render(<FormPanelView title="Note form" panelId="panel-4" config={oneNonCounterConfig} />);
    await screen.findByRole("form", { name: "Note form" });
    cleanup();

    const twoFieldConfig: FormPanelConfig = {
      dataSourceId: "ds-5",
      fields: [
        { sourceField: "note", control: "text", label: "Note" },
        { sourceField: "delta", control: "counter", label: "Delta" },
      ],
      submit: { writeMode: "append" },
    };
    fetchDatasetSchemaMock.mockResolvedValueOnce({
      fields: [
        { name: "note", type: "string" as const, required: false },
        { name: "delta", type: "integer" as const, required: false },
        { name: "occurred_at", type: "timestamp" as const, required: false },
        { name: "value", type: "integer" as const, required: false },
      ],
    });
    render(<FormPanelView title="Mixed form" panelId="panel-5" config={twoFieldConfig} />);
    await screen.findByRole("form", { name: "Mixed form" });
    // The embedded counter renders via the standard layout's shared Submit button, not per-click.
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("2.4: a counter embedded in a multi-field form never submits on its own +/- activation, and never touches sibling fields", async () => {
    const twoFieldConfig: FormPanelConfig = {
      dataSourceId: "ds-6",
      fields: [
        { sourceField: "note", control: "text", label: "Note", required: true },
        { sourceField: "delta", control: "counter", label: "Delta" },
      ],
      submit: { writeMode: "append" },
    };
    fetchDatasetSchemaMock.mockResolvedValueOnce({
      fields: [
        { name: "note", type: "string" as const, required: false },
        { name: "delta", type: "integer" as const, required: false },
        { name: "occurred_at", type: "timestamp" as const, required: false },
        { name: "value", type: "integer" as const, required: false },
      ],
    });
    render(<FormPanelView title="Mixed form" panelId="panel-6" config={twoFieldConfig} />);
    await screen.findByRole("form", { name: "Mixed form" });

    fireEvent.click(screen.getByRole("button", { name: /increase delta/i }));

    expect(submitFormPanelMock).not.toHaveBeenCalled();
    const noteField = screen.getByRole("textbox", { name: "Note" });
    expect(noteField).not.toHaveAttribute("aria-invalid", "true");
  });

  it("1.2/1.3/4.1: +/- immediately submits the configured step as a delta and accumulates the displayed value", async () => {
    submitFormPanelMock.mockResolvedValue({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
    });
    const control = await renderCompact();
    expect(control).toHaveAttribute("aria-valuenow", "0");

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));
    await waitFor(() =>
      expect(submitFormPanelMock).toHaveBeenCalledWith("panel-2", { delta: 5 }, {}),
    );
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));

    fireEvent.click(screen.getByRole("button", { name: /decrease widgets/i }));
    await waitFor(() =>
      expect(submitFormPanelMock).toHaveBeenCalledWith("panel-2", { delta: -5 }, {}),
    );
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "0"));
  });

  it("1.3/4.3: a rejected increment reverts the optimistic tally and writes nothing", async () => {
    submitFormPanelMock.mockRejectedValueOnce(new Error("Network Error"));
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(submitFormPanelMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "0"));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be completed/i);
  });

  it("resetOnSuccess: false is respected — the compact layout never wipes the tally after a click", async () => {
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
    });
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));
  });
});
