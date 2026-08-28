import { fireEvent, render, screen } from "@testing-library/react";
import { faDatabase, faPlus } from "@fortawesome/free-solid-svg-icons";
import { TriangleAlert } from "lucide-react";

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

  describe('intent="error"', () => {
    it("carries an alert role, error-tinted styling, and no aria-label", () => {
      const { container } = render(
        <EmptyState
          intent="error"
          icon={<TriangleAlert />}
          title="Couldn't load sources"
          description="Something went wrong."
        />,
      );
      const root = screen.getByRole("alert");
      expect(root).toHaveClass("ui-empty-state--error");
      expect(root).not.toHaveAttribute("aria-label");
      expect(container.querySelector(".ui-empty-state__icon-wrap")).toBeInTheDocument();
    });

    it('defaults to intent="neutral" — no alert role, aria-label carries the title', () => {
      render(
        <EmptyState icon={faDatabase} title="No sources" description="Add one to get started." />,
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByLabelText("No sources")).toBeInTheDocument();
    });
  });

  // HEL-539 — icon prop widened to accept a ReactNode alongside IconDefinition
  describe("icon prop — IconDefinition vs ReactNode", () => {
    it("renders a FontAwesome IconDefinition via FontAwesomeIcon", () => {
      const { container } = render(
        <EmptyState icon={faDatabase} title="No sources" description="Add one to get started." />,
      );
      expect(container.querySelector("svg[data-icon='database']")).toBeInTheDocument();
    });

    it("renders a ReactNode icon directly, not wrapped in FontAwesomeIcon", () => {
      const { container } = render(
        <EmptyState
          icon={<TriangleAlert data-testid="lucide-icon" />}
          title="Couldn't load"
          description="Something went wrong."
        />,
      );
      expect(screen.getByTestId("lucide-icon")).toBeInTheDocument();
      expect(container.querySelector("svg[data-icon]")).not.toBeInTheDocument();
    });
  });

  it("renders cta and secondaryCta together, using the Primary/Secondary recipes respectively", () => {
    const handlePrimary = jest.fn();
    const handleSecondary = jest.fn();
    render(
      <EmptyState
        intent="error"
        icon={<TriangleAlert />}
        title="Couldn't load sources"
        description="Something went wrong."
        cta={{ label: "Retry", onClick: handlePrimary }}
        secondaryCta={{ label: "Back to dashboards", onClick: handleSecondary }}
      />,
    );
    const primary = screen.getByRole("button", { name: "Retry" });
    const secondary = screen.getByRole("button", { name: "Back to dashboards" });
    expect(primary).toHaveClass("ui-empty-state__cta");
    expect(secondary).toHaveClass("ui-empty-state__secondary-cta");
    fireEvent.click(primary);
    fireEvent.click(secondary);
    expect(handlePrimary).toHaveBeenCalledTimes(1);
    expect(handleSecondary).toHaveBeenCalledTimes(1);
  });

  // HEL-539 — disabled + caller-supplied in-flight label (component-agnostic;
  // contrast InlineError.retrying, which IS component-owned)
  it("cta.disabled renders the caller-supplied label and disables the button", () => {
    render(
      <EmptyState
        intent="error"
        icon={<TriangleAlert />}
        title="Couldn't load sources"
        description="Something went wrong."
        cta={{ label: "Retrying…", onClick: jest.fn(), disabled: true }}
      />,
    );
    const button = screen.getByRole("button", { name: "Retrying…" });
    expect(button).toBeDisabled();
  });

  it("cta.icon accepts a ReactNode alongside the existing FontAwesome IconDefinition", () => {
    const { container } = render(
      <EmptyState
        icon={faDatabase}
        title="No sources"
        description="Add one to get started."
        cta={{ label: "Add source", icon: faPlus, onClick: jest.fn() }}
      />,
    );
    expect(container.querySelector(".ui-empty-state__cta-icon")).toBeInTheDocument();
  });
});
