import { screen } from "@testing-library/react";

import { iso } from "../test/homeFixtures";
import { renderHome } from "../test/renderHome";
import { formatClock } from "../utils/timelineScale";
import { UpNext } from "./UpNext";

describe("UpNext", () => {
  it("lists each fire with its local time and pipeline name, linking to the pipeline, in the given order", () => {
    renderHome(
      <UpNext
        load="ready"
        items={[
          { pipelineId: "a", pipelineName: "first", at: iso(1) },
          { pipelineId: "b", pipelineName: "second", at: iso(2) },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/pipelines/a", "/pipelines/b"]);
    expect(links[0]).toHaveTextContent(`${formatClock(Date.parse(iso(1)))}first`);
  });

  it("has a plain empty state with a link to Data Pipelines", () => {
    renderHome(<UpNext items={[]} load="ready" />);
    expect(screen.getByText(/Nothing is scheduled/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule a pipeline" })).toHaveAttribute(
      "href",
      "/pipelines",
    );
  });

  it("shows skeleton rows, never 'Nothing is scheduled', while loading or after a failed load", () => {
    const { rerender } = renderHome(<UpNext items={[]} load="loading" />);
    expect(screen.getByRole("status", { name: "Loading up next" })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is scheduled/)).not.toBeInTheDocument();
    rerender(<UpNext items={[]} load="failed" />);
    expect(screen.queryByText(/Nothing is scheduled/)).not.toBeInTheDocument();
    expect(screen.getByText("Not available right now.")).toBeInTheDocument();
  });
});
