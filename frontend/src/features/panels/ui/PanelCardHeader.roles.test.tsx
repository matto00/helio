// HEL-1773 D5: a panel card's menu and move handle follow the caller's role on the dashboard (from `PanelList`'s provider).
import { fireEvent, render, screen } from "@testing-library/react";

import { DashboardAccessProvider } from "../../dashboards/state/dashboardAccessContext";
import type { DashboardAccessRole } from "../../dashboards/types/dashboard";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { PanelCardHeader } from "./PanelCardHeader";

const noop = jest.fn();
const panel = makeOutputPanel({ id: "p1", title: "Revenue", config: { outputId: "o1" } });

function renderHeader(role: DashboardAccessRole) {
  return render(
    <DashboardAccessProvider role={role}>
      <PanelCardHeader
        panel={panel}
        isEditingTitle={false}
        editingTitle=""
        editingTitleError={null}
        isConfirmingDelete={false}
        outputId="o1"
        refresh={noop}
        isRefreshing={false}
        isPending={() => false}
        chartInspectConfig={null}
        onCancelDelete={noop}
        handleConfirmDelete={noop}
        handleOpenFullscreen={noop}
        handleRename={noop}
        handleDetail={noop}
        handleDuplicate={noop}
        handleOpenInspectFromMenu={noop}
        handleRequestDelete={noop}
        handleTitleInputChange={noop}
        handleTitleKeyDown={noop}
        handleTitleBlur={noop}
      />
    </DashboardAccessProvider>,
  );
}

function menu(): string[] {
  fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));
  return screen.getAllByRole("menuitem").map((el) => el.textContent?.trim() ?? "");
}

describe("PanelCardHeader by role", () => {
  it("owner and editor: the full edit menu and the move handle", () => {
    for (const role of ["owner", "editor"] as const) {
      const { unmount } = renderHeader(role);
      expect(menu()).toEqual(["Rename", "Customize", "Duplicate", "Delete"]);
      expect(screen.getByRole("button", { name: "Move Revenue panel" })).toBeInTheDocument();
      unmount();
    }
  });

  it("viewer: view details only, and no move handle", () => {
    renderHeader("viewer");
    expect(menu()).toEqual(["View details"]);
    expect(screen.queryByRole("button", { name: "Move Revenue panel" })).toBeNull();
  });
});
