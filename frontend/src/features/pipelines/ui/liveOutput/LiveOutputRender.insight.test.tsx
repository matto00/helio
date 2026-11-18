import { render, screen } from "@testing-library/react";

import { LiveOutputRender } from "./LiveOutputRender";

describe("LiveOutputRender insight (HEL-1740)", () => {
  it("shows the not-yet-rendered state and ignores the rows", () => {
    render(
      <LiveOutputRender
        kind="insight"
        config={{ preset: "auto" }}
        schema={[{ name: "region", type: "string" }]}
        records={[{ region: "Bound value" }]}
      />,
    );
    expect(screen.getByText("Not yet rendered")).toBeInTheDocument();
    expect(
      screen.getByText("This insight will appear after its first render."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bound value")).toBeNull();
  });
});
