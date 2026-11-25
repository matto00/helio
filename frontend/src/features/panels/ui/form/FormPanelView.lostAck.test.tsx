// HEL-1175 — a counter click whose acknowledgement is lost is re-sent automatically with the same key, and the
// server's replayed 200 settles it as an ordinary success: one increment, no error. Mocked at the HTTP layer
// (`httpClient`), NOT `submitFormPanel`, so the real retry runs.
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { AxiosError } from "axios";

import { FormPanelView } from "./FormPanelView";
import { httpClient } from "../../../../services/httpClient";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchFieldAggregate as fetchFieldAggregateRequest,
} from "../../../sources/services/dataSourceService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { testUser } from "../../../../test/tabsTestStore";
import type { FormPanelConfig } from "../../types/panel";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { post: jest.fn() },
}));
jest.mock("../../../sources/services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
  fetchFieldAggregate: jest.fn(),
}));

const post = jest.mocked(httpClient.post);
const fetchDatasetSchema = jest.mocked(fetchDatasetSchemaRequest);
const fetchFieldAggregate = jest.mocked(fetchFieldAggregateRequest);

const config: FormPanelConfig = {
  dataSourceId: "ds-2",
  fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
  submit: { writeMode: "append", resetOnSuccess: false },
};

describe("compact counter, lost acknowledgement (HEL-1175)", () => {
  it("retries with the same key, shows one increment and announces no error", async () => {
    fetchDatasetSchema.mockResolvedValueOnce({
      fields: [
        { name: "delta", type: "integer", required: false },
        { name: "occurred_at", type: "timestamp", required: false },
        { name: "value", type: "integer", required: false },
      ],
    });
    fetchFieldAggregate.mockResolvedValue({ field: "delta", op: "sum", value: 5 });
    // Bodies are deep-copied at call time so an in-place change of the key between attempts would show.
    const bodies: Array<{ values: unknown; submitKey: string }> = [];
    post.mockImplementation((_url: string, body?: unknown) => {
      bodies.push(JSON.parse(JSON.stringify(body)) as { values: unknown; submitKey: string });
      return bodies.length === 1
        ? Promise.reject(new AxiosError("Network Error", "ERR_NETWORK"))
        : Promise.resolve({
            data: {
              rows: [{ id: "r1", seq: 0, updatedAt: "t" }],
              updatedAt: "t",
              deniedPipelines: [],
            },
          });
    });
    renderWithStore(
      <FormPanelView formOwnerId="user-1" title="Widgets" panelId="panel-2" config={config} />,
      { auth: { currentUser: testUser(undefined, "user-1") } },
    );
    const control = await screen.findByRole("spinbutton", { name: "Widgets" });

    fireEvent.click(screen.getByRole("button", { name: /increase widgets/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0].submitKey).toBeTruthy();
    expect(bodies[1].submitKey).toBe(bodies[0].submitKey);
    expect(bodies[0].values).toEqual({ delta: 5 });
    await waitFor(() => expect(control).toHaveAttribute("aria-valuenow", "5"));
    expect(document.querySelector(".form-panel-view__alert")).toHaveTextContent("");
    expect(document.querySelector(".form-panel-view__status")).toHaveTextContent(
      "The row was added.",
    );
  });
});
