import { render, screen, fireEvent, within } from "@testing-library/react";

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
      initialLoad={false}
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
        initialLoad={false}
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
        initialLoad={false}
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
        initialLoad={false}
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
        initialLoad={false}
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
        initialLoad={false}
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
        initialLoad={false}
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
        initialLoad={false}
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

// HEL-548 D3/task 6.2/6.4 — filter-to-zero is its own EmptyState (SearchX
// icon, "No matches" title, query-quoting description, "Clear filter" CTA),
// distinct from the no-data-yet state and shared by every section that
// reuses this component.
describe("SidebarItemList filtered empty state (HEL-548 D3)", () => {
  it("names the query and offers a Clear filter action, distinct from the no-data empty state", () => {
    render(
      <SidebarItemList
        heading="Data Sources"
        items={items}
        initialLoad={false}
        onSelect={jest.fn()}
        emptyIcon={<span data-testid="stub-icon" />}
        emptyText="Connect a data source"
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter data sources by name"), {
      target: { value: "zzz-nope" },
    });

    const filteredState = screen.getByLabelText("No matches");
    expect(
      within(filteredState).getByText('No data sources match "zzz-nope".'),
    ).toBeInTheDocument();
    // Distinct from the no-data title — never rendered here.
    expect(screen.queryByText("Connect a data source")).not.toBeInTheDocument();
    expect(within(filteredState).getByRole("button", { name: "Clear filter" })).toBeInTheDocument();
  });

  it("clearing the filtered empty state's CTA restores the list", () => {
    render(
      <SidebarItemList
        heading="Data Sources"
        items={items}
        initialLoad={false}
        onSelect={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter data sources by name"), {
      target: { value: "zzz-nope" },
    });
    fireEvent.click(
      within(screen.getByLabelText("No matches")).getByRole("button", { name: "Clear filter" }),
    );

    expect(screen.getByText("Profit")).toBeInTheDocument();
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });
});

// HEL-548 D4a/task 5.2 — `emptyCta` is consumed ONLY by the no-data branch;
// falls back to `onAdd` when unset (the four pre-existing call sites'
// shape, unaffected).
describe("SidebarItemList emptyCta (HEL-548 D4a)", () => {
  it("renders emptyCta (not onAdd) on the no-data empty state when both are technically available", () => {
    const onAdd = jest.fn();
    const emptyCtaClick = jest.fn();
    render(
      <SidebarItemList
        heading="Data Types"
        items={[]}
        initialLoad={false}
        onSelect={jest.fn()}
        emptyIcon={<span data-testid="stub-icon" />}
        emptyText="No types defined"
        onAdd={onAdd}
        emptyCta={{ label: "New pipeline", onClick: emptyCtaClick }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New pipeline" }));
    expect(emptyCtaClick).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("falls back to onAdd's derived label when emptyCta is not provided (pre-existing four call sites, unaffected)", () => {
    const onAdd = jest.fn();
    render(
      <SidebarItemList
        heading="Data Sources"
        items={[]}
        initialLoad={false}
        onSelect={jest.fn()}
        emptyIcon={<span data-testid="stub-icon" />}
        onAdd={onAdd}
        addLabel="Add source"
      />,
    );

    const emptyState = screen.getByLabelText("No data sources yet");
    fireEvent.click(within(emptyState).getByRole("button", { name: "Add source" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  // Skeptic final-gate round 1 CR1 — the fallback CTA rendered without a
  // leading glyph while the explicit `emptyCta` path (Data Types) and
  // `DashboardList`'s own `EmptyState` both carry `icon: <Plus />`, so
  // `/pipelines` and `/sources` showed the same-labelled action glyphed on
  // the main surface and bare on the sidebar, simultaneously on one screen.
  // Locks in that the fallback descriptor now carries an icon too, so the
  // uniformity can't silently regress back to a bare button.
  it("renders a leading icon on the fallback CTA (onAdd path), matching the explicit emptyCta path", () => {
    const onAdd = jest.fn();
    render(
      <SidebarItemList
        heading="Data Sources"
        items={[]}
        initialLoad={false}
        onSelect={jest.fn()}
        emptyIcon={<span data-testid="stub-icon" />}
        onAdd={onAdd}
        addLabel="Add source"
      />,
    );

    const emptyState = screen.getByLabelText("No data sources yet");
    const button = within(emptyState).getByRole("button", { name: "Add source" });
    expect(button.querySelector("svg")).toBeInTheDocument();
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
        initialLoad={false}
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
        initialLoad={false}
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
        initialLoad={false}
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
        initialLoad={false}
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
});

// HEL-528 — initial-load skeleton, gated on the call site's own `initialLoad`
// flag rather than an internal `status === "loading"` check (design.md D11).
describe("SidebarItemList — loading state (HEL-528)", () => {
  it("renders shape-matched skeleton rows instead of a bare loading text line", () => {
    const { container } = render(
      <SidebarItemList heading="Data Sources" items={[]} initialLoad onSelect={jest.fn()} />,
    );

    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".ui-skeleton").length).toBeGreaterThan(0);
    expect(
      container.querySelector('.dashboard-list__items[aria-label="Loading data sources…"]'),
    ).toBeInTheDocument();
  });

  it("keeps rendering existing items during a refetch instead of flashing a skeleton (D4)", () => {
    const { container } = render(
      <SidebarItemList
        heading="Data Sources"
        items={items}
        initialLoad={false}
        onSelect={jest.fn()}
      />,
    );

    expect(container.querySelectorAll(".ui-skeleton").length).toBe(0);
    expect(screen.getByText("Profit")).toBeInTheDocument();
  });

  it("renders taller stacked-shape skeleton rows when rowShape is stacked (D9)", () => {
    const { container } = render(
      <SidebarItemList
        heading="Type Registry"
        items={[]}
        initialLoad
        rowShape="stacked"
        onSelect={jest.fn()}
      />,
    );

    const row = container.querySelector(".dashboard-list__button--stacked");
    expect(row).toBeInTheDocument();
    // Two skeleton lines (name + subtitle) inside the stacked row.
    expect(row?.querySelectorAll(".ui-skeleton").length).toBe(2);
  });

  it("renders single-line flat-shape skeleton rows by default", () => {
    const { container } = render(
      <SidebarItemList heading="Data Sources" items={[]} initialLoad onSelect={jest.fn()} />,
    );

    expect(container.querySelector(".dashboard-list__button--stacked")).not.toBeInTheDocument();
    const row = container.querySelector(".dashboard-list__button");
    expect(row?.querySelectorAll(".ui-skeleton").length).toBe(1);
  });
});
