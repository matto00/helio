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

  it("counter: renders a spinbutton and is always aria-required, regardless of declared/config required", () => {
    const field: FormFieldSpec = { sourceField: "delta", control: "counter", label: "Delta" };
    render(
      <Harness field={field} declared={{ name: "delta", type: "integer", required: false }} />,
    );
    const control = screen.getByRole("spinbutton", { name: "Delta" });
    expect(control).toHaveAttribute("aria-required", "true");
  });

  it("counter: exposes computed ARIA value/step state and defaults step to 1", () => {
    const field: FormFieldSpec = { sourceField: "delta", control: "counter", label: "Delta" };
    render(
      <Harness
        field={field}
        declared={{ name: "delta", type: "integer", required: false }}
        initialValue="3"
      />,
    );
    const control = screen.getByRole("spinbutton", { name: "Delta" });
    expect(control).toHaveAttribute("aria-valuenow", "3");
    expect(control).toHaveAttribute("aria-valuetext", "3, step 1");
  });

  it("counter: exposes the configured step in aria-valuetext", () => {
    const field: FormFieldSpec = {
      sourceField: "delta",
      control: "counter",
      label: "Delta",
      step: 5,
    };
    render(
      <Harness
        field={field}
        declared={{ name: "delta", type: "integer", required: false }}
        initialValue="12"
      />,
    );
    const control = screen.getByRole("spinbutton", { name: "Delta" });
    expect(control).toHaveAttribute("aria-valuenow", "12");
    expect(control).toHaveAttribute("aria-valuetext", "12, step 5");
  });

  it("counter: non-immediate +/- updates local value via onChange, never submits directly", () => {
    const onChange = jest.fn();
    const field: FormFieldSpec = {
      sourceField: "delta",
      control: "counter",
      label: "Delta",
      step: 2,
    };
    render(
      <FormFieldControl
        field={field}
        declared={{ name: "delta", type: "integer", required: false }}
        value="4"
        error={null}
        onChange={onChange}
        onBlur={() => {}}
        immediate={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /increase delta/i }));
    expect(onChange).toHaveBeenCalledWith("6");
  });

  it("counter: immediate mode calls onImmediateStep instead of onChange", () => {
    const onChange = jest.fn();
    const onImmediateStep = jest.fn();
    const field: FormFieldSpec = { sourceField: "delta", control: "counter", label: "Delta" };
    render(
      <FormFieldControl
        field={field}
        declared={{ name: "delta", type: "integer", required: false }}
        value="0"
        error={null}
        onChange={onChange}
        onBlur={() => {}}
        immediate
        onImmediateStep={onImmediateStep}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /increase delta/i }));
    expect(onImmediateStep).toHaveBeenCalledWith(1);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /decrease delta/i }));
    expect(onImmediateStep).toHaveBeenCalledWith(-1);
  });

  // HEL-1095 tasks.md 2.5, design.md D8: computed aria-busy, plumbed from the caller's own
  // pending state -- never DOM presence.
  it("counter: immediate mode exposes the caller's `busy` prop as aria-busy on the spinbutton", () => {
    const field: FormFieldSpec = { sourceField: "delta", control: "counter", label: "Delta" };
    const { rerender } = render(
      <FormFieldControl
        field={field}
        declared={{ name: "delta", type: "integer", required: false }}
        value="0"
        error={null}
        onChange={() => {}}
        onBlur={() => {}}
        immediate
        onImmediateStep={() => {}}
        busy={false}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "Delta" })).not.toHaveAttribute("aria-busy");

    rerender(
      <FormFieldControl
        field={field}
        declared={{ name: "delta", type: "integer", required: false }}
        value="0"
        error={null}
        onChange={() => {}}
        onBlur={() => {}}
        immediate
        onImmediateStep={() => {}}
        busy
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "Delta" })).toHaveAttribute("aria-busy", "true");
  });

  // A non-immediate counter (embedded in a multi-field form) has no request of its own to be
  // busy about -- `busy` must never surface there even if a caller mistakenly passes it.
  it("counter: a non-immediate counter never exposes aria-busy, even if `busy` is passed", () => {
    const field: FormFieldSpec = { sourceField: "delta", control: "counter", label: "Delta" };
    render(
      <FormFieldControl
        field={field}
        declared={{ name: "delta", type: "integer", required: false }}
        value="0"
        error={null}
        onChange={() => {}}
        onBlur={() => {}}
        immediate={false}
        busy
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "Delta" })).not.toHaveAttribute("aria-busy");
  });

  it("counter: ArrowUp/ArrowDown on the spinbutton step the value", () => {
    const onChange = jest.fn();
    const field: FormFieldSpec = { sourceField: "delta", control: "counter", label: "Delta" };
    render(
      <FormFieldControl
        field={field}
        declared={{ name: "delta", type: "integer", required: false }}
        value="0"
        error={null}
        onChange={onChange}
        onBlur={() => {}}
        immediate={false}
      />,
    );
    const control = screen.getByRole("spinbutton", { name: "Delta" });
    fireEvent.keyDown(control, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith("1");
    fireEvent.keyDown(control, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith("-1");
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
