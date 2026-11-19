// HEL-1784: a dashboard's owner and editors submit its forms; a viewer is told who can. Which schema route the form
// reads follows whether the signed-in user owns the FORM (`panel.ownerId`), which only the form's owner and the
// dashboard owner ever receive, so an unknown owner fails closed to "not the owner".
import { screen } from "@testing-library/react";

import { DashboardAccessProvider } from "../../../dashboards/state/dashboardAccessContext";
import { makeFormPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import { testUser } from "../../../../test/tabsTestStore";
import { FormRenderer } from "./FormRenderer";

jest.mock("../form/FormPanelView", () => ({
  FormPanelView: ({ formOwnerId }: { formOwnerId?: string }) => (
    <p>the form of {String(formOwnerId)}</p>
  ),
}));

const fields = [{ id: "f1", label: "Note", control: "text", sourceField: "note" } as never];

function renderAs(role: "owner" | "editor" | "viewer", ownerId: string | null = "someone-else") {
  const base = makeFormPanel({ config: { fields } as never });
  const panel = { ...base, ownerId: ownerId ?? undefined };
  return renderWithStore(
    <DashboardAccessProvider role={role}>
      <FormRenderer panel={panel} />
    </DashboardAccessProvider>,
    { auth: { currentUser: testUser(undefined, "user-1") } },
  );
}

it.each([
  ["owner", true],
  ["editor", true],
  ["viewer", false],
] as const)("%s sees the form: %s", (role, sees) => {
  renderAs(role);
  expect(screen.queryByText(/^the form/) !== null).toBe(sees);
  expect(screen.queryByText("Only editors can submit this form") !== null).toBe(!sees);
});

it("hands the panel's owner id to the form body", () => {
  renderAs("editor", "form-owner");
  expect(screen.getByText("the form of form-owner")).toBeInTheDocument();
});

it("hands on an absent owner id as absent", () => {
  renderAs("editor", null);
  expect(screen.getByText("the form of undefined")).toBeInTheDocument();
});
