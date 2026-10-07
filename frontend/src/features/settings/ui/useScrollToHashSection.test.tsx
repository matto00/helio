// HEL-1331 D6 -- the hash scroll fires on mount and again as page-level loading flags settle, and
// stops once the user has interacted.

import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { useScrollToHashSection } from "./useScrollToHashSection";

function Harness({ flags }: { flags: boolean[] }) {
  useScrollToHashSection("beta-access", flags);
  return <section id="beta-access">Beta access</section>;
}

function setup(hash: string, flags: boolean[]) {
  const scroll = jest.fn();
  window.HTMLElement.prototype.scrollIntoView = scroll;
  const ui = (f: boolean[]) => (
    <MemoryRouter initialEntries={[`/settings${hash}`]}>
      <Harness flags={f} />
    </MemoryRouter>
  );
  const view = render(ui(flags));
  return { scroll, rerender: (f: boolean[]) => view.rerender(ui(f)) };
}

describe("useScrollToHashSection", () => {
  it("scrolls on mount and again when a loading flag settles", () => {
    const { scroll, rerender } = setup("#beta-access", [true, true]);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    rerender([false, true]);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("does nothing for another or missing hash", () => {
    expect(setup("", [true]).scroll).not.toHaveBeenCalled();
    expect(setup("#other", [true]).scroll).not.toHaveBeenCalled();
  });

  it("stops auto-scrolling once the user has interacted", () => {
    const { scroll, rerender } = setup("#beta-access", [true]);
    fireEvent.wheel(window);
    rerender([false]);
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
