import { render, screen } from "@testing-library/react";

import { PageShell } from "./PageShell";

describe("PageShell", () => {
  it("renders children inside the standard page-shell container", () => {
    render(
      <PageShell>
        <p>Content</p>
      </PageShell>,
    );

    const content = screen.getByText("Content");
    expect(content.parentElement).toHaveClass("page-shell");
  });

  it("applies an additional className alongside the base class", () => {
    render(
      <PageShell className="sources-page">
        <p>Content</p>
      </PageShell>,
    );

    const content = screen.getByText("Content");
    expect(content.parentElement).toHaveClass("page-shell");
    expect(content.parentElement).toHaveClass("sources-page");
  });
});
