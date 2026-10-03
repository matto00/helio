import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { SourceDeleteConflictNotice } from "./SourceDeleteConflictNotice";

function renderNotice(pipelines: { id: string; name: string }[], message = "server reason") {
  return render(
    <MemoryRouter>
      <SourceDeleteConflictNotice
        sourceName="Warehouse"
        conflict={{ kind: "conflict", message, pipelines }}
        onDismiss={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe("SourceDeleteConflictNotice (HEL-989)", () => {
  it("links each named pipeline to its editor", () => {
    renderNotice([
      { id: "p-1", name: "Sales" },
      { id: "p-2", name: "Ops" },
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent(/"Warehouse" was not deleted/);
    expect(screen.getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/pipelines/p-1");
    expect(screen.getByRole("link", { name: "Ops" })).toHaveAttribute("href", "/pipelines/p-2");
  });

  it("falls back to the server reason, with no links, when no pipeline is visible", () => {
    renderNotice([], "this source is a root of a pipeline you cannot access");
    expect(screen.getByRole("alert")).toHaveTextContent("a pipeline you cannot access");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
