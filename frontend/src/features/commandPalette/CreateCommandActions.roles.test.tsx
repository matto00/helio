// HEL-1782 D3: with a viewer's dashboard open the palette offers no entry that edits it ("Add panel"), keeps the
// entries that create the caller's own resources, and an editor keeps "Add panel".
import { act, screen } from "@testing-library/react";

import { renderWithStore } from "../../test/renderWithStore";
import { CommandPaletteProvider } from "./CommandPaletteProvider";
import { CreateCommandActions } from "./CreateCommandActions";
import { useCommandRegistryActions } from "./hooks";

function Titles() {
  const actions = useCommandRegistryActions();
  return (
    <ul data-testid="titles">
      {actions.map((a) => (
        <li key={a.id}>{a.title}</li>
      ))}
    </ul>
  );
}

function titlesFor(accessRole: "owner" | "editor" | "viewer"): string[] {
  act(() => {
    renderWithStore(
      <CommandPaletteProvider>
        <CreateCommandActions />
        <Titles />
      </CommandPaletteProvider>,
      {
        auth: { status: "authenticated", currentUser: { id: "me" } as never },
        dashboards: {
          items: [
            {
              id: "d1",
              name: "Board",
              accessRole,
              ownerId: accessRole === "owner" ? "me" : "other",
            },
          ],
          selectedDashboardId: "d1",
          status: "succeeded",
        },
      },
      "/dashboards",
    );
  });
  return screen.getAllByRole("listitem").map((el) => el.textContent ?? "");
}

describe("CreateCommandActions by role (HEL-1782)", () => {
  it("a viewer has no Add panel but keeps New dashboard", () => {
    const titles = titlesFor("viewer");
    expect(titles).toContain("New dashboard");
    expect(titles).not.toContain("Add panel");
  });

  it("an editor keeps Add panel", () => {
    expect(titlesFor("editor")).toContain("Add panel");
  });
});
