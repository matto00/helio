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
