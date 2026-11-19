// HEL-1773: `POST /api/panels/:id/submit` is owner-only for every non-owner (editors included), so a form on a shared
// dashboard offers no fields to submit.
import { render, screen } from "@testing-library/react";

import { DashboardAccessProvider } from "../../../dashboards/state/dashboardAccessContext";
import { makeFormPanel } from "../../../../test/panelFixtures";
import { FormRenderer } from "./FormRenderer";

jest.mock("../form/FormPanelView", () => ({
  FormPanelView: () => <p>the form</p>,
}));

const panel = makeFormPanel({
  config: {
    fields: [{ id: "f1", label: "Note", control: "text", sourceField: "note" } as never],
  } as never,
});

it.each([
  ["owner", true],
  ["editor", false],
  ["viewer", false],
] as const)("%s sees the form: %s", (role, sees) => {
  render(
    <DashboardAccessProvider role={role}>
      <FormRenderer panel={panel} />
    </DashboardAccessProvider>,
  );
  expect(screen.queryByText("the form") !== null).toBe(sees);
  expect(screen.queryByText("Only the owner can submit this form") !== null).toBe(!sees);
});
