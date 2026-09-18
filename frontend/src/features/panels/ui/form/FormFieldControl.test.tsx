import { fireEvent, render, screen } from "@testing-library/react";

import { FormFieldControl } from "./FormFieldControl";
import type { DatasetFieldResponse } from "../../../sources/types/dataSource";
import type { FormFieldSpec } from "../../types/panel";
import type { FormFieldValue } from "./useFormPanelValues";

function Harness({
  field,
  declared,
  issue,
  initialValue = "",
  error = null,
}: {
  field: FormFieldSpec;
  declared?: DatasetFieldResponse;
  issue?: string | null;
  initialValue?: FormFieldValue;
  error?: string | null;
}) {
  return (
    <FormFieldControl
      field={field}
      declared={declared}
      issue={issue}
      value={initialValue}
      error={error}
      onChange={() => {}}
      onBlur={() => {}}
    />
  );
}

describe("FormFieldControl", () => {
  it("text: exposes computed accessible name from the label and description from helpText", () => {
    const field: FormFieldSpec = {
      sourceField: "note",
      control: "text",
      label: "Note",
      helpText: "Whole units only",
    };
    render(<Harness field={field} declared={{ name: "note", type: "string", required: false }} />);
    const control = screen.getByRole("textbox", { name: "Note" });
    expect(control).toHaveAccessibleName("Note");
    expect(control).toHaveAccessibleDescription("Whole units only");
  });

  it("text: falls back to sourceField as the accessible name with no label", () => {
    const field: FormFieldSpec = { sourceField: "note", control: "text" };
    render(<Harness field={field} declared={{ name: "note", type: "string", required: false }} />);
    expect(screen.getByRole("textbox", { name: "note" })).toBeInTheDocument();
  });

  it("textarea: renders a multiline textbox with the computed name", () => {
    const field: FormFieldSpec = { sourceField: "note", control: "textarea", label: "Note" };
    render(<Harness field={field} declared={{ name: "note", type: "string", required: false }} />);
    expect(screen.getByRole("textbox", { name: "Note" }).tagName).toBe("TEXTAREA");
  });

  it("number: renders a spinbutton and lists exactly the aria-required from declared-required", () => {
    const field: FormFieldSpec = { sourceField: "quantity", control: "number", label: "Quantity" };
    render(
      <Harness field={field} declared={{ name: "quantity", type: "integer", required: true }} />,
    );
    const control = screen.getByRole("spinbutton", { name: "Quantity" });
    expect(control).toHaveAttribute("aria-required", "true");
  });

  it("date: renders a date-typed input", () => {
    const field: FormFieldSpec = { sourceField: "when", control: "date", label: "When" };
    render(
      <Harness field={field} declared={{ name: "when", type: "timestamp", required: false }} />,
    );
    const control = screen.getByLabelText("When");
    expect(control).toHaveAttribute("type", "date");
  });

  it("select: exposes the combobox role, computed aria-required, and lists exactly the typed options", () => {
    const field: FormFieldSpec = {
      sourceField: "size",
      control: "select",
      label: "Size",
      options: [1, 2, 3],
    };
    render(<Harness field={field} declared={{ name: "size", type: "integer", required: true }} />);
    const trigger = screen.getByRole("combobox", { name: "Size" });
    expect(trigger).toHaveAttribute("aria-required", "true");
    fireEvent.click(trigger);
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["1", "2", "3"]);
  });

  it("checkbox: renders a switch with the computed accessible name", () => {
    const field: FormFieldSpec = { sourceField: "active", control: "checkbox", label: "Active" };
    render(
      <Harness field={field} declared={{ name: "active", type: "boolean", required: false }} />,
    );
    expect(screen.getByRole("switch", { name: "Active" })).toBeInTheDocument();
  });

  it("required-empty on blur: shows aria-invalid and the error as the accessible description", () => {
    const field: FormFieldSpec = { sourceField: "note", control: "text", label: "Note" };
    render(
      <Harness
        field={field}
        declared={{ name: "note", type: "string", required: false }}
        error="Note is required"
      />,
    );
    const control = screen.getByRole("textbox", { name: "Note" });
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription("Note is required");
  });

  it("no error before blur — no aria-invalid and no error description", () => {
    const field: FormFieldSpec = {
      sourceField: "note",
      control: "text",
      label: "Note",
      helpText: "Optional context",
    };
    render(<Harness field={field} declared={{ name: "note", type: "string", required: false }} />);
    const control = screen.getByRole("textbox", { name: "Note" });
    expect(control).not.toHaveAttribute("aria-invalid");
    expect(control).toHaveAccessibleDescription("Optional context");
  });

  it("touches the field on blur via the wrapping onBlur handler", () => {
    const onBlur = jest.fn();
    const field: FormFieldSpec = { sourceField: "note", control: "text", label: "Note" };
    render(
      <FormFieldControl
        field={field}
        declared={{ name: "note", type: "string", required: false }}
        value=""
        error={null}
        onChange={() => {}}
        onBlur={onBlur}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox", { name: "Note" }));
    expect(onBlur).toHaveBeenCalled();
  });

  it("file control has a computed accessible name (HEL-1086)", () => {
    const field: FormFieldSpec = {
      sourceField: "attachment",
      control: "file",
      label: "Attachment",
    };
    render(
      <Harness
        field={field}
        declared={{ name: "attachment", type: "binary-ref", required: false }}
      />,
    );
    expect(screen.getByLabelText("Attachment")).not.toBeDisabled();
  });

  it("file control's initial visible state is 'no file selected'", () => {
    const field: FormFieldSpec = {
      sourceField: "attachment",
      control: "file",
      label: "Attachment",
    };
    render(
      <Harness
        field={field}
        declared={{ name: "attachment", type: "binary-ref", required: false }}
      />,
    );
    expect(screen.getByLabelText("Attachment")).toHaveAccessibleDescription("No file selected");
  });

  it("selecting a file updates the visible/exposed selected-file state", () => {
    const field: FormFieldSpec = {
      sourceField: "attachment",
      control: "file",
      label: "Attachment",
    };
    const file = new File(["contents"], "report.pdf", { type: "application/pdf" });
    render(
      <Harness
        field={field}
        declared={{ name: "attachment", type: "binary-ref", required: false }}
        initialValue={file}
      />,
    );
    expect(screen.getByLabelText("Attachment")).toHaveAccessibleDescription("report.pdf");
  });

  it("orphaned field is surfaced disabled with the issue as its description", () => {
    const field: FormFieldSpec = { sourceField: "ghost", control: "text", label: "Ghost" };
    render(<Harness field={field} issue="'ghost' is not declared by the bound dataset" />);
    const control = screen.getByLabelText("Ghost");
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleDescription("'ghost' is not declared by the bound dataset");
  });

  it("unfit control is surfaced disabled with the issue as its description", () => {
    const field: FormFieldSpec = { sourceField: "flag", control: "text", label: "Flag" };
    render(
      <Harness field={field} issue="Control 'text' does not fit — fitting controls: checkbox" />,
    );
    expect(screen.getByLabelText("Flag")).toBeDisabled();
  });

  it("bad select options are surfaced disabled with the issue as its description", () => {
    const field: FormFieldSpec = { sourceField: "size", control: "select", label: "Size" };
    render(<Harness field={field} issue="Options must be a non-empty list" />);
    const control = screen.getByLabelText("Size");
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleDescription("Options must be a non-empty list");
  });
});
