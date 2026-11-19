// HEL-1773 D7: the phone chip row lists shared dashboards, marked "Shared" (visible text and accessible name).
import { screen, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DashboardChipRow, resetDashboardChipOrderForTests } from "./DashboardChipRow";

beforeEach(() => {
  resetDashboardChipOrderForTests();
  window.localStorage.clear();
});

it("marks a shared dashboard's chip and leaves an owned one plain", () => {
  renderWithStore(<DashboardChipRow />, {
    auth: { status: "authenticated", currentUser: { id: "me" } as never },
    dashboards: {
      items: [
        { id: "own", name: "Mine", accessRole: "owner", ownerId: "me" },
        { id: "vw", name: "Theirs", accessRole: "viewer", ownerId: "other" },
      ],
      selectedDashboardId: "own",
      status: "succeeded",
    },
  });
  const shared = screen.getByRole("button", { name: "Theirs (Shared)" });
  expect(within(shared).getByText("Shared")).toBeInTheDocument();
  expect(within(screen.getByRole("button", { name: "Mine" })).queryByText("Shared")).toBeNull();
});
