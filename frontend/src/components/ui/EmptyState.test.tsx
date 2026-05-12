import { fireEvent, render, screen } from "@testing-library/react";
import { faDatabase } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(
      <EmptyState
        icon={faDatabase}
        title="Connect a data source"
        description="Pull in data from PostgreSQL, MySQL, CSV, or static input."
      />,
    );

    expect(screen.getByText("Connect a data source")).toBeInTheDocument();
    expect(
      screen.getByText("Pull in data from PostgreSQL, MySQL, CSV, or static input."),
    ).toBeInTheDocument();
  });

  it("renders a CTA button and calls onClick when clicked", () => {
    const handleClick = jest.fn();
    render(
      <EmptyState
        icon={faDatabase}
        title="Connect a data source"
        description="Pull in data from PostgreSQL, MySQL, CSV, or static input."
        cta={{ label: "Add source", onClick: handleClick }}
      />,
    );

    const button = screen.getByRole("button", { name: "Add source" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("does not render a CTA button when no cta prop is provided", () => {
    render(
      <EmptyState
        icon={faDatabase}
        title="No types defined"
        description="Types are auto-generated from pipelines."
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies the sidebar variant class", () => {
    const { container } = render(
      <EmptyState
        variant="sidebar"
        icon={faDatabase}
        title="No sources"
        description="Add one to get started."
      />,
    );

    expect(container.firstChild).toHaveClass("ui-empty-state--sidebar");
  });

  it("applies the main variant class by default", () => {
    const { container } = render(
      <EmptyState icon={faDatabase} title="No sources" description="Add one to get started." />,
    );

    expect(container.firstChild).toHaveClass("ui-empty-state--main");
  });
});
