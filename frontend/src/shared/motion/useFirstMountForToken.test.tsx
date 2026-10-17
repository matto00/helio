import { render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";

import { resetFirstMountRegistryForTests, useFirstMountForToken } from "./useFirstMountForToken";

const reports: { latest: boolean | null } = { latest: null };
function Probe({ scope = "s", token }: { scope?: string; token: string }) {
  const first = useFirstMountForToken(scope, token);
  useEffect(() => {
    reports.latest = first;
  });
  return null;
}

describe("useFirstMountForToken", () => {
  beforeEach(() => {
    resetFirstMountRegistryForTests();
    reports.latest = null;
  });

  it("is true on the first mount of a token and false on a remount with the same token", () => {
    const first = render(<Probe token="a" />);
    expect(reports.latest).toBe(true);
    first.unmount();
    render(<Probe token="a" />);
    expect(reports.latest).toBe(false);
  });

  it("is true again for a new token, and per scope", () => {
    render(<Probe token="a" />).unmount();
    render(<Probe token="b" />).unmount();
    expect(reports.latest).toBe(true);
    render(<Probe scope="other" token="a" />);
    expect(reports.latest).toBe(true);
  });

  it("records every token seen while mounted, not only the one at mount", () => {
    const view = render(<Probe token="a" />);
    view.rerender(<Probe token="b" />);
    expect(reports.latest).toBe(true); // latched at mount
    view.unmount();
    render(<Probe token="b" />);
    expect(reports.latest).toBe(false);
  });

  it("a token that arrived while nothing was mounted is still new", () => {
    render(<Probe token="a" />).unmount();
    render(<Probe token="c" />);
    expect(reports.latest).toBe(true);
  });

  it("is StrictMode-safe: the double initializer and the simulated remount agree", () => {
    render(
      <StrictMode>
        <Probe token="a" />
      </StrictMode>,
    );
    expect(reports.latest).toBe(true);
    render(
      <StrictMode>
        <Probe token="a" />
      </StrictMode>,
    );
    expect(reports.latest).toBe(false);
  });
});
