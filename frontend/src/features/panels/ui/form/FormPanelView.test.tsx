// HEL-1085/HEL-1087 — loading skeleton, InlineError + Retry (re-fetches), authored field order,
// and the submit path: success, client-side block, server field errors, transport failure,
// preserved input on rejection, and computed-ARIA-only assertions (C1).

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

import { FormPanelView } from "./FormPanelView";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchFieldAggregate as fetchFieldAggregateRequest,
} from "../../../sources/services/dataSourceService";
import { submitFormPanel as submitFormPanelRequest } from "../../services/panelService";
import { renderWithStore } from "../../../../test/renderWithStore";
import type { FormPanelConfig } from "../../types/panel";

jest.mock("../../../sources/services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
  fetchFieldAggregate: jest.fn(),
}));

jest.mock("../../services/panelService", () => ({
  submitFormPanel: jest.fn(),
  parseFieldErrors: jest.requireActual("../../services/panelService").parseFieldErrors,
}));

const fetchDatasetSchemaMock = jest.mocked(fetchDatasetSchemaRequest);
const fetchFieldAggregateMock = jest.mocked(fetchFieldAggregateRequest);
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
  renderWithStore(<FormPanelView title="My form" panelId="panel-1" config={config} />);
  return screen.findByRole("form", { name: "My form" });
}

describe("FormPanelView", () => {
  beforeEach(() => {
    fetchDatasetSchemaMock.mockReset();
    submitFormPanelMock.mockReset();
  });

  it("shows a loading state while the schema fetch is in flight", () => {
    fetchDatasetSchemaMock.mockReturnValue(new Promise(() => {}));
    renderWithStore(<FormPanelView title="My form" panelId="panel-1" config={config} />);
    expect(screen.getByLabelText("Loading form fields")).toBeInTheDocument();
  });

  it("shows InlineError with a working Retry action on failure", async () => {
    fetchDatasetSchemaMock.mockRejectedValueOnce(new Error("boom"));
    renderWithStore(<FormPanelView title="My form" panelId="panel-1" config={config} />);

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
      deniedPipelines: [],
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
      deniedPipelines: [],
    });
    renderWithStore(<FormPanelView title="My form" panelId="panel-1" config={fileConfig} />);
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
      deniedPipelines: [],
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
      deniedPipelines: [],
    });
    fetchDatasetSchemaMock.mockResolvedValueOnce({ fields: schemaFields });
    renderWithStore(<FormPanelView title="My form" panelId="panel-1" config={noResetConfig} />);
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
        resolveSubmit = () => resolve({ rows: [], updatedAt: "now", deniedPipelines: [] });
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
    submitFormPanelMock.mockResolvedValueOnce({ rows: [], updatedAt: "now", deniedPipelines: [] });
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
    fetchFieldAggregateMock.mockReset();
  });

  async function renderCompact() {
    fetchDatasetSchemaMock.mockResolvedValueOnce({ fields: counterSchemaFields });
    renderWithStore(<FormPanelView title="Widgets" panelId="panel-2" config={counterConfig} />);
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
    renderWithStore(<FormPanelView title="Empty" panelId="panel-3" config={zeroFieldConfig} />);
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
    renderWithStore(
      <FormPanelView title="Note form" panelId="panel-4" config={oneNonCounterConfig} />,
    );
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
    renderWithStore(<FormPanelView title="Mixed form" panelId="panel-5" config={twoFieldConfig} />);
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
    renderWithStore(<FormPanelView title="Mixed form" panelId="panel-6" config={twoFieldConfig} />);
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
      deniedPipelines: [],
    });
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 5 });
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 0 });
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

  // HEL-1169: updated from a response-less `Error` to a definite (axios, response-carrying)
  // rejection — under the new classification (design.md D1) a response-less failure is
  // indeterminate and must NOT roll back (see 1.1 above, which covers that case); this test's own
  // intent ("a rejected submit reverts the tally") is preserved by making the rejection definite.
  it("1.3/4.3: a rejected increment reverts the optimistic tally and writes nothing", async () => {
    submitFormPanelMock.mockRejectedValueOnce(axiosErrorWith(500, {}));
    fetchFieldAggregateMock.mockRejectedValueOnce(new Error("aggregate refetch failed"));
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(submitFormPanelMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "0"));
    // Two `role="alert"` regions now co-exist on a rejection (the shared alert region AND the
    // field-associated error `FormField` renders once `aria-invalid` is set) -- scoped to the
    // shared region specifically, matching this test's own original intent.
    expect(document.querySelector(".form-panel-view__alert")).toHaveTextContent(
      /could not be completed/i,
    );
  });

  // ── HEL-1169 tasks.md Section 1 — red-first: prove the defect before fixing it ────────────

  // 1.1: a network failure with no response, AFTER the server actually committed the write
  // (the aggregate mock already reflects the new total), must reconcile to the true total —
  // not roll back a write that persisted. Red against pre-HEL-1169 code: the old catch branch
  // treats every rejection identically and always subtracts the click's own delta, so the old
  // behavior displays "0" here, not the persisted "5".
  it("HEL-1169 1.1: a lost acknowledgement after a committed write reconciles to the true total, not a rollback", async () => {
    submitFormPanelMock.mockRejectedValueOnce(new Error("Network Error"));
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 5 });
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledWith("ds-2", "delta"));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));
    // Indeterminate settles are silent unless their own trailing reconciliation fetch also
    // fails (design.md D4) — this one succeeds, so nothing is announced.
    expect(document.querySelector(".form-panel-view__alert")).toHaveTextContent("");
  });

  // 1.2: a definite rejection (a real HTTP response) must still roll back AND associate the
  // error with the counter control itself via computed `aria-invalid`/`aria-describedby` — not
  // just the shared alert region's text. Red against pre-HEL-1169 code: today the compact
  // counter path never calls `setExternalErrors`, so the control never gets `aria-invalid`.
  it("HEL-1169 1.2: a definite rejection rolls back and marks the counter control invalid via computed ARIA", async () => {
    submitFormPanelMock.mockRejectedValueOnce(
      axiosErrorWith(400, {
        message: "bad",
        fieldErrors: [{ field: "delta", reason: "delta must be positive" }],
      }),
    );
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "0"));
    await waitFor(() => expect(control).toHaveAttribute("aria-invalid", "true"));
    expect(control).toHaveAccessibleDescription(/delta must be positive/i);
  });

  // ── HEL-1169 tasks.md Section 2 — implementation-verifying tests ──────────────────────────

  // 2.4: when the settle that empties the pending set is itself indeterminate, AND the resulting
  // reconciliation fetch also fails, the optimistic value is left as-is (never discarded) and the
  // assertive region announces an unconfirmed state, distinct from a definite rejection's wording.
  it("HEL-1169 2.4: an indeterminate failure whose own reconciliation fetch also fails leaves the value and announces 'couldn't confirm'", async () => {
    submitFormPanelMock.mockRejectedValueOnce(new Error("Network Error"));
    fetchFieldAggregateMock.mockRejectedValueOnce(new Error("aggregate refetch failed"));
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledWith("ds-2", "delta"));
    // The optimistic value is never rolled back for an indeterminate failure, and stays put even
    // when the follow-up reconciliation fetch can't confirm it.
    expect(control).toHaveAttribute("aria-valuenow", "5");
    await waitFor(() =>
      expect(document.querySelector(".form-panel-view__alert")).toHaveTextContent(
        /couldn't confirm/i,
      ),
    );
    expect(document.querySelector(".form-panel-view__alert")).not.toHaveTextContent(
      /could not be completed/i,
    );
  });

  // 2.5: a field-associated rejection error is cleared unconditionally by the NEXT successful
  // settle — even when that success's own trailing reconciliation fetch fails, since relying on
  // the fetch's own outcome would leave a stale `aria-invalid` indefinitely (design.md D3, CR3).
  it("HEL-1169 2.5: a successful settle clears a prior rejection's aria-invalid even when its own reconciliation fetch fails", async () => {
    submitFormPanelMock.mockRejectedValueOnce(
      axiosErrorWith(400, { fieldErrors: [{ field: "delta", reason: "delta must be positive" }] }),
    );
    fetchFieldAggregateMock.mockRejectedValueOnce(new Error("aggregate refetch failed"));
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));
    await waitFor(() => expect(control).toHaveAttribute("aria-invalid", "true"));

    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
      deniedPipelines: [],
    });
    fetchFieldAggregateMock.mockRejectedValueOnce(new Error("aggregate refetch failed again"));
    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(control).not.toHaveAttribute("aria-invalid", "true"));
    // A success's own trailing fetch failure stays silent -- no "couldn't confirm" announcement,
    // exactly the existing accepted silent-swallow behavior (design.md D4).
    expect(document.querySelector(".form-panel-view__alert")).not.toHaveTextContent(
      /couldn't confirm/i,
    );
  });

  // 2.6: a burst that happens to quiesce on a DEFINITE-REJECTION settle must still reconcile an
  // earlier sibling's indeterminate outcome within the same burst (design.md D2, round-1
  // design-gate CR2) -- not just the success/indeterminate branches.
  it("HEL-1169 2.6: a burst that quiesces on a definite-rejection settle still reconciles an earlier sibling's indeterminate outcome", async () => {
    let rejectA!: (e: unknown) => void;
    let rejectB!: (e: unknown) => void;
    submitFormPanelMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectA = reject;
      }),
    );
    submitFormPanelMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectB = reject;
      }),
    );
    const control = await renderCompact();
    const increaseButton = screen.getByRole("button", { name: /increase widgets/i });

    fireEvent.click(increaseButton); // A
    fireEvent.click(increaseButton); // B
    await waitFor(() => expect(submitFormPanelMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "10")); // A(5)+B(5)

    // A settles indeterminate first -- sibling B still pending, so no fetch dispatched yet, and
    // A's own optimistic delta is NOT rolled back.
    await act(async () => {
      rejectA(new Error("Network Error"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchFieldAggregateMock).not.toHaveBeenCalled();
    expect(control).toHaveAttribute("aria-valuenow", "10");

    // B settles with a DEFINITE rejection second -- empties the pending set. B's own delta rolls
    // back, AND the reconciliation fetch fires (fixing the pre-HEL-1169 gap where a burst that
    // quiesced on a rejection never reconciled A's own indeterminate outcome at all). The
    // resolved aggregate (8) differs from what local rollback math alone would produce (5),
    // proving this is a real server-confirmed correction, not leftover optimistic arithmetic.
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 8 });
    await act(async () => {
      rejectB(axiosErrorWith(500, {}));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledWith("ds-2", "delta"));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "8"));
  });

  // 2.8: the single most common real-world path for AC #1 -- an isolated rejected click, no
  // sibling in flight, whose own trailing reconciliation fetch SUCCEEDS. The fix (design.md D3a,
  // round-2 design-gate CR1) is that `reconcileValue` (not `setValue`) applies the fetched total,
  // so this success can never incidentally clear the rejection's own `aria-invalid`.
  it("HEL-1169 2.8: a rejected click's own successful trailing reconciliation does not clear its aria-invalid (primary path)", async () => {
    submitFormPanelMock.mockRejectedValueOnce(
      axiosErrorWith(400, { fieldErrors: [{ field: "delta", reason: "delta must be positive" }] }),
    );
    // Differs from the post-rollback local value (0) so a later assertion can distinguish
    // "reconciliation actually applied" from "the value just happened to already be right".
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 20 });
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    // Rollback and the trailing reconciliation fetch can resolve close enough together that an
    // intermediate "0" is never observed as its own distinct state (real timers, not asserted
    // here) -- what matters is the FINAL state once reconciliation has applied (20, not 0 or 5).
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "20")); // reconciled
    // The reconciliation fetch succeeded and updated the TOTAL -- but must not have cleared the
    // rejection's own error state.
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription(/delta must be positive/i);
  });

  it("resetOnSuccess: false is respected — the compact layout never wipes the tally after a click", async () => {
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
      deniedPipelines: [],
    });
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 5 });
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));
  });

  // ── HEL-1095 tasks.md 2.2/2.5/3.1/3.2/3.3/3.4/3.7 ──────────────────────────

  // 2.2: the old single-value `submitState === "pending"` guard silently dropped every click
  // after the first in a burst (design-gate round 1) -- a second click fired BEFORE the first
  // settles must still fire its own request and accumulate its own delta, both tracked
  // concurrently by the pending-delta map.
  it("2.2: a second click fired before the first settles still submits its own request and accumulates its own delta", async () => {
    const resolvers: Array<
      (v: {
        rows: { id: string; seq: number; updatedAt: string }[];
        updatedAt: string;
        deniedPipelines: never[];
      }) => void
    > = [];
    submitFormPanelMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const control = await renderCompact();
    const increaseButton = screen.getByRole("button", { name: /increase widgets/i });

    fireEvent.click(increaseButton);
    fireEvent.click(increaseButton);

    await waitFor(() => expect(submitFormPanelMock).toHaveBeenCalledTimes(2));
    expect(control).toHaveAttribute("aria-valuenow", "10");

    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 10 });
    await act(async () => {
      resolvers[0]({
        rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
        updatedAt: "now",
        deniedPipelines: [],
      });
      await Promise.resolve();
    });
    // The first settle alone must not empty the map or dispatch a reconciliation fetch -- the
    // second request is still outstanding.
    expect(fetchFieldAggregateMock).not.toHaveBeenCalled();

    await act(async () => {
      resolvers[1]({
        rows: [{ id: "r2", seq: 1, updatedAt: "now" }],
        updatedAt: "now",
        deniedPipelines: [],
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledTimes(1));
  });

  it("2.5: aria-busy is true while the immediate-submit request is outstanding, and clears once it settles", async () => {
    let resolveSubmit!: (v: {
      rows: { id: string; seq: number; updatedAt: string }[];
      updatedAt: string;
      deniedPipelines: never[];
    }) => void;
    submitFormPanelMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 5 });
    const control = await renderCompact();
    expect(control).not.toHaveAttribute("aria-busy", "true");

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));
    await waitFor(() => expect(control).toHaveAttribute("aria-busy", "true"));

    resolveSubmit({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
      deniedPipelines: [],
    });
    await waitFor(() => expect(control).not.toHaveAttribute("aria-busy", "true"));
  });

  // 3.1 (failing-first before 2.3): a submit succeeds with no downstream pipeline bound (this
  // ticket never even queries one -- C1) -- the displayed value settles to the server's own
  // aggregate rather than the client-computed optimistic tally, proving reconciliation actually
  // replaces the local value rather than merely leaving it alone.
  it("3.1: a successful submit reconciles the displayed value to the server's own aggregate", async () => {
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
      deniedPipelines: [],
    });
    // The server's aggregate (e.g. a concurrent writer's row already landed) differs from what
    // this session's own optimistic delta alone would compute (0 + 5 = 5) -- only a real
    // reconciliation, not the optimistic tally surviving untouched, produces 11 here.
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 11 });
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledWith("ds-2", "delta"));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "11"));
  });

  // 3.2: a rejected submit reverts the optimistic value and announces the failure via the
  // assertive alert region (design.md D7/2.6 -- the single-click rollback trigger itself is
  // UNCHANGED by this ticket, already red-then-green proven at HEL-1087; verified here as a
  // regression guard confirming 2.2/2.3/2.4's new per-click map/relative-subtraction plumbing
  // didn't disturb it -- this single-click case passes against BOTH the pre- and post-1095 code,
  // unlike 3.7's genuinely new multi-click relative-rollback assertion, which is red pre-fix).
  // HEL-1169: updated from a response-less `Error` to a definite (axios) rejection — a
  // response-less failure is now indeterminate and must NOT roll back (see 1.1). Also updated:
  // per design.md D2, EVERY settle (including a definite rejection) now unconditionally triggers
  // the shared reconciliation tail once it empties the pending map, so `fetchFieldAggregateMock`
  // IS called here now, unlike pre-HEL-1169 behavior.
  it("3.2: a rejected submit rolls back and announces the failure", async () => {
    submitFormPanelMock.mockRejectedValueOnce(axiosErrorWith(500, {}));
    fetchFieldAggregateMock.mockRejectedValueOnce(new Error("aggregate refetch failed"));
    const control = await renderCompact();

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "0"));
    // Two `role="alert"` regions now co-exist on a rejection (the shared alert region AND the
    // field-associated error `FormField` renders once `aria-invalid` is set) -- scoped to the
    // shared region specifically, matching this test's own original intent.
    expect(document.querySelector(".form-panel-view__alert")).toHaveTextContent(
      /could not be completed/i,
    );
    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledWith("ds-2", "delta"));
  });

  // 3.3: ten rapid clicks accumulate optimistically with no reconciliation fetch until the very
  // last response settles, REGARDLESS of the order the ten responses actually resolve in --
  // resolved out of request order here (a same-order mock would never exercise design.md D9's
  // quiesce gate), and the displayed value never regresses below what's already shown.
  it("3.3: ten rapid clicks accumulate with no reconciliation until the burst fully settles, resolved out of order", async () => {
    const resolvers: Array<
      (v: {
        rows: { id: string; seq: number; updatedAt: string }[];
        updatedAt: string;
        deniedPipelines: never[];
      }) => void
    > = [];
    submitFormPanelMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    fetchFieldAggregateMock.mockResolvedValueOnce({ field: "delta", op: "sum", value: 50 });
    const control = await renderCompact();
    const increaseButton = screen.getByRole("button", { name: /increase widgets/i });

    for (let i = 0; i < 10; i++) fireEvent.click(increaseButton);
    await waitFor(() => expect(submitFormPanelMock).toHaveBeenCalledTimes(10));
    // All ten optimistic deltas are already reflected before any response has settled.
    expect(control).toHaveAttribute("aria-valuenow", "50");

    // Resolve out of request order: last-fired resolves first, first-fired resolves last.
    const outOfOrder = [...resolvers].reverse();
    for (const resolve of outOfOrder) {
      // Yield a microtask so each settle's synchronous map-mutation/state-update actually lands
      // before the next one fires -- proves the value never regresses mid-burst, not just at
      // the very end.
      await act(async () => {
        resolve({
          rows: [{ id: "r", seq: 0, updatedAt: "now" }],
          updatedAt: "now",
          deniedPipelines: [],
        });
        await Promise.resolve();
      });
      const now = Number(control.getAttribute("aria-valuenow"));
      expect(now).toBe(50);
    }

    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "50"));
  });

  // 3.4 (failing-first before the myGen/map-empty guard): a click settles and dispatches its
  // reconciliation fetch; before that fetch resolves, a NEW click fires and updates the displayed
  // value. The fetch is then forced to resolve strictly AFTER the new click's own optimistic
  // state update has already committed (never a same-order mock) -- the stale fetch result must
  // be discarded, not overwrite the new click's own optimistic delta.
  it("3.4: a stale reconciliation fetch is discarded when a new click fires before it resolves", async () => {
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r1", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
      deniedPipelines: [],
    });
    let resolveAggregate!: (v: { field: string; op: string; value: number }) => void;
    fetchFieldAggregateMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAggregate = resolve;
      }),
    );
    const control = await renderCompact();
    const increaseButton = screen.getByRole("button", { name: /increase widgets/i });

    fireEvent.click(increaseButton);
    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledTimes(1));
    // The first click's own settle already committed its optimistic value (5) before its
    // reconciliation fetch (still unresolved) was dispatched.
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));

    // A brand-new click fires and commits its own optimistic update BEFORE the first fetch
    // resolves.
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "r2", seq: 1, updatedAt: "now" }],
      updatedAt: "now",
      deniedPipelines: [],
    });
    fireEvent.click(increaseButton);
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "10"));

    // Only now does the FIRST (now-stale) fetch resolve -- strictly after the new click's own
    // state update, per the task's explicit ordering requirement.
    await act(async () => {
      resolveAggregate({ field: "delta", op: "sum", value: 5 });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale result (5) must never overwrite the new click's own optimistic value (10).
    expect(control).toHaveAttribute("aria-valuenow", "10");
  });

  // 3.7 (failing-first before the unconditional reconcileGeneration bump): click A settles
  // (success, dispatches fetch F1), then B and C fire; B settles (success, map still has C --
  // no new dispatch); C settles (a definite rejection, empties the map). This exact ordering is
  // forced (never a same-order mock) -- F1's result must be discarded as stale, and the displayed
  // value must reflect B's own committed contribution plus C's own rollback.
  // HEL-1169: updated per design.md D2 -- C's own settle (whatever kind) now ALSO
  // unconditionally dispatches its own reconciliation fetch (F2) once it empties the map, unlike
  // pre-HEL-1169 behavior where a rejection never reconciled at all. C is kept a DEFINITE
  // rejection here (not response-less) so this test's own rollback assertion stays exactly what
  // it always tested -- the response-less/indeterminate case is covered separately by 1.1 and
  // 2.6.
  it("3.7: a stale fetch is discarded even when invalidated by a sibling's success that didn't itself empty the map, followed by a rejection that did (which now dispatches its own fetch too)", async () => {
    // Click A: resolves immediately (its own settle dispatches F1, captured below).
    submitFormPanelMock.mockResolvedValueOnce({
      rows: [{ id: "a", seq: 0, updatedAt: "now" }],
      updatedAt: "now",
      deniedPipelines: [],
    });
    let resolveF1!: (v: { field: string; op: string; value: number }) => void;
    fetchFieldAggregateMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveF1 = resolve;
      }),
    );
    const control = await renderCompact();
    const increaseButton = screen.getByRole("button", { name: /increase widgets/i });

    fireEvent.click(increaseButton); // A
    await waitFor(() => expect(fetchFieldAggregateMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5")); // A's own delta

    // B and C fire while F1 is still outstanding -- both held open until explicitly resolved.
    let resolveB!: (v: {
      rows: { id: string; seq: number; updatedAt: string }[];
      updatedAt: string;
      deniedPipelines: never[];
    }) => void;
    let rejectC!: (e: unknown) => void;
    submitFormPanelMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveB = resolve;
      }),
    );
    submitFormPanelMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectC = reject;
      }),
    );
    fireEvent.click(increaseButton); // B
    fireEvent.click(increaseButton); // C
    await waitFor(() => expect(submitFormPanelMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "15")); // A(5)+B(5)+C(5)

    // B settles success -- map still has C outstanding, so no new fetch is dispatched.
    await act(async () => {
      resolveB({
        rows: [{ id: "b", seq: 1, updatedAt: "now" }],
        updatedAt: "now",
        deniedPipelines: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchFieldAggregateMock).toHaveBeenCalledTimes(1);
    expect(control).toHaveAttribute("aria-valuenow", "15");

    // C settles with a DEFINITE rejection -- empties the map. C's own delta rolls back
    // immediately, AND (design.md D2) this settle now ALSO dispatches its own reconciliation
    // fetch (F2), captured below so its resolution can be controlled independently of F1's.
    let resolveF2!: (v: { field: string; op: string; value: number }) => void;
    fetchFieldAggregateMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveF2 = resolve;
      }),
    );
    await act(async () => {
      rejectC(axiosErrorWith(500, {}));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchFieldAggregateMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "10")); // A(5)+B(5)

    // F1 (from A) finally resolves with a value that predates B's own commit -- it must be
    // discarded: `reconcileGeneration` moved twice since F1 was dispatched (B's success, C's
    // rejection), so F1's `myGen` no longer matches.
    await act(async () => {
      resolveF1({ field: "delta", op: "sum", value: 5 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(control).toHaveAttribute("aria-valuenow", "10");

    // F2 (from C's own rejection settle) resolves last and IS applied -- it's the current
    // generation's own fetch, not a stale one, and applying it never disturbs C's own
    // already-set field error (design.md D3a -- `reconcileValue`, not `setValue`).
    await act(async () => {
      resolveF2({ field: "delta", op: "sum", value: 10 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(control).toHaveAttribute("aria-valuenow", "10");
    expect(control).toHaveAttribute("aria-invalid", "true");
  });
});
