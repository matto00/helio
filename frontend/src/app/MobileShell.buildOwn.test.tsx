// HEL-1782 D6: the phone dashboard sheet ends its list with a "Build your own dashboard" row while the user owns none.
import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../test/renderWithStore";
import { MobileShell } from "./MobileShell";

function setup(
  items: Array<{ id: string; name: string; accessRole: "owner" | "editor" | "viewer" }>,
) {
  const onClose = jest.fn();
  const ctx = renderWithStore(
    <MobileShell isMobileNavSheetOpen onClose={onClose} />,
    {
      auth: {
        status: "authenticated",
        currentUser: { id: "me", email: "me@example.test", displayName: "Me" } as never,
      },
      dashboards: {
        items: items.map((i) => ({ ...i, ownerId: i.accessRole === "owner" ? "me" : "other" })),
        selectedDashboardId: items[0].id,
        status: "succeeded",
      },
    },
    "/dashboards",
  );
  return { ...ctx, onClose };
}

describe("phone dashboard sheet build-your-own row (HEL-1782)", () => {
  it("is offered to a shared-only user, after the list, and closes the open dashboard and the sheet", () => {
    const { store, onClose } = setup([{ id: "vw", name: "Theirs", accessRole: "viewer" }]);
    const row = screen.getByRole("button", { name: "Build your own dashboard" });
    expect(row.closest("li")?.parentElement?.lastElementChild).toBe(row.closest("li"));
    fireEvent.click(row);
    expect(store.getState().dashboards.selectedDashboardId).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it("is absent once the user owns a dashboard", () => {
    setup([
      { id: "ed", name: "Edit me", accessRole: "editor" },
      { id: "own", name: "Mine", accessRole: "owner" },
    ]);
    expect(screen.queryByRole("button", { name: "Build your own dashboard" })).toBeNull();
  });

  it("offers an editor's shared row no Share", () => {
    setup([
      { id: "ed", name: "Edit me", accessRole: "editor" },
      { id: "own", name: "Mine", accessRole: "owner" },
    ]);
    expect(screen.queryByRole("button", { name: "Share Edit me" })).toBeNull();
    expect(screen.getByRole("button", { name: "Share Mine" })).toBeInTheDocument();
  });

  it("is absent for a user with no dashboard at all", () => {
    renderWithStore(
      <MobileShell isMobileNavSheetOpen onClose={jest.fn()} />,
      {
        auth: {
          status: "authenticated",
          currentUser: { id: "me", email: "me@example.test", displayName: "Me" } as never,
        },
        dashboards: { items: [], selectedDashboardId: null, status: "succeeded" },
      },
      "/dashboards",
    );
    expect(screen.queryByRole("button", { name: "Build your own dashboard" })).toBeNull();
  });

  it("gives the sheet row the same leading icon as the sidebar row", () => {
    setup([{ id: "vw", name: "Theirs", accessRole: "viewer" }]);
    const row = screen.getByRole("button", { name: "Build your own dashboard" });
    expect(row.querySelector("svg")).not.toBeNull();
  });
});
