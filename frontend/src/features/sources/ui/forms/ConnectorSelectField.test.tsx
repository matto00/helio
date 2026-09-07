// HEL-845 design.md Decision 5 / evidence plan step 4: the picker must list only `rest_api`
// Connectors. A content assertion on the rendered options, not a focus/visibility assertion —
// jsdom has no layout, so any focus/visibility claim here would be vacuous by construction.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";

import { connectorsReducer } from "../../../connectors/state/connectorsSlice";
import type { Connector } from "../../../connectors/types/connector";
import { ConnectorSelectField } from "./ConnectorSelectField";

const restConnector: Connector = {
  id: "conn-rest",
  ownerId: "u1",
  name: "Stripe",
  kind: "rest_api",
  baseUrl: "https://api.stripe.com",
  config: { authType: "bearer" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  dependentCount: 0,
  pending: false,
};

const sqlConnector: Connector = {
  id: "conn-sql",
  ownerId: "u1",
  name: "Warehouse",
  kind: "sql",
  baseUrl: "postgres://warehouse.internal",
  config: { authType: "none" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  dependentCount: 0,
  pending: false,
};

function renderField(items: Connector[]) {
  const store = configureStore({
    reducer: { connectors: connectorsReducer },
    preloadedState: {
      connectors: { items, status: "succeeded" as const, error: null, deleteConflict: {} },
    },
  });
  render(
    <Provider store={store}>
      <ConnectorSelectField connector={null} onChange={() => {}} />
    </Provider>,
  );
}

describe("ConnectorSelectField kind filtering (HEL-845)", () => {
  it("lists a rest_api Connector but excludes a sql-kind Connector from the options", () => {
    renderField([restConnector, sqlConnector]);

    fireEvent.click(screen.getByRole("combobox", { name: "Connector" }));
    const optionLabels = screen.getAllByRole("option").map((option) => option.textContent);

    expect(optionLabels.some((label) => label?.includes("Stripe"))).toBe(true);
    expect(optionLabels.some((label) => label?.includes("Warehouse"))).toBe(false);
  });

  it("shows an explanatory empty state instead of a bare empty control when no rest_api Connector exists", () => {
    renderField([sqlConnector]);

    expect(screen.queryByRole("combobox", { name: "Connector" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/no REST Connector/i).length).toBeGreaterThan(0);
  });
});
