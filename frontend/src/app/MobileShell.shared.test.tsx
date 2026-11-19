// HEL-1773 D7/D5: the phone dashboards sheet lists a shared dashboard marked "Shared" and offers "Share" on owned rows only.
import { screen } from "@testing-library/react";

import { renderWithStore } from "../test/renderWithStore";
import { MobileShell } from "./MobileShell";

it("marks the shared row and offers Share only on the owned one", () => {
  renderWithStore(
    <MobileShell isMobileNavSheetOpen onClose={jest.fn()} />,
    {
      auth: {
        status: "authenticated",
        currentUser: { id: "me", email: "me@example.test", displayName: "Me" } as never,
      },
      dashboards: {
        items: [
          { id: "own", name: "Mine", accessRole: "owner", ownerId: "me" },
          { id: "vw", name: "Theirs", accessRole: "viewer", ownerId: "other" },
        ],
        selectedDashboardId: "own",
        status: "succeeded",
      },
    },
    "/dashboards",
  );
  expect(screen.getByText("Shared")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Share Mine" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Share Theirs" })).toBeNull();
});
