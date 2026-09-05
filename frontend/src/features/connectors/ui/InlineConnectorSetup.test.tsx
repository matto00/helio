// HEL-829 tasks.md 3.4 — the runtime backstop for the "agents never see this
// key" claim (design.md Decision 4b), respecified against this design's real
// carriers (Decision 3, Point 7's carrier statement): the submitted test
// credential must be absent from router `location.state` and from every
// Redux slice's serialized state, and present in ONLY the `POST
// /api/connectors` outbound request body — no other captured request.
//
// Uses an obviously-fake test value only (`test-fake-key-do-not-use`) — never
// a real credential/token, per this ticket's own evidence-hygiene rule.

import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { connectorsReducer } from "../state/connectorsSlice";
import type { Connector } from "../types/connector";
import type { UnresolvedConnectorRef } from "../../proposals/utils/unresolvedConnectorRefs";
import { InlineConnectorSetup } from "./InlineConnectorSetup";
import { httpClient } from "../../../services/httpClient";

jest.mock("../../../services/httpClient", () => ({
  httpClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedHttpClient = httpClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const TEST_CREDENTIAL = "test-fake-key-do-not-use";

const createdConnector: Connector = {
  id: "conn-new",
  ownerId: "u1",
  name: "Stripe",
  kind: "rest_api",
  baseUrl: "https://api.stripe.com",
  config: { authType: "bearer" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  dependentCount: 0,
};

const reference: UnresolvedConnectorRef = {
  key: "pipeline-source",
  draft: {
    name: "Stripe",
    baseUrl: "https://api.stripe.com",
    authType: "bearer",
    retrievalInstructions: "Generate a key at https://dashboard.stripe.com/apikeys",
  },
};

function makeStore() {
  return configureStore({ reducer: { connectors: connectorsReducer } });
}

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="location-state">{JSON.stringify(location.state ?? null)}</div>;
}

function renderSetup(onResolved: (id: string) => void) {
  const store = makeStore();
  const utils = render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[
          { pathname: "/pipeline-proposals/review", state: { proposal: { pipelineName: "P" } } },
        ]}
      >
        <Routes>
          <Route
            path="/pipeline-proposals/review"
            element={
              <>
                <RouteProbe />
                <InlineConnectorSetup reference={reference} onResolved={onResolved} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { ...utils, store };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedHttpClient.post.mockResolvedValue({ data: createdConnector });
});

describe("InlineConnectorSetup — credential carrier discipline (HEL-829 AC, demonstrated red pair)", () => {
  it("submits the credential ONLY in the POST /api/connectors body — absent from router state and Redux state, before and after", async () => {
    const onResolved = jest.fn();
    const { store } = renderSetup(onResolved);

    const beforeLocationState = screen.getByTestId("location-state").textContent ?? "";
    expect(beforeLocationState).not.toContain(TEST_CREDENTIAL);

    fireEvent.change(screen.getByLabelText(/bearer token value/i), {
      target: { value: TEST_CREDENTIAL },
    });
    fireEvent.click(screen.getByRole("button", { name: /create connector/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("conn-new", "pipeline-source"));

    // ONLY carrier: the POST /api/connectors body.
    expect(mockedHttpClient.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockedHttpClient.post.mock.calls[0];
    expect(url).toBe("/api/connectors");
    expect(JSON.stringify(body)).toContain(TEST_CREDENTIAL);

    expect(mockedHttpClient.get).not.toHaveBeenCalled();
    expect(mockedHttpClient.patch).not.toHaveBeenCalled();
    expect(mockedHttpClient.put).not.toHaveBeenCalled();
    expect(mockedHttpClient.delete).not.toHaveBeenCalled();

    // Absent from router state after submission (never navigated/written to).
    const afterLocationState = screen.getByTestId("location-state").textContent ?? "";
    expect(afterLocationState).not.toContain(TEST_CREDENTIAL);

    // Absent from the ENTIRE serialized Redux store (createConnector.fulfilled
    // only ever stores the response `Connector`, which has no credential field).
    expect(JSON.stringify(store.getState())).not.toContain(TEST_CREDENTIAL);
  });
});
