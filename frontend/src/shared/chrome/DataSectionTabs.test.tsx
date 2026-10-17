import { screen } from "@testing-library/react";

import { renderWithStore } from "../../test/renderWithStore";
import { DataSectionTabs } from "./DataSectionTabs";

function setPhone(isPhone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isPhone && /max-width:\s*768px/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  // jsdom ships no matchMedia; restoring "undefined" keeps other suites on the desktop shell.
  delete (window as Partial<Window>).matchMedia;
});

describe("DataSectionTabs (HEL-1583 D8)", () => {
  it("links Sources and Connectors on the phone shell, marking the current page aria-current=page", () => {
    setPhone(true);
    renderWithStore(<DataSectionTabs />, undefined, "/connectors");
    const nav = screen.getByRole("navigation", { name: "Data sections" });
    expect(nav).toBeInTheDocument();
    const sources = screen.getByRole("link", { name: "Sources" });
    const connectors = screen.getByRole("link", { name: "Connectors" });
    expect(sources).toHaveAttribute("href", "/sources");
    expect(connectors).toHaveAttribute("href", "/connectors");
    expect(connectors).toHaveAttribute("aria-current", "page");
    expect(sources).not.toHaveAttribute("aria-current");
  });

  it("marks Sources current on a source sub-route", () => {
    setPhone(true);
    renderWithStore(<DataSectionTabs />, undefined, "/sources/abc");
    expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Connectors" })).not.toHaveAttribute("aria-current");
  });

  it("is not rendered above the phone shell", () => {
    setPhone(false);
    renderWithStore(<DataSectionTabs />, undefined, "/sources");
    expect(screen.queryByRole("navigation", { name: "Data sections" })).not.toBeInTheDocument();
  });
});
