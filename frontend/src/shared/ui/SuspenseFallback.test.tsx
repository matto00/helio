import { render } from "@testing-library/react";

import { PanelSuspenseFallback, PageSuspenseFallback } from "./SuspenseFallback";

describe("PanelSuspenseFallback", () => {
  it("renders a labelled skeleton matching the panel data-loading pattern (HEL-528 design.md D6)", () => {
    const { container } = render(<PanelSuspenseFallback />);
    expect(container.querySelector('[aria-label="Loading data"]')).toBeInTheDocument();
    expect(container.querySelector(".panel-body-skeleton")).toBeInTheDocument();
    expect(container.querySelector(".ui-skeleton")).toBeInTheDocument();
    // No spinner here anymore — the chunk-load and data-load states share
    // one skeleton treatment (design.md D6), not a spinner.
    expect(container.querySelector(".ui-spinner")).not.toBeInTheDocument();
  });
});

describe("PageSuspenseFallback", () => {
  it("renders an unlabelled full-width loading indicator", () => {
    const { container } = render(<PageSuspenseFallback />);
    expect(container.querySelector('[aria-label="Loading"]')).toBeInTheDocument();
    expect(container.querySelector(".ui-spinner--2xl")).toBeInTheDocument();
  });
});
