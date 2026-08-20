import { render, screen, fireEvent } from "@testing-library/react";

import { SidebarItemList } from "./SidebarItemList";

const items = [
  { id: "src-1", name: "Profit" },
  { id: "src-2", name: "Netflix" },
];

function renderList(deleteWarning?: (item: { id: string; name: string }) => string | null) {
  return render(
    <SidebarItemList
      heading="Data Sources"
      items={items}
      status="succeeded"
      onSelect={jest.fn()}
      onDelete={jest.fn()}
      deleteWarning={deleteWarning}
    />,
  );
}

function openDeleteConfirm(itemName: string) {
  fireEvent.click(screen.getByRole("button", { name: `${itemName} actions` }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
}

// HEL-718 evaluation-1.md Change Request 1: the header "+" add button
// reused DashboardList.css's `.dashboard-list__add` class (imported at the
// top of this file) and was left unstyled when that recipe was deleted in
// favor of the shared IconButton primitive -- this locks in that the button
// is now a real IconButton instance (not just carrying an aria-label) so a
// future CSS-consolidation pass can't silently regress it the same way.
describe("SidebarItemList header add button (HEL-718)", () => {
  it("renders the add button as an IconButton with a matching title tooltip", () => {
    render(
      <SidebarItemList
        heading="Data Pipelines"
        items={items}
        status="succeeded"
        onSelect={jest.fn()}
        onAdd={jest.fn()}
        addLabel="New pipeline"
      />,
    );

    const addButton = screen.getByRole("button", { name: "New pipeline" });
    expect(addButton).toHaveClass("ui-icon-btn", "ui-icon-btn--secondary", "ui-icon-btn--xs");
    expect(addButton).toHaveAttribute("title", "New pipeline");
  });

  it("calls onAdd when clicked", () => {
    const onAdd = jest.fn();
    render(
      <SidebarItemList
        heading="Data Pipelines"
        items={items}
        status="succeeded"
        onSelect={jest.fn()}
        onAdd={onAdd}
        addLabel="New pipeline"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New pipeline" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("defaults the aria-label from heading when addLabel is omitted", () => {
    render(
      <SidebarItemList
        heading="Data Sources"
        items={items}
        status="succeeded"
        onSelect={jest.fn()}
        onAdd={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add data source" })).toBeInTheDocument();
  });
});

describe("SidebarItemList filter-clear button (HEL-718)", () => {
  it("has a visible title tooltip matching its aria-label once a filter query is entered", () => {
    render(
      <SidebarItemList
        heading="Data Sources"
        items={items}
        status="succeeded"
        onSelect={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter data sources by name"), {
      target: { value: "prof" },
    });

    expect(screen.getByRole("button", { name: "Clear filter" })).toHaveAttribute(
      "title",
      "Clear filter",
    );
  });
});

describe("SidebarItemList delete-confirm warning", () => {
  it("shows the dependency warning while confirming when deleteWarning returns text", () => {
    renderList((item) =>
      item.id === "src-1" ? "2 pipelines read from this source and will stop working." : null,
    );

    openDeleteConfirm("Profit");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "2 pipelines read from this source and will stop working.",
    );
    expect(screen.getByRole("button", { name: "Confirm delete Profit" })).toBeInTheDocument();
  });

  it("shows no warning when deleteWarning returns null", () => {
    renderList(() => null);

    openDeleteConfirm("Netflix");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delete Netflix" })).toBeInTheDocument();
  });

  it("shows no warning when deleteWarning is not provided", () => {
    renderList();

    openDeleteConfirm("Profit");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SidebarItemList subtitle (provenance)", () => {
  it("renders the subtitle under the name when an item sets one", () => {
    render(
      <SidebarItemList
        heading="Type Registry"
        items={[{ id: "t-1", name: "RevenueRow", subtitle: "Pipeline: Revenue ETL" }]}
        status="succeeded"
        onSelect={jest.fn()}
      />,
    );

    const row = screen.getByText("RevenueRow").closest("li");
    expect(row?.querySelector(".dashboard-list__subtitle")).toHaveTextContent(
      "Pipeline: Revenue ETL",
    );
  });

  it("renders no subtitle element for items that omit one (other-sections guard)", () => {
    render(
      <SidebarItemList
        heading="Type Registry"
        items={[{ id: "t-1", name: "RevenueRow" }]}
        status="succeeded"
        onSelect={jest.fn()}
      />,
    );

    const row = screen.getByText("RevenueRow").closest("li");
    expect(row?.querySelector(".dashboard-list__subtitle")).not.toBeInTheDocument();
  });

  it("filters on name only — a subtitle-only match yields the no-matches state", () => {
    render(
      <SidebarItemList
        heading="Type Registry"
        items={[{ id: "t-1", name: "RevenueRow", subtitle: "Pipeline: Revenue ETL" }]}
        status="succeeded"
        onSelect={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Filter type registry by name/i }), {
      target: { value: "Revenue ETL" },
    });

    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryByText("RevenueRow")).not.toBeInTheDocument();
  });
});

// HEL-664 design.md D3 (design-gate round 1 fix): `renderRowAction` renders a
// genuine sibling of the row's own selectable button, not nested inside it —
// so a clickable control there needs no `stopPropagation()` to keep its own
// click from also firing `onSelect`.
describe("SidebarItemList renderRowAction", () => {
  it("renders the row action as a sibling of the row's own button", () => {
    render(
      <SidebarItemList
        heading="Chat"
        items={items}
        status="succeeded"
        onSelect={jest.fn()}
        renderRowAction={(item) => <button type="button">{`Pin ${item.name}`}</button>}
      />,
    );

    const row = screen.getByText("Profit").closest("li");
    expect(row?.querySelector(".dashboard-list__row-action")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pin Profit" })).toBeInTheDocument();
  });

  it("clicking the row action does not also dispatch onSelect", () => {
    const onSelect = jest.fn();
    render(
      <SidebarItemList
        heading="Chat"
        items={items}
        status="succeeded"
        onSelect={onSelect}
        renderRowAction={(item) => <button type="button">{`Pin ${item.name}`}</button>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pin Profit" }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("omits the row-action slot entirely when the prop is unset (other-sections guard)", () => {
    render(
      <SidebarItemList
        heading="Data Sources"
        items={items}
        status="succeeded"
        onSelect={jest.fn()}
      />,
    );

    expect(document.querySelector(".dashboard-list__row-action")).not.toBeInTheDocument();
  });
});

// HEL-539 (skeptic-final-1.md CR2) — a fetch failure must read as an error
// (icon + role="alert" + intent-error tint) here too, matching
// DashboardList.tsx's sibling Dashboards section — not the old bare muted
// `<p role="alert">` that carried no visual error signal at all.
describe("SidebarItemList — error state (HEL-539)", () => {
  it("renders a visible, icon-paired error via StatusMessage on fetch failure", () => {
    render(
      <SidebarItemList
        heading="Data Sources"
        items={[]}
        status="failed"
        error="Failed to load sources."
        onSelect={jest.fn()}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Failed to load sources.");
    expect(alert).toHaveClass("status-message--error");
    expect(alert.querySelector("svg")).toBeInTheDocument();
    // Deliberately no Retry — this component has no re-dispatchable fetch
    // wired through it.
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders the loading message via StatusMessage, with no alert role", () => {
    render(
      <SidebarItemList heading="Data Sources" items={[]} status="loading" onSelect={jest.fn()} />,
    );

    expect(screen.getByText("Loading data sources…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
