// HEL-1838 -- the History card's "Request Beta access" link is shown to every role that can open the sheet on a
// free-owned pipeline: a viewer (read-only), an editor and the sheet's fail-closed default (no `readOnly` prop).
// Every query is scoped to the History card: a free-tier user's Ask panel has an upsell with the same accessible name.

import { configureStore } from "@reduxjs/toolkit";
import { render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { authReducer } from "../../../auth/state/authSlice";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { UserTier } from "../../../auth/types/user";
import type { Output } from "../../types/output";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

beforeEach(() => {
  http.get.mockImplementation((url: string) =>
    url.endsWith("/panels")
      ? Promise.resolve({ data: [] })
      : Promise.resolve({
          data: {
            columns: [{ name: "amount", dataType: "number", nullable: false }],
            capabilities: {},
            rows: [],
            rowCount: 0,
            stepRowCounts: {},
            sourceRowCount: 0,
            blocked: false,
            sourceTruncated: false,
            truncatedReads: [],
          },
        }),
  );
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const LINK_NAME = "Request Beta access (opens in a new tab)";

// A saved, non-insight Output on a free-owned pipeline (`historyPayloadsAvailable: false`).
const OUTPUT: Output = {
  id: "o-1",
  pipelineId: "p-1",
  nodeStepId: "step-1",
  ownerId: "u-owner",
  name: "Revenue",
  kind: "metric",
  config: { fieldMapping: {}, aggregation: { value: "amount", agg: "sum" } },
  schema: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  historyPayloadsAvailable: false,
};

/** `readOnly` is passed only when defined, so `undefined` exercises the sheet's own fail-closed default. */
function renderSheet(props: { readOnly?: boolean; isPipelineOwner: boolean }) {
  const initial = authReducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: { outputs: outputsReducer, auth: authReducer },
    preloadedState: {
      outputs: outputsReducer(undefined, { type: "init" }),
      auth: {
        ...initial,
        currentUser: {
          id: "u-grantee",
          email: "g@test.local",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier: "free" as UserTier,
        },
      },
    },
  });
  render(
    <MemoryRouter>
      <Provider store={store}>
        <OutputEditorSheet
          {...(props.readOnly === undefined ? {} : { readOnly: props.readOnly })}
          isPipelineOwner={props.isPipelineOwner}
          open
          onClose={jest.fn()}
          pipelineId="p-1"
          output={OUTPUT}
          createTargetStepId="step-1"
          steps={[]}
        />
      </Provider>
    </MemoryRouter>,
  );
}

const historyCard = (): HTMLElement =>
  screen
    .getByRole("heading", { name: "History", level: 3 })
    .closest(".output-editor-sheet__group--card") as HTMLElement;

function expectUpsell(): HTMLElement {
  const card = historyCard();
  const link = within(card).getByRole("link", { name: LINK_NAME });
  expect(link).toHaveAttribute("href", "/settings#beta-access");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).not.toHaveAttribute("aria-disabled");
  expect(within(card).getByText("Free stores run summaries only")).toBeInTheDocument();
  return link;
}

describe("OutputEditorSheet -- History upsell by role (HEL-1838)", () => {
  it("a viewer (read-only, not the pipeline owner) sees a live link inside the disabled fieldset", () => {
    renderSheet({ readOnly: true, isPipelineOwner: false });
    const link = expectUpsell();
    expect(link.closest("fieldset")).toBeDisabled();
  });

  it("an editor (not read-only, not the pipeline owner) sees the link", () => {
    renderSheet({ readOnly: false, isPipelineOwner: false });
    const link = expectUpsell();
    expect(link.closest("fieldset")).toBeNull();
  });

  it("the sheet's fail-closed default (no readOnly prop) still shows the link", () => {
    renderSheet({ isPipelineOwner: false });
    const link = expectUpsell();
    expect(link.closest("fieldset")).toBeDisabled();
  });

  it("the pipeline owner sees the link", () => {
    renderSheet({ readOnly: false, isPipelineOwner: true });
    expectUpsell();
  });
});
