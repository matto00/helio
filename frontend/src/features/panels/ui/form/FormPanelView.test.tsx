// HEL-1085 task 4.5 — loading skeleton, InlineError + Retry (re-fetches), authored field order,
// and Enter-in-a-text-field non-submission (D8/design.md's "No submit affordance" requirement).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FormPanelView } from "./FormPanelView";
import { fetchDatasetSchema as fetchDatasetSchemaRequest } from "../../../sources/services/dataSourceService";
import type { FormPanelConfig } from "../../types/panel";

jest.mock("../../../sources/services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
}));

const fetchDatasetSchemaMock = jest.mocked(fetchDatasetSchemaRequest);

const config: FormPanelConfig = {
  dataSourceId: "ds-1",
  fields: [
    { sourceField: "note", control: "text", label: "Note" },
    { sourceField: "quantity", control: "number", label: "Quantity" },
  ],
  submit: { writeMode: "append" },
};

describe("FormPanelView", () => {
  beforeEach(() => {
    fetchDatasetSchemaMock.mockReset();
  });

  it("shows a loading state while the schema fetch is in flight", () => {
    fetchDatasetSchemaMock.mockReturnValue(new Promise(() => {}));
    render(<FormPanelView title="My form" config={config} />);
    expect(screen.getByLabelText("Loading form fields")).toBeInTheDocument();
  });

  it("shows InlineError with a working Retry action on failure", async () => {
    fetchDatasetSchemaMock.mockRejectedValueOnce(new Error("boom"));
    render(<FormPanelView title="My form" config={config} />);

    await screen.findByRole("alert");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();

    fetchDatasetSchemaMock.mockResolvedValueOnce({
      fields: [
        { name: "note", type: "string", required: false },
        { name: "quantity", type: "integer", required: false },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await screen.findByRole("form", { name: "My form" });
    expect(fetchDatasetSchemaMock).toHaveBeenCalledTimes(2);
  });

  it("renders fields in authored order once the schema loads", async () => {
    fetchDatasetSchemaMock.mockResolvedValueOnce({
      fields: [
        { name: "note", type: "string", required: false },
        { name: "quantity", type: "integer", required: false },
      ],
    });
    render(<FormPanelView title="My form" config={config} />);

    const form = await screen.findByRole("form", { name: "My form" });
    const controls = form.querySelectorAll("input, textarea, button[role='combobox']");
    expect(controls[0]).toHaveAccessibleName("Note");
    expect(controls[1]).toHaveAccessibleName("Quantity");
  });

  it("Enter in a text field does not submit the form", async () => {
    const submitHandler = jest.fn();
    fetchDatasetSchemaMock.mockResolvedValueOnce({
      fields: [
        { name: "note", type: "string", required: false },
        { name: "quantity", type: "integer", required: false },
      ],
    });
    render(<FormPanelView title="My form" config={config} />);
    const form = await screen.findByRole("form", { name: "My form" });
    form.addEventListener("submit", submitHandler);

    const noteField = screen.getByRole("textbox", { name: "Note" });
    fireEvent.keyDown(noteField, { key: "Enter", code: "Enter" });
    fireEvent.submit(form);

    await waitFor(() => expect(submitHandler).toHaveBeenCalledTimes(1));
    expect(submitHandler.mock.calls[0][0].defaultPrevented).toBe(true);
  });
});
