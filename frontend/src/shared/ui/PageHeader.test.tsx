import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders only the title when no optional prop is given", () => {
    render(<PageHeader title="Data Sources" />);

    const title = screen.getByRole("heading", { level: 1, name: "Data Sources" });
    expect(title).toHaveClass("page-title");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the eyebrow above the title when given", () => {
    render(<PageHeader title="Data Sources" eyebrow="Overview" />);

    expect(screen.getByText("Overview")).toHaveClass("eyebrow");
  });

  it("renders a back link before the title and actions after it", () => {
    const onBack = jest.fn();
    render(
      <PageHeader
        title="Pipeline detail"
        onBack={onBack}
        actions={<button type="button">Edit</button>}
      />,
    );

    const back = screen.getByRole("button", { name: "Back" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("renders backTo as a react-router Link, not a full-page anchor", () => {
    render(
      <MemoryRouter>
        <PageHeader title="Pipeline detail" backTo="/pipelines" />
      </MemoryRouter>,
    );

    const back = screen.getByRole("link", { name: "Back" });
    expect(back).toHaveAttribute("href", "/pipelines");
  });

  it("prefers onBack over backTo when both are given", () => {
    const onBack = jest.fn();
    render(
      <MemoryRouter>
        <PageHeader title="Pipeline detail" backTo="/pipelines" onBack={onBack} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Back" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
