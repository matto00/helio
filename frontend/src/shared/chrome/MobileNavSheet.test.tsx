import { fireEvent, render, screen } from "@testing-library/react";

import { MobileNavSheet, type MobileNavSheetItem } from "./MobileNavSheet";
import { OverlayProvider } from "./OverlayProvider";

const items: MobileNavSheetItem[] = [
  { id: "dash-1", name: "Ops Overview", isActive: true },
  { id: "dash-2", name: "Growth", isActive: false },
];

function renderSheet(overrides: Partial<Parameters<typeof MobileNavSheet>[0]> = {}) {
  const onClose = jest.fn();
  const onSelect = jest.fn();
  const utils = render(
    <OverlayProvider>
      <MobileNavSheet
        open
        onClose={onClose}
        title="Dashboards"
        items={items}
        onSelect={onSelect}
        {...overrides}
      />
    </OverlayProvider>,
  );
  return { ...utils, onClose, onSelect };
}

describe("MobileNavSheet", () => {
  it("renders nothing when closed", () => {
    render(
      <OverlayProvider>
        <MobileNavSheet
          open={false}
          onClose={jest.fn()}
          title="Dashboards"
          items={items}
          onSelect={jest.fn()}
        />
      </OverlayProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the title and lists items from the store-derived props, active item marked", () => {
    renderSheet();

    const dialog = screen.getByRole("dialog", { name: "Dashboards" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ops Overview/ })).toHaveClass(
      "mobile-nav-sheet__item--active",
    );
    expect(screen.getByRole("button", { name: /Growth/ })).not.toHaveClass(
      "mobile-nav-sheet__item--active",
    );
  });

  it("dispatches selection and dismisses on pick", () => {
    const { onSelect, onClose } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: /Growth/ }));

    expect(onSelect).toHaveBeenCalledWith(items[1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on backdrop tap", () => {
    const { onClose } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape via the shared overlay registry", () => {
    const { onClose } = renderSheet();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders no CRUD affordances — no add, delete, or actions-menu controls", () => {
    renderSheet();

    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actions/i })).not.toBeInTheDocument();
  });

  it("shows the empty-state message when there are no items — every section is a picker, never a dead end", () => {
    renderSheet({ items: [], emptyMessage: "No data sources yet." });

    expect(screen.getByText("No data sources yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ops Overview/ })).not.toBeInTheDocument();
  });

  it("renders the provenance subtitle for an item that sets one", () => {
    renderSheet({
      items: [
        { id: "type-1", name: "RevenueRow", isActive: false, subtitle: "Pipeline: Revenue ETL" },
      ],
    });

    const item = screen.getByRole("button", { name: /RevenueRow/ });
    expect(item.querySelector(".mobile-nav-sheet__item-subtitle")).toHaveTextContent(
      "Pipeline: Revenue ETL",
    );
  });

  it("renders no subtitle element for an item that omits one", () => {
    renderSheet({ items: [{ id: "type-1", name: "RevenueRow", isActive: false }] });

    const item = screen.getByRole("button", { name: /RevenueRow/ });
    expect(item.querySelector(".mobile-nav-sheet__item-subtitle")).not.toBeInTheDocument();
  });
});
