// HEL-528 design.md D13 — locks the panel body's pre-dispatch frame at the
// COMPONENT level, driven through `PanelCardBody`/`usePanelData` (the grid
// path) and through `PanelDetailModal` (which uses the same hook with no
// override at all).
//
// A normal `render()`/`act()` call flushes the mount effect's dispatch
// synchronously, and `fetchPanelPage.pending` populates `paginationState`
// synchronously too — so a REAL reducer's `paginationState` is already
// defined by the time any assertion can run, racing straight past the exact
// frame these decisions closes (see `usePanelData.test.ts`'s "pre-dispatch
// frame" describe block for the same reasoning at the hook level). The
// wrapped reducer below runs the real `panelsReducer` for everything (item
// lookup, etc. all behave normally) but pins `paginationState` at its seeded
// empty value regardless of what's dispatched, faithfully holding the
// component in the state D13 cares about.
//
// HEL-909: an output-kind panel's renderer choice now ALSO depends on
// `useOutputMeta`'s own `GET /api/outputs/:id` fetch — `getOutputById` is
// mocked to a never-resolving promise here so the body stays on its
// kind-agnostic loading skeleton for the whole test, mirroring the frozen
// pagination state's intent.

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { makeOutputPanel } from "../../../test/panelFixtures";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { panelsReducer } from "../state/panelsSlice";
import { PanelCardBody } from "./PanelCard";
import { PanelDetailModal } from "./detailModal/PanelDetailModal";
import type { Panel } from "../types/panel";

jest.mock("../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(() => new Promise(() => {})),
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
}));

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

function makeFrozenPaginationStore(panel: Panel) {
  const seed = panelsReducer(undefined, { type: "@@INIT" });
  const frozen = { ...seed, items: [panel] };
  return configureStore({
    reducer: {
      panels: (state = frozen, action: UnknownAction) => {
        const next = panelsReducer(state as never, action as never);
        return { ...next, paginationState: frozen.paginationState };
      },
    } as never,
  });
}

function renderCardBody(panel: Panel) {
  const store = makeFrozenPaginationStore(panel);
  return render(
    <Provider store={store}>
      <PanelCardBody panel={panel} frozen={false} />
    </Provider>,
  );
}

describe("PanelCardBody — pre-dispatch frame (design.md D13)", () => {
  it("a bound output panel shows the skeleton, not '--'/'No data', before its fetch is dispatched", () => {
    const panel = makeOutputPanel();
    const { container } = renderCardBody(panel);

    expect(container.querySelector(".panel-body-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("--")).not.toBeInTheDocument();
    expect(screen.queryByText("No data available")).not.toBeInTheDocument();
  });
});

describe("PanelDetailModal — pre-dispatch frame (design.md D13)", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  it("inherits the same skeleton-before-dispatch behaviour for a bound output panel", () => {
    const panel = makeOutputPanel();
    const store = makeFrozenPaginationStore(panel);
    const { container } = render(
      <MemoryRouter>
        <Provider store={store}>
          <ThemeProvider>
            <PanelDetailModal panel={panel} onClose={jest.fn()} />
          </ThemeProvider>
        </Provider>
      </MemoryRouter>,
    );

    expect(container.querySelector(".panel-body-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("--")).not.toBeInTheDocument();
    expect(screen.queryByText("No data available")).not.toBeInTheDocument();
  });
});
