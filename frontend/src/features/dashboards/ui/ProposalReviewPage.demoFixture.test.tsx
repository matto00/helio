import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { dashboardsReducer } from "../state/dashboardsSlice";
import { fetchDataTypes } from "../../dataTypes/services/dataTypeService";
import { ProposalReviewPage } from "./ProposalReviewPage";
import type { DataType } from "../../dataTypes/types/dataType";

// HEL-539 (task 2.8/5.5 regression) — `ProposalReviewPage`'s DEV-only
// demo-fixture path (`useDemoFixture = IS_DEV && !stateProposal`) is only
// reachable with `IS_DEV=true`; every other test file in this feature relies
// on the global `config/env` mock (`IS_DEV=false`, see envMock.ts) to keep
// that path inert, so this scenario gets its own file with a local override
// instead of disturbing that shared assumption.
jest.mock("../../../config/env", () => ({
  API_BASE_URL: "",
  IS_DEV: true,
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
}));

const mockedFetchDataTypes = jest.mocked(fetchDataTypes);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

beforeEach(() => {
  mockedFetchDataTypes.mockReset();
});

const outputDataType: DataType = {
  id: "dt-1",
  sourceId: null,
  name: "Sales",
  fields: [
    { name: "region", displayName: "Region", dataType: "string", nullable: false },
    { name: "revenue", displayName: "Revenue", dataType: "float", nullable: false },
  ],
  computedFields: [],
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderPage() {
  return render(
    <Provider store={configureStore({ reducer: { dashboards: dashboardsReducer } })}>
      <MemoryRouter initialEntries={[{ pathname: "/proposals/review", state: null }]}>
        <Routes>
          <Route path="/proposals/review" element={<ProposalReviewPage />} />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe("ProposalReviewPage — demo-fixture load error + retry (HEL-539 D5/task 2.8)", () => {
  it("shows a Retry action on load failure, and a successful retry clears loadError and renders the synthesized proposal", async () => {
    mockedFetchDataTypes.mockRejectedValueOnce(new Error("network down"));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the workspace");
    // The pre-existing "Back to dashboards" secondary action is kept
    // alongside Retry (design D5 — this fetch is DEV-only demo-fixture data).
    expect(screen.getByRole("button", { name: "Back to dashboards" })).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });

    mockedFetchDataTypes.mockResolvedValueOnce([outputDataType]);
    fireEvent.click(retryBtn);

    // The retry must clear loadError immediately, not just once the new
    // fetch resolves — otherwise the stale error renders forever (the exact
    // defect task 2.8 fixes).
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    await waitFor(() => expect(screen.getByDisplayValue("Sales overview")).toBeInTheDocument());
    expect(mockedFetchDataTypes).toHaveBeenCalledTimes(2);
  });

  it("a second retry after another failure dispatches fetchDataTypes again and still recovers", async () => {
    // Both failures queued up front — the retry effect fires synchronously
    // on click, before any assertion/wait can re-arm the mock in between.
    mockedFetchDataTypes.mockRejectedValueOnce(new Error("network down"));
    mockedFetchDataTypes.mockRejectedValueOnce(new Error("still down"));
    mockedFetchDataTypes.mockResolvedValueOnce([outputDataType]);
    renderPage();

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByDisplayValue("Sales overview")).toBeInTheDocument());
    expect(mockedFetchDataTypes).toHaveBeenCalledTimes(3);
  });
});
