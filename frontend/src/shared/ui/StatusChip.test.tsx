import { render, screen } from "@testing-library/react";

import { StatusChip } from "./StatusChip";

describe("StatusChip", () => {
  it("renders its children", () => {
    render(<StatusChip intent="success">Succeeded</StatusChip>);
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
  });

  it("applies the intent class", () => {
    render(<StatusChip intent="error">Failed</StatusChip>);
    expect(screen.getByText("Failed")).toHaveClass("ui-status-chip--error");
  });

  it("does not render a dot by default", () => {
    const { container } = render(<StatusChip intent="neutral">Never run</StatusChip>);
    expect(container.querySelector(".ui-status-chip__dot")).not.toBeInTheDocument();
  });

  it("renders a leading dot when dot is set", () => {
    const { container } = render(
      <StatusChip intent="accent" dot>
        Running
      </StatusChip>,
    );
    expect(container.querySelector(".ui-status-chip__dot")).toBeInTheDocument();
  });

  it("applies the dashed modifier class when dashed is set", () => {
    render(
      <StatusChip intent="neutral" dashed>
        Dry run
      </StatusChip>,
    );
    expect(screen.getByText("Dry run")).toHaveClass("ui-status-chip--dashed");
  });

  it("merges a caller-supplied className", () => {
    render(
      <StatusChip intent="success" className="custom-class">
        Active
      </StatusChip>,
    );
    expect(screen.getByText("Active")).toHaveClass("custom-class");
  });
});
