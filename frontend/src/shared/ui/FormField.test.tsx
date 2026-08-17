import { render, screen } from "@testing-library/react";

import { FormField } from "./FormField";

describe("FormField", () => {
  it("renders the label wired to the control via htmlFor/id", () => {
    render(
      <FormField label="Pipeline name" htmlFor="pipeline-name">
        <input id="pipeline-name" />
      </FormField>,
    );

    const input = screen.getByLabelText("Pipeline name");
    expect(input).toBeInTheDocument();
  });

  it("renders children between the label and any error/hint", () => {
    render(
      <FormField label="Output type name">
        <input aria-label="Output type name" />
      </FormField>,
    );

    expect(screen.getByLabelText("Output type name")).toBeInTheDocument();
  });

  it("appends an '(optional)' suffix to the label when optional", () => {
    render(
      <FormField label="Description" optional>
        <input />
      </FormField>,
    );

    expect(screen.getByText("(optional)")).toBeInTheDocument();
  });

  it("renders the error message with role=alert when error is set", () => {
    render(
      <FormField label="Pipeline name" error="Name is required">
        <input />
      </FormField>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
  });

  it("renders the hint when there is no error", () => {
    render(
      <FormField label="Pipeline name" hint="Shown in the pipeline list">
        <input />
      </FormField>,
    );

    expect(screen.getByText("Shown in the pipeline list")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prefers the error over the hint when both are provided", () => {
    render(
      <FormField label="Pipeline name" error="Name is required" hint="Shown in the pipeline list">
        <input />
      </FormField>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    expect(screen.queryByText("Shown in the pipeline list")).not.toBeInTheDocument();
  });

  it("renders neither error nor hint when both are omitted", () => {
    render(
      <FormField label="Pipeline name">
        <input />
      </FormField>,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
