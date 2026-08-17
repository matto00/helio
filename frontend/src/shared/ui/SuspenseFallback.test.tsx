import { render } from "@testing-library/react";

import { PanelSuspenseFallback, PageSuspenseFallback } from "./SuspenseFallback";

describe("PanelSuspenseFallback", () => {
  it("renders a labelled loading indicator matching the panel data-loading pattern", () => {
    const { container } = render(<PanelSuspenseFallback />);
    expect(container.querySelector('[aria-label="Loading data"]')).toBeInTheDocument();
    expect(container.querySelector(".ui-spinner--xl")).toBeInTheDocument();
    expect(container.querySelector(".suspense-fallback__label")).toHaveTextContent("Loading...");
  });
});

describe("PageSuspenseFallback", () => {
  it("renders an unlabelled full-width loading indicator", () => {
    const { container } = render(<PageSuspenseFallback />);
    expect(container.querySelector('[aria-label="Loading"]')).toBeInTheDocument();
    expect(container.querySelector(".ui-spinner--2xl")).toBeInTheDocument();
  });
});
