import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { SourceDeleteConflictNotice } from "./SourceDeleteConflictNotice";

type Pipeline = { id: string; name: string; references?: string[] };
type Panel = { id: string; title: string; dashboardId: string; dashboardName: string };

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-/;
const SERVER_MESSAGE =
  "This source is still referenced by pipeline(s) 'Sales' (2fd4f051-c04e-48b2-9297-14255cbc65a2; as root); a pipeline you cannot access.";

function renderNotice(
  pipelines: Pipeline[],
  opts: {
    message?: string;
    panels?: Panel[];
    hiddenPipelines?: number;
    hiddenPanels?: number;
  } = {},
) {
  return render(
    <MemoryRouter>
      <SourceDeleteConflictNotice
        sourceName="Warehouse"
        conflict={{
          kind: "conflict",
          message: opts.message ?? SERVER_MESSAGE,
          pipelines: pipelines.map((p) => ({ references: [], ...p })),
          panels: opts.panels ?? [],
          hiddenPipelineCount: opts.hiddenPipelines ?? 0,
          hiddenPanelCount: opts.hiddenPanels ?? 0,
        }}
        onDismiss={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe("SourceDeleteConflictNotice (HEL-989 / HEL-1252)", () => {
  it("links each named pipeline to its editor and labels the reference kinds", () => {
    renderNotice([
      { id: "p-1", name: "Sales", references: ["root", "join"] },
      { id: "p-2", name: "Ops", references: ["upsertTarget"] },
    ]);
    expect(screen.getByRole("alert")).toHaveTextContent(/"Warehouse" was not deleted: it is still/);
    expect(screen.getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/pipelines/p-1");
    expect(screen.getByRole("link", { name: "Ops" })).toHaveAttribute("href", "/pipelines/p-2");
    expect(screen.getByRole("alert")).toHaveTextContent("root, join input");
    expect(screen.getByRole("alert")).toHaveTextContent("upsert target");
  });

  it("does not describe a non-root reference as a root", () => {
    renderNotice([{ id: "p-1", name: "Sales", references: ["join"] }]);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/\broot\b/);
  });

  it("shows a panel-only conflict with a link to the dashboard", () => {
    renderNotice([], {
      panels: [{ id: "pn-1", title: "Entry", dashboardId: "d-1", dashboardName: "Ops board" }],
    });
    expect(screen.getByRole("link", { name: "Entry" })).toHaveAttribute("href", "/dashboards/d-1");
    expect(screen.getByRole("alert")).toHaveTextContent("form panel on Ops board");
  });

  it("composes its own copy for a mixed visible + hidden conflict: hidden count shown, no UUIDs, each reference once", () => {
    renderNotice([{ id: "p-1", name: "Sales", references: ["root"] }], {
      panels: [{ id: "pn-1", title: "Entry", dashboardId: "d-1", dashboardName: "Ops board" }],
      hiddenPipelines: 2,
      hiddenPanels: 1,
    });
    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toContain("2 pipelines you cannot access");
    expect(text).toContain("a form panel you cannot access");
    expect(text).not.toMatch(UUID_LIKE);
    expect(text).not.toContain("2fd4f051");
    expect(text.match(/Sales/g)).toHaveLength(1);
    expect(text.match(/Entry/g)).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("states a hidden-only conflict as a sentence from the structured counts, with no links", () => {
    renderNotice([], { hiddenPipelines: 1 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"Warehouse" was not deleted: it is still referenced by a pipeline you cannot access. Remove each reference first.',
    );
    expect(screen.getByRole("alert").textContent).not.toMatch(UUID_LIKE);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("falls back to the server message only for an older server body with no structured data", () => {
    render(
      <MemoryRouter>
        <SourceDeleteConflictNotice
          sourceName="Warehouse"
          conflict={{ kind: "conflict", message: "old server says no", pipelines: [], panels: [] }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("old server says no");
  });
});
